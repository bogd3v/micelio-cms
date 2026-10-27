import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals'
import request from 'supertest'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

// Issue #385: the core's two grant-checked preview routes read drafts inside a content API request
// authenticated by the frontend's API token. `restrictDraftsToEditors` lets exactly those two
// handlers through, and the grant is what protects them. Everything else keeps the refusal.

const PAGE_UID = 'api::page.page'
const ARTICLE_UID = 'api::article.article'
const CATEGORY_UID = 'plugin::micelio.category'
const TOKEN_UID = 'admin::api-token'
const EXCHANGE = 'plugin::micelio.preview.exchange'
const DRAFT = 'plugin::micelio.preview.draft'
// The handlers as the core's route file names them, which is what Strapi keeps in `ctx.state.route`.
const EXCHANGE_HANDLER = 'preview.exchange'
const DRAFT_HANDLER = 'preview.draft'
const FRONTEND_KEY = 'preview-routes-frontend-token-0123456789abcdef'
const ADMIN_ORIGIN = 'https://admin.example.com'
const FRONTEND_ORIGIN = 'https://frontend.example.com'
const GRANT_HEADER = 'x-micelio-preview-grant'
const DRAFT_TITLE = 'Draft of the preview'
const RELATED_PUBLISHED_TITLE = 'Published, related to the previewed document'
const RELATED_DRAFT_TITLE = 'Draft only, related to the previewed document'

interface PreviewService {
  issueToken(binding: Record<string, unknown>): Promise<{ url: string }>
  issueSystemGrant(binding: Record<string, unknown>): Promise<string>
}

type Line = { message: string; meta: Record<string, unknown> }

describe('The preview routes read drafts within their grant', () => {
  const saved = { ...process.env }
  let lines: Line[] = []
  let siteSlug = ''
  let siteDocumentId = ''
  let adminUser = 0
  let documentId = ''

  const http = () => request(strapi.server.httpServer)
  const frontend = { Authorization: `Bearer ${FRONTEND_KEY}` }
  const previews = () => strapi.plugin('micelio').service('preview') as unknown as PreviewService
  const refusals = () => lines.filter((line) => line.message === 'security: access.draft.refused')

  /** A fresh preview token for the draft, as the admin's token route would make it. */
  async function newToken(
    entry: { contentType: string; documentId: string } = { contentType: PAGE_UID, documentId }
  ): Promise<string> {
    const { url } = await previews().issueToken({
      adminUser,
      adminOrigin: ADMIN_ORIGIN,
      siteDocumentId,
      contentType: entry.contentType,
      entryDocumentId: entry.documentId,
      entryLocale: 'en',
    })
    return new URL(url).searchParams.get('token') ?? ''
  }

  const exchange = (token: string) =>
    http().post('/api/micelio/preview/exchange').query({ site: siteSlug }).set(frontend).send({
      token,
    })

  const readDraft = (grant: string) =>
    http()
      .get('/api/micelio/preview/draft')
      .query({ site: siteSlug, documentId, locale: 'en' })
      .set(frontend)
      .set(GRANT_HEADER, grant)

  async function newGrant(): Promise<string> {
    const res = await exchange(await newToken())
    expect(res.status).toBe(200)
    return res.body.data.grant as string
  }

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY
    await setupStrapi()

    // The distribution's frontend token carries the draft action and not the exchange (the demo
    // adds it, #382): the test gives the token the exchange itself.
    const tokens = strapi.service(TOKEN_UID) as unknown as {
      getByName(name: string): Promise<{ id: number; permissions?: { action: string }[] }>
      update(id: number, data: Record<string, unknown>): Promise<unknown>
    }
    const token = await strapi.db
      .query(TOKEN_UID)
      .findOne({ where: { name: 'frontend' }, populate: ['permissions'] })
    const actions = (token.permissions as { action: string }[]).map(({ action }) => action)
    expect(actions).toContain(DRAFT)
    expect(actions).not.toContain(EXCHANGE)
    await tokens.update(token.id, { permissions: [...actions, EXCHANGE] })

    const site = (await strapi.db.query(SITE_UID).findOne({ where: { isDefault: true } })) as {
      slug: string
      documentId: string
    }
    siteSlug = site.slug
    siteDocumentId = site.documentId
    await strapi.db
      .query(SITE_UID)
      .updateMany({ where: { documentId: siteDocumentId }, data: { url: FRONTEND_ORIGIN } })

    const superAdmin = (await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })) as { id: number }
    const user = (await strapi.service('admin::user').create({
      email: 'previewer@example.com',
      firstname: 'Preview',
      lastname: 'Tester',
      password: 'Password1234',
      roles: [superAdmin.id],
      isActive: true,
    })) as { id: number }
    adminUser = user.id

    const page = await strapi.documents(PAGE_UID).create({
      data: {
        title: DRAFT_TITLE,
        slug: 'preview-routes',
        sections: [],
        site: await defaultSiteRelation(strapi),
      },
    })
    documentId = page.documentId

    jest.spyOn(strapi.log, 'warn').mockImplementation(((
      message: string,
      meta?: Record<string, unknown>
    ) => {
      lines.push({ message: String(message), meta: meta ?? {} })
    }) as typeof strapi.log.warn)
  })

  beforeEach(() => {
    lines = []
  })

  afterAll(async () => {
    jest.restoreAllMocks()
    await cleanupStrapi()
    process.env = { ...saved }
  })

  describe('with a valid grant', () => {
    it('exchanges a token for a grant and reads the draft by it', async () => {
      const exchanged = await exchange(await newToken())
      expect(exchanged.status).toBe(200)
      expect(exchanged.body.data).toMatchObject({ contentType: PAGE_UID, documentId })

      const res = await readDraft(exchanged.body.data.grant)
      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({ documentId, title: DRAFT_TITLE })
      expect(res.body.meta).toEqual({ actor: 'admin' })
      expect(refusals()).toHaveLength(0)
    })

    it('reads the draft by a system grant too, once', async () => {
      const { updatedAt } = (await strapi.documents(PAGE_UID).findOne({
        documentId,
        status: 'draft',
        fields: ['updatedAt'],
        locale: 'en',
      })) as { updatedAt: string }
      const grant = await previews().issueSystemGrant({
        siteDocumentId,
        contentType: PAGE_UID,
        entryDocumentId: documentId,
        entryLocale: 'en',
        entryVersion: new Date(updatedAt).toISOString(),
      })
      const first = await readDraft(grant)
      expect(first.status).toBe(200)
      expect(first.body.meta).toEqual({ actor: 'system' })
      expect((await readDraft(grant)).status).toBe(404)
    })
  })

  describe('with a grant that is spent, unknown or not a grant', () => {
    it('refuses a token the second time it is exchanged', async () => {
      const token = await newToken()
      expect((await exchange(token)).status).toBe(200)
      const again = await exchange(token)
      expect(again.status).toBe(404)
      expect(again.body.code).toBe('previewRefused')
    })

    it('refuses an unknown token', async () => {
      const res = await exchange('not-a-token')
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('previewRefused')
    })

    it('refuses an unknown grant and a token used as a grant', async () => {
      for (const grant of ['not-a-grant', await newToken()]) {
        const res = await readDraft(grant)
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('previewRefused')
        expect(JSON.stringify(res.body)).not.toContain(DRAFT_TITLE)
      }
    })

    it('refuses a system grant the second time it is presented', async () => {
      const { updatedAt } = (await strapi.documents(PAGE_UID).findOne({
        documentId,
        status: 'draft',
        fields: ['updatedAt'],
        locale: 'en',
      })) as { updatedAt: string }
      const grant = await previews().issueSystemGrant({
        siteDocumentId,
        contentType: PAGE_UID,
        entryDocumentId: documentId,
        entryLocale: 'en',
        entryVersion: new Date(updatedAt).toISOString(),
      })
      expect((await readDraft(grant)).status).toBe(200)
      const spent = await readDraft(grant)
      expect(spent.status).toBe(404)
      expect(spent.body.code).toBe('previewRefused')
    })

    it('does not show a draft-only document through a populated relation', async () => {
      const category = await strapi.documents(CATEGORY_UID).create({
        data: { name: 'Preview', slug: 'preview', site: await defaultSiteRelation(strapi) },
      })
      const published = await strapi.documents(ARTICLE_UID).create({
        data: { title: RELATED_PUBLISHED_TITLE, category: category.documentId },
      })
      await strapi.documents(ARTICLE_UID).publish({ documentId: published.documentId })
      await strapi.documents(ARTICLE_UID).create({
        data: {
          title: RELATED_DRAFT_TITLE,
          category: category.documentId,
        },
      })
      const exchanged = await exchange(
        await newToken({ contentType: CATEGORY_UID, documentId: category.documentId })
      )
      expect(exchanged.status).toBe(200)
      const res = await http()
        .get('/api/micelio/preview/draft')
        .query({
          site: siteSlug,
          documentId: category.documentId,
          locale: 'en',
          populate: 'articles',
        })
        .set(frontend)
        .set(GRANT_HEADER, exchanged.body.data.grant)
      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({ documentId: category.documentId })
      // The control: the populate does reach the published article, so the draft's absence is real.
      expect(JSON.stringify(res.body)).toContain(RELATED_PUBLISHED_TITLE)
      expect(JSON.stringify(res.body)).not.toContain(RELATED_DRAFT_TITLE)
    })

    it('refuses a grant for another document', async () => {
      const grant = await newGrant()
      const res = await http()
        .get('/api/micelio/preview/draft')
        .query({ site: siteSlug, documentId: 'another-document', locale: 'en' })
        .set(frontend)
        .set(GRANT_HEADER, grant)
      expect(res.status).toBe(404)
    })
  })

  describe('every other draft read keeps its refusal', () => {
    it.each([
      ['pages', '/api/pages?status=draft'],
      ['articles', '/api/articles?status=draft'],
      ['a populated relation', '/api/categories?populate=articles&status=draft'],
    ])('gives the frontend token 403 and the log for %s', async (_name, path) => {
      const res = await http().get(path).set(frontend)
      expect(res.status).toBe(403)
      expect(refusals()).toHaveLength(1)
      expect(refusals()[0].meta).toMatchObject({ reason: 'draft-requested' })
    })

    it('does not open another route to a request that carries a valid grant', async () => {
      const grant = await newGrant()
      const res = await http().get('/api/pages?status=draft').set(frontend).set(GRANT_HEADER, grant)
      expect(res.status).toBe(403)
      expect(refusals()).toHaveLength(1)
      expect(JSON.stringify(res.body)).not.toContain(DRAFT_TITLE)
    })

    it('refuses the draft route to a caller with no API token', async () => {
      const grant = await newGrant()
      const res = await http()
        .get('/api/micelio/preview/draft')
        .query({ site: siteSlug, documentId, locale: 'en' })
        .set(GRANT_HEADER, grant)
      expect(res.status).toBe(403)
      expect(JSON.stringify(res.body)).not.toContain(DRAFT_TITLE)
    })

    // Requests as the guard sees them, with the route information Strapi puts in `ctx.state.route`
    // for the matching route and for look-alikes.
    const asRoute = (
      info: Record<string, unknown>,
      handler: unknown,
      read: () => Promise<void>
    ): Promise<void> =>
      strapi.requestContext.run(
        {
          state: { route: { info: { type: 'content-api', ...info }, handler } },
          request: { path: '/api/zz', ip: '127.0.0.1' },
        } as never,
        read
      )

    let reads = 0
    beforeEach(() => {
      reads = 0
    })
    const draftRead = async (): Promise<void> => {
      await strapi.documents(ARTICLE_UID).findMany({ status: 'draft' })
      reads += 1
    }

    it('lets a read through only for the plugin micelio and the two handlers', async () => {
      for (const handler of [EXCHANGE_HANDLER, DRAFT_HANDLER]) {
        await asRoute({ pluginName: 'micelio' }, handler, draftRead)
      }
      expect(reads).toBe(2)
      expect(refusals()).toHaveLength(0)
    })

    it.each([
      ['another handler of the plugin', { pluginName: 'micelio' }, 'preview.token'],
      ['the handler as a full action UID', { pluginName: 'micelio' }, DRAFT],
      ['a handler that only starts like one', { pluginName: 'micelio' }, 'preview.draft.all'],
      ['the handler name under another plugin', { pluginName: 'other' }, DRAFT_HANDLER],
      ['the handler name of an api type', { apiName: 'article' }, DRAFT_HANDLER],
      ['the handler name with no plugin', {}, EXCHANGE_HANDLER],
      ['a handler that is a function', { pluginName: 'micelio' }, () => undefined],
      ['no handler', { pluginName: 'micelio' }, undefined],
    ])('refuses %s', async (_name, info, handler) => {
      await expect(asRoute(info, handler, draftRead)).rejects.toThrow(
        'Drafts are only available to editors'
      )
      expect(reads).toBe(0)
      expect(refusals()).toHaveLength(1)
      expect(refusals()[0].meta).toMatchObject({ reason: 'draft-requested' })
    })
  })
})
