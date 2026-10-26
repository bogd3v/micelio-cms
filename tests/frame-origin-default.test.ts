import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'

// `/admin/init`, not `/admin`: the suites have no admin build (see frame-origin.test.ts).
describe('frame-src of the admin without FRONTEND_URL', () => {
  beforeAll(async () => {
    delete process.env.FRONTEND_URL
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('boots and frames only itself', async () => {
    const res = await request(strapi.server.httpServer).get('/admin/init').expect(200)
    expect(res.headers['content-security-policy']).toContain("frame-src 'self';")
  })
})
