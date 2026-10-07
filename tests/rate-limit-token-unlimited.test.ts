import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

describe('Rate limiting: RATE_LIMIT_TOKEN=0', () => {
  let token: string;
  const read = (headers: Record<string, string>) =>
    request(strapi.server.httpServer).get('/api/articles').set(headers);

  beforeAll(async () => {
    setRateLimitEnv({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_API: '3/60', RATE_LIMIT_TOKEN: '0' });
    await setupStrapi();
    token = (
      await strapi
        .service('admin::api-token')
        .create({ name: 'unlimited', type: 'read-only', lifespan: null })
    ).accessKey;
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
  });

  it('never limits a valid content-api token, past the IP limit', async () => {
    const client = { ...asClient('203.0.113.210'), Authorization: `Bearer ${token}` };
    for (let i = 0; i < 30; i++) expect((await read(client)).status).not.toBe(429);
    // Another client with the (known) token is not limited either.
    expect(
      (await read({ ...asClient('203.0.113.211'), Authorization: `Bearer ${token}` })).status
    ).not.toBe(429);
  });

  it('still limits clients without a valid token', async () => {
    const client = { ...asClient('203.0.113.212'), Authorization: `Bearer ${'c'.repeat(128)}` };
    for (let i = 0; i < 3; i++) await read(client);
    expect((await read(client)).status).toBe(429);
  });
});
