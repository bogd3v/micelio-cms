import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import type { Context } from 'koa';
import { setupStrapi, cleanupStrapi } from './strapi';
import { asClient, restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';
import { createForwarder } from '../src/utils/rate-limit/forwarder';

const SECRET = 'forwarder-secret-0123456789-abcdefghij';
const COMMENT_PATH = '/api/comments/api::article.article:rate-limit-target';

const forwarded = (ip: string, secret = SECRET) => ({
  'X-Micelio-Forwarder-Secret': secret,
  'X-Micelio-Client-IP': ip,
});

describe('Rate limiting: frontend forwarder', () => {
  const http = () => request(strapi.server.httpServer);
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
      RATE_LIMIT_FORWARDER_SECRET: SECRET,
      RATE_LIMIT_COMMENTS: '3/600',
      // Forwarded requests of one peer share a ceiling of 20 times this.
      RATE_LIMIT_API: '2/60',
    });
    await setupStrapi();

    // Runs after every Strapi middleware: shows what a route would see.
    strapi.server.use(async (ctx, next) => {
      if (ctx.path !== '/probe-headers') return next();
      ctx.body = { headers: ctx.req.headers };
    });
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
  });

  it('hides the forwarder headers from everything downstream', async () => {
    const res = await http()
      .get('/probe-headers')
      .set({ ...asClient('203.0.113.89'), ...forwarded('192.0.2.50') });
    expect(res.status).toBe(200);
    expect(res.body.headers).toBeDefined();
    expect(res.body.headers['x-micelio-forwarder-secret']).toBeUndefined();
    expect(res.body.headers['x-micelio-client-ip']).toBeUndefined();
    expect(res.body.headers['x-forwarded-for']).toBe('203.0.113.89');
  });

  it('counts forwarded requests by the forwarded client, not by the peer', async () => {
    const peer = asClient('203.0.113.80');
    const a = await statuses(4, () => postComment({ ...peer, ...forwarded('192.0.2.1') }));
    expect(a.slice(0, 3)).not.toContain(429);
    expect(a[3]).toBe(429);

    // Another forwarded client behind the same peer has its own bucket.
    expect((await postComment({ ...peer, ...forwarded('192.0.2.2') })).status).not.toBe(429);
    // The peer's own address was never charged.
    expect((await postComment(peer)).status).not.toBe(429);
  });

  it('groups forwarded IPv6 clients by /64 and accepts ports and ::ffff: forms', async () => {
    const peer = asClient('203.0.113.81');
    const results = await statuses(4, (i) =>
      postComment({
        ...peer,
        ...forwarded(i === 0 ? '[2001:db8:5:5::1]:80' : `2001:db8:5:5:${i}::2`),
      })
    );
    expect(results[3]).toBe(429);

    const v4 = await statuses(4, (i) =>
      postComment({ ...peer, ...forwarded(i % 2 ? '::ffff:192.0.2.9' : '192.0.2.9:8080') })
    );
    expect(v4[3]).toBe(429);
  });

  it('ignores a wrong secret: the claimed address is not used', async () => {
    const peer = asClient('203.0.113.82');
    const results = await statuses(5, (i) =>
      postComment({ ...peer, ...forwarded(`192.0.2.${100 + i}`, 'x'.repeat(40)) })
    );
    // All five count on the peer, whatever they claim.
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('ignores the client header when the secret is missing', async () => {
    const peer = asClient('203.0.113.83');
    const results = await statuses(5, (i) =>
      postComment({ ...peer, 'X-Micelio-Client-IP': `192.0.2.${110 + i}` })
    );
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('falls back to the peer when the forwarded address is invalid', async () => {
    const peer = asClient('203.0.113.84');
    const results = await statuses(5, (i) =>
      postComment({ ...peer, ...forwarded(['garbage', '999.1.1.1', '', 'a, b', 'x'][i]) })
    );
    expect(results.slice(0, 3)).not.toContain(429);
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('uses the peer when a valid secret comes without a client address', async () => {
    const peer = asClient('203.0.113.85');
    const results = await statuses(5, () =>
      postComment({ ...peer, 'X-Micelio-Forwarder-Secret': SECRET })
    );
    expect(results.slice(3)).toEqual([429, 429]);
  });

  it('caps the forged addresses one peer can name with a ceiling bucket', async () => {
    const peer = asClient('203.0.113.86');
    // api limit 2 x 20 = 40 forwarded requests a minute for the whole peer, though
    // every one names a fresh client with its whole api budget left.
    const results = await statuses(42, (i) =>
      http()
        .get('/api/articles')
        .set({ ...peer, ...forwarded(`192.0.2.${i + 1}`) })
    );
    expect(results.slice(0, 40)).not.toContain(429);
    expect(results.slice(40)).toEqual([429, 429]);
    // Requests that are not forwarded are not charged to the ceiling.
    expect((await http().get('/api/articles').set(asClient('203.0.113.87'))).status).not.toBe(429);
  });

  it('does not count exempt routes in the ceiling', async () => {
    const peer = asClient('203.0.113.88');
    const results = await statuses(60, (i) =>
      http()
        .get('/_health')
        .set({ ...peer, ...forwarded(`192.0.2.${i + 1}`) })
    );
    expect(results).toEqual(Array(60).fill(204));
  });
});

describe('Rate limiting: forwarder headers', () => {
  const fakeCtx = (headers: Record<string, string | string[]>) =>
    ({ req: { headers } }) as unknown as Context;
  const noWarn = () => undefined;

  it('removes both headers after reading them, whatever the outcome', () => {
    const forwarder = createForwarder(SECRET);
    for (const secret of [SECRET, 'wrong', undefined]) {
      const headers: Record<string, string | string[]> = {
        'x-micelio-client-ip': '192.0.2.5',
        authorization: 'Bearer t',
      };
      if (secret) headers['x-micelio-forwarder-secret'] = secret;
      forwarder.apply(fakeCtx(headers), '10.0.0.1', noWarn);
      expect(headers).toEqual({ authorization: 'Bearer t' });
    }
  });

  it('removes them even when no secret is configured, and never trusts them then', () => {
    const headers: Record<string, string | string[]> = {
      'x-micelio-client-ip': '192.0.2.5',
      'x-micelio-forwarder-secret': 'anything',
    };
    const result = createForwarder('').apply(fakeCtx(headers), '10.0.0.1', noWarn);
    expect(result).toEqual({ forwarded: false, clientSupplied: false, ip: '10.0.0.1' });
    expect(headers).toEqual({});
  });

  it('returns the normalised forwarded address for a valid secret', () => {
    const headers = {
      'x-micelio-forwarder-secret': SECRET,
      'x-micelio-client-ip': '::ffff:192.0.2.5',
    };
    expect(createForwarder(SECRET).apply(fakeCtx(headers), '10.0.0.1', noWarn)).toEqual({
      forwarded: true,
      clientSupplied: true,
      ip: '192.0.2.5',
    });
  });

  it('warns without the secret or the address in the message', () => {
    const messages: string[] = [];
    const warn = (_key: string, message: string) => messages.push(message);
    const forwarder = createForwarder(SECRET);
    forwarder.apply(
      fakeCtx({
        'x-micelio-forwarder-secret': 'wrong-secret-value',
        'x-micelio-client-ip': '1.2.3.4',
      }),
      '10.0.0.1',
      warn
    );
    forwarder.apply(
      fakeCtx({ 'x-micelio-forwarder-secret': SECRET, 'x-micelio-client-ip': 'not-an-ip' }),
      '10.0.0.1',
      warn
    );
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).not.toMatch(/wrong-secret-value|not-an-ip|1\.2\.3\.4/);
      expect(message).not.toContain(SECRET);
    }
  });

  it('takes the first value of a repeated header', () => {
    const headers = {
      'x-micelio-forwarder-secret': [SECRET, 'other'],
      'x-micelio-client-ip': ['192.0.2.6', '192.0.2.7'],
    };
    expect(createForwarder(SECRET).apply(fakeCtx(headers), '10.0.0.1', noWarn).ip).toBe(
      '192.0.2.6'
    );
  });

  it('takes no client and still removes the headers when the path may not use one', () => {
    const headers: Record<string, string | string[]> = {
      'x-micelio-forwarder-secret': SECRET,
      'x-micelio-client-ip': '192.0.2.5',
    };
    const result = createForwarder(SECRET).apply(fakeCtx(headers), '10.0.0.1', noWarn, false);
    expect(result).toEqual({ forwarded: false, clientSupplied: false, ip: '10.0.0.1' });
    expect(headers).toEqual({});
  });

  it('marks a forwarded request without a client as not client-supplied', () => {
    const headers = { 'x-micelio-forwarder-secret': SECRET };
    expect(createForwarder(SECRET).apply(fakeCtx(headers), '10.0.0.1', noWarn)).toEqual({
      forwarded: true,
      clientSupplied: false,
      ip: '10.0.0.1',
    });
  });
});
