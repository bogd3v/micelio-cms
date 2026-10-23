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

interface SentEmail {
  to: string
  html?: string
  text?: string
}
interface Line {
  level: 'info' | 'warn'
  message: string
  meta: Record<string, unknown>
}

describe('Authentication security events (ASVS V16.3.1)', () => {
  const sent: SentEmail[] = []
  /** Every info and warn call of the current test, serialised, for the leak check. */
  let seen: string[] = []
  let lines: Line[] = []
  let failLogging = false
  const spies: Array<ReturnType<typeof jest.spyOn>> = []

  const http = () => request(strapi.server.httpServer)
  const securityLines = () => lines.filter((l) => l.message.startsWith('security: '))
  const events = () => securityLines().map((l) => l.meta.event)
  const linkIn = (email: SentEmail): URL => {
    const link = /href="([^"]+)"/.exec(email.html ?? email.text ?? '')?.[1]
    if (!link) throw new Error('The email has no link')
    return new URL(link)
  }
  const createUser = async (username: string, extra: Record<string, unknown> = {}) => {
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
        ...extra,
      })
  }

  beforeAll(async () => {
    await setupStrapi()
    strapi.plugin('email').service('email').send = async (options: SentEmail) => {
      sent.push(options)
    }
    for (const level of ['info', 'warn'] as const) {
      spies.push(
        jest.spyOn(strapi.log, level).mockImplementation(((
          message: string,
          meta?: Record<string, unknown>
        ) => {
          if (failLogging && String(message).startsWith('security: ')) {
            throw new Error('the log is down')
          }
          lines.push({ level, message: String(message), meta: meta ?? {} })
          seen.push(JSON.stringify({ message, meta }))
        }) as never)
      )
    }
  })

  beforeEach(() => {
    lines = []
    seen = []
    sent.length = 0
    failLogging = false
  })

  /** No test may write an email, password, code, token or raw address, whatever it checks. */
  afterEach(() => {
    const output = seen.join('\n')
    for (const secret of [
      '@example.com',
      PASSWORD,
      'An0ther-secret',
      'Password123!',
      'Wrong-pass-1',
      '127.0.0.1',
      '::1',
      'eyJ',
      'confirmation=',
    ]) {
      expect(output).not.toContain(secret)
    }
  })

  afterAll(async () => {
    for (const spy of spies) spy.mockRestore()
    await cleanupStrapi()
  })

  it('logs a successful sign-in with the user id and the answer unchanged', async () => {
    const user = await createUser('signin-ok')
    const res = await http()
      .post('/api/auth/local')
      .send({ identifier: 'signin-ok@example.com', password: PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.jwt).toEqual(expect.any(String))
    expect(res.body.user).toMatchObject({ id: user.id, username: 'signin-ok' })
    expect(securityLines()).toHaveLength(1)
    expect(securityLines()[0]).toMatchObject({
      level: 'info',
      message: 'security: auth.login.success',
      meta: {
        event: 'auth.login.success',
        outcome: 'success',
        actor: String(user.id),
        client: expect.stringMatching(/^[0-9a-f]{16}$/),
        path: '/api/auth/local',
      },
    })
  })

  it('logs failed sign-ins as warnings and answers an unknown account like a wrong password', async () => {
    await createUser('signin-bad')
    const wrong = await http()
      .post('/api/auth/local')
      .send({ identifier: 'signin-bad@example.com', password: 'Wrong-pass-1' })
    const unknown = await http()
      .post('/api/auth/local')
      .send({ identifier: 'nobody@example.com', password: 'Wrong-pass-1' })

    expect(wrong.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.message).toBe('Invalid identifier or password')
    expect(unknown.body).toEqual(wrong.body)
    expect(securityLines()).toHaveLength(2)
    for (const line of securityLines()) {
      expect(line.level).toBe('warn')
      expect(line.meta).toMatchObject({
        event: 'auth.login.failure',
        outcome: 'failure',
        reason: 'invalid-credentials',
        client: expect.stringMatching(/^[0-9a-f]{16}$/),
      })
      expect(line.meta).not.toHaveProperty('actor')
    }
  })

  it('logs a blocked account with its own reason', async () => {
    await createUser('signin-blocked', { blocked: true })
    const res = await http()
      .post('/api/auth/local')
      .send({ identifier: 'signin-blocked@example.com', password: PASSWORD })
      .expect(400)

    expect(res.body.error.message).toBe('Your account has been blocked by an administrator')
    expect(securityLines()[0].meta).toMatchObject({
      event: 'auth.login.failure',
      reason: 'blocked-account',
    })
  })

  it('logs registration, email confirmation, password reset requests and completions', async () => {
    sent.length = 0
    const registered = await http()
      .post('/api/auth/local/register')
      .send({ username: 'flow', email: 'flow@example.com', password: PASSWORD })
      .expect(200)
    expect(securityLines()[0].meta).toMatchObject({
      event: 'auth.register',
      actor: String(registered.body.user.id),
    })

    const token = linkIn(sent[0]).searchParams.get('confirmation')
    lines = []
    const unconfirmed = await http()
      .post('/api/auth/local')
      .send({ identifier: 'flow@example.com', password: PASSWORD })
      .expect(400)
    expect(unconfirmed.body.error.message).toBe('Your account email is not confirmed')
    expect(securityLines()).toHaveLength(1)
    expect(securityLines()[0].meta).toMatchObject({
      event: 'auth.login.failure',
      reason: 'unconfirmed-account',
    })
    lines = []
    // The GET only redirects: not an event.
    await http().get(`/api/auth/email-confirmation?confirmation=${token}`).expect(303)
    expect(securityLines()).toHaveLength(0)
    await http().post('/api/auth/email-confirmation').send({ confirmation: token }).expect(204)
    expect(events()).toEqual(['auth.email-confirmation.confirmed'])

    // A token that confirms nothing is a failure; a second use of the real one too.
    for (const bad of ['a'.repeat(40), token, 'not-a-token']) {
      lines = []
      const res = await http()
        .post('/api/auth/email-confirmation')
        .send({ confirmation: bad })
        .expect(400)
      expect(res.body.error.message).toBe('Invalid token')
      expect(securityLines()).toHaveLength(1)
      expect(securityLines()[0]).toMatchObject({
        level: 'warn',
        meta: { event: 'auth.email-confirmation.failure', reason: 'invalid-token' },
      })
    }
    lines = []
    await http().get('/api/auth/email-confirmation?confirmation=bad').expect(303)
    expect(securityLines()).toHaveLength(0)

    sent.length = 0
    lines = []
    const known = await http()
      .post('/api/auth/forgot-password')
      .send({ email: 'flow@example.com' })
      .expect(200)
    const unknown = await http()
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200)
    expect(unknown.body).toEqual(known.body)
    expect(known.body).toEqual({ ok: true })
    expect(events()).toEqual(['auth.password-reset.requested', 'auth.password-reset.requested'])
    for (const line of securityLines()) expect(line.meta).not.toHaveProperty('actor')

    lines = []
    const code = linkIn(sent[0]).searchParams.get('code')
    const next = 'An0ther-secret'
    const reset = await http()
      .post('/api/auth/reset-password')
      .send({ code, password: next, passwordConfirmation: next })
      .expect(200)
    expect(reset.body.jwt).toEqual(expect.any(String))
    expect(securityLines()).toHaveLength(1)
    expect(securityLines()[0].meta).toMatchObject({
      event: 'auth.password-reset.completed',
      actor: String(registered.body.user.id),
    })
  })

  it('logs a refused password reset with the code reason, or none for a rejected password', async () => {
    await createUser('reset-fail')
    sent.length = 0
    await http().post('/api/auth/forgot-password').send({ email: 'reset-fail@example.com' })
    const code = linkIn(sent[0]).searchParams.get('code')
    lines = []

    const wrongCode = await http()
      .post('/api/auth/reset-password')
      .send({
        code: 'f'.repeat(128),
        password: 'An0ther-secret',
        passwordConfirmation: 'An0ther-secret',
      })
      .expect(400)
    expect(wrongCode.body.error.message).toBe('Incorrect code provided')
    expect(securityLines()).toHaveLength(1)
    expect(securityLines()[0]).toMatchObject({
      level: 'warn',
      meta: { event: 'auth.password-reset.failure', reason: 'invalid-code' },
    })

    lines = []
    await http()
      .post('/api/auth/reset-password')
      .send({ code, password: 'password', passwordConfirmation: 'password' })
      .expect(400)
    expect(securityLines()).toHaveLength(1)
    expect(securityLines()[0].meta).toMatchObject({ event: 'auth.password-reset.failure' })
    expect(securityLines()[0].meta).not.toHaveProperty('reason')
  })

  it('logs every refused registration the same way, whatever the cause', async () => {
    await createUser('taken')
    const attempts = [
      { username: 'taken', email: 'other@example.com', password: PASSWORD },
      { username: 'fresh', email: 'taken@example.com', password: PASSWORD },
      { username: 'weak', email: 'weak@example.com', password: 'password' },
    ]
    for (const body of attempts) {
      lines = []
      await http().post('/api/auth/local/register').send(body).expect(400)
      expect(securityLines()).toHaveLength(1)
      expect(securityLines()[0]).toMatchObject({
        level: 'warn',
        meta: {
          event: 'auth.register.failure',
          outcome: 'failure',
          path: '/api/auth/local/register',
          client: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
      })
      expect(Object.keys(securityLines()[0].meta).sort()).toEqual(
        ['client', 'event', 'outcome', 'path'].sort()
      )
    }
  })

  it('logs sign-ins the same in refresh session mode', async () => {
    const user = await createUser('refresh-mode')
    const original = strapi.config.get('plugin::users-permissions.jwtManagement')
    strapi.config.set('plugin::users-permissions.jwtManagement', 'refresh')
    try {
      lines = []
      const res = await http()
        .post('/api/auth/local')
        .send({ identifier: 'refresh-mode@example.com', password: PASSWORD })
      expect(res.status).toBe(200)
      // Only the refresh mode answers with a refresh token.
      expect(res.body.refreshToken).toEqual(expect.any(String))
      expect(securityLines()).toHaveLength(1)
      expect(securityLines()[0].meta).toMatchObject({
        event: 'auth.login.success',
        actor: String(user.id),
      })
    } finally {
      strapi.config.set('plugin::users-permissions.jwtManagement', original)
    }
  })

  it('logs an admin panel sign-in and refusal, with the same answers', async () => {
    const superAdmin = await strapi.service('admin::role').getSuperAdmin()
    const admin = await strapi.service('admin::user').create({
      email: 'panel@example.com',
      firstname: 'Panel',
      password: 'Password123!',
      isActive: true,
      registrationToken: null,
      roles: [superAdmin.id],
    })

    const bad = await http()
      .post('/admin/login')
      .send({ email: 'panel@example.com', password: 'Wrong-pass-1!' })
    expect(bad.status).toBe(400)
    expect(securityLines()).toHaveLength(1)
    expect(securityLines()[0]).toMatchObject({
      level: 'warn',
      meta: {
        event: 'auth.login.failure',
        reason: 'invalid-credentials',
        path: '/admin/login',
        client: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
    })

    lines = []
    const ok = await http()
      .post('/admin/login')
      .send({ email: 'panel@example.com', password: 'Password123!' })
    expect(ok.status).toBe(200)
    expect(ok.body.data.token).toEqual(expect.any(String))
    expect(securityLines()).toHaveLength(1)
    expect(securityLines()[0]).toMatchObject({
      level: 'info',
      meta: { event: 'auth.login.success', actor: String(admin.id), path: '/admin/login' },
    })
  })

  it('does not change the answers when the log cannot be written', async () => {
    await createUser('log-down')
    const superAdmin = await strapi.service('admin::role').getSuperAdmin()
    await strapi.service('admin::user').create({
      email: 'down@example.com',
      firstname: 'Down',
      password: 'Password123!',
      isActive: true,
      registrationToken: null,
      roles: [superAdmin.id],
    })
    failLogging = true

    const ok = await http()
      .post('/api/auth/local')
      .send({ identifier: 'log-down@example.com', password: PASSWORD })
    const bad = await http()
      .post('/api/auth/local')
      .send({ identifier: 'log-down@example.com', password: 'Wrong-pass-1' })
    const adminOk = await http()
      .post('/admin/login')
      .send({ email: 'down@example.com', password: 'Password123!' })
    const adminBad = await http()
      .post('/admin/login')
      .send({ email: 'down@example.com', password: 'Wrong-pass-1!' })

    expect(ok.status).toBe(200)
    expect(ok.body.jwt).toEqual(expect.any(String))
    expect(bad.status).toBe(400)
    expect(bad.body.error.message).toBe('Invalid identifier or password')
    expect(adminOk.status).toBe(200)
    expect(adminBad.status).toBe(400)
    expect(securityLines()).toHaveLength(0)
  })

  it('logs auth.register.failure when the account is created but the confirmation email fails', async () => {
    const send = strapi.plugin('email').service('email').send
    strapi.plugin('email').service('email').send = async () => {
      throw new Error('smtp is down')
    }
    try {
      const res = await http()
        .post('/api/auth/local/register')
        .send({ username: 'mailfail', email: 'mailfail@example.com', password: PASSWORD })
      expect(res.status).toBe(400)
      expect(res.body.error.message).toBe('Error sending confirmation email')
    } finally {
      strapi.plugin('email').service('email').send = send
    }
    expect(
      await strapi.db
        .query('plugin::users-permissions.user')
        .count({ where: { username: 'mailfail' } })
    ).toBe(1)
    expect(events()).toEqual(['auth.register.failure'])
  })
})
