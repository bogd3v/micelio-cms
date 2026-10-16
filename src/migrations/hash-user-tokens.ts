import { createHash } from 'node:crypto';
import type { Core } from '@strapi/strapi';

// Self-contained on purpose (standard, section 6): a migration keeps its own copies.
const USER_UID = 'plugin::users-permissions.user';
const TOKEN_COLUMNS = ['confirmationToken', 'resetPasswordToken'] as const;
const HASHED = /^[0-9a-f]{64}$/;
const BATCH_SIZE = 100;

type TokenRow = { id: number } & Partial<Record<(typeof TOKEN_COLUMNS)[number], string | null>>;

/**
 * Replaces the plain confirmation tokens and reset codes of readers with their
 * SHA-256 hex, and returns how many values it rewrote.
 *
 * @remarks
 * Idempotent: a value of exactly 64 lowercase hex characters is a hash and is
 * left alone (legacy tokens are 40 and 128 characters), so a hash is never
 * hashed again. It writes through `strapi.db.query`, so no lifecycle or
 * security stamp runs. The change cannot be undone: pending links stop
 * working and their owners ask for a new one. Never logs a token.
 */
export async function hashUserTokens(strapi: Core.Strapi): Promise<number> {
  const users = strapi.db.query(USER_UID);
  let rewritten = 0;
  let lastId = 0;

  for (;;) {
    const rows = (await users.findMany({
      select: ['id', ...TOKEN_COLUMNS],
      where: {
        id: { $gt: lastId },
        $or: TOKEN_COLUMNS.map((column) => ({ [column]: { $notNull: true } })),
      },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    })) as TokenRow[];
    if (rows.length === 0) return rewritten;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      for (const column of TOKEN_COLUMNS) {
        const value = row[column];
        if (typeof value !== 'string' || value === '' || HASHED.test(value)) continue;
        // Match the value just read: a row that changed since is not overwritten.
        const updated = await users.update({
          where: { id: row.id, [column]: value },
          data: { [column]: createHash('sha256').update(value).digest('hex') },
        });
        if (updated) rewritten += 1;
      }
    }
  }
}
