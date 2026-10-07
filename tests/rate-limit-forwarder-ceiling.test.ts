import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

const SECRET = 'forwarder-secret-0123456789-abcdefghij';
const COMMENT_PATH = '/api/comments/api::article.article:rate-limit-target';

const forwarded = (ip: string) => ({
  'X-Micelio-Forwarder-Secret': SECRET,
  'X-Micelio-Client-IP': ip,
});

describe('Rate limiting: forwarder ceiling per group', () => {
  const http = () => request(strapi.server.httpServer);
  const statuses = async (count: number, send: (i: number) => Promise<{ status: number }>) => {
    const result: number[] = [];
    for (let i = 0; i < count; i++) result.push((await send(i)).status);
    return result;
  };

  beforeAll(async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_FORWARDER_SECRET: SECRET,
      // The api group is off: the ceiling must not depend on it.
      RATE_LIMIT_API: '0',
      RATE_LIMIT_AUTH: '2/60',
      RATE_LIMIT_AUTH_IDENTIFIER: '0',
      RATE_LIMIT_COMMENTS: '3/600',
      RATE_LIMIT_ADMIN_AUTH: '3/300',
    });
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
  });

  it('caps forged clients at 20 times the group rule, even with the api group off', async () => {
    const peer = asClient('203.0.113.200');
    const results = await statuses(42, (i) =>
      http()
        .post('/api/auth/local')
        .set({ ...peer, ...forwarded(`192.0.2.${i + 1}`) })
        .send({ identifier: `u${i}@example.com`, password: 'wrong-password' })
    );
    // auth is 2 a minute: 40 forwarded requests a minute per peer, whatever the clients.
    expect(results.slice(0, 40)).not.toContain(429);
    expect(results.slice(40)).toEqual([429, 429]);
  });

  it('keeps one ceiling per group', async () => {
    // The auth ceiling of this peer is spent; its comments ceiling (20 x 3) is not.
    const peer = asClient('203.0.113.200');
    const res = await http()
      .post(COMMENT_PATH)
      .set({ ...peer, ...forwarded('192.0.2.250') })
      .send({ content: 'hi' });
    expect(res.status).not.toBe(429);
  });

  it('does not limit the api group at all while it is off', async () => {
    const results = await statuses(30, () =>
      http().get('/api/articles').set(asClient('203.0.113.201'))
    );
    expect(results).not.toContain(429);
  });

  it('ignores the forwarded client on /admin/login: it counts on the peer', async () => {
    const peer = asClient('203.0.113.202');
    const results = await statuses(5, (i) =>
      http()
        .post('/admin/login')
        .set({ ...peer, ...forwarded(`192.0.2.${100 + i}`) })
        .send({ email: 'a@example.com', password: 'wrong-password' })
    );
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
  });
});
