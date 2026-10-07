import { describe, it, expect, jest, afterEach } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

const COMMENT_PATH = '/api/comments/api::article.article:rate-limit-target';

const statuses = async (count: number, send: (i: number) => Promise<{ status: number }>) => {
  const result: number[] = [];
  for (let i = 0; i < count; i++) result.push((await send(i)).status);
  return result;
};
const postComment = (headers: Record<string, string>) =>
  request(strapi.server.httpServer).post(COMMENT_PATH).set(headers).send({ content: 'hi' });

afterEach(async () => {
  await cleanupStrapi();
  restoreRateLimitEnv();
});

describe('Rate limiting: TRUST_PROXY at boot and at runtime', () => {
  it('TRUST_PROXY=false ignores X-Forwarded-For even from loopback', async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_COMMENTS: '3/600',
      TRUST_PROXY: 'false',
    });
    await setupStrapi();
    const results = await statuses(5, (i) => postComment(asClient(`203.0.113.${i + 1}`)));
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it.each([
    ['on', { RATE_LIMIT_ENABLED: 'true' }],
    ['off', {}],
  ])(
    'warns once when TRUST_PROXY=false and a proxy header arrives (limiter %s)',
    async (_n, extra) => {
      setRateLimitEnv({ ...extra, TRUST_PROXY: 'false' });
      await setupStrapi();
      const warn = jest.spyOn(strapi.log, 'warn');
      try {
        await request(strapi.server.httpServer).get('/api/articles');
        expect(
          warn.mock.calls.filter(([m]) => String(m).includes('TRUST_PROXY=false'))
        ).toHaveLength(0);
        for (let i = 0; i < 3; i++)
          await request(strapi.server.httpServer)
            .get('/api/articles')
            .set(asClient(`203.0.113.${i + 1}`));
        const warnings = warn.mock.calls.filter(([m]) => String(m).includes('TRUST_PROXY=false'));
        expect(warnings).toHaveLength(1);
        expect(String(warnings[0][0])).not.toContain('203.0.113');
      } finally {
        warn.mockRestore();
      }
    }
  );

  it('TRUST_PROXY=1 takes the last entry of the chain', async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_COMMENTS: '3/600',
      TRUST_PROXY: '1',
    });
    await setupStrapi();
    const results = await statuses(5, (i) =>
      postComment({ 'X-Forwarded-For': `10.1.1.${i}, 203.0.113.9` })
    );
    expect(results.slice(3)).toEqual([429, 429]);
    // A short chain (0 entries) falls back to the socket address: still one client.
    expect((await postComment(asClient('203.0.113.10'))).status).not.toBe(429);
  });

  it('TRUST_PROXY=2 skips one more hop', async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_COMMENTS: '3/600',
      TRUST_PROXY: '2',
    });
    await setupStrapi();
    // The second entry from the right is the client, the last one a proxy.
    const results = await statuses(5, (i) =>
      postComment({ 'X-Forwarded-For': `10.1.1.${i}, 203.0.113.9, 10.2.2.${i}` })
    );
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('a CIDR list trusts only those proxies', async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_COMMENTS: '3/600',
      TRUST_PROXY: '192.0.2.0/24',
    });
    await setupStrapi();
    // The test client is loopback, which is not listed: the header is ignored.
    const results = await statuses(5, (i) => postComment(asClient(`203.0.113.${i + 1}`)));
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('PROXY_IP_HEADER names the header that is read', async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_COMMENTS: '3/600',
      PROXY_IP_HEADER: 'X-Real-Client',
    });
    await setupStrapi();
    const results = await statuses(5, (i) =>
      postComment({ 'X-Real-Client': '203.0.113.9', 'X-Forwarded-For': `203.0.113.${i + 20}` })
    );
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('refuses to boot with TRUST_PROXY=true', async () => {
    setRateLimitEnv({ RATE_LIMIT_ENABLED: 'true', TRUST_PROXY: 'true' });
    await expect(setupStrapi()).rejects.toThrow(/TRUST_PROXY=true is not allowed/);
  });

  it('refuses to boot with a forwarder secret under 32 characters', async () => {
    setRateLimitEnv({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_FORWARDER_SECRET: 'too-short' });
    await expect(setupStrapi()).rejects.toThrow(/at least 32 characters/);
  });

  it('refuses TRUST_PROXY=true even while rate limiting is off', async () => {
    setRateLimitEnv({ TRUST_PROXY: 'true' });
    await expect(setupStrapi()).rejects.toThrow(/TRUST_PROXY=true is not allowed/);
  });

  it('checks the forwarder secret length only while rate limiting is on', async () => {
    setRateLimitEnv({ RATE_LIMIT_FORWARDER_SECRET: 'short' });
    await setupStrapi();
    const results = await statuses(15, () => postComment(asClient('203.0.113.1')));
    expect(results).not.toContain(429);
  });
});
