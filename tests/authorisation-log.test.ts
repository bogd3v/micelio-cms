import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import { logAccessRefusal, isRefusalLogged } from '../src/utils/access-log';
import { SECURITY_EVENTS } from '../src/constants/security-events';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setRolePermissions } from './helpers/permissions';

// Issue #180, ASVS V16.3.2: a refused authorisation is logged as a security
// event, without the query string, email, token or raw address, and the
// response is the one it always was.

type Line = { message: string; meta: Record<string, unknown> };

describe('Authorisation refusals are logged', () => {
  let warn: ReturnType<typeof jest.spyOn>;
  let lines: Line[];
  let readerJwt = '';
  let readerId = 0;

  const http = () => request(strapi.server.httpServer);
  const security = () => lines.filter((line) => line.message.startsWith('security: '));

  beforeAll(async () => {
    await setupStrapi();
    await setRolePermissions('public', 'article', ['find', 'findOne']);
    const role = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });
    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'reader',
      email: 'reader@example.com',
      password: 'Password123!',
      provider: 'local',
      confirmed: true,
      role: role.id,
    });
    readerId = user.id;
    readerJwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
    warn = jest.spyOn(strapi.log, 'warn').mockImplementation(((
      message: string,
      meta?: Record<string, unknown>
    ) => {
      lines.push({ message: String(message), meta: meta ?? {} });
    }) as typeof strapi.log.warn);
  });

  beforeEach(() => {
    lines = [];
  });

  afterAll(async () => {
    warn.mockRestore();
    await cleanupStrapi();
  });

  function expectClean(line: Line, forbidden: string[]): void {
    const text = JSON.stringify(line);
    for (const value of forbidden) expect(text).not.toContain(value);
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
    expect(line.meta.client).toMatch(/^[0-9a-f]{16}$/);
  }

  it('writes access.draft.refused for a draft request, with no query string', async () => {
    const res = await http().get('/api/articles?status=draft&email=secret@example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.name).toBe('ForbiddenError');

    expect(security()).toHaveLength(1);
    const [line] = security();
    expect(line.message).toBe('security: access.draft.refused');
    expect(line.meta).toMatchObject({
      event: 'access.draft.refused',
      outcome: 'failure',
      path: '/api/articles',
      reason: 'draft-requested',
    });
    expect(line.meta.actor).toBeUndefined();
    expectClean(line, ['secret@example.com', 'status=draft', '?']);
  });

  it('names the actor by numeric id when a user is signed in', async () => {
    const res = await http()
      .get('/api/articles?status=draft')
      .set('Authorization', `Bearer ${readerJwt}`);
    expect(res.status).toBe(403);
    expect(security()).toHaveLength(1);
    expect(security()[0].meta.actor).toBe(String(readerId));
    expectClean(security()[0], ['reader@example.com', readerJwt]);
  });

  it('writes access.editor.refused when the is-editor policy refuses, once', async () => {
    // Without the `drafts` permission Strapi answers 403 before the policy runs
    // (access.forbidden); with it, only the policy stands between a reader and drafts.
    const before = await http()
      .get('/api/articles/drafts')
      .set('Authorization', `Bearer ${readerJwt}`);
    expect(before.status).toBe(403);
    expect(security().map((line) => line.message)).toEqual(['security: access.forbidden']);

    await setRolePermissions('authenticated', 'article', ['drafts']);
    lines = [];
    const res = await http()
      .get('/api/articles/drafts?token=abc')
      .set('Authorization', `Bearer ${readerJwt}`);
    expect(res.status).toBe(403);
    expect(res.body.error.name).toBe('PolicyError');

    expect(security()).toHaveLength(1);
    const [line] = security();
    expect(line.message).toBe('security: access.editor.refused');
    expect(line.meta).toMatchObject({
      path: '/api/articles/drafts',
      reason: 'not-editor',
      actor: String(readerId),
    });
    expectClean(line, ['token=abc', 'reader@example.com', readerJwt]);
  });

  it('writes access.forbidden for a plain 403 on the content API', async () => {
    const res = await http().get('/api/users?populate=role');
    expect(res.status).toBe(403);
    expect(security()).toHaveLength(1);
    expect(security()[0].message).toBe('security: access.forbidden');
    expect(security()[0].meta).toMatchObject({ path: '/api/users' });
    expect(security()[0].meta).not.toHaveProperty('reason');
    expectClean(security()[0], ['populate']);
  });

  it('writes nothing for a request that is allowed', async () => {
    const res = await http().get('/api/articles');
    expect(res.status).toBe(200);
    expect(security()).toHaveLength(0);
  });

  it('writes access.editor.refused without an actor for an API token', async () => {
    const token = await strapi
      .service('admin::api-token')
      .create({ name: 'full', type: 'full-access', lifespan: null });
    const res = await http()
      .get('/api/articles/drafts')
      .set('Authorization', `Bearer ${token.accessKey}`);
    expect(res.status).toBe(403);
    expect(security()).toHaveLength(1);
    expect(security()[0].message).toBe('security: access.editor.refused');
    expect(security()[0].meta).toMatchObject({ reason: 'not-editor' });
    expect(security()[0].meta.actor).toBeUndefined();
    expectClean(security()[0], [token.accessKey]);
  });

  it('writes access.forbidden for a 403 on an admin route, once', async () => {
    const author = await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-author' } });
    await strapi.service('admin::user').create({
      email: 'author@example.com',
      firstname: 'Au',
      lastname: 'Thor',
      password: 'Password123!',
      isActive: true,
      roles: [author.id],
    });
    const login = await http()
      .post('/admin/login')
      .send({ email: 'author@example.com', password: 'Password123!' });
    expect(login.status).toBe(200);
    const jwt: string = login.body.data.token;
    lines = [];
    const res = await http().get('/admin/users?email=x').set('Authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(403);
    expect(security()).toHaveLength(1);
    expect(security()[0].message).toBe('security: access.forbidden');
    expect(security()[0].meta).toMatchObject({ path: '/admin/users' });
    expectClean(security()[0], ['author@example.com', jwt, 'email=x']);
  });

  it('keeps answering 403 when the logger throws', async () => {
    warn.mockImplementationOnce((() => {
      throw new Error('log sink down');
    }) as typeof strapi.log.warn);
    const res = await http().get('/api/articles?status=draft');
    expect(res.status).toBe(403);
    expect(res.body.error.name).toBe('ForbiddenError');
  });
});

describe('logAccessRefusal', () => {
  const context = () => ({
    state: {} as Record<string, unknown>,
    request: { ip: '203.0.113.7', path: '/x' },
  });
  const keys = <T>() => ['key'] as unknown as T;

  it('does not throw and leaves the marker unset when the logger throws', () => {
    const ctx = context();
    const host = {
      log: {
        info: () => undefined,
        warn: () => {
          throw new Error('down');
        },
      },
      config: { get: keys },
    };
    expect(() => logAccessRefusal(host, ctx, SECURITY_EVENTS.accessDraftRefused)).not.toThrow();
    expect(isRefusalLogged(ctx)).toBe(false);
  });

  it('writes the event without a client hash when there are no app keys', () => {
    const ctx = context();
    const metas: Record<string, unknown>[] = [];
    const host = {
      log: {
        info: () => undefined,
        warn: (_message: string, meta?: Record<string, unknown>) => void metas.push(meta ?? {}),
      },
      config: { get: <T>() => undefined as unknown as T },
    };
    expect(() =>
      logAccessRefusal(host, ctx, SECURITY_EVENTS.accessEditorRefused, 'not-editor')
    ).not.toThrow();
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ event: 'access.editor.refused', path: '/x' });
    expect(metas[0]).not.toHaveProperty('client');
    expect(isRefusalLogged(ctx)).toBe(true);
  });
});
