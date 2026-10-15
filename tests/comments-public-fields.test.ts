import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { getPublicRole, getRole } from './helpers/permissions';
import type { ApiComment } from './helpers/api-types';
import { FRONTEND_TOKEN_PERMISSIONS } from '../src/migrations/api-tokens';

const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';
const REPORT_UID = 'plugin::comments.comment-report';
const TOKEN_UID = 'admin::api-token';
const GUEST_EMAIL = 'guest@example.test';
const USER_EMAIL = 'member@example.test';
const REPLIER_EMAIL = 'replier@example.test';
const REPORT_TEXT = 'report-text-marker';
const ACTIONS = ['findAll', 'findAllFlat', 'findAllInHierarchy'];

const FLAT = (relation: string) => `/api/comments/${relation}/flat`;
const TREE = (relation: string) => `/api/comments/${relation}`;

/** Every comment object in a body, at any depth (`data`, `children`, `threadOf`). */
function allComments(value: unknown, found: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) value.forEach((item) => allComments(item, found));
  else if (value != null && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (typeof node.id === 'number' && 'content' in node) found.push(node);
    for (const key of ['data', 'children', 'threadOf']) {
      if (key in node) allComments(node[key], found);
    }
  }
  return found;
}

describe('Public comments API: fields and filters', () => {
  let relation: string;
  let frontendKey: string;
  const http = () => request(strapi.server.httpServer);

  /** The two kinds of caller: the public role and a token with the frontend permissions. */
  const callers: [string, (path: string) => request.Test][] = [
    ['the public role', (path) => http().get(path)],
    [
      'the frontend token',
      (path) => http().get(path).set('Authorization', `Bearer ${frontendKey}`),
    ],
  ];

  beforeAll(async () => {
    await setupStrapi();
    const publicRole = await getPublicRole();
    for (const action of ACTIONS) {
      await strapi.query('plugin::users-permissions.permission').create({
        data: { action: `plugin::comments.client.${action}`, role: publicRole.id },
      });
    }
    await strapi.service('plugin::users-permissions.users-permissions').initialize();

    const token = await strapi.service(TOKEN_UID).create({
      name: 'frontend',
      type: 'custom',
      lifespan: null,
      permissions: FRONTEND_TOKEN_PERMISSIONS,
    });
    frontendKey = token.accessKey;

    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'Fields target', slug: 'fields-target' } });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    relation = `${ARTICLE_UID}:${draft.documentId}`;

    const role = await getRole('authenticated');
    const user = await strapi.plugin('users-permissions').service('user').add({
      username: 'member',
      email: USER_EMAIL,
      password: 'Sup3r-secret',
      provider: 'local',
      confirmed: true,
      role: role.id,
    });

    const guestParent = await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'guest parent',
        related: relation,
        approvalStatus: 'APPROVED',
        authorId: 'guest-1',
        authorName: 'Guest',
        authorEmail: GUEST_EMAIL,
      },
    });
    const userParent = await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'member parent',
        related: relation,
        approvalStatus: 'APPROVED',
        authorUser: user.id,
      },
    });
    for (const [content, parent] of [
      ['reply to guest', guestParent],
      ['reply to member', userParent],
    ] as const) {
      await strapi.documents(COMMENT_UID).create({
        data: {
          content,
          related: relation,
          approvalStatus: 'APPROVED',
          authorId: 'replier-1',
          authorName: 'Replier',
          authorEmail: REPLIER_EMAIL,
          threadOf: parent.id,
        },
      });
    }
    for (const status of ['PENDING', 'REJECTED'] as const) {
      const hidden = await strapi.documents(COMMENT_UID).create({
        data: {
          content: `${status.toLowerCase()} note`,
          related: relation,
          approvalStatus: status,
          authorId: `hidden-${status}`,
          authorName: `Hidden ${status}`,
        },
      });
      await strapi.documents(COMMENT_UID).create({
        data: {
          content: `answer to ${status.toLowerCase()}`,
          related: relation,
          approvalStatus: 'APPROVED',
          authorId: 'replier-2',
          authorName: 'Answerer',
          threadOf: hidden.id,
        },
      });
    }
    await strapi.db.query(REPORT_UID).create({
      data: {
        content: REPORT_TEXT,
        reason: 'OTHER',
        resolved: false,
        related: guestParent.id,
      },
    });
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  describe.each(callers)('as %s', (_caller, get) => {
    it.each([
      ['the flat list', FLAT],
      ['the hierarchy', TREE],
    ])('returns no author email or report in %s', async (_name, path) => {
      const res = await get(path(relation));
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      for (const secret of [GUEST_EMAIL, USER_EMAIL, REPLIER_EMAIL, REPORT_TEXT]) {
        expect(body).not.toContain(secret);
      }
      const comments = allComments(res.body);
      expect(comments.length).toBeGreaterThanOrEqual(4);
      for (const comment of comments) {
        expect(comment).not.toHaveProperty('reports');
        const author = comment.author as Record<string, unknown> | null | undefined;
        if (author) expect(author).not.toHaveProperty('email');
      }
    });

    it('still returns what the frontend reads', async () => {
      const res = await get(FLAT(relation));
      const replies = (res.body.data as ApiComment[]).filter((c) => c.content.startsWith('reply'));
      expect(replies).toHaveLength(2);
      for (const reply of replies) {
        expect(reply.author).toMatchObject({ name: 'Replier' });
        expect(reply).toHaveProperty('threadOf');
      }
    });

    it('does not bring reports or parent emails back through populate', async () => {
      for (const path of [FLAT(relation), TREE(relation)]) {
        const res = await get(
          `${path}?populate[reports]=true&populate[threadOf][populate][authorUser]=true`
        );
        expect(res.status).toBe(200);
        const body = JSON.stringify(res.body);
        for (const secret of [GUEST_EMAIL, USER_EMAIL, REPORT_TEXT]) {
          expect(body).not.toContain(secret);
        }
      }
    });

    it.each([
      ['authorEmail', 'filters[authorEmail][$eq]=' + GUEST_EMAIL],
      ['authorEmail with $contains', 'filters[authorEmail][$contains]=guest'],
      ['authorName', 'filters[authorName][$eq]=Guest'],
      ['authorId', 'filters[authorId][$eq]=guest-1'],
      ['authorUser', 'filters[authorUser][email][$eq]=' + USER_EMAIL],
      ['author', 'filters[author][email][$eq]=' + USER_EMAIL],
      ['a nested $and', 'filters[$and][0][authorEmail][$eq]=' + GUEST_EMAIL],
      [
        'a nested $or',
        'filters[$or][0][content][$eq]=x&filters[$or][1][authorEmail][$startsWith]=g',
      ],
      ['a deeper $and/$or', 'filters[$and][0][$or][0][authorEmail][$eq]=' + GUEST_EMAIL],
      ['populate with filters', 'populate[authorUser][filters][email][$eq]=' + USER_EMAIL],
      ['populate with where', 'populate[authorUser][where][email][$eq]=' + USER_EMAIL],
      ['populate author with where', 'populate[author][where][email][$eq]=' + USER_EMAIL],
      [
        'a nested populate with filters',
        'populate[threadOf][populate][authorUser][filters][email][$eq]=' + USER_EMAIL,
      ],
      ['a related comment', 'filters[threadOf][authorEmail][$eq]=' + GUEST_EMAIL],
    ])('rejects a filter on %s with 400', async (_name, query) => {
      for (const path of [FLAT(relation), TREE(relation)]) {
        const res = await get(`${path}?${query}`);
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).not.toContain('guest-1');
        expect(res.body.data ?? null).toBeNull();
      }
    });

    it('does not return a hidden parent in threadOf of an approved reply', async () => {
      const res = await get(FLAT(relation));
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      for (const marker of ['pending note', 'rejected note', 'Hidden PENDING', 'Hidden REJECTED']) {
        expect(body).not.toContain(marker);
      }
      const answers = allComments(res.body).filter((c) =>
        String(c.content).startsWith('answer to')
      );
      expect(answers).toHaveLength(2);
      for (const answer of answers) expect(answer.threadOf ?? null).toBeNull();
    });

    it('still accepts a normal filter', async () => {
      const res = await get(`${FLAT(relation)}?filters[content][$contains]=parent`);
      expect(res.status).toBe(200);
      expect(
        allComments(res.body)
          .map((c) => c.content)
          .sort()
      ).toEqual(['guest parent', 'member parent']);
    });
  });
});
