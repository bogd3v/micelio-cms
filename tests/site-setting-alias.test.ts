import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import recorded from './fixtures/site-setting-0.6.0.json'

// `GET /api/site-setting` answers from the default site (ADR-0017, D6) so the frontend of 0.6 keeps
// working: the same shape as the single type gave, compared with answers recorded from the 0.6.0
// image (`tests/fixtures/site-setting-0.6.0.json`, which says how). The single type is hidden and
// nothing writes it.

const SITE_SETTING = 'api::site-setting.site-setting'
const FRONTEND_KEY = 'site-alias-frontend-token-0123456789abcdef0123'
const PASSWORD = 'Alias-write-1'

/** What differs between two runs of the same content: ids, timestamps, the stored file names. */
const VOLATILE_KEYS = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'privacyUpdatedAt',
])

/** The answer with its volatile values replaced by their type, so two runs can be compared. */
function comparable(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((entry) => comparable(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, comparable(entry, name)])
    )
  }
  if (VOLATILE_KEYS.has(key)) return typeof value
  if (key === 'url' && typeof value === 'string' && value.startsWith('/uploads/')) {
    return '/uploads/<file>'
  }
  return value
}

describe('GET /api/site-setting answers from the default site', () => {
  const saved = { ...process.env }
  const http = () => request(strapi.server.httpServer)
  const frontend = { Authorization: `Bearer ${FRONTEND_KEY}` }
  const sites = () =>
    strapi.documents(SITE_UID as never) as unknown as {
      findFirst(params?: object): Promise<{ documentId: string } | null>
      update(params: object): Promise<unknown>
    }
  const singleType = () => strapi.db.query(SITE_SETTING)

  beforeAll(async () => {
    // The environment the answers were recorded in.
    process.env.MICELIO_DEMO = 'true'
    process.env.FRONTEND_URL = 'http://localhost:3000'
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY
    await setupStrapi()
    // What was written on top of the demo in the 0.6.0 instance, on the site this time.
    const site = await sites().findFirst({ filters: { isDefault: true } })
    await sites().update({
      documentId: site!.documentId,
      locale: 'en',
      data: recorded.extras,
    })
  })

  afterAll(async () => {
    await cleanupStrapi()
    process.env = { ...saved }
  })

  it('GET /api/site-setting answers the default site with the 0.6 shape', async () => {
    const asked: Record<string, { locale?: string; populate?: string }> = {
      populatedEn: { locale: 'en', populate: recorded.populate },
      populatedEs: { locale: 'es', populate: recorded.populate },
      bareEn: { locale: 'en' },
      bareDefault: {},
    }
    for (const [name, query] of Object.entries(asked)) {
      // The populate was recorded as a query string: send it as it was.
      const url =
        '/api/site-setting?' +
        [
          query.locale ? `locale=${query.locale}` : '',
          'populate' in query ? (query.populate as string) : '',
        ]
          .filter(Boolean)
          .join('&')
      const res = await http().get(url).set(frontend)

      expect([name, res.status]).toEqual([name, 200])
      expect([name, comparable(res.body)]).toEqual([
        name,
        comparable(recorded.responses[name as keyof typeof recorded.responses]),
      ])
    }
  })

  it('leaves out what only a site has', async () => {
    const res = await http().get('/api/site-setting').set(frontend)

    for (const name of ['slug', 'hosts', 'isDefault', 'editorialPolicy', 'localizations']) {
      expect(res.body.data).not.toHaveProperty(name)
    }
  })

  it('answers from the default site and not from the single type', async () => {
    const site = await sites().findFirst({ filters: { isDefault: true } })
    const before = await sites().findFirst({ filters: { isDefault: true } })
    await sites().update({
      documentId: site!.documentId,
      locale: 'en',
      data: { name: 'Renamed on the site' },
    })

    const res = await http().get('/api/site-setting').query({ locale: 'en' }).set(frontend)

    expect(res.body.data.name).toBe('Renamed on the site')
    expect(res.body.data.documentId).toBe(before!.documentId)
    expect(await singleType().count({ where: { name: 'Renamed on the site' } })).toBe(0)
  })

  it('a write to the single type is refused', async () => {
    const { accessKey } = await strapi
      .service('admin::api-token')
      .create({ name: 'full-access', type: 'full-access', lifespan: null })
    const full = { Authorization: `Bearer ${accessKey}` }
    const nameOf = async () =>
      (await singleType().findOne({ where: { locale: 'en' }, select: ['name'] }))?.name ?? null
    const siteName = async () => (await http().get('/api/site-setting').set(full)).body.data.name
    const before = { single: await nameOf(), site: await siteName() }

    const attempts = [
      await http()
        .put('/api/site-setting')
        .set(full)
        .send({ data: { name: 'Written' } }),
      await http()
        .post('/api/site-setting')
        .set(full)
        .send({ data: { name: 'Written' } }),
      await http().delete('/api/site-setting').set(full),
    ]
    expect(attempts.map((res) => res.status)).toEqual([405, 405, 405])

    // The Content Manager is the other way in: the type is hidden there and refuses the write too.
    const role = await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })
    await strapi.service('admin::user').create({
      email: 'alias-writer@example.test',
      password: PASSWORD,
      firstname: 'Alias',
      lastname: 'Writer',
      isActive: true,
      roles: [role.id],
    })
    const login = await http()
      .post('/admin/login')
      .send({ email: 'alias-writer@example.test', password: PASSWORD })
      .expect(200)
    const admin = {
      Authorization: `Bearer ${login.body.data.token ?? login.body.data.accessToken}`,
    }
    const viaAdmin = await http()
      .put(`/content-manager/single-types/${SITE_SETTING}?locale=en`)
      .set(admin)
      .send({ name: 'Written' })
    expect(viaAdmin.status).toBe(403)

    expect({ single: await nameOf(), site: await siteName() }).toEqual(before)
  })
})
