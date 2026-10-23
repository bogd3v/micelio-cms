import { createHash } from 'node:crypto'
import type { Core } from '@strapi/strapi'

const SUBSCRIBER_UID = 'api::subscriber.subscriber'
const TOKEN_FIELDS = ['confirmationToken', 'unsubscribeToken'] as const
/** A stored value that already is a SHA-256 hex digest; the frontend uses the same test. */
const HASH_PATTERN = /^[0-9a-f]{64}$/
const BATCH_SIZE = 200

type TokenRow = {
  id: number
  confirmationToken: string | null
  unsubscribeToken: string | null
}

/**
 * Replaces every subscriber token stored in the clear with its SHA-256 hex digest.
 *
 * @remarks
 * Rows written before the frontend hashed tokens (UUIDs or 43-character base64url
 * strings) hold the token the subscriber's email carries. The frontend looks a token up
 * by `sha256(token)` first, so the emailed links keep working after the rewrite, and a
 * stored value can no longer be used as a token. A value that already matches
 * `/^[0-9a-f]{64}$/` is left alone, so a second run changes nothing. The rewrite is in
 * place and cannot be undone. Never logs a token or an email.
 *
 * A token changed between the read and the update is left for the next boot.
 *
 * @returns How many tokens were hashed.
 */
export async function hashSubscriberTokens(strapi: Core.Strapi): Promise<number> {
  const query = strapi.db.query(SUBSCRIBER_UID)
  let hashed = 0
  let lastId = 0

  for (;;) {
    const rows = (await query.findMany({
      select: ['id', ...TOKEN_FIELDS],
      where: {
        id: { $gt: lastId },
        $or: TOKEN_FIELDS.map((field) => ({ [field]: { $notNull: true } })),
      },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    })) as TokenRow[]
    if (rows.length === 0) return hashed

    for (const row of rows) {
      for (const field of TOKEN_FIELDS) {
        const stored = row[field]
        if (typeof stored !== 'string' || stored === '' || HASH_PATTERN.test(stored)) continue
        // Matching the value read keeps a token written since then (a concurrent frontend) intact.
        const updated = await query.updateMany({
          where: { id: row.id, [field]: stored },
          data: { [field]: createHash('sha256').update(stored).digest('hex') },
        })
        hashed += updated.count
      }
    }
    lastId = rows[rows.length - 1].id
  }
}
