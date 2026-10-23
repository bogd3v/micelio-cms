import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi, serverHost } from './strapi'
import { needsNoStore } from '../src/utils/cache-control'

const ACTIVITY_JSON = 'application/activity+json'
const HSTS = 'max-age=31536000; includeSubDomains'

describe('needsNoStore', () => {
  it.each([
    ['GET', '/api/auth/local', {}],
    ['POST', '/api/auth/local', {}],
    ['GET', '/api/auth/email-confirmation', {}],
    ['GET', '/api/users/me', {}],
    ['GET', '/API/Users/Me/', {}],
    ['GET', '/api/site-settings', {}],
    ['POST', '/api/subscribers', {}],
    ['GET', '/api/subscribers/abc', {}],
    ['GET', '/api/articles', { status: 'draft' }],
    ['GET', '/api/pages/abc', { status: ['published', 'draft'] }],
  ])('%s %s %j needs no-store', (method, path, query) => {
    expect(needsNoStore(method, path, query)).toBe(true)
  })

  it.each([
    ['GET', '/api/articles', {}],
    ['GET', '/api/articles', { status: 'published' }],
    ['GET', '/api/categories', { populate: '*' }],
    ['GET', '/api/users', {}],
    ['GET', '/api/site-settingsx', {}],
    ['POST', '/api/articles', { status: 'draft' }],
    ['GET', '/uploads/a.png', { status: 'draft' }],
    ['GET', '/fediverse/user/x', {}],
  ])('%s %s %j is left cacheable', (method, path, query) => {
    expect(needsNoStore(method, path, query)).toBe(false)
  })
})

describe('Browser-facing headers', () => {
  const http = () => request(strapi.server.httpServer)

  beforeAll(async () => {
    process.env.FEDIVERSE_ENABLED = 'true'
    process.env.FEDIVERSE_ACTOR_IDENTIFIER = process.env.FEDIVERSE_ACTOR_IDENTIFIER || 'devbog'
    process.env.FEDIVERSE_ACTOR_USERNAME = process.env.FEDIVERSE_ACTOR_USERNAME || 'bogdev'
    process.env.FRONTEND_URL = 'https://blog.example.test'
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe('security headers on app responses', () => {
    it('sends HSTS, nosniff, frame protection and base-uri none', async () => {
      const res = await http().get('/api/articles')
      expect(res.headers['strict-transport-security']).toBe(HSTS)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'")
      expect(res.headers['content-security-policy']).toContain("base-uri 'none'")
      expect(res.headers['content-security-policy']).toContain("object-src 'none'")
    })
  })

  describe('security headers on federation responses', () => {
    it.each([
      ['actor', '/fediverse/user/devbog', ACTIVITY_JSON],
      ['webfinger', '/.well-known/webfinger?resource=acct:bogdev@blog.example.test', undefined],
      ['nodeinfo', '/nodeinfo/2.1', undefined],
      ['an unknown actor (404)', '/fediverse/user/nobody', ACTIVITY_JSON],
    ])('carries them on %s', async (_name, path, accept) => {
      const res = await fetch(`http://${serverHost()}${path}`, {
        headers: accept ? { accept } : {},
      })
      expect(res.headers.get('strict-transport-security')).toBe(HSTS)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'")
      await res.arrayBuffer()
    })
  })

  describe('cookies', () => {
    it('sets SameSite on the session cookie', () => {
      const middlewares = strapi.config.get('middlewares') as (string | { name: string })[]
      const session = middlewares.find(
        (m): m is { name: string; config?: { sameSite?: string } } =>
          typeof m === 'object' && m.name === 'strapi::session'
      )
      expect(session?.config?.sameSite).toBe('lax')
    })

    it('sets the admin refresh cookie HttpOnly and SameSite=Lax under its fixed name', async () => {
      const role = await strapi.db
        .query('admin::role')
        .findOne({ where: { code: 'strapi-super-admin' } })
      await strapi.service('admin::user').create({
        email: 'cookie-admin@example.com',
        password: 'Passw0rd!long',
        firstname: 'Cookie',
        isActive: true,
        roles: [role.id],
      })
      const res = await http()
        .post('/admin/login')
        .send({ email: 'cookie-admin@example.com', password: 'Passw0rd!long' })
      expect(res.status).toBe(200)
      const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[]
      const refresh = cookies.find((c) => c.includes('strapi_admin_refresh='))
      expect(refresh).toBeDefined()
      expect(refresh).toMatch(/httponly/i)
      expect(refresh).toMatch(/samesite=lax/i)
      expect(refresh).toMatch(/path=\//i)
    })
  })

  describe('Cache-Control', () => {
    it.each([
      ['/api/users/me'],
      ['/api/auth/email-confirmation?confirmation=x'],
      ['/api/site-settings'],
      ['/api/subscribers'],
      ['/api/articles?status=draft'],
    ])('answers %s with private, no-store', async (path) => {
      const res = await http().get(path)
      expect(res.headers['cache-control']).toBe('private, no-store')
    })

    it('answers a login attempt with private, no-store', async () => {
      const res = await http().post('/api/auth/local').send({ identifier: 'x', password: 'y' })
      expect(res.headers['cache-control']).toBe('private, no-store')
    })

    it('does not add no-store to public content', async () => {
      const res = await http().get('/api/articles')
      expect(res.headers['cache-control'] ?? '').not.toMatch(/no-store/)
    })
  })
})
