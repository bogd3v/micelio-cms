import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'
import { migrateRichTextToProse } from '../src/migrations/prose'
import { plantRetiredRichText } from './helpers/retired-rich-text'

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
      update(params: Data): Promise<unknown>
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
    // A save refuses `section.rich-text` since #445: it is stored as a release before it did.
    const { documentId } = await create('prose-order', [
      { __component: 'shared.rich-text', body: '## First' },
      { __component: 'shared.rich-text', body: 'placeholder' },
      { __component: 'shared.rich-text', body: 'Third' },
    ])
    await plantRetiredRichText(documentId, 1, { body: 'Second **text**' })

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

  // #445, fourth pull request: `section.rich-text` is retired, closed to writes, and stays in the
  // zone for one release so a frontend that names it in its populate keeps working.
  it('refuses a save that sends section.rich-text, naming prose', async () => {
    const attempt = create('prose-refused', [
      { __component: 'shared.rich-text', body: 'Allowed' },
      { __component: 'section.rich-text', body: 'Retired' },
    ])

    await expect(attempt).rejects.toMatchObject({
      name: 'ValidationError',
      message: expect.stringContaining('prose'),
      details: { errors: [{ path: ['sections', '1', '__component'] }] },
    })
    const { documentId } = await create('prose-allowed', [
      { __component: 'shared.rich-text', body: 'Allowed' },
    ])
    await expect(
      pages().update({ documentId, data: { sections: [{ __component: 'section.rich-text' }] } })
    ).rejects.toMatchObject({ message: expect.stringContaining('prose') })
  })

  it('a page request whose populate names section.rich-text still answers after the migration', async () => {
    const { documentId } = await create('prose-populate', [
      { __component: 'shared.rich-text', body: 'placeholder' },
    ])
    await plantRetiredRichText(documentId, 0, { body: 'Moved **text**', tone: 'accent' })
    await migrateRichTextToProse(strapi)

    const response = await request(strapi.server.httpServer)
      .get(
        '/api/pages?filters[slug][$eq]=prose-populate&locale=en' +
          '&populate[sections][on][section.rich-text][populate]=*' +
          '&populate[sections][on][shared.rich-text]=true'
      )
      .set('Authorization', `Bearer ${FRONTEND_KEY}`)

    expect(response.status).toBe(200)
    expect(response.body.data[0].sections).toEqual([
      expect.objectContaining({ __component: 'shared.rich-text', body: 'Moved **text**' }),
    ])
  })
})
