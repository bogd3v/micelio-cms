import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { seedContent } from './helpers/response-fields-seed'
import { fillBlockIds } from '../src/migrations/block-ids'

const BLOCKS = [
  'section.hero',
  'section.feature-grid',
  'section.media-showcase',
  'section.stats',
  'section.logo-cloud',
  'section.testimonials',
  'section.pricing',
  'section.faq',
  'section.cta',
  'section.post-list',
  'section.newsletter',
  'section.rich-text',
  'section.gallery',
  'section.scene',
  'shared.rich-text',
  'shared.quote',
  'shared.media',
  'shared.slider',
  'shared.playground',
]
const ITEMS = [
  'section.feature-item',
  'section.stat',
  'section.testimonial',
  'section.plan',
  'section.faq-item',
  'section.logo',
  'shared.slide',
]
const FIELDS: [string, string][] = [
  ...BLOCKS.map((uid): [string, string] => [uid, 'blockId']),
  ...ITEMS.map((uid): [string, string] => [uid, 'itemId']),
]

interface Row {
  id: number
  [field: string]: unknown
}

const rowsOf = async (uid: string): Promise<Row[]> =>
  (await strapi.db.query(uid).findMany({ orderBy: { id: 'asc' } })) as Row[]

/** Every stored id of every block and item, keyed by component and row. */
async function snapshot(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const [uid, field] of FIELDS) {
    for (const row of await rowsOf(uid)) out[`${uid}#${row.id}`] = row[field]
  }
  return out
}

describe('block ids migration', () => {
  beforeAll(async () => {
    await setupStrapi()
    await seedContent()
  })

  // The seed saves content through the Document Service, which does not generate ids yet:
  // the rows are as an earlier release stored them.
  beforeEach(async () => {
    for (const [uid, field] of FIELDS) {
      await strapi.db.query(uid).updateMany({ where: {}, data: { [field]: null } })
    }
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('fills a blockId on every stored block and an itemId on every repeatable item that lacks one, drafts and published', async () => {
    for (const [uid] of FIELDS) {
      expect((await rowsOf(uid)).length).toBeGreaterThan(0)
    }

    const written = await fillBlockIds(strapi)

    const ids: string[] = []
    let total = 0
    for (const [uid, field] of FIELDS) {
      for (const row of await rowsOf(uid)) {
        total += 1
        expect(typeof row[field]).toBe('string')
        expect(row[field]).not.toBe('')
        ids.push(`${uid}:${row[field] as string}`)
      }
    }
    expect(written).toBe(total)
    expect(new Set(ids).size).toBe(ids.length)

    // Drafts and published versions are both stored: the seed publishes a page and an article.
    for (const uid of ['api::page.page', 'api::article.article']) {
      const statuses = (await strapi.db.query(uid).findMany({})) as { publishedAt: unknown }[]
      expect(statuses.some((row) => row.publishedAt === null)).toBe(true)
      expect(statuses.some((row) => row.publishedAt !== null)).toBe(true)
    }
  })

  it('a second run changes nothing and never rewrites an id it finds', async () => {
    await strapi.db.query('section.stat').update({
      where: { id: (await rowsOf('section.stat'))[0].id },
      data: { itemId: 'kept-item' },
    })
    await strapi.db.query('section.hero').update({
      where: { id: (await rowsOf('section.hero'))[0].id },
      data: { blockId: 'kept-block' },
    })

    const first = await fillBlockIds(strapi)
    const afterFirst = await snapshot()
    const second = await fillBlockIds(strapi)

    expect(first).toBeGreaterThan(0)
    expect(second).toBe(0)
    expect(await snapshot()).toEqual(afterFirst)
    expect((await rowsOf('section.stat'))[0].itemId).toBe('kept-item')
    expect((await rowsOf('section.hero'))[0].blockId).toBe('kept-block')
  })
})
