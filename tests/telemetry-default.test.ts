import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'

/** No request to Strapi's analytics host unless the operator opts in (ASVS V14.2.3). */
describe('Telemetry and admin survey are off by default', () => {
  beforeAll(async () => {
    delete process.env.FLAG_NPS
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('package.json disables telemetry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      strapi?: { telemetryDisabled?: unknown }
    }
    expect(pkg.strapi?.telemetryDisabled).toBe(true)
  })

  it('the telemetry service is disabled with no environment override', () => {
    expect(process.env.STRAPI_TELEMETRY_DISABLED).toBeUndefined()
    expect(strapi.telemetry.isDisabled).toBe(true)
  })

  it('/admin/init gives the admin app no project uuid', async () => {
    const res = await request(strapi.server.httpServer).get('/admin/init').expect(200)
    expect(res.body.data.uuid).toBe(false)
  })

  it('the admin survey flag is off', () => {
    const flags = strapi.config.get('admin.flags') as { nps: boolean }
    expect(flags.nps).toBe(false)
  })
})
