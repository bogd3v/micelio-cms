import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { hashIdentifier, securityLogSecret } from '../src/utils/security-log'
import { cleanRemoteText } from '../src/plugins/fediverse/server/src/utils/remote-text'

describe('cleanRemoteText', () => {
  it('turns line breaks into spaces so a value cannot forge a log line', () => {
    expect(cleanRemoteText('eve\n[2026-01-01] info: follow accepted: admin')).toBe(
      'eve [2026-01-01] info: follow accepted: admin'
    )
    expect(cleanRemoteText('a\r\nb c d\te')).toBe('a b c d e')
  })

  it('drops invisible format characters such as bidi overrides', () => {
    expect(cleanRemoteText('ev‮il​')).toBe('evil')
  })

  it('caps the length by characters, not by UTF-16 units', () => {
    expect(cleanRemoteText('x'.repeat(300))).toHaveLength(255)
    expect(Array.from(cleanRemoteText('🍄'.repeat(300), 10) ?? '')).toHaveLength(10)
  })

  it.each([undefined, null, 42, '', ' \n\t '])('gives null for %j', (value) => {
    expect(cleanRemoteText(value)).toBeNull()
  })

  it('leaves an ordinary handle alone', () => {
    expect(cleanRemoteText('@ana@mastodon.example')).toBe('@ana@mastodon.example')
  })
})

describe('Request log', () => {
  let lines: string[]
  let metas: Array<Record<string, unknown> | undefined>
  let spy: ReturnType<typeof jest.spyOn>

  beforeAll(async () => {
    await setupStrapi()
    lines = []
    metas = []
    spy = jest.spyOn(strapi.log, 'http').mockImplementation(((
      message: string,
      meta?: Record<string, unknown>
    ) => {
      lines.push(String(message))
      metas.push(meta)
    }) as never)
  })

  afterAll(async () => {
    spy.mockRestore()
    await cleanupStrapi()
  })

  it('logs the path of a request, without its query string', async () => {
    await request(strapi.server.httpServer).get(
      '/api/auth/email-confirmation?confirmation=SECRET-TOKEN-123&email=ana%40example.com'
    )
    await request(strapi.server.httpServer).get('/api/articles?filters[slug]=hello')

    const log = lines.join('\n')
    expect(log).toMatch(/GET \/api\/auth\/email-confirmation \(\d+ ms\) \d{3}/)
    expect(log).toMatch(/GET \/api\/articles \(\d+ ms\) \d{3}/)
    expect(log).not.toContain('SECRET-TOKEN-123')
    expect(log).not.toContain('example.com')
    expect(log).not.toContain('?')
  })

  describe('request context', () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    /** supertest connects over loopback; `TRUST_PROXY` is unset, so the socket address is the client. */
    const PEER_IP = '127.0.0.1'
    const lineOf = (path: string) => {
      const index = lines.findIndex((l) => l.includes(` ${path} (`))
      return { line: lines[index], meta: metas[index] }
    }

    it('gives an anonymous request an id and a hashed client, and no actor', async () => {
      await request(strapi.server.httpServer)
        .get('/api/articles?filters[slug]=anon-probe&email=eve%40example.com')
        .set('X-Request-Id', 'client-chosen')
        .set('X-Forwarded-For', '203.0.113.9')
      const { meta } = lineOf('/api/articles')
      expect(meta?.requestId).toMatch(UUID)
      const secret = securityLogSecret(strapi as never)
      expect(meta?.client).toBe(hashIdentifier(PEER_IP, secret))
      expect(meta).not.toHaveProperty('actor')
      expect(meta).not.toHaveProperty('actorKind')
      const text = JSON.stringify(lines) + JSON.stringify(metas)
      expect(text).not.toContain('client-chosen')
      expect(text).not.toContain('203.0.113.9')
      expect(text).not.toContain('127.0.0.1')
      expect(text).not.toContain('eve@example.com')
      expect(text).not.toContain('anon-probe')
    })

    it('gives each request its own id', async () => {
      await request(strapi.server.httpServer).get('/api/tags')
      await request(strapi.server.httpServer).get('/api/tags')
      const ids = metas
        .filter((_m, i) => lines[i]?.includes(' /api/tags ('))
        .map((m) => m?.requestId)
      expect(ids).toHaveLength(2)
      expect(ids[0]).not.toBe(ids[1])
    })

    it('names the numeric id of an authenticated reader, and no token or email', async () => {
      const role = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } })
      const user = await strapi.db.query('plugin::users-permissions.user').create({
        data: {
          username: 'ctx-reader',
          email: 'ctx-reader@example.com',
          provider: 'local',
          confirmed: true,
          blocked: false,
          role: role.id,
        },
      })
      const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id })
      await request(strapi.server.httpServer)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${jwt}`)
        .expect(200)
      const { line, meta } = lineOf('/api/users/me')
      expect(meta?.actor).toBe(user.id)
      expect(meta?.actorKind).toBe('user')
      expect(meta?.requestId).toMatch(UUID)
      expect(JSON.stringify([line, meta])).not.toContain(jwt)
      expect(JSON.stringify([line, meta])).not.toContain('ctx-reader')
    })

    it('names the admin user id on an admin request', async () => {
      const superAdmin = await strapi.service('admin::role').getSuperAdmin()
      const admin = await strapi.service('admin::user').create({
        email: 'ctx-admin@example.com',
        firstname: 'Admin',
        password: 'Password123!',
        isActive: true,
        registrationToken: null,
        roles: [superAdmin.id],
      })
      const login = await request(strapi.server.httpServer)
        .post('/admin/login')
        .send({ email: 'ctx-admin@example.com', password: 'Password123!' })
        .expect(200)
      await request(strapi.server.httpServer)
        .get('/admin/users/me')
        .set('Authorization', `Bearer ${login.body.data.token}`)
        .expect(200)
      const { meta } = lineOf('/admin/users/me')
      expect(meta?.actor).toBe(admin.id)
      expect(meta?.actorKind).toBe('admin')
      await request(strapi.server.httpServer)
        .get('/upload/files')
        .set('Authorization', `Bearer ${login.body.data.token}`)
        .expect(200)
      expect(lineOf('/upload/files').meta).toMatchObject({ actor: admin.id, actorKind: 'admin' })
      expect(JSON.stringify(metas)).not.toContain('ctx-admin@example.com')
    })

    it('answers a refused request with exactly one line (the finally itself is unit-tested)', async () => {
      const before = lines.length
      const res = await request(strapi.server.httpServer)
        .post('/api/articles')
        .set('Content-Type', 'application/json')
        .send('{"broken":')
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(lines.length).toBe(before + 1)
      expect(metas[before]?.requestId).toMatch(UUID)
    })

    it('does not expose the id in a response header', async () => {
      const res = await request(strapi.server.httpServer).get('/api/tags')
      expect(Object.keys(res.headers).join(' ')).not.toMatch(/request-id/i)
    })
  })
})
