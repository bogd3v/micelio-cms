import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { setupStrapi, cleanupStrapi } from './strapi';
import { assertShape, routeById as route, unexercisedCallers } from './helpers/response-fields';
import { http } from './helpers/response-fields-callers';
import {
  BUILD_KEY,
  FRONTEND_KEY,
  SEEDED,
  seedContent,
  signIn,
  type SeededContent,
} from './helpers/response-fields-seed';
import { RESPONSE_ROUTES } from '../src/constants/response-fields';

// ASVS V15.3.1 for the comments plugin, the signed-in user and the newsletter
// subscribers (see the other response-fields suites for the rest).

const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';
const REPORT_UID = 'plugin::comments.comment-report';
const GUEST_EMAIL = 'guest@example.test';
const MEMBER_EMAIL = 'member@example.test';
const REPLIER_EMAIL = 'replier@example.test';
const POSTER_EMAIL = 'poster@example.test';
const PENDING_TEXT = 'A pending comment';
/** Attributes of a user that no response may carry. */
const PRIVATE_USER_KEYS = [
  'password',
  'confirmationToken',
  'resetPasswordToken',
  'resetPasswordIssuedAt',
  'passwordChangedAt',
];
const PUBLIC_ACTIONS = ['findAllFlat', 'findAllInHierarchy'];

/** Fails when a response names an attribute of a user that is private. */
function expectNoPrivateUserKey(body: unknown): void {
  const text = JSON.stringify(body);
  for (const key of PRIVATE_USER_KEYS) expect(text).not.toContain(`"${key}"`);
}

describe('Response fields of comments, the signed-in user and subscribers (ASVS V15.3.1)', () => {
  const saved = { ...process.env };
  const frontend = { Authorization: `Bearer ${FRONTEND_KEY}` };
  let seeded: SeededContent;
  let relation: string;
  let parentId: string | number;
  let readerJwt: string;
  let editorJwt: string;

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY;
    process.env.BUILD_API_TOKEN = BUILD_KEY;
    await setupStrapi();
    // Registering sends a confirmation email: keep it away from SMTP.
    strapi.plugin('email').service('email').send = async () => ({});
    seeded = await seedContent();
    relation = `${ARTICLE_UID}:${seeded.articleDocumentId}`;

    const publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });
    for (const action of PUBLIC_ACTIONS) {
      await strapi.query('plugin::users-permissions.permission').create({
        data: { action: `plugin::comments.client.${action}`, role: publicRole.id },
      });
    }
    await strapi.service('plugin::users-permissions.users-permissions').initialize();

    const reader = await signIn('reader', 'authenticated');
    readerJwt = reader.jwt;
    editorJwt = (await signIn('editor', 'editor')).jwt;
    const member = await signIn('member', 'authenticated');

    const comments = strapi.documents(COMMENT_UID);
    const parent = await comments.create({
      data: {
        content: 'A guest comment',
        related: relation,
        locale: 'en',
        approvalStatus: 'APPROVED',
        authorId: 'guest-1',
        authorName: 'Guest',
        authorEmail: GUEST_EMAIL,
        authorAvatar: 'https://example.test/guest.png',
        isAdminComment: true,
        blockReason: 'A reason',
      },
    });
    parentId = parent.id;
    await comments.create({
      data: {
        content: 'A reply from a member',
        related: relation,
        approvalStatus: 'APPROVED',
        authorUser: member.id,
        threadOf: parent.id,
      },
    });
    await comments.create({
      data: {
        content: 'A reply from the fediverse',
        related: relation,
        approvalStatus: 'APPROVED',
        authorId: 'https://remote.example/users/ana',
        authorName: 'Ana',
        authorEmail: REPLIER_EMAIL,
        fediverseActorHandle: '@ana@remote.example',
        fediverseUri: 'https://remote.example/users/ana/notes/1',
        threadOf: parent.id,
      },
    });
    const pending = await comments.create({
      data: {
        content: PENDING_TEXT,
        related: relation,
        approvalStatus: 'PENDING',
        authorId: 'guest-2',
        authorName: 'Pending',
      },
    });
    await comments.create({
      data: {
        content: 'An answer to a pending comment',
        related: relation,
        approvalStatus: 'APPROVED',
        authorId: 'guest-3',
        authorName: 'Answerer',
        threadOf: pending.id,
      },
    });
    await strapi.db.query(REPORT_UID).create({
      data: { content: 'A report', reason: 'OTHER', resolved: false, related: parent.id },
    });
  });

  afterAll(async () => {
    await cleanupStrapi();
    process.env = { ...saved };
  });

  describe.each([
    ['public', () => ({}) as Record<string, string>],
    ['frontend', () => frontend],
  ] as const)('comments as the %s caller', (caller, headers) => {
    it('comments.flat returns only listed fields and every required one', async () => {
      const res = await http().get(`/api/comments/${relation}/flat`).set(headers());
      expect(res.status).toBe(200);
      assertShape(route('comments.flat'), caller, [res.body]);
    });

    it('comments.tree returns only listed fields and every required one', async () => {
      const res = await http().get(`/api/comments/${relation}`).set(headers());
      expect(res.status).toBe(200);
      assertShape(route('comments.tree'), caller, [res.body]);
    });

    it('no comment carries an email, a report or the text of a pending comment', async () => {
      for (const path of [`/api/comments/${relation}/flat`, `/api/comments/${relation}`]) {
        const res = await http().get(path).set(headers());
        const body = JSON.stringify(res.body);
        for (const email of [GUEST_EMAIL, MEMBER_EMAIL, REPLIER_EMAIL]) {
          expect(body).not.toContain(email);
        }
        expect(body).not.toContain('A report');
        expect(body).not.toContain(PENDING_TEXT);
      }
    });
  });

  it('threadOf is { id } or null on the flat list, for both callers', async () => {
    for (const headers of [{}, frontend] as Record<string, string>[]) {
      const res = await http().get(`/api/comments/${relation}/flat`).set(headers);
      const replies = (res.body.data as { threadOf?: unknown }[]).filter((c) => c.threadOf);
      expect(replies.length).toBeGreaterThanOrEqual(2);
      for (const reply of replies) expect(Object.keys(reply.threadOf as object)).toEqual(['id']);
      const answers = (res.body.data as { content: string; threadOf?: unknown }[]).filter((c) =>
        c.content.startsWith('An answer to a pending')
      );
      for (const answer of answers) expect(answer.threadOf).toBeNull();
    }
  });

  it('comments.post returns only listed fields and every required one', async () => {
    const res = await http()
      .post(`/api/comments/${relation}`)
      .set(frontend)
      .send({
        author: { id: 'guest-9', name: 'Poster', email: POSTER_EMAIL },
        content: 'A new comment',
        threadOf: parentId,
        locale: 'en',
      });
    expect(res.status).toBe(200);
    assertShape(route('comments.post'), 'frontend', [res.body]);
    expect(res.body.threadOf).toEqual({ id: parentId });
    expect(JSON.stringify(res.body)).not.toContain(POSTER_EMAIL);
  });

  it('comments are refused to the build token', async () => {
    const res = await http()
      .get(`/api/comments/${relation}/flat`)
      .set('Authorization', `Bearer ${BUILD_KEY}`);
    expect(res.status).toBe(403);
  });

  describe('GET /api/users/me', () => {
    it.each([
      ['user', () => readerJwt],
      ['editor', () => editorJwt],
    ] as const)('users.me returns only listed fields to the %s caller', async (caller, jwt) => {
      const res = await http()
        .get('/api/users/me?populate=role')
        .set('Authorization', `Bearer ${jwt()}`);
      expect(res.status).toBe(200);
      assertShape(route('users.me'), caller, [res.body]);
      expectNoPrivateUserKey(res.body);
    });

    it('refuses a request without a JWT and the frontend token', async () => {
      expect((await http().get('/api/users/me')).status).toBe(403);
      expect((await http().get('/api/users/me').set(frontend)).status).toBe(403);
    });
  });

  describe('signing up and in', () => {
    const credentials = {
      username: 'newcomer',
      email: 'newcomer@example.test',
      password: 'Sup3r-secret-xyz1',
    };

    it('auth.register and auth.login return only listed fields', async () => {
      const registered = await http().post('/api/auth/local/register').send(credentials);
      expect(registered.status).toBe(200);
      assertShape(route('auth.register'), 'public', [registered.body]);

      await strapi
        .query('plugin::users-permissions.user')
        .update({ where: { username: credentials.username }, data: { confirmed: true } });
      const loggedIn = await http()
        .post('/api/auth/local')
        .send({ identifier: credentials.username, password: credentials.password });
      expect(loggedIn.status).toBe(200);
      assertShape(route('auth.login'), 'public', [loggedIn.body]);
      for (const body of [registered.body, loggedIn.body]) {
        expect(JSON.stringify(body)).not.toContain(credentials.password);
        expectNoPrivateUserKey(body);
      }
    });
  });

  describe('subscribers', () => {
    it('subscribers.find, create and update return only listed fields', async () => {
      const found = await http()
        .get('/api/subscribers')
        .query({ filters: { email: { $eq: SEEDED.subscriberEmail } }, pagination: { pageSize: 1 } })
        .set(frontend);
      expect(found.status).toBe(200);
      expect(found.body.data).toHaveLength(1);
      assertShape(route('subscribers.find'), 'frontend', [found.body]);

      const created = await http()
        .post('/api/subscribers')
        .set(frontend)
        .send({
          data: {
            email: 'new-subscriber@example.test',
            language: 'en',
            confirmed: false,
            confirmationToken: 'c'.repeat(64),
          },
        });
      expect(created.status).toBe(201);
      assertShape(route('subscribers.create'), 'frontend', [created.body]);

      const updated = await http()
        .put(`/api/subscribers/${created.body.data.documentId}`)
        .set(frontend)
        .send({ data: { confirmed: true } });
      expect(updated.status).toBe(200);
      assertShape(route('subscribers.update'), 'frontend', [updated.body]);

      const deleted = await http()
        .delete(`/api/subscribers/${created.body.data.documentId}`)
        .set(frontend);
      expect(deleted.status).toBe(204);
      expect(deleted.text).toBe('');
    });

    it('refuses the public role, a signed-in reader, an editor and the build token', async () => {
      expect((await http().get('/api/subscribers')).status).toBe(403);
      for (const key of [readerJwt, editorJwt, BUILD_KEY]) {
        const res = await http().get('/api/subscribers').set('Authorization', `Bearer ${key}`);
        expect(res.status).toBe(403);
      }
    });
  });

  it('read every route as every caller that may', () => {
    const ids = RESPONSE_ROUTES.map((candidate) => candidate.id).filter((id) =>
      ['comments.', 'auth.', 'users.', 'subscribers.'].some((prefix) => id.startsWith(prefix))
    );
    expect(unexercisedCallers(ids)).toEqual([]);
  });
});
