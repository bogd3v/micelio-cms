import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

// The builder's page settings on `api::page.page` (#414): `withPageSettings` of
// `@micelio/strapi-plugin-core` adds `pageType`, `visibility` and the template record to the page,
// and turns on the core's JSON-LD check of `seo.structuredData` (`docs/architecture/pages.md`).

const PAGE_UID = 'api::page.page'
const FRONTEND_KEY = 'page-settings-frontend-token-0123456789ab'
const PASSWORD = 'Page-settings-1'
const saved = { ...process.env }

type Data = Record<string, unknown>

interface PageRow {
  id: number
  documentId: string
  pageType: string | null
  visibility: Data | null
}

describe('Page settings (#414)', () => {
  const http = () => request(strapi.server.httpServer)
  const frontend = (path: string) => http().get(path).set('Authorization', `Bearer ${FRONTEND_KEY}`)
  const pages = () =>
    strapi.documents(PAGE_UID) as unknown as {
      create(params: Data): Promise<Data & { documentId: string }>
      update(params: Data): Promise<Data & { documentId: string }>
      findOne(params: Data): Promise<Data | null>
    }
  let counter = 0
  const nextSlug = () => `settings-${++counter}`
  /** The page of `slug` as the frontend token reads it, with `populate`. */
  const served = async (slug: string, populate = '*'): Promise<Data> => {
    const res = await frontend(
      `/api/pages?filters[slug][$eq]=${slug}&populate=${populate}&locale=en`
    )
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    return res.body.data[0] as Data
  }

  /** Signs in a new Super Admin and returns its token, for the Content Manager's routes. */
  async function signIn(): Promise<string> {
    const role = await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })
    const email = `page-settings-${++counter}@example.test`
    await strapi.service('admin::user').create({
      email,
      password: PASSWORD,
      firstname: 'Page',
      lastname: 'Settings',
      isActive: true,
      roles: [role.id],
    })
    const res = await http().post('/admin/login').send({ email, password: PASSWORD }).expect(200)
    return res.body.data.token ?? res.body.data.accessToken
  }

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY
    await setupStrapi()
    const locales = strapi.plugin('i18n').service('locales')
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' })
    }
  })

  afterAll(async () => {
    await cleanupStrapi()
    process.env = { ...saved }
  })

  it('a page stores pageType and visibility', async () => {
    const slug = nextSlug()
    const visibility = { inMenu: false, inSitemap: true, noindex: true }
    const { documentId } = await pages().create({
      status: 'published',
      data: {
        title: 'Landing',
        slug,
        pageType: 'landing',
        visibility,
        site: await defaultSiteRelation(strapi),
      },
    })

    expect(await served(slug)).toMatchObject({
      pageType: 'landing',
      visibility: expect.objectContaining(visibility),
      templateId: null,
      templateVersion: null,
    })

    // What the drawer saves: another type and another visibility, over the draft, then published.
    await pages().update({
      documentId,
      locale: 'en',
      status: 'published',
      data: {
        pageType: 'long-read',
        visibility: { inMenu: true, inSitemap: false, noindex: false },
      },
    })
    expect(await served(slug)).toMatchObject({
      pageType: 'long-read',
      visibility: expect.objectContaining({ inMenu: true, inSitemap: false, noindex: false }),
    })

    // Not localised: the Spanish version of the page has the same settings.
    await pages().update({
      documentId,
      locale: 'es',
      data: { title: 'Portada', slug: `${slug}-es` },
    })
    const spanish = await pages().findOne({
      documentId,
      locale: 'es',
      status: 'draft',
      populate: { visibility: true },
    })
    expect(spanish).toMatchObject({
      pageType: 'long-read',
      visibility: expect.objectContaining({ inMenu: true, inSitemap: false, noindex: false }),
    })
  })

  it('a page created before withPageSettings reads as standard and visible', async () => {
    const rows = () => strapi.db.query(PAGE_UID)
    const site = await strapi.db
      .query('plugin::micelio.site')
      .findOne({ where: { isDefault: true }, select: ['id'] })
    const stamp = new Date('2026-01-02T03:04:05.000Z')
    // A page as `0.8` stored it, below the Document Service: the columns of the page settings did
    // not exist, so the upgrade adds them empty (no boot migration fills them).
    for (const publishedAt of [null, stamp]) {
      await rows().create({
        data: {
          documentId: 'before-page-settings',
          title: 'Before',
          slug: 'before-page-settings',
          locale: 'en',
          publishedAt,
          createdAt: stamp,
          updatedAt: stamp,
          site: site.id,
          pageType: null,
        },
      })
    }

    await cleanupStrapi({ keepDatabase: true })
    await setupStrapi({ keepDatabase: true })

    const stored = (await rows().findMany({
      where: { documentId: 'before-page-settings' },
      populate: { visibility: true },
    })) as PageRow[]
    expect(stored.map((row) => [row.pageType, row.visibility])).toEqual([
      [null, null],
      [null, null],
    ])

    // The frontend still gets the page, with no page type and no visibility: the core's `standard`
    // and the visibility of a page never saved with one (in the menu, in the sitemap, indexable).
    expect(await served('before-page-settings')).toMatchObject({
      title: 'Before',
      slug: 'before-page-settings',
      pageType: null,
      visibility: null,
    })

    // The first save of the page in the Content Manager keeps it so: it is not refused, and it
    // writes no page type or visibility the editor did not choose.
    const token = await signIn()
    const res = await http()
      .put(`/content-manager/collection-types/${PAGE_UID}/before-page-settings?locale=en`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Before, saved' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ title: 'Before, saved', visibility: null })
    expect(res.body.data.pageType).toBeNull()
  })

  it('the page routes never return templateSamples or templateFixed', async () => {
    const slug = nextSlug()
    await pages().create({
      status: 'published',
      data: {
        title: 'From a template',
        slug,
        templateId: 'template-document-id',
        templateVersion: 2,
        templateSamples: ['Sample headline'],
        templateFixed: [{ block: 'hero', nth: 1 }],
        site: await defaultSiteRelation(strapi),
      },
    })
    const stored = (await strapi.db
      .query(PAGE_UID)
      .findOne({ where: { slug, publishedAt: { $notNull: true } } })) as Data
    expect(stored).toMatchObject({
      templateSamples: ['Sample headline'],
      templateFixed: [{ block: 'hero', nth: 1 }],
    })

    const bodies = [
      (await frontend(`/api/pages?filters[slug][$eq]=${slug}&populate=*`)).body,
      (await frontend(`/api/pages?filters[slug][$eq]=${slug}`)).body,
    ]
    // Asked by name, they are refused, as any private field is.
    for (const field of ['templateSamples', 'templateFixed']) {
      const named = await frontend(`/api/pages?filters[slug][$eq]=${slug}&fields[0]=${field}`)
      expect(named.status).toBe(400)
      expect(named.body.data).toBeNull()
      bodies.push(named.body.data)
    }
    for (const body of bodies) {
      const text = JSON.stringify(body)
      expect(text).not.toContain('templateSamples')
      expect(text).not.toContain('templateFixed')
      expect(text).not.toContain('Sample headline')
    }
    expect(bodies[0].data[0]).toMatchObject({
      templateId: 'template-document-id',
      templateVersion: 2,
    })
  })

  it('a page save whose structured data is not JSON-LD is refused with structuredDataInvalid', async () => {
    const page = async (structuredData: unknown) =>
      pages().create({
        data: {
          title: 'Structured',
          slug: nextSlug(),
          seo: { structuredData },
          site: await defaultSiteRelation(strapi),
        },
      })
    const refused = { name: 'ValidationError', details: { code: 'structuredDataInvalid' } }

    await expect(page({ '@type': 'Article' })).rejects.toMatchObject(refused)
    await expect(page('not json')).rejects.toMatchObject(refused)
    await expect(page([{ '@context': 'https://schema.org' }])).rejects.toMatchObject(refused)
    // Valid JSON-LD and an empty value are still accepted.
    await expect(
      page({ '@context': 'https://schema.org', '@type': 'Article' })
    ).resolves.toBeTruthy()
    const { documentId } = await page(null)

    // The same refusal on an update, and as a 400 from the Content Manager.
    await expect(
      pages().update({
        documentId,
        locale: 'en',
        data: { seo: { structuredData: { '@type': 'WebPage' } } },
      })
    ).rejects.toMatchObject(refused)
    const token = await signIn()
    const res = await http()
      .put(`/content-manager/collection-types/${PAGE_UID}/${documentId}?locale=en`)
      .set('Authorization', `Bearer ${token}`)
      .send({ seo: { structuredData: { '@type': 'WebPage' } } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatchObject({ details: { code: 'structuredDataInvalid' } })
  })
})
