import { describe, it, expect, afterEach } from '@jest/globals';
import { setupStrapi, cleanupStrapi, serverHost } from './strapi';
import { restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';
import { parseTrustProxy, trustsForwardedHeaders } from '../src/utils/client-ip';

const forged = { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' };

/** The actor id follows the request origin while `URL` is unset. */
async function actorId(headers: Record<string, string>): Promise<string> {
  const res = await fetch(`http://${serverHost()}/fediverse/user/devbog`, {
    headers: { accept: 'application/activity+json', ...headers },
  });
  return ((await res.json()) as { id: string }).id;
}

async function boot(env: Parameters<typeof setRateLimitEnv>[0]) {
  setRateLimitEnv({
    FEDIVERSE_ENABLED: 'true',
    FEDIVERSE_ACTOR_IDENTIFIER: 'devbog',
    FEDIVERSE_ACTOR_USERNAME: 'bogdev',
    ...env,
  });
  delete process.env.URL;
  process.env.FRONTEND_URL = 'https://blog.example.test';
  await setupStrapi();
}

afterEach(async () => {
  await cleanupStrapi();
  restoreRateLimitEnv();
  delete process.env.FRONTEND_URL;
});

describe('trustsForwardedHeaders', () => {
  it('follows the same peers as the client address', () => {
    const header = '203.0.113.9';
    expect(trustsForwardedHeaders(parseTrustProxy('private'), '10.0.0.5', header)).toBe(true);
    expect(trustsForwardedHeaders(parseTrustProxy('private'), '::ffff:127.0.0.1', header)).toBe(
      true
    );
    expect(trustsForwardedHeaders(parseTrustProxy('private'), '198.51.100.7', header)).toBe(false);
    expect(trustsForwardedHeaders(parseTrustProxy('false'), '10.0.0.5', header)).toBe(false);
    expect(trustsForwardedHeaders(parseTrustProxy('192.0.2.0/24'), '192.0.2.4', header)).toBe(true);
    expect(trustsForwardedHeaders(parseTrustProxy('192.0.2.0/24'), '127.0.0.1', header)).toBe(
      false
    );
    expect(trustsForwardedHeaders(parseTrustProxy('private'), undefined, header)).toBe(false);
  });

  it('counts hops: needs at least that many entries in the chain', () => {
    expect(trustsForwardedHeaders(parseTrustProxy('1'), '198.51.100.7', '203.0.113.9')).toBe(true);
    expect(trustsForwardedHeaders(parseTrustProxy('2'), '198.51.100.7', '203.0.113.9')).toBe(false);
    expect(trustsForwardedHeaders(parseTrustProxy('1'), '198.51.100.7', '')).toBe(false);
  });
});

describe('X-Forwarded-Proto and -Host reach ctx only from a trusted peer', () => {
  it('honours them from a private peer (default)', async () => {
    await boot({});
    expect(await actorId(forged)).toBe('https://evil.example/fediverse/user/devbog');
  });

  it('ignores them from a peer outside TRUST_PROXY', async () => {
    await boot({ TRUST_PROXY: '192.0.2.0/24' });
    expect(await actorId(forged)).toBe(`http://${serverHost()}/fediverse/user/devbog`);
  });

  it('ignores them when TRUST_PROXY=false', async () => {
    await boot({ TRUST_PROXY: 'false' });
    expect(await actorId(forged)).toBe(`http://${serverHost()}/fediverse/user/devbog`);
  });

  it('TRUST_PROXY_PROTOCOL=false ignores them even from a trusted peer', async () => {
    await boot({ TRUST_PROXY_PROTOCOL: 'false' });
    expect(await actorId(forged)).toBe(`http://${serverHost()}/fediverse/user/devbog`);
  });

  it('keeps honouring them from a listed proxy', async () => {
    await boot({ TRUST_PROXY: '127.0.0.0/8' });
    expect(await actorId(forged)).toBe('https://evil.example/fediverse/user/devbog');
  });
});
