import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { getRole } from './helpers/permissions';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';

const PASSWORD = 'Sup3r-secret';
const COMMENT_PATH = '/api/comments/api::article.article:rate-limit-target';

interface SentEmail {
  to: string;
}

describe('Rate limiting (application level)', () => {
  const sent: SentEmail[] = [];
  let userJwt: string;

  const http = () => request(strapi.server.httpServer);
  /** Sends `count` requests one after the other and returns their statuses. */
  const statuses = async (count: number, send: (i: number) => Promise<{ status: number }>) => {
    const result: number[] = [];
    for (let i = 0; i < count; i++) result.push((await send(i)).status);
    return result;
  };
  const postComment = (headers: Record<string, string>) =>
    http().post(COMMENT_PATH).set(headers).send({ content: 'hi' });

  beforeAll(async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_COMMENTS: '3/600',
      RATE_LIMIT_AUTH: '5/60',
      RATE_LIMIT_AUTH_EMAIL: '2/3600',
      RATE_LIMIT_ADMIN_AUTH: '3/300',
      RATE_LIMIT_AUTH_IDENTIFIER: '3/900',
      RATE_LIMIT_UPLOAD: '3/600',
      RATE_LIMIT_API: '8/60',
    });
    process.env.FRONTEND_URL = 'https://rate-limit.test';
    await setupStrapi();

    strapi.plugin('email').service('email').send = async (options: SentEmail) => {
      sent.push(options);
    };

    const role = await getRole('authenticated');
    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'reader',
      email: 'reader@example.com',
      password: PASSWORD,
      provider: 'local',
      confirmed: true,
      role: role.id,
    });
    userJwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
    delete process.env.FRONTEND_URL;
  });

  it('is on, and replaces the users-permissions limiter', () => {
    expect(strapi.config.get('rate-limit.enabled')).toBe(true);
    expect(strapi.config.get('plugin::users-permissions.ratelimit.enabled')).toBe(false);
  });

  describe('comments', () => {
    const client = asClient('203.0.113.10');

    it('answers 429 with the standard body and rate limit headers past the limit', async () => {
      const first = await postComment(client);
      expect(first.status).not.toBe(429);
      expect(first.headers['ratelimit-limit']).toBe('3');
      expect(first.headers['ratelimit-remaining']).toBe('2');
      expect(first.headers['ratelimit-policy']).toBe('3;w=600');
      expect(Number(first.headers['ratelimit-reset'])).toBeGreaterThan(0);

      expect(await statuses(2, () => postComment(client))).not.toContain(429);

      const blocked = await postComment(client);
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({
        data: null,
        error: {
          status: 429,
          name: 'RateLimitError',
          message: 'Too many requests, please try again later.',
          details: {},
        },
      });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(600);
      expect(blocked.headers['ratelimit-limit']).toBe('3');
      expect(blocked.headers['ratelimit-remaining']).toBe('0');
    });

    it('lets a different client through', async () => {
      expect((await postComment(asClient('203.0.113.11'))).status).not.toBe(429);
    });

    it('does not open new buckets for a spoofed leftmost X-Forwarded-For', async () => {
      const results = await statuses(5, (i) =>
        postComment({ 'X-Forwarded-For': `10.9.9.${i}, 198.51.100.7` })
      );
      expect(results.slice(0, 3)).not.toContain(429);
      expect(results.slice(3)).toEqual([429, 429]);
    });

    it('groups IPv6 clients by their /64', async () => {
      const results = await statuses(4, (i) => postComment(asClient(`2001:db8:aa:bb:${i}::1`)));
      expect(results.slice(0, 3)).not.toContain(429);
      expect(results[3]).toBe(429);
    });

    it('limits write verbs only: GET is not in the comments group', async () => {
      const client = asClient('203.0.113.12');
      for (let i = 0; i < 3; i++) await postComment(client);
      const get = await http().get(COMMENT_PATH).set(client);
      expect(get.status).not.toBe(429);
    });

    it('matches case and trailing slash variants of the path', async () => {
      const client = asClient('203.0.113.13');
      await postComment(client);
      await postComment(client);
      await http().post(`${COMMENT_PATH}/`).set(client).send({});
      const blocked = await http().post('/API/Comments/x').set(client).send({});
      expect(blocked.status).toBe(429);
    });
  });

  describe('exempt routes', () => {
    it('never limits /_health or /uploads', async () => {
      const client = asClient('203.0.113.20');
      expect(await statuses(25, () => http().get('/_health').set(client))).toEqual(
        Array(25).fill(204)
      );
      const uploads = await statuses(25, () => http().get('/uploads/missing.png').set(client));
      expect(uploads).not.toContain(429);
      // Exempt requests do not eat the client's api budget either.
      expect((await http().get('/api/articles').set(client)).status).not.toBe(429);
    });

    it('does not limit the rest of /admin', async () => {
      const client = asClient('203.0.113.21');
      const results = await statuses(15, () => http().get('/admin/init').set(client));
      expect(results).not.toContain(429);
    });
  });

  describe('api group', () => {
    it('limits ordinary reads per client', async () => {
      const client = asClient('203.0.113.30');
      const results = await statuses(10, () => http().get('/api/articles').set(client));
      expect(results.slice(0, 8)).not.toContain(429);
      expect(results.slice(8)).toEqual([429, 429]);
      expect((await http().get('/api/articles').set(asClient('203.0.113.31'))).status).not.toBe(
        429
      );
    });
  });

  describe('auth group', () => {
    it('keeps limiting /api/auth/local when the email in the body varies', async () => {
      const client = asClient('203.0.113.40');
      const results = await statuses(7, (i) =>
        http()
          .post('/api/auth/local')
          .set(client)
          .send({ identifier: `nobody${i}@example.com`, password: 'wrong-password' })
      );
      expect(results.slice(0, 5)).not.toContain(429);
      expect(results.slice(5)).toEqual([429, 429]);
    });

    it('limits per path, case and trailing slash included', async () => {
      const client = asClient('203.0.113.41');
      await statuses(4, () => http().post('/api/auth/local').set(client).send({}));
      // A different auth path has its own bucket for the same client.
      expect((await http().post('/api/auth/reset-password').set(client).send({})).status).not.toBe(
        429
      );
      await http().post('/API/AUTH/LOCAL/').set(client).send({});
      expect((await http().post('/api/AUTH/local').set(client).send({})).status).toBe(429);
    });

    it('limits DELETE /api/users/me with the plugin limiter off', async () => {
      const client = { ...asClient('203.0.113.42'), Authorization: `Bearer ${userJwt}` };
      const results = await statuses(7, () =>
        http().delete('/api/users/me').set(client).send({ password: 'wrong-password' })
      );
      // Wrong password: the route itself answers 4xx until the limiter steps in.
      expect(results.slice(0, 5).every((status) => status >= 400 && status !== 429)).toBe(true);
      expect(results.slice(5)).toEqual([429, 429]);
    });

    it('limits /api/connect/* too', async () => {
      const client = asClient('203.0.113.43');
      const results = await statuses(7, () => http().get('/api/connect/github').set(client));
      expect(results.slice(5)).toEqual([429, 429]);
    });
  });

  describe('auth-email group', () => {
    it('answers forgot-password normally on overflow, without sending', async () => {
      sent.length = 0;
      const forgot = (i: number, email = 'reader@example.com') =>
        http()
          .post('/api/auth/forgot-password')
          .set(asClient(`203.0.113.${100 + i}`))
          .send({ email });

      const first = await forgot(0);
      const second = await forgot(1, 'READER@example.com');
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(first.body).toEqual({ ok: true });
      expect(sent.map((mail) => mail.to)).toEqual(['reader@example.com', 'reader@example.com']);

      const overflow = await forgot(2, ' Reader@Example.com');
      expect(overflow.status).toBe(200);
      expect(overflow.body).toEqual({ ok: true });
      expect(sent).toHaveLength(2);
    });

    it('answers send-email-confirmation normally on overflow, without sending', async () => {
      sent.length = 0;
      const confirm = (i: number) =>
        http()
          .post('/api/auth/send-email-confirmation')
          .set(asClient(`203.0.113.${110 + i}`))
          .send({ email: 'pending@example.com' });

      await strapi
        .plugin('users-permissions')
        .service('user')
        .add({
          username: 'pending',
          email: 'pending@example.com',
          password: PASSWORD,
          provider: 'local',
          confirmed: false,
          role: (await getRole('authenticated')).id,
        });
      expect((await confirm(0)).status).toBe(200);
      expect((await confirm(1)).status).toBe(200);
      const sentBefore = sent.length;
      const overflow = await confirm(2);
      expect(overflow.status).toBe(200);
      expect(overflow.body).toEqual({ email: 'pending@example.com', sent: true });
      expect(sent).toHaveLength(sentBefore);
    });

    it('does not mix up addresses: another email still sends', async () => {
      sent.length = 0;
      await strapi
        .plugin('users-permissions')
        .service('user')
        .add({
          username: 'someone-else',
          email: 'someone-else@example.com',
          password: PASSWORD,
          provider: 'local',
          confirmed: true,
          role: (await getRole('authenticated')).id,
        });
      const res = await http()
        .post('/api/auth/forgot-password')
        .set(asClient('203.0.113.120'))
        .send({ email: 'someone-else@example.com' });
      expect(res.status).toBe(200);
      expect(sent.map((mail) => mail.to)).toContain('someone-else@example.com');
    });

    it('treats a non-string email as one bucket per client, not one per value', async () => {
      const client = asClient('203.0.113.121');
      const results = await statuses(4, (i) =>
        http()
          .post('/api/auth/forgot-password')
          .set(client)
          .send({ email: i % 2 ? { a: i } : i })
      );
      // Overflow answers 200 {ok:true}; before it the route validates the input.
      expect(results.slice(2)).toEqual([200, 200]);
    });

    it('answers register overflow with 429', async () => {
      const register = (i: number) =>
        http()
          .post('/api/auth/local/register')
          .set(asClient(`203.0.113.${130 + i}`))
          .send({ username: `newbie${i}`, email: 'newbie@example.com', password: PASSWORD });

      expect((await register(0)).status).toBe(200);
      expect((await register(1)).status).toBeGreaterThanOrEqual(400);
      const blocked = await register(2);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.name).toBe('RateLimitError');
    });
  });

  describe('auth-identifier group', () => {
    const login = (ip: string, identifier: unknown) =>
      http()
        .post('/api/auth/local')
        .set(asClient(ip))
        .send({ identifier, password: 'wrong-password' });

    it('limits one account across many clients; case and spaces share the bucket', async () => {
      const results = await statuses(5, (i) =>
        login(
          `203.0.113.${140 + i}`,
          [
            'Victim@Example.com',
            ' victim@example.com',
            'VICTIM@example.com ',
            'victim@example.com',
            'victim@example.com',
          ][i]
        )
      );
      expect(results.slice(0, 3)).not.toContain(429);
      expect(results.slice(3)).toEqual([429, 429]);
      // Another account from a fresh client is unaffected.
      expect((await login('203.0.113.150', 'other@example.com')).status).not.toBe(429);
    });

    it('puts non-string identifiers in one bucket per client', async () => {
      const results = await statuses(4, (i) => login('203.0.113.151', i % 2 ? { a: i } : i));
      expect(results.slice(0, 3)).not.toContain(429);
      expect(results[3]).toBe(429);
      expect((await login('203.0.113.152', 7)).status).not.toBe(429);
    });
  });

  describe('auth path families', () => {
    it('does not open new buckets for varying /api/connect/<x>', async () => {
      const client = asClient('203.0.113.160');
      const results = await statuses(7, (i) => http().get(`/api/connect/p${i}`).set(client));
      expect(results.slice(5)).toEqual([429, 429]);
    });

    it('does not open new buckets for varying /api/auth/<provider>/callback', async () => {
      const client = asClient('203.0.113.161');
      const results = await statuses(7, (i) => http().get(`/api/auth/p${i}/callback`).set(client));
      expect(results.slice(5)).toEqual([429, 429]);
    });

    it('does not open new buckets for unknown /api/auth/<random>', async () => {
      const client = asClient('203.0.113.162');
      const results = await statuses(7, (i) =>
        http().post(`/api/auth/rnd${i}`).set(client).send({})
      );
      expect(results.slice(5)).toEqual([429, 429]);
    });
  });

  describe('admin API prefixes', () => {
    it('are exempt, unlike /api/upload and /api/comments', async () => {
      const client = asClient('203.0.113.170');
      for (const path of [
        '/content-manager/init',
        '/upload/files',
        '/i18n/locales',
        '/comments/x',
      ]) {
        const results = await statuses(12, () => http().get(path).set(client));
        expect(results).not.toContain(429);
      }
      // They did not use up the client's api budget (8 a minute) either.
      expect((await http().get('/api/articles').set(client)).status).not.toBe(429);

      const upload = await statuses(5, () => http().post('/api/upload').set(client).send({}));
      expect(upload.slice(3)).toEqual([429, 429]);
      const comments = await statuses(5, () => postComment(client));
      expect(comments.slice(3)).toEqual([429, 429]);
    });
  });

  describe('/admin/login', () => {
    it('is limited by client IP, spoofed leftmost entries included', async () => {
      const login = (i: number) =>
        http()
          .post('/admin/login')
          .set({ 'X-Forwarded-For': `10.8.8.${i}, 203.0.113.50` })
          .send({ email: `admin${i}@example.com`, password: 'wrong-password' });
      const results = await statuses(5, login);
      expect(results.slice(0, 3)).not.toContain(429);
      expect(results.slice(3)).toEqual([429, 429]);
      const other = await http()
        .post('/admin/login')
        .set(asClient('203.0.113.51'))
        .send({ email: 'a@example.com', password: 'wrong-password' });
      expect(other.status).not.toBe(429);
    });
  });

  describe('/admin/register', () => {
    it('is in the admin-auth group', async () => {
      const client = asClient('203.0.113.180');
      const results = await statuses(5, () =>
        http().post('/admin/register').set(client).send({ registrationToken: 'x' })
      );
      expect(results.slice(0, 3)).not.toContain(429);
      expect(results.slice(3)).toEqual([429, 429]);
    });
  });
});
