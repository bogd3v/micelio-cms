import { describe, it, expect, jest } from '@jest/globals';
import requestLogger from '../src/middlewares/request-logger';
import { buildRequestLogMeta, requestActor, requestActorKind } from '../src/utils/request-context';

describe('requestActor', () => {
  it.each([
    [{ user: { id: 7, email: 'a@example.com' } }, 7],
    [{ user: { id: '7' } }, undefined],
    [{ user: { id: 0 } }, undefined],
    [{ user: null }, undefined],
    [{}, undefined],
    [undefined, undefined],
  ])('reads %j as %j', (state, expected) => {
    expect(requestActor(state)).toBe(expected);
  });
});

describe('requestActorKind', () => {
  it.each([
    ['admin', 'admin'],
    ['admin-token', 'admin'],
    ['users-permissions', 'user'],
    ['content-api-token', undefined],
    ['constructor', undefined],
  ])('maps strategy %s to %s', (name, expected) => {
    expect(requestActorKind({ auth: { strategy: { name } } })).toBe(expected);
  });
});

describe('buildRequestLogMeta', () => {
  const secret = Buffer.from('test-secret');

  it('hashes the address and carries the actor', () => {
    const meta = buildRequestLogMeta('id-1', '203.0.113.9', { user: { id: 3 } }, secret);
    expect(meta).toEqual({
      requestId: 'id-1',
      client: expect.stringMatching(/^[0-9a-f]{16}$/),
      actor: 3,
    });
    expect(JSON.stringify(meta)).not.toContain('203.0.113.9');
  });

  it('leaves the client out without a key or an address', () => {
    expect(buildRequestLogMeta('id-1', '203.0.113.9', {}, undefined)).toEqual({
      requestId: 'id-1',
    });
    expect(buildRequestLogMeta('id-1', undefined, {}, secret)).toEqual({ requestId: 'id-1' });
  });

  it('reports the actor kind only with an actor', () => {
    const auth = { strategy: { name: 'admin' } };
    expect(buildRequestLogMeta('id', undefined, { auth }, undefined)).toEqual({ requestId: 'id' });
    expect(buildRequestLogMeta('id', undefined, { auth, user: { id: 2 } }, undefined)).toEqual({
      requestId: 'id',
      actor: 2,
      actorKind: 'admin',
    });
  });
});

describe('request-logger middleware', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const fakeStrapi = (keys: unknown) => ({
    log: { http: jest.fn(), warn: jest.fn() },
    config: { get: () => keys },
  });
  const fakeContext = () =>
    ({
      method: 'GET',
      path: '/x',
      status: 404,
      state: {} as Record<string, unknown>,
      request: { ip: '203.0.113.9' },
    }) as never;
  const build = (host: ReturnType<typeof fakeStrapi>) =>
    requestLogger({}, { strapi: host as never });

  it('writes the line and rethrows when a downstream middleware throws', async () => {
    const host = fakeStrapi(['key-one']);
    await expect(build(host)(fakeContext(), () => Promise.reject(new Error('x')))).rejects.toThrow(
      'x'
    );
    expect(host.log.http).toHaveBeenCalledTimes(1);
    const [message, meta] = host.log.http.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toMatch(/^GET \/x \(\d+ ms\) 500$/);
    expect(meta.requestId).toMatch(UUID);
    expect(meta.client).toMatch(/^[0-9a-f]{16}$/);
  });

  it('logs the status an error carries, not the one on the context', async () => {
    const host = fakeStrapi(['key-one']);
    const error = Object.assign(new Error('nope'), { status: 403 });
    await expect(build(host)(fakeContext(), () => Promise.reject(error))).rejects.toThrow('nope');
    expect(String(host.log.http.mock.calls[0]?.[0])).toMatch(/ 403$/);
  });

  it('puts the request id on ctx.state', async () => {
    const host = fakeStrapi(['key-one']);
    const ctx = fakeContext();
    await build(host)(ctx, async () => {});
    const meta = host.log.http.mock.calls[0]?.[1] as Record<string, unknown>;
    expect((ctx as { state: { requestId: string } }).state.requestId).toBe(meta.requestId);
  });

  it('writes the line without a client and warns once when APP_KEYS is unusable', async () => {
    const host = fakeStrapi([]);
    await build(host)(fakeContext(), async () => {});
    await build(host)(fakeContext(), async () => {});
    expect(host.log.http).toHaveBeenCalledTimes(2);
    expect(host.log.http.mock.calls[0]?.[1]).not.toHaveProperty('client');
    expect(host.log.warn).toHaveBeenCalledTimes(1);
  });
});
