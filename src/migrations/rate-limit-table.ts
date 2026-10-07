import type { Core } from '@strapi/strapi';
import { RATE_LIMIT_TABLE } from '../constants/rate-limit';
import type { RateLimitConfig } from '../types/rate-limit';

/**
 * Creates the table of the database rate limit store, with the columns
 * `rate-limiter-flexible`'s Postgres store expects (race-safe). Only on Postgres with
 * `RATE_LIMIT_STORE=database` and rate limiting on; idempotent. On SQLite the
 * store falls back to memory (it warns on first use), so nothing is created.
 * Returns whether the table was created.
 */
export async function ensureRateLimitTable(strapi: Core.Strapi): Promise<boolean> {
  const config = strapi.config.get<RateLimitConfig | undefined>('rate-limit');
  if (!config?.enabled || config.store !== 'database') return false;
  if (strapi.db.dialect.client !== 'postgres') return false;

  // Race-safe when several instances boot together: IF NOT EXISTS, and the
  // table-already-exists error of a concurrent create is swallowed too.
  const schemaName = strapi.db.getSchemaName();
  const table = schemaName ? `"${schemaName}"."${RATE_LIMIT_TABLE}"` : `"${RATE_LIMIT_TABLE}"`;
  const exists = await strapi.db.getSchemaConnection().hasTable(RATE_LIMIT_TABLE);
  if (exists) return false;
  try {
    await strapi.db.connection.raw(
      `CREATE TABLE IF NOT EXISTS ${table} (
        key varchar(255) PRIMARY KEY,
        points integer NOT NULL DEFAULT 0,
        expire bigint
      )`
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '42P07' && code !== '23505') throw error;
    return false;
  }
  return true;
}
