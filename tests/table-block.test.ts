import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { setPublicPermissions } from './helpers/permissions'
import { defaultSiteRelation } from '../src/utils/default-site'
import { fillBlockIds } from '../src/migrations/block-ids'
import type { ApiDocument } from './helpers/api-types'

// `shared.table` (#449, first pull request): a table of data with a caption, header cells and a
// header column, allowed in `article.blocks` and in `page.sections`. Its columns
// (`shared.table-column`) and rows (`shared.table-row`) are repeatable items. That a row has one
// cell per column is checked on save in `@micelio/strapi-plugin-core`, not here.

const ARTICLE_UID = 'api::article.article'
const PAGE_UID = 'api::page.page'

type Data = Record<string, unknown>

const block = (fields: Data = {}): Data => ({
  __component: 'shared.table',
  caption: 'Plans and prices',
  columns: [
    { label: 'Plan', align: 'start' },
    { label: 'Price', align: 'center' },
  ],
  rows: [{ cells: ['Basic', '0'] }, { cells: ['Pro', '10'] }, { cells: ['Team', '25'] }],
  headerColumn: true,
  ...fields,
})

describe('shared.table block', () => {
  const articles = () =>
    strapi.documents(ARTICLE_UID) as unknown as {
      create(params: Data): Promise<{ documentId: string }>
      publish(params: Data): Promise<unknown>
    }
  const pages = () =>
    strapi.documents(PAGE_UID) as unknown as {
      create(params: Data): Promise<{ documentId: string }>
      findOne(params: Data): Promise<{ sections: Data[] } | null>
    }

  async function publishedBlocks(slug: string): Promise<Data[]> {
    const res = await request(strapi.server.httpServer)
      .get('/api/articles')
      .query({ filters: { slug: { $eq: slug } }, populate: { blocks: { populate: '*' } } })
      .expect(200)
    const [article] = res.body.data as (ApiDocument & { blocks: Data[] })[]
    return article.blocks
  }

  async function createArticle(slug: string, blocks: Data[]): Promise<void> {
    const draft = await articles().create({ data: { title: slug, slug, blocks } })
    await articles().publish({ documentId: draft.documentId })
  }

  beforeAll(async () => {
    await setupStrapi()
    await setPublicPermissions('article', ['find', 'findOne'])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('an article returns the caption, the columns, the rows and the header column through the public API', async () => {
    await createArticle('table-block', [
      { __component: 'shared.rich-text', body: 'Before.' },
      block(),
    ])

    const blocks = await publishedBlocks('table-block')
    expect(blocks[1]).toMatchObject(block())
  })

  it('keeps the order of the columns, of the rows and of the cells of each row', async () => {
    const columns = [
      { label: 'C', align: 'center' },
      { label: 'A', align: 'start' },
      { label: 'B', align: 'center' },
    ]
    const rows = [{ cells: ['3', '1', '2'] }, { cells: ['z', 'x', 'y'] }]
    await createArticle('table-order', [block({ columns, rows })])

    const [stored] = (await publishedBlocks('table-order')) as {
      columns: Data[]
      rows: Data[]
    }[]
    expect(stored.columns.map((column) => column.label)).toEqual(['C', 'A', 'B'])
    expect(stored.rows.map((row) => row.cells)).toEqual([
      ['3', '1', '2'],
      ['z', 'x', 'y'],
    ])
  })

  it('leaves every optional field empty and sets no default', async () => {
    await createArticle('table-bare', [
      { __component: 'shared.table', columns: [{ label: 'Only' }], rows: [{ cells: ['one'] }] },
    ])

    const [stored] = await publishedBlocks('table-bare')
    expect(stored).toMatchObject({
      __component: 'shared.table',
      caption: null,
      headerColumn: null,
      columns: [{ label: 'Only', align: null }],
      rows: [{ cells: ['one'] }],
    })
  })

  it('refuses a column alignment other than start or center', async () => {
    await expect(
      articles().create({
        data: { title: 'End', blocks: [block({ columns: [{ label: 'A', align: 'end' }] })] },
      })
    ).rejects.toThrow(/must be one of/)
  })

  it('a page stores shared.table in sections, next to the sections, in order', async () => {
    const { documentId } = await pages().create({
      status: 'published',
      data: {
        title: 'Table page',
        slug: 'table-page',
        site: await defaultSiteRelation(strapi),
        sections: [
          { __component: 'shared.rich-text', body: 'First' },
          block(),
          { __component: 'shared.rich-text', body: 'Third' },
        ],
      },
    })

    for (const status of ['draft', 'published']) {
      const page = await pages().findOne({
        documentId,
        status,
        populate: { sections: { populate: '*' } },
      })
      expect(page?.sections).toMatchObject([
        { __component: 'shared.rich-text' },
        block(),
        { __component: 'shared.rich-text' },
      ])
    }
  })

  it('the block id migration fills a blockId on a stored table and an itemId on its columns and rows, once', async () => {
    const fields: [string, string][] = [
      ['shared.table', 'blockId'],
      ['shared.table-column', 'itemId'],
      ['shared.table-row', 'itemId'],
    ]
    const read = async (uid: string, field: string): Promise<unknown[]> =>
      ((await strapi.db.query(uid).findMany({ orderBy: { id: 'asc' } })) as Data[]).map(
        (row) => row[field]
      )

    for (const [uid, field] of fields) {
      await strapi.db.query(uid).updateMany({ where: {}, data: { [field]: null } })
      expect((await read(uid, field)).length).toBeGreaterThan(0)
    }

    await fillBlockIds(strapi)
    const before: unknown[][] = []
    for (const [uid, field] of fields) {
      const ids = await read(uid, field)
      for (const id of ids) expect(typeof id).toBe('string')
      before.push(ids)
    }

    await fillBlockIds(strapi)
    for (const [index, [uid, field]] of fields.entries()) {
      expect(await read(uid, field)).toEqual(before[index])
    }
  })
})
