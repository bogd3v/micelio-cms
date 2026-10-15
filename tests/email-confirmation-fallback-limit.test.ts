import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

/** The plugin's default `max` per minute and client. */
const LIMIT = 10;
const CONFIRM_PATH = '/api/auth/email-confirmation';

describe('POST /api/auth/email-confirmation with the plugin limiter', () => {
  beforeAll(async () => {
    // The app-level limiter is off, so the plugin's own limiter stays active.
    setRateLimitEnv({ RATE_LIMIT_ENABLED: 'false' });
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
  });

  it('keys its bucket on the client, not on a body email', async () => {
    const client = asClient('203.0.113.60');
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 1; i++) {
      const res = await request(strapi.server.httpServer)
        .post(CONFIRM_PATH)
        .set(client)
        .send({ confirmation: 'b'.repeat(40), email: `victim${i}@example.com` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, LIMIT)).toEqual(Array(LIMIT).fill(400));
    expect(statuses[LIMIT]).toBe(429);
  });
});
