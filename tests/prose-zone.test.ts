import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

// `shared.rich-text` is allowed in the sections of a page next to `section.rich-text` (#445, first
// pull request): the same Markdown block as an article's, stored and returned in order.

const PAGE_UID = 'api::page.page'
const FRONTEND_KEY = 'prose-zone-frontend-token-0123456789abcdef'
const saved = { ...process.env }

type Data = Record<string, unknown>

describe('shared.rich-text in the sections of a page', () => {
  const pages = () =>
    strapi.documents(PAGE_UID) as unknown as {
      create(params: Data): Promise<{ documentId: string }>
      findOne(params: Data): Promise<{ sections: Data[] } | null>
    }
  const create = async (slug: string, sections: Data[]) =>
    pages().create({
      status: 'published',
      data: { title: slug, slug, sections, site: await defaultSiteRelation(strapi) },
    })

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
    process.env = { ...saved }
  })

  it('a page stores shared.rich-text and section.rich-text in sections, in order', async () => {
    const { documentId } = await create('prose-order', [
      { __component: 'shared.rich-text', body: '## First' },
      { __component: 'section.rich-text', body: 'Second **text**' },
      { __component: 'shared.rich-text', body: 'Third' },
    ])

    for (const status of ['draft', 'published']) {
      const page = await pages().findOne({
        documentId,
        status,
        populate: { sections: { populate: '*' } },
      })
      expect(page?.sections).toMatchObject([
        { __component: 'shared.rich-text', body: '## First' },
        { __component: 'section.rich-text', body: 'Second **text**' },
        { __component: 'shared.rich-text', body: 'Third' },
      ])
    }
  })

  it('the content API returns a shared.rich-text section of a page with its body', async () => {
    await create('prose-api', [{ __component: 'shared.rich-text', body: 'Body **in** a page' }])

    const response = await request(strapi.server.httpServer)
      .get(
        '/api/pages?filters[slug][$eq]=prose-api&populate[sections][on][shared.rich-text][populate]=*&locale=en'
      )
      .set('Authorization', `Bearer ${FRONTEND_KEY}`)

    expect(response.status).toBe(200)
    expect(response.body.data[0].sections).toMatchObject([
      { __component: 'shared.rich-text', body: 'Body **in** a page' },
    ])
  })
})
