import { describe, it, expect, afterEach } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { ensureRateLimitTable } from '../src/migrations/rate-limit-table';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

const COMMENT_PATH = '/api/comments/api::article.article:rate-limit-target';
const TABLE = 'micelio_rate_limits';

const postComment = (headers: Record<string, string>) =>
  request(strapi.server.httpServer).post(COMMENT_PATH).set(headers).send({ content: 'hi' });
const statuses = async (count: number, send: (i: number) => Promise<{ status: number }>) => {
  const result: number[] = [];
  for (let i = 0; i < count; i++) result.push((await send(i)).status);
  return result;
};

afterEach(async () => {
  await cleanupStrapi();
  restoreRateLimitEnv();
});

describe('Rate limiting: database store on SQLite', () => {
  // On Postgres (TEST_DATABASE_URL) the block below runs instead.
  (process.env.TEST_DATABASE_URL ? it.skip : it)(
    'falls back to counting in memory, without creating the table',
    async () => {
      setRateLimitEnv({
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_STORE: 'database',
        RATE_LIMIT_COMMENTS: '3/600',
      });
      await setupStrapi();
      expect(await strapi.db.getSchemaConnection().hasTable(TABLE)).toBe(false);

      const results = await statuses(5, () => postComment(asClient('203.0.113.1')));
      expect(results.slice(0, 3)).not.toContain(429);
      expect(results.slice(3)).toEqual([429, 429]);
    }
  );
});

// Needs a Postgres server: TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/postgres
(process.env.TEST_DATABASE_URL ? describe : describe.skip)(
  'Rate limiting: database store on Postgres',
  () => {
    const rows = async () =>
      strapi.db.connection(TABLE).select('key', 'points') as Promise<
        { key: string; points: number }[]
      >;

    it('creates the table, counts in it and keeps HMAC keys only', async () => {
      setRateLimitEnv({
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_STORE: 'database',
        RATE_LIMIT_COMMENTS: '3/600',
      });
      await setupStrapi();
      expect(await strapi.db.getSchemaConnection().hasTable(TABLE)).toBe(true);

      const results = await statuses(5, () => postComment(asClient('203.0.113.1')));
      expect(results.slice(0, 3)).not.toContain(429);
      expect(results.slice(3)).toEqual([429, 429]);

      const stored = await rows();
      expect(stored.length).toBeGreaterThan(0);
      expect(JSON.stringify(stored)).not.toContain('203.0.113.1');
      expect(stored.every((row) => /^comments:[0-9a-f]{64}$/.test(row.key))).toBe(true);
    });

    it('creates the table safely when several instances boot together', async () => {
      setRateLimitEnv({
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_STORE: 'database',
        RATE_LIMIT_COMMENTS: '3/600',
      });
      await setupStrapi();
      const schema = strapi.db.getSchemaConnection();
      await strapi.db.connection.raw(`DROP TABLE IF EXISTS "${TABLE}"`);

      const outcomes = await Promise.all(
        Array.from({ length: 6 }, () => ensureRateLimitTable(strapi))
      );
      expect(await schema.hasTable(TABLE)).toBe(true);
      expect(outcomes.filter(Boolean).length).toBeGreaterThanOrEqual(1);
      // And again once it exists.
      expect(await ensureRateLimitTable(strapi)).toBe(false);
    });

    it('stops querying the store for a key that is already blocked', async () => {
      setRateLimitEnv({
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_STORE: 'database',
        RATE_LIMIT_COMMENTS: '3/600',
      });
      await setupStrapi();
      const client = asClient('203.0.113.2');
      await statuses(5, () => postComment(client));
      const before = await rows();

      // The key is blocked in memory now: more attempts leave the row untouched.
      expect(await statuses(10, () => postComment(client))).toEqual(Array(10).fill(429));
      expect(await rows()).toEqual(before);
    });
  }
);
