import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { frontendFrameOrigin } from '../src/utils/frame-origin'

describe('frontendFrameOrigin', () => {
  it('keeps scheme, host and port, and drops the path, query and credentials', () => {
    expect(frontendFrameOrigin('https://www.example.com/blog')).toBe('https://www.example.com')
    expect(frontendFrameOrigin('http://localhost:3000/a/b?c=d#e')).toBe('http://localhost:3000')
    expect(frontendFrameOrigin('https://user:pass@example.com:8443/x')).toBe(
      'https://example.com:8443'
    )
    expect(frontendFrameOrigin('http://[::1]:3000/')).toBe('http://[::1]:3000')
  })

  it('drops a trailing slash, a default port and the case of the host', () => {
    expect(frontendFrameOrigin('https://www.example.com/')).toBe('https://www.example.com')
    expect(frontendFrameOrigin('https://www.example.com:443')).toBe('https://www.example.com')
    expect(frontendFrameOrigin('  HTTPS://WWW.Example.com  ')).toBe('https://www.example.com')
  })

  it('answers null when it is unset or blank', () => {
    expect(frontendFrameOrigin(undefined)).toBeNull()
    expect(frontendFrameOrigin('')).toBeNull()
    expect(frontendFrameOrigin('   ')).toBeNull()
  })

  it.each([
    'ftp://example.com',
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'wss://example.com',
    'example.com',
    '//example.com',
    'not a url',
  ])('answers null for %s, which is not an http(s) URL', (value) => {
    expect(frontendFrameOrigin(value)).toBeNull()
  })

  it.each([
    'https://*.example.com',
    'https://*',
    'https://a;b.example.com',
    "https://a'b.example.com",
    'https://a,b.example.com',
    'https://exa%20mple.com',
  ])('answers null for %s, a host that would widen or split the directive', (value) => {
    expect(frontendFrameOrigin(value)).toBeNull()
  })
})

// The suites have no admin build, so `GET /admin` itself fails on the missing index.html and
// loses its headers; `/admin/init` is an admin route under the same `strapi::security`. The real
// `GET /admin` is read on the production image (see the pull request).
describe('frame-src of the admin', () => {
  const FRONTEND = 'https://www.example.com'
  const frameSrc = (csp: string) =>
    csp
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('frame-src'))

  beforeAll(async () => {
    process.env.FRONTEND_URL = `${FRONTEND}/blog`
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('allows the frontend origin and itself, and nothing else', async () => {
    const res = await request(strapi.server.httpServer).get('/admin/init').expect(200)
    const csp = res.headers['content-security-policy']
    expect(csp).toContain(`frame-src 'self' ${FRONTEND};`)
    expect(frameSrc(csp)).toBe(`frame-src 'self' ${FRONTEND}`)
  })

  it('leaves the other directives as they were', async () => {
    const res = await request(strapi.server.httpServer).get('/admin/init').expect(200)
    const csp = res.headers['content-security-policy']
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).not.toContain('*')
  })
})
