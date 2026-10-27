import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import { assignPagesToDefaultSite } from '../src/migrations/page-site'
import { defaultSiteRelation } from '../src/utils/default-site'

// Pages belong to a site (#373, ADR-0017 section 4): every stored page gets the default site at
// boot, and the content API answers the frontend as it did before, with `?site=` as the new,
// optional parameter.

const PAGE_UID = 'api::page.page'
const FRONTEND_KEY = 'pages-site-frontend-token-0123456789abcdef'
const saved = { ...process.env }

interface PageRow {
  id: number
  slug: string
  locale: string
  publishedAt: string | null
  updatedAt: string
  site: { slug: string; isDefault: boolean } | null
}

describe('Pages belong to a site', () => {
  const pages = () => strapi.db.query(PAGE_UID)
  const rows = async (): Promise<PageRow[]> =>
    (await pages().findMany({
      orderBy: { id: 'asc' },
      populate: { site: { select: ['slug', 'isDefault'] } },
    })) as PageRow[]
  const http = () => request(strapi.server.httpServer)
  const frontend = (path: string) => http().get(path).set('Authorization', `Bearer ${FRONTEND_KEY}`)

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

  describe('the boot migration', () => {
    const stamp = new Date('2026-01-02T03:04:05.000Z')

    it('gives every row with no site the default site: every locale, draft and published', async () => {
      // Rows as a release before the relation stored them: written below the Document Service.
      for (const locale of ['en', 'es']) {
        for (const publishedAt of [null, stamp]) {
          await pages().create({
            data: {
              documentId: 'legacy-page-document',
              title: 'Legacy',
              slug: `legacy-${locale}`,
              locale,
              publishedAt,
              createdAt: stamp,
              updatedAt: stamp,
            },
          })
        }
      }
      const legacy = (await rows()).filter((row) => row.slug.startsWith('legacy-'))
      expect(legacy).toHaveLength(4)
      expect(legacy.every((row) => row.site === null)).toBe(true)

      await cleanupStrapi({ keepDatabase: true })
      await setupStrapi({ keepDatabase: true })

      const after = (await rows()).filter((row) => row.slug.startsWith('legacy-'))
      expect(
        after.map((row) => [row.locale, row.publishedAt !== null, row.site?.isDefault])
      ).toEqual([
        ['en', false, true],
        ['en', true, true],
        ['es', false, true],
        ['es', true, true],
      ])
    })

    it('does not change updatedAt, which the admin compares between the draft and the published row', async () => {
      const after = (await rows()).filter((row) => row.slug.startsWith('legacy-'))
      expect(after.map((row) => new Date(row.updatedAt).toISOString())).toEqual(
        Array(4).fill(stamp.toISOString())
      )
    })

    it('changes nothing on a second boot', async () => {
      const before = await rows()

      await cleanupStrapi({ keepDatabase: true })
      await setupStrapi({ keepDatabase: true })

      expect(await rows()).toEqual(before)
      expect(await assignPagesToDefaultSite(strapi)).toBe(0)
    })

    it('keeps a page that already has another site there', async () => {
      const other = await strapi.documents(SITE_UID).create({
        data: { name: 'Other', slug: 'other', isDefault: false, modules: {} },
      } as never)
      const row = (await pages().create({
        data: { documentId: 'other-site-page', title: 'Other', slug: 'other-page', locale: 'en' },
      })) as { id: number }
      const site = await strapi.db
        .query(SITE_UID)
        .findOne({ where: { documentId: other.documentId } })
      await pages().update({ where: { id: row.id }, data: { site: site.id } })

      expect(await assignPagesToDefaultSite(strapi)).toBe(0)
      expect((await rows()).find((entry) => entry.id === row.id)?.site?.slug).toBe('other')
    })
  })

  describe('the content API', () => {
    const slug = 'scoped-page'
    let before: unknown

    // What the frontend sends for one page (micelio's `PAGE_POPULATE` is deeper; this seed has no
    // media, and tests/response-fields-pages-site.test.ts reads the fully populated page).
    const query = `/api/pages?filters[slug][$eq]=${slug}&populate=*&locale=en`

    beforeAll(async () => {
      await strapi.documents(PAGE_UID).create({
        status: 'published',
        data: {
          title: 'Scoped',
          slug,
          sections: [{ __component: 'section.rich-text', body: 'Hello' }],
          site: await defaultSiteRelation(strapi),
        },
      } as never)
      before = (await frontend(query)).body
    })

    // The body the same request got before pages had a site, ids and timestamps aside (the
    // relation is not populated by default, and `populate=*` does not reach it).
    const expected = {
      data: [
        {
          title: 'Scoped',
          slug,
          locale: 'en',
          sections: [{ __component: 'section.rich-text', body: 'Hello' }],
          seo: null,
          localizations: [],
        },
      ],
      meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
    }
    // The body without what differs between two runs: ids, document ids and timestamps.
    const VOLATILE = new Set(['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt'])
    const plain = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(plain)
      if (typeof value !== 'object' || value === null) return value
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !VOLATILE.has(key))
          .map(([key, entry]) => [key, plain(entry)])
      )
    }

    it('answers the frontend token the same page, with no site in the answer', async () => {
      const res = await frontend(query)

      expect(res.status).toBe(200)
      expect(plain(res.body)).toEqual(expected)
    })

    it('answers the same with ?site=default', async () => {
      const res = await frontend(`${query}&site=default`)

      expect(res.status).toBe(200)
      expect(res.body).toEqual(before)
    })

    it('answers an unknown site 404 with the code unknownSite', async () => {
      const res = await frontend(`${query}&site=nope`)

      expect(res.status).toBe(404)
      expect(res.type).toBe('application/problem+json')
      expect(res.body).toMatchObject({ status: 404, code: 'unknownSite' })
    })

    it('serves a site only its own pages', async () => {
      await strapi.documents(SITE_UID).create({
        data: { name: 'Second', slug: 'second', isDefault: false, modules: {} },
      } as never)

      const res = await frontend(`${query}&site=second`)

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    })

    it('lets a token that may only read pages neither create, update nor delete one', async () => {
      const { documentId } = (await strapi.db
        .query(PAGE_UID)
        .findOne({ where: { slug }, select: ['documentId'] })) as { documentId: string }
      const write = (req: request.Test) =>
        req.set('Authorization', `Bearer ${FRONTEND_KEY}`).send({ data: { title: 'Nope' } })

      expect((await write(http().post('/api/pages'))).status).toBe(403)
      expect((await write(http().put(`/api/pages/${documentId}`))).status).toBe(403)
      expect((await write(http().delete(`/api/pages/${documentId}`))).status).toBe(403)
    })

    it('refuses to create a page with no site below the content API', async () => {
      await expect(
        strapi.documents(PAGE_UID).create({ data: { title: 'Lost', slug: 'lost' } } as never)
      ).rejects.toThrow('site is required')
    })

    it('keeps drafts closed to the content API', async () => {
      await strapi.documents(PAGE_UID).create({
        data: {
          title: 'Draft only',
          slug: 'draft-only',
          site: await defaultSiteRelation(strapi),
        },
      } as never)

      const res = await frontend('/api/pages?filters[slug][$eq]=draft-only&status=draft&locale=en')

      expect(res.status).toBe(403)
    })
  })
})
