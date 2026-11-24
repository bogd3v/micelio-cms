import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { setPublicPermissions } from './helpers/permissions'
import { defaultSiteRelation } from '../src/utils/default-site'
import { fillBlockIds } from '../src/migrations/block-ids'
import type { ApiDocument } from './helpers/api-types'

// `shared.code` (#448, first pull request): code with a file name, highlighted lines and a caption,
// allowed in `article.blocks` and in `page.sections`. The server's highlighter is micelio's.

const ARTICLE_UID = 'api::article.article'
const PAGE_UID = 'api::page.page'

type Data = Record<string, unknown>

/** The languages the highlighter of micelio registers (the maintainer's decision on #448). */
const LANGUAGES = [
  'bash',
  'shell',
  'javascript',
  'typescript',
  'json',
  'yaml',
  'xml',
  'css',
  'python',
  'sql',
  'diff',
  'dockerfile',
  'ini',
  'markdown',
]

const block = (fields: Data = {}): Data => ({
  __component: 'shared.code',
  code: 'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4',
  language: 'typescript',
  filename: 'src/index.ts',
  highlight: [2, 3],
  caption: 'Two constants',
  ...fields,
})

describe('shared.code block', () => {
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

  beforeAll(async () => {
    await setupStrapi()
    await setPublicPermissions('article', ['find', 'findOne'])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('an article returns every field of the block through the public API', async () => {
    const draft = await articles().create({
      data: {
        title: 'Code',
        slug: 'code-block',
        blocks: [{ __component: 'shared.rich-text', body: 'Before.' }, block()],
      },
    })
    await articles().publish({ documentId: draft.documentId })

    const blocks = await publishedBlocks('code-block')
    expect(blocks[1]).toMatchObject(block())
  })

  it('stores the highlighted lines as a list of numbers, in order', async () => {
    const draft = await articles().create({
      data: {
        title: 'Lines',
        slug: 'code-lines',
        blocks: [block({ highlight: [7, 2, 3] })],
      },
    })
    await articles().publish({ documentId: draft.documentId })

    const [stored] = await publishedBlocks('code-lines')
    expect(stored.highlight).toEqual([7, 2, 3])
  })

  it('leaves every optional field empty and sets no default', async () => {
    const draft = await articles().create({
      data: {
        title: 'Bare',
        slug: 'code-bare',
        blocks: [{ __component: 'shared.code', code: 'echo hi' }],
      },
    })
    await articles().publish({ documentId: draft.documentId })

    const [stored] = await publishedBlocks('code-bare')
    expect(stored).toMatchObject({
      __component: 'shared.code',
      code: 'echo hi',
      language: null,
      filename: null,
      highlight: null,
      caption: null,
    })
  })

  it('accepts every language the highlighter ships', async () => {
    for (const language of LANGUAGES) {
      const draft = await articles().create({
        data: {
          title: `Language ${language}`,
          slug: `code-language-${language}`,
          blocks: [block({ language })],
        },
      })
      await articles().publish({ documentId: draft.documentId })

      const [stored] = await publishedBlocks(`code-language-${language}`)
      expect(stored.language).toBe(language)
    }
  })

  it('refuses a language the highlighter does not ship', async () => {
    await expect(
      articles().create({ data: { title: 'Ruby', blocks: [block({ language: 'ruby' })] } })
    ).rejects.toThrow(/must be one of/)
  })

  it('a page stores shared.code in sections, next to the sections, in order', async () => {
    const { documentId } = await pages().create({
      status: 'published',
      data: {
        title: 'Code page',
        slug: 'code-page',
        site: await defaultSiteRelation(strapi),
        sections: [
          { __component: 'section.rich-text', body: 'First' },
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
        { __component: 'section.rich-text' },
        block(),
        { __component: 'shared.rich-text' },
      ])
    }
  })

  it('the block id migration fills a blockId on a stored code block, once', async () => {
    await strapi.db.query('shared.code').updateMany({ where: {}, data: { blockId: null } })
    const rows = (await strapi.db.query('shared.code').findMany({})) as { blockId: unknown }[]
    expect(rows.length).toBeGreaterThan(0)

    await fillBlockIds(strapi)
    const filled = (await strapi.db.query('shared.code').findMany({})) as { blockId: unknown }[]
    for (const row of filled) expect(typeof row.blockId).toBe('string')

    const before = filled.map((row) => row.blockId)
    await fillBlockIds(strapi)
    const after = (await strapi.db.query('shared.code').findMany({})) as { blockId: unknown }[]
    expect(after.map((row) => row.blockId)).toEqual(before)
  })
})
