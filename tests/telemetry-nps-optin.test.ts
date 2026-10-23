import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'

describe('FLAG_NPS=true turns the admin survey on', () => {
  const saved = process.env.FLAG_NPS

  beforeAll(async () => {
    process.env.FLAG_NPS = 'true'
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
    if (saved === undefined) delete process.env.FLAG_NPS
    else process.env.FLAG_NPS = saved
  })

  it('exposes nps in the admin flags', () => {
    const flags = strapi.config.get('admin.flags') as { nps: boolean }
    expect(flags.nps).toBe(true)
  })
})
