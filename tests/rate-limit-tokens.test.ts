import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { getRole } from './helpers/permissions';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

const TOKEN_UID = 'admin::api-token';
const SECRET = 'forwarder-secret-0123456789-abcdefghij';
const COMMENT_PATH = '/api/comments/api::article.article:rate-limit-target';

describe('Rate limiting: API tokens', () => {
  const tokens: Record<string, string> = {};
  let userJwt: string;

  const http = () => request(strapi.server.httpServer);
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const statuses = async (count: number, send: (i: number) => Promise<{ status: number }>) => {
    const result: number[] = [];
    for (let i = 0; i < count; i++) result.push((await send(i)).status);
    return result;
  };
  const read = (headers: Record<string, string>) => http().get('/api/articles').set(headers);

  beforeAll(async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_API: '3/60',
      RATE_LIMIT_TOKEN: '10/60',
      RATE_LIMIT_COMMENTS: '3/600',
      RATE_LIMIT_FORWARDER_SECRET: SECRET,
    });
    await setupStrapi();

    const service = strapi.service(TOKEN_UID);
    for (const name of ['frontend', 'second', 'late', 'expired']) {
      tokens[name] = (await service.create({ name, type: 'read-only', lifespan: null })).accessKey;
    }
    // A token past its expiry.
    await strapi.db
      .query(TOKEN_UID)
      .updateMany({ where: { name: 'expired' }, data: { expiresAt: new Date(Date.now() - 1000) } });

    // Admin-kind tokens belong to an admin user, as the admin panel creates them.
    const superAdmin = await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } });
    const owner = await strapi.service('admin::user').create({
      email: 'owner@example.com',
      firstname: 'Owner',
      password: 'Passw0rd!x',
      isActive: true,
      roles: [superAdmin.id],
    });
    const adminTokens = (
      strapi.admin as unknown as {
        services: Record<string, { create(a: object, u: object): Promise<{ accessKey: string }> }>;
      }
    ).services['api-token-admin'];
    for (const name of ['admin', 'admin-mcp']) {
      tokens[name] = (await adminTokens.create({ name, lifespan: null }, owner)).accessKey;
    }

    const role = await getRole('authenticated');
    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'reader',
      email: 'reader@example.com',
      password: 'Sup3r-secret',
      provider: 'local',
      confirmed: true,
      role: role.id,
    });
    userJwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
  });

  it('starts a valid token on the IP bucket, then moves it to the token bucket', async () => {
    const client = { ...asClient('203.0.113.60'), ...bearer(tokens.frontend) };
    const results = await statuses(14, () => read(client));
    // 3 on the client's bucket, then 10 on the token's, then the token's limit.
    expect(results.slice(0, 13)).not.toContain(429);
    expect(results[13]).toBe(429);
  });

  it('shares the token bucket across clients and skips their IP bucket once known', async () => {
    // The token bucket is spent by the previous test: a fresh client with the
    // same (now cached) token is refused at once, while it has IP budget left.
    const fresh = await read({ ...asClient('203.0.113.61'), ...bearer(tokens.frontend) });
    expect(fresh.status).toBe(429);
    // Without the token the same client still has its own budget.
    expect((await read(asClient('203.0.113.61'))).status).not.toBe(429);
  });

  it('gives a second token its own bucket', async () => {
    const client = { ...asClient('203.0.113.62'), ...bearer(tokens.second) };
    expect(await statuses(6, () => read(client))).not.toContain(429);
  });

  it('keeps a random bearer on the IP bucket', async () => {
    const client = { ...asClient('203.0.113.63'), ...bearer('a'.repeat(128)) };
    const results = await statuses(5, () => read(client));
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('keeps a JWT-shaped bearer on the IP bucket', async () => {
    const client = { ...asClient('203.0.113.64'), ...bearer(userJwt) };
    const results = await statuses(5, () => read(client));
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('gives an expired token no token bucket', async () => {
    const client = { ...asClient('203.0.113.65'), ...bearer(tokens.expired) };
    const results = await statuses(5, () => read(client));
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('gives an admin-kind token no token bucket on ordinary routes', async () => {
    const client = { ...asClient('203.0.113.66'), ...bearer(tokens.admin) };
    const results = await statuses(5, () => read(client));
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('exempts /mcp only when its bearer is a valid admin token', async () => {
    const mcp = (headers: Record<string, string>) => http().post('/mcp').set(headers).send({});

    const admin = { ...asClient('203.0.113.67'), ...bearer(tokens['admin-mcp']) };
    expect(await statuses(10, () => mcp(admin))).not.toContain(429);

    // No bearer and a random one go through the api group.
    for (const [ip, headers] of [
      ['203.0.113.68', {}],
      ['203.0.113.69', bearer('b'.repeat(128))],
    ] as const) {
      const results = await statuses(5, () => mcp({ ...asClient(ip), ...headers }));
      expect(results[4]).toBe(429);
    }
  });

  it('still limits a valid frontend token per client on POST comments', async () => {
    const client = { ...asClient('203.0.113.71'), ...bearer(tokens.second) };
    const post = (headers: Record<string, string>) =>
      http().post(COMMENT_PATH).set(headers).send({ content: 'hi' });
    const results = await statuses(5, () => post(client));
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
    expect((await post({ ...asClient('203.0.113.72'), ...bearer(tokens.second) })).status).not.toBe(
      429
    );
  });

  it('caps the token lookups one client can trigger (60 a minute)', async () => {
    const client = asClient('203.0.113.73');
    // The client's api bucket is empty after 3 requests; every further junk
    // bearer then spends a lookup.
    await statuses(3, () => read(client));
    const junk = await statuses(60, (i) =>
      read({ ...client, ...bearer(`junk-${i}-`.padEnd(64, 'x')) })
    );
    expect(junk).toEqual(Array(60).fill(429));

    // Lookup budget gone: even a valid token is not looked up for this client...
    const refused = await read({ ...client, ...bearer(tokens.late) });
    expect(refused.status).toBe(429);
    // ...while another client, with its own budget, gets the token recognised
    // (and then the token's bucket) after its IP bucket is spent.
    const other = asClient('203.0.113.74');
    const results = await statuses(5, () => read({ ...other, ...bearer(tokens.late) }));
    expect(results).not.toContain(429);
  });

  it('ignores the token on forwarded requests that name the visitor', async () => {
    const peer = asClient('203.0.113.75');
    const visitor = (ip: string) => ({
      ...peer,
      ...bearer(tokens.frontend),
      'X-Micelio-Forwarder-Secret': SECRET,
      'X-Micelio-Client-IP': ip,
    });
    // `tokens.frontend` is spent from the first test, and cached: were the token
    // used, every visitor would get 429 at once.
    const a = await statuses(5, () => read(visitor('192.0.2.201')));
    expect(a.slice(0, 3)).not.toContain(429);
    expect(a.slice(3)).toEqual([429, 429]);
    expect((await read(visitor('192.0.2.202'))).status).toBe(200);
  });
});
