import { randomUUID } from 'node:crypto'
import type { Core } from '@strapi/strapi'

const BATCH_SIZE = 100

/** Components of the dynamic zones that carry a `blockId`. */
const BLOCK_UIDS = [
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

/** Repeatable items of the blocks that carry an `itemId`. */
const ITEM_UIDS = [
  'section.feature-item',
  'section.stat',
  'section.testimonial',
  'section.plan',
  'section.faq-item',
  'section.logo',
  'shared.slide',
]

/** What the migration reads of a component row. */
interface IdRow {
  id: number
}

/** Fills `field` on every row of `uid` that has none, and returns how many it filled. */
async function fillField(strapi: Core.Strapi, uid: string, field: string): Promise<number> {
  const query = strapi.db.query(uid)
  let filled = 0
  let lastId = 0

  for (;;) {
    const rows = (await query.findMany({
      select: ['id'],
      where: { id: { $gt: lastId }, $or: [{ [field]: null }, { [field]: '' }] },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    })) as IdRow[]
    if (rows.length === 0) return filled
    lastId = rows[rows.length - 1].id

    for (const row of rows) {
      await query.update({ where: { id: row.id }, data: { [field]: randomUUID() } })
      filled += 1
    }
  }
}

/**
 * Gives every stored block a `blockId` and every repeatable item an `itemId`
 * when it has none: an opaque UUID, one per component row. It writes the
 * component rows directly, like `migrateSliderItems`, so drafts and published
 * versions of pages, articles and the About page are all reached and nothing
 * gets republished (the two versions of a document get different ids: the
 * published one takes the draft's on the next publish). Idempotent: a row that
 * has an id is never rewritten, so a second run returns 0.
 *
 * @returns The number of ids written.
 */
export async function fillBlockIds(strapi: Core.Strapi): Promise<number> {
  let filled = 0
  for (const uid of BLOCK_UIDS) filled += await fillField(strapi, uid, 'blockId')
  for (const uid of ITEM_UIDS) filled += await fillField(strapi, uid, 'itemId')
  return filled
}
