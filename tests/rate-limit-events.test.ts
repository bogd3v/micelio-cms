import {
  describe,
  it,
  expect,
  jest,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi, serverHost } from './strapi';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';
import { ipBucket } from '../src/utils/client-ip';
import { createForwarder, FORWARDER_SECRET_WARN_KEY } from '../src/utils/rate-limit/forwarder';
import { createRateLimitLogger } from '../src/utils/rate-limit/log';
import { getRateLimitRuntime } from '../src/utils/rate-limit/runtime';
import type { SecurityLogHost } from '../src/types/security-events';
import { hashIdentifier, securityLogSecret } from '../src/utils/security-log';

const SECRET = 'forwarder-secret-0123456789-abcdefghij';
const COMMENT_PATH = '/api/comments/api::article.article:rate-limit-events';
const INBOX = '/fediverse/user/devbog/inbox';
const HASH = /^[0-9a-f]{16}$/;

/** The metadata of a logged call. */
const metaOf = (call: readonly unknown[]): Record<string, string> =>
  (call[1] ?? {}) as Record<string, string>;

/** A host that only records `warn` calls, with fixed app keys. */
function fakeHost(): {
  host: SecurityLogHost;
  warn: jest.Mock<(message: string, meta?: Record<string, unknown>) => void>;
} {
  const warn = jest.fn<(message: string, meta?: Record<string, unknown>) => void>();
  const host: SecurityLogHost = {
    config: { get: <T>() => ['test-key-one', 'test-key-two'] as T },
    log: { info: jest.fn(), warn },
  };
  return { host, warn };
}

describe('Rate limiting: security events', () => {
  let accessKey = '';
  const http = () => request(strapi.server.httpServer);
  const spy = () => jest.spyOn(strapi.log, 'warn');
  const lines = (warn: ReturnType<typeof spy>, event: string) =>
    warn.mock.calls.filter(
      (call) => String(call[0]) === `security: ${event}` && metaOf(call).suppressed === undefined
    );
  const postComment = (ip: string) =>
    http().post(COMMENT_PATH).set(asClient(ip)).send({ content: 'hi' });

  beforeAll(async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_FORWARDER_SECRET: SECRET,
      RATE_LIMIT_COMMENTS: '2/600',
      RATE_LIMIT_FEDIVERSE_INBOX: '1/600',
      RATE_LIMIT_API: '3/60',
      RATE_LIMIT_TOKEN: '2/60',
      RATE_LIMIT_AUTH_IDENTIFIER: '2/900',
      RATE_LIMIT_ADMIN_IDENTIFIER: '2/900',
      RATE_LIMIT_AUTH_EMAIL: '1/3600',
      FEDIVERSE_ENABLED: 'true',
      FEDIVERSE_ACTOR_IDENTIFIER: 'devbog',
      FEDIVERSE_ACTOR_USERNAME: 'bogdev',
    });
    process.env.FRONTEND_URL = 'https://rate-limit.test';
    await setupStrapi();
    strapi.plugin('email').service('email').send = async () => undefined;
    accessKey = (
      await strapi
        .service('admin::api-token')
        .create({ name: 'events', type: 'read-only', lifespan: null })
    ).accessKey;
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
    delete process.env.FRONTEND_URL;
  });

  // Every test starts with a fresh line budget and throttle.
  beforeEach(() => {
    getRateLimitRuntime(strapi)?.events.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs one event for a rejection and none for a repeat inside the window', async () => {
    const ip = '203.0.113.141';
    await postComment(ip);
    await postComment(ip);
    const warn = spy();
    const first = await postComment(ip);
    const second = await postComment(ip);

    expect(first.status).toBe(429);
    expect(second.status).toBe(429);
    const written = lines(warn, 'rate-limit.rejected');
    expect(written).toHaveLength(1);
    const meta = metaOf(written[0]);
    expect(meta.event).toBe('rate-limit.rejected');
    expect(meta.outcome).toBe('failure');
    expect(meta.reason).toBe('rate-limited');
    expect(meta.client).toMatch(HASH);
    expect(meta.path).toContain('/api/comments/');
    expect(JSON.stringify(written[0])).not.toContain(ip);
  });

  it('keeps the 429 response and headers as they were', async () => {
    const ip = '203.0.113.142';
    await postComment(ip);
    await postComment(ip);
    const res = await postComment(ip);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ status: 429, name: 'RateLimitError' });
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.headers['ratelimit-limit']).toBe('2');
    expect(res.headers['ratelimit-remaining']).toBe('0');
  });

  it('logs the rejection of the fediverse guard without the address', async () => {
    const ip = '203.0.113.143';
    const send = () =>
      http()
        .post(INBOX)
        .set({ 'Content-Type': 'application/activity+json', ...asClient(ip) })
        .send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://mastodon.social/tests/rate-limit-events/1',
          type: 'Follow',
          actor: 'https://mastodon.social/users/test',
          object: `http://${serverHost()}/fediverse/user/devbog`,
        });
    await send();
    const warn = spy();
    const res = await send();
    expect(res.status).toBe(429);
    const written = lines(warn, 'rate-limit.rejected');
    expect(written).toHaveLength(1);
    expect(metaOf(written[0]).path).toBe(INBOX);
    expect(JSON.stringify(written[0])).not.toContain(ip);
  });

  it('logs a wrong forwarder secret once, without the secret or the address', async () => {
    const warn = spy();
    const wrong = 'wrong-secret-value-that-must-not-leak';
    for (let i = 0; i < 2; i++) {
      await http()
        .get('/api/articles')
        .set({
          ...asClient('203.0.113.144'),
          'X-Micelio-Forwarder-Secret': wrong,
          'X-Micelio-Client-IP': '192.0.2.77',
        });
    }
    const written = lines(warn, 'rate-limit.forwarder-secret.invalid');
    expect(written).toHaveLength(1);
    expect(metaOf(written[0]).reason).toBe('invalid-secret');
    const text = JSON.stringify(warn.mock.calls);
    expect(text).not.toContain(wrong);
    expect(text).not.toContain('192.0.2.77');
  });

  it('logs a ceiling rejection once, naming the peer and not the claimed visitors', async () => {
    const peer = '203.0.113.150';
    const send = (visitor: string) =>
      http()
        .post(COMMENT_PATH)
        .set({
          ...asClient(peer),
          'X-Micelio-Forwarder-Secret': SECRET,
          'X-Micelio-Client-IP': visitor,
        })
        .send({ content: 'hi' });
    // The ceiling is 20 times the group's 2 requests; each visitor stays under its own limit.
    for (let i = 1; i <= 40; i++) await send(`192.0.2.${i}`);
    const warn = spy();
    const first = await send('192.0.2.200');
    const second = await send('192.0.2.201');
    expect([first.status, second.status]).toEqual([429, 429]);
    const written = lines(warn, 'rate-limit.rejected');
    expect(written).toHaveLength(1);
    expect(metaOf(written[0]).client).toBe(
      hashIdentifier(ipBucket(peer), securityLogSecret(strapi))
    );
    expect(JSON.stringify(written[0])).not.toContain('192.0.2');
  });

  it('logs a token bucket rejection once', async () => {
    const warn = spy();
    const results: number[] = [];
    for (let i = 0; i < 9; i++) {
      const res = await http()
        .get('/api/articles')
        .set({ ...asClient('203.0.113.151'), Authorization: `Bearer ${accessKey}` });
      results.push(res.status);
    }
    expect(results).toContain(429);
    expect(lines(warn, 'rate-limit.rejected')).toHaveLength(1);
  });

  it.each([
    ['/api/auth/local', 'identifier'],
    ['/admin/login', 'email'],
  ])('logs one line for an account limited across addresses (%s)', async (path, field) => {
    const warn = spy();
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await http()
        .post(path)
        .set(asClient(`198.51.100.${10 + i}`))
        .send({ [field]: `victim-${field}@example.com`, password: 'wrong-password' });
      results.push(res.status);
    }
    expect(results.slice(0, 2)).not.toContain(429);
    expect(results.slice(2)).toEqual([429, 429, 429]);
    const written = lines(warn, 'rate-limit.rejected');
    expect(written).toHaveLength(1);
    expect(metaOf(written[0]).path).toBe(path);
    expect(JSON.stringify(written[0])).not.toContain('victim');
  });

  it('logs the silent auth-email answers without changing them', async () => {
    const forgot = (ip: string) =>
      http()
        .post('/api/auth/forgot-password')
        .set(asClient(ip))
        .send({ email: 'silent@example.com' });
    await forgot('198.51.100.30');
    const warn = spy();
    const second = await forgot('198.51.100.31');
    const third = await forgot('198.51.100.32');
    expect([second.status, second.body]).toEqual([200, { ok: true }]);
    expect(third.status).toBe(200);
    const written = lines(warn, 'rate-limit.rejected');
    expect(written).toHaveLength(1);
    expect(metaOf(written[0]).path).toBe('/api/auth/forgot-password');
    expect(JSON.stringify(written[0])).not.toContain('silent@');
  });

  describe('throttle', () => {
    const address = (i: number) => `10.${i >> 8}.${i & 255}.1`;

    it('writes again after a minute and keeps separate groups apart', () => {
      const { host, warn } = fakeHost();
      const logger = createRateLimitLogger(host);
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      logger.rejected('198.51.100.1', 'auth', '/api/auth/local');
      logger.rejected('198.51.100.1', 'auth', '/api/auth/local');
      logger.rejected('198.51.100.1', 'comments', '/api/comments/x');
      expect(warn).toHaveBeenCalledTimes(2);
      now.mockReturnValue(1_000_000 + 60_001);
      logger.rejected('198.51.100.1', 'auth', '/api/auth/local');
      // The summary of the held-back repeat comes first.
      expect(warn).toHaveBeenCalledTimes(4);
    });

    it('keys an account group by its bucket, not by the client', () => {
      const { host, warn } = fakeHost();
      const logger = createRateLimitLogger(host);
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      logger.rejected('198.51.100.1', 'auth-identifier', '/x', 'bucket-a');
      logger.rejected('198.51.100.2', 'auth-identifier', '/x', 'bucket-a');
      logger.rejected('198.51.100.1', 'auth-identifier', '/x', 'bucket-b');
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('caps a burst of 6,000 distinct clients and reports what it held back', () => {
      const { host, warn } = fakeHost();
      const logger = createRateLimitLogger(host);
      const now = jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
      for (let i = 0; i < 6_000; i++) logger.rejected(address(i), 'api', '/api/x');
      expect(warn).toHaveBeenCalledTimes(20);
      now.mockReturnValue(2_000_000 + 60_001);
      logger.rejected(address(7_000), 'api', '/api/x');
      // The summary comes first, then the new window's first line.
      expect(warn).toHaveBeenCalledTimes(22);
      expect(warn.mock.calls[20][1]).toMatchObject({
        event: 'rate-limit.rejected',
        suppressed: 5_980,
      });
      expect(warn.mock.calls[21][1]).toMatchObject({ reason: 'rate-limited' });
    });

    it('keeps a noisy group from using the line budget of another', () => {
      const { host, warn } = fakeHost();
      const logger = createRateLimitLogger(host);
      jest.spyOn(Date, 'now').mockReturnValue(4_000_000);
      for (let i = 0; i < 100; i++) logger.rejected(address(i), 'api', '/api/x');
      expect(warn).toHaveBeenCalledTimes(20);
      logger.rejected('198.51.100.9', 'admin-identifier', '/admin/login', 'bucket-z');
      expect(warn).toHaveBeenCalledTimes(21);
    });

    it('writes one summary per group that held rejections back, on flush', () => {
      const { host, warn } = fakeHost();
      const logger = createRateLimitLogger(host);
      jest.spyOn(Date, 'now').mockReturnValue(5_000_000);
      for (let i = 0; i < 22; i++) logger.rejected(address(i), 'api', '/api/x');
      for (let i = 0; i < 23; i++) logger.rejected(address(i), 'comments', '/api/c');
      expect(warn).toHaveBeenCalledTimes(40);
      logger.flush();
      const summaries = warn.mock.calls.slice(40).map(([, meta]) => meta?.suppressed);
      expect(summaries).toEqual([2, 3]);
      logger.flush();
      expect(warn).toHaveBeenCalledTimes(42);
    });

    it('routes the forwarder wrong-secret warning to the security event', () => {
      const keys: string[] = [];
      const forwarder = createForwarder(SECRET);
      const ctx = {
        req: { headers: { 'x-micelio-forwarder-secret': 'not-the-secret-0123456789abcdef' } },
      } as never;
      forwarder.apply(ctx, '203.0.113.9', (key) => keys.push(key));
      expect(keys).toEqual([FORWARDER_SECRET_WARN_KEY]);
    });

    it('limits the wrong-secret line to one a minute for the instance', () => {
      const { host, warn } = fakeHost();
      const logger = createRateLimitLogger(host);
      const now = jest.spyOn(Date, 'now').mockReturnValue(3_000_000);
      logger.forwarderSecretInvalid();
      logger.forwarderSecretInvalid();
      expect(warn).toHaveBeenCalledTimes(1);
      now.mockReturnValue(3_000_000 + 60_001);
      logger.forwarderSecretInvalid();
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });
});
