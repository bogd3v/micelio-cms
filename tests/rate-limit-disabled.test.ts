import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

const INBOX = '/fediverse/user/devbog/inbox';

describe('Rate limiting off (the default under NODE_ENV=test)', () => {
  const api = () => request(strapi.server.httpServer);

  beforeAll(async () => {
    // Limits set, but the switch is not: nothing may be enforced.
    setRateLimitEnv({
      RATE_LIMIT_COMMENTS: '1/600',
      RATE_LIMIT_API: '1/60',
      RATE_LIMIT_FEDIVERSE_INBOX: '1/60',
      FEDIVERSE_ENABLED: 'true',
      FEDIVERSE_ACTOR_IDENTIFIER: 'devbog',
      FEDIVERSE_ACTOR_USERNAME: 'bogdev',
    });
    await setupStrapi();

    // Runs after every Strapi middleware: shows the address the app works with.
    strapi.server.use(async (ctx, next) => {
      if (ctx.path !== '/probe-ip') return next();
      ctx.body = { ip: ctx.request.ip };
    });
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
  });

  it('is off by default under test and leaves the users-permissions limiter on', () => {
    expect(strapi.config.get('rate-limit.enabled')).toBe(false);
    expect(strapi.config.get('plugin::users-permissions.ratelimit.enabled')).not.toBe(false);
  });

  it('registers no fediverse guard', () => {
    expect(strapi.config.get('plugin::fediverse.requestGuard')).toBeUndefined();
  });

  it('federation works without a guard: no 429, no RateLimit headers', async () => {
    for (let i = 0; i < 6; i++) {
      const res = await api()
        .post(INBOX)
        .set('Content-Type', 'application/activity+json')
        .send(
          JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: 'https://mastodon.social/tests/rate-limit/1',
            type: 'Follow',
            actor: 'https://mastodon.social/users/test',
            object: 'https://example.test/fediverse/user/devbog',
          })
        );
      expect(res.status).toBe(401);
      expect(res.headers['ratelimit-limit']).toBeUndefined();
    }
    const actor = await api()
      .get('/fediverse/user/devbog')
      .set('Accept', 'application/activity+json');
    expect(actor.status).toBe(200);
  });

  it('enforces nothing on the REST routes either', async () => {
    const client = asClient('203.0.113.1');
    for (let i = 0; i < 6; i++) {
      const comment = await api().post('/api/comments/x').set(client).send({});
      const read = await api().get('/api/articles').set(client);
      expect(comment.status).not.toBe(429);
      expect(read.status).not.toBe(429);
      expect(read.headers['ratelimit-limit']).toBeUndefined();
    }
  });

  it('still resolves the client address from TRUST_PROXY (private by default)', async () => {
    const trusted = await api()
      .get('/probe-ip')
      .set({ 'X-Forwarded-For': '1.1.1.1, 203.0.113.9, 198.51.100.7' });
    // Rightmost untrusted entry, not Koa's leftmost.
    expect(trusted.body.ip).toBe('198.51.100.7');
    expect((await api().get('/probe-ip')).body.ip).toBe('127.0.0.1');
  });
});
