import type { Core } from '@strapi/strapi'

const NEWSLETTER_UID = 'section.newsletter'
const BATCH_SIZE = 100

/** What the migration reads of a component row. */
interface NewsletterRow {
  id: number
}

/**
 * Reports each stored `section.newsletter` entry (drafts and published
 * versions) that has no `consentText`, one warning per entry in the boot log.
 * It writes nothing: a consent text is a node's own legal wording and nothing
 * stored can fill it, so there is no default, and `successMessage` and
 * `placeholder` stay empty so the frontend keeps its own strings. Idempotent:
 * a second run reports the same entries and changes nothing.
 *
 * @returns The row ids of the entries without a `consentText`.
 */
export async function reportNewsletterConsent(strapi: Core.Strapi): Promise<number[]> {
  const query = strapi.db.query(NEWSLETTER_UID)
  const missing: number[] = []
  let lastId = 0

  for (;;) {
    const rows = (await query.findMany({
      select: ['id'],
      where: { id: { $gt: lastId }, $or: [{ consentText: null }, { consentText: '' }] },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    })) as NewsletterRow[]
    if (rows.length === 0) return missing
    lastId = rows[rows.length - 1].id

    for (const row of rows) {
      strapi.log.warn(`[newsletter] entry ${row.id} has no consentText`)
      missing.push(row.id)
    }
  }
}
