import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  jest,
} from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { getRole } from './helpers/permissions'

const PASSWORD = 'Sup3r-secret'
const ADMIN_PASSWORD = 'Password123!'
const USER_UID = 'plugin::users-permissions.user'

interface Line {
  level: 'info' | 'warn'
  message: string
  meta: Record<string, unknown>
}

describe('Refused token events (ASVS V16.3.1)', () => {
  /** Every info and warn call of the current test, serialised, for the leak check. */
  let seen: string[] = []
  let lines: Line[] = []
  const spies: Array<ReturnType<typeof jest.spyOn>> = []

  const http = () => request(strapi.server.httpServer)
  const securityLines = () => lines.filter((l) => l.message.startsWith('security: auth.'))
  const events = () => securityLines().map((l) => l.meta.event)
  const only = () => {
    expect(securityLines()).toHaveLength(1)
    return securityLines()[0]
  }
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
  const jwtFor = (user: { id: number }) =>
    strapi.plugin('users-permissions').service('jwt').issue({ id: user.id })
  const createUser = async (username: string) => {
    const role = await getRole('authenticated')
    return strapi
      .plugin('users-permissions')
      .service('user')
      .add({
        username,
        email: `${username}@example.com`,
        password: PASSWORD,
        provider: 'local',
        confirmed: true,
        role: role.id,
      })
  }
  const createAdmin = async (name: string) => {
    const superAdmin = await strapi.service('admin::role').getSuperAdmin()
    return strapi.service('admin::user').create({
      email: `${name}@example.com`,
      firstname: name,
      password: ADMIN_PASSWORD,
      isActive: true,
      registrationToken: null,
      roles: [superAdmin.id],
    })
  }

  beforeAll(async () => {
    await setupStrapi()
    for (const level of ['info', 'warn'] as const) {
      spies.push(
        jest.spyOn(strapi.log, level).mockImplementation(((
          message: string,
          meta?: Record<string, unknown>
        ) => {
          lines.push({ level, message: String(message), meta: meta ?? {} })
          seen.push(JSON.stringify({ message, meta }))
        }) as never)
      )
    }
  })

  beforeEach(() => {
    lines = []
    seen = []
  })

  /** No test may write an email, password, token, cookie or raw address. */
  afterEach(() => {
    const output = seen.join('\n')
    for (const secret of [
      '@example.com',
      PASSWORD,
      ADMIN_PASSWORD,
      'Wrong-pass-1',
      '127.0.0.1',
      '::1',
      'eyJ',
      'strapi_admin_refresh',
      'garbage-token',
      'Bearer',
    ]) {
      expect(output).not.toContain(secret)
    }
  })

  afterAll(async () => {
    for (const spy of spies) spy.mockRestore()
    await cleanupStrapi()
  })

  const garbage = bearer('garbage-token-0123456789')

  it.each([
    ['a reader JWT', '/api/users/me'],
    ['a Content API token', '/api/articles'],
    ['an admin session', '/admin/users/me'],
    ['an admin token on /mcp', '/mcp'],
  ])('logs one auth.token.invalid for %s', async (_label, path) => {
    const res = await (path === '/mcp' ? http().post(path).send({}) : http().get(path)).set(garbage)
    expect(res.status).toBe(401)
    expect(only()).toMatchObject({
      level: 'warn',
      meta: {
        event: 'auth.token.invalid',
        outcome: 'failure',
        reason: 'invalid-token',
        path,
        client: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
    })
    expect(Object.keys(only().meta).sort()).toEqual([
      'client',
      'event',
      'outcome',
      'path',
      'reason',
    ])
  })

  it('logs a JWT revoked by a later password change', async () => {
    const user = await createUser('revoked')
    const jwt = jwtFor(user)
    await strapi.db.query(USER_UID).update({
      where: { id: user.id },
      data: { passwordChangedAt: new Date(Date.now() + 10_000) },
    })
    const res = await http().get('/api/users/me').set(bearer(jwt))
    expect(res.status).toBe(401)
    expect(events()).toEqual(['auth.token.invalid'])
  })

  it('does not log a 401 that carries no token', async () => {
    await http().get('/api/users/me').expect(403)
    await http().get('/admin/users/me').expect(401)
    expect(securityLines()).toHaveLength(0)
  })

  it('does not log a valid token', async () => {
    const user = await createUser('valid-token')
    await http()
      .get('/api/users/me')
      .set(bearer(jwtFor(user)))
      .expect(200)
    expect(securityLines()).toHaveLength(0)
  })

  it('logs one line, not two, for a request that already wrote an event', async () => {
    await createAdmin('double')
    await http()
      .post('/admin/login')
      .set(garbage)
      .send({ email: 'double@example.com', password: 'Wrong-pass-1' })
    expect(securityLines()).toHaveLength(1)

    lines = []
    await http()
      .post('/admin/access-token')
      .set(garbage)
      .set('Cookie', 'strapi_admin_refresh=garbage-token')
      .expect(401)
    expect(events()).toEqual(['auth.session-refresh.failure'])

    lines = []
    const res = await http()
      .post('/api/auth/local')
      .set(garbage)
      .send({ identifier: 'nobody@example.com', password: 'Wrong-pass-1' })
    expect(res.status).toBe(401)
    expect(events()).toEqual(['auth.token.invalid'])
  })

  it('does not log a valid Content API token that a route refuses for lack of a user', async () => {
    const created = await strapi
      .service('admin::api-token')
      .create({ name: 'full', description: '', type: 'full-access', lifespan: null })
    const token = bearer(created.accessKey)

    const me = await http().get('/api/users/me').set(token)
    expect(me.status).toBe(401)
    const destroy = await http().delete('/api/users/me').set(token).send({ password: PASSWORD })
    expect(destroy.status).toBe(401)
    expect(securityLines()).toHaveLength(0)
  })

  it('does not log a refresh call that carries a stale bearer and no cookie', async () => {
    const res = await http().post('/admin/access-token').set(garbage)
    expect(res.status).toBe(401)
    expect(res.body.error.message).toBe('Missing refresh token')
    expect(securityLines()).toHaveLength(0)
  })
})
