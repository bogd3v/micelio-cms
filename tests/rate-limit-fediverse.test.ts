import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import request from 'supertest';
import { setupStrapi, cleanupStrapi, serverHost } from './strapi';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

const ACTIVITY_JSON = 'application/activity+json';
const INBOX = '/fediverse/user/devbog/inbox';
const ACTOR = '/fediverse/user/devbog';

describe('Rate limiting: fediverse inbox', () => {
  const api = () => request(strapi.server.httpServer);
  const statuses = async (count: number, send: (i: number) => Promise<{ status: number }>) => {
    const result: number[] = [];
    for (let i = 0; i < count; i++) result.push((await send(i)).status);
    return result;
  };
  const postInbox = (path: string, headers: Record<string, string>) =>
    api()
      .post(path)
      .set({ 'Content-Type': ACTIVITY_JSON, ...headers })
      .send({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://mastodon.social/tests/rate-limit/1',
        type: 'Follow',
        actor: 'https://mastodon.social/users/test',
        object: `http://${serverHost()}${ACTOR}`,
      });

  beforeAll(async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_FEDIVERSE_INBOX: '3/60',
      RATE_LIMIT_API: '5/60',
      FEDIVERSE_ENABLED: 'true',
      FEDIVERSE_ACTOR_IDENTIFIER: 'devbog',
      FEDIVERSE_ACTOR_USERNAME: 'bogdev',
    });
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
  });

  it('registers the guard for the plugin', () => {
    expect(typeof strapi.config.get('plugin::fediverse.requestGuard')).toBe('function');
  });

  it('answers 429 once the inbox limit is spent, and lets Fedify answer before', async () => {
    const client = asClient('203.0.113.90');
    const first = await statuses(3, () => postInbox(INBOX, client));
    // Unsigned deliveries are Fedify's 401, which proves it ran.
    expect(first).toEqual([401, 401, 401]);

    const blocked = await postInbox(INBOX, client);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      data: null,
      error: { status: 429, name: 'RateLimitError' },
    });
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers['ratelimit-policy']).toBe('3;w=60');
  });

  it('answers 429 without reading the body', async () => {
    const client = asClient('203.0.113.91');
    await statuses(3, () => postInbox(INBOX, client));

    const [host, port] = serverHost().split(':');
    // Declares a 1 MB body and never sends it: a handler that read the body
    // would wait for it, the guard answers at once.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host,
          port: Number(port),
          path: INBOX,
          method: 'POST',
          headers: { ...client, 'Content-Type': ACTIVITY_JSON, 'Content-Length': '1000000' },
        },
        (res) => {
          resolve(res.statusCode ?? 0);
          req.destroy();
        }
      );
      req.on('error', (error) => reject(error));
      req.setTimeout(5000, () => reject(new Error('no answer without a body: the body was read')));
      req.write('{');
    });
    expect(status).toBe(429);
  });

  it('limits the shared inbox and a trailing slash with the same bucket', async () => {
    const client = asClient('203.0.113.92');
    await postInbox(INBOX, client);
    await postInbox('/fediverse/inbox', client);
    await postInbox(`${INBOX}/`, client);
    expect((await postInbox('/fediverse/inbox', client)).status).toBe(429);
  });

  it('keeps counting clients apart', async () => {
    expect((await postInbox(INBOX, asClient('203.0.113.93'))).status).toBe(401);
  });

  it('leaves the actor document alone while the inbox limit is spent', async () => {
    const client = asClient('203.0.113.94');
    await statuses(4, () => postInbox(INBOX, client));
    expect((await postInbox(INBOX, client)).status).toBe(429);

    const actor = await api()
      .get(ACTOR)
      .set({ ...client, Accept: ACTIVITY_JSON });
    expect(actor.status).toBe(200);
    expect(actor.body.type).toBe('Person');
  });

  it('counts other federation reads in the api group, once each', async () => {
    const client = asClient('203.0.113.95');
    // HTML requests fall through Fedify to Strapi's router: the root limiter
    // must skip them, the guard having counted them already.
    const results = await statuses(7, () =>
      api()
        .get(ACTOR)
        .set({ ...client, Accept: 'text/html' })
    );
    expect(results.slice(0, 5)).not.toContain(429);
    expect(results.slice(5)).toEqual([429, 429]);
  });

  describe('when the guard fails', () => {
    it('lets federation through and warns once', async () => {
      const real = strapi.config.get('plugin::fediverse.requestGuard');
      strapi.config.set('plugin::fediverse.requestGuard', async () => {
        throw new Error('guard exploded');
      });
      const warn = jest.spyOn(strapi.log, 'warn');
      try {
        const client = asClient('203.0.113.96');
        const results = await statuses(6, () => postInbox(INBOX, client));
        expect(results).toEqual(Array(6).fill(401));
        const warnings = warn.mock.calls.filter(([message]) =>
          String(message).includes('[fediverse] request guard failed')
        );
        expect(warnings).toHaveLength(1);
      } finally {
        warn.mockRestore();
        strapi.config.set('plugin::fediverse.requestGuard', real);
      }
    });

    it('lets federation through when a guard answers false or is missing', async () => {
      const real = strapi.config.get('plugin::fediverse.requestGuard');
      try {
        strapi.config.set('plugin::fediverse.requestGuard', undefined);
        const client = asClient('203.0.113.97');
        expect(await statuses(6, () => postInbox(INBOX, client))).toEqual(Array(6).fill(401));
      } finally {
        strapi.config.set('plugin::fediverse.requestGuard', real);
      }
    });
  });
});
