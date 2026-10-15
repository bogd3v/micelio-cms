import type { ResponseRoute, Shape } from './types';

const COMMENTS_READER =
  'server/api/comments/*.get.ts, server/api/comments/index.post.ts (`toPublicComment`)';

/** The author of a comment: no email, whatever the caller (`src/middlewares/strip-comment-author-email.ts`). */
const COMMENT_AUTHOR: Shape = { id: 'required', name: 'required', avatar: 'required' };

/** The keys of a comment common to the three comment routes. */
const COMMENT: Shape = {
  id: 'required',
  documentId: 'required',
  content: 'required',
  blocked: 'required',
  blockedThread: 'required',
  blockReason: 'required',
  isAdminComment: 'required',
  removed: 'required',
  approvalStatus: 'required',
  createdAt: 'required',
  updatedAt: 'required',
  author: { use: 'required', of: COMMENT_AUTHOR },
  publishedAt: 'surplus',
  locale: 'surplus',
};

/** The parent of a reply, as the plugin returns it: the whole comment, of which the frontend reads the id. */
const THREAD_PARENT: Shape = {
  id: 'required',
  documentId: 'surplus',
  content: 'surplus',
  blocked: 'surplus',
  blockedThread: 'surplus',
  blockReason: 'surplus',
  isAdminComment: 'surplus',
  removed: 'surplus',
  approvalStatus: 'surplus',
  related: 'surplus',
  createdAt: 'surplus',
  updatedAt: 'surplus',
  publishedAt: 'surplus',
  locale: 'surplus',
  author: { use: 'surplus', of: { id: 'surplus', name: 'surplus', avatar: 'surplus' } },
};

/** The subscriber row, as `find`, `create` and `update` return it. */
const SUBSCRIBER_FIELDS: Shape = {
  id: 'surplus',
  documentId: 'surplus',
  email: 'surplus',
  confirmationToken: 'surplus',
  unsubscribeToken: 'surplus',
  confirmed: 'surplus',
  language: 'surplus',
  createdAt: 'surplus',
  updatedAt: 'surplus',
  publishedAt: 'surplus',
};

/** The routes of the comments plugin, the signed-in user and the subscribers. */
export const ACCOUNT_ROUTES: readonly ResponseRoute[] = [
  {
    id: 'comments.flat',
    auth: 'public role or API token with `findAllFlat`',
    method: 'GET',
    path: '/api/comments/:relation/flat',
    callers: ['public', 'frontend'],
    reader: COMMENTS_READER,
    note: 'Only approved comments. `reports`, the author email and the author of a hidden parent never appear (PR #207). The frontend allow-lists `authorUser`, which the plugin does not return, and reads `related` as an object although the plugin returns a string. `fediverseUri` and `fediverseActorHandle` are added by `src/middlewares/fediverse-comment-fields.ts`. `gotThread` and `threadFirstItemId` are plugin internals the frontend does not read.',
    body: {
      data: {
        use: 'required',
        of: {
          ...COMMENT,
          related: 'required',
          threadOf: { use: 'required', of: THREAD_PARENT },
          fediverseUri: 'required',
          fediverseActorHandle: 'required',
          gotThread: 'surplus',
          threadFirstItemId: 'surplus',
        },
      },
      pagination: { use: 'surplus', of: 'pagination-unread' },
    },
  },
  {
    id: 'comments.tree',
    auth: 'public role or API token with `findAllInHierarchy`',
    method: 'GET',
    path: '/api/comments/:relation',
    callers: ['public', 'frontend'],
    reader: COMMENTS_READER,
    kind: 'list',
    note: 'A bare list of top-level comments with their `children`, which have the same keys. The hierarchy carries no `related` and no `threadOf`. Same rules as `comments.flat`.',
    body: {
      ...COMMENT,
      children: { use: 'required', of: 'self' },
      fediverseUri: 'required',
      fediverseActorHandle: 'required',
      gotThread: 'surplus',
      threadFirstItemId: 'surplus',
    },
  },
  {
    id: 'comments.post',
    auth: 'API token with `post`',
    method: 'POST',
    path: '/api/comments/:relation',
    callers: ['frontend'],
    reader: 'server/api/comments/index.post.ts (`toPublicComment`)',
    note: 'The comment just stored, without the email that was sent. It has no fediverse fields and no `gotThread`.',
    body: {
      ...COMMENT,
      related: 'required',
      threadOf: { use: 'required', of: THREAD_PARENT },
    },
  },
  {
    id: 'auth.login',
    auth: 'none (the public role has `auth.callback`)',
    method: 'POST',
    path: '/api/auth/local',
    callers: ['public'],
    reader: 'server/api/auth/login.post.ts',
    note: 'The frontend keeps the `jwt` and reads the user again from `/api/users/me`, so the `user` that comes with it is surplus. Password hash, reset and confirmation tokens are private and never appear.',
    body: {
      jwt: 'required',
      user: {
        use: 'surplus',
        of: {
          id: 'surplus',
          documentId: 'surplus',
          username: 'surplus',
          email: 'surplus',
          provider: 'surplus',
          confirmed: 'surplus',
          blocked: 'surplus',
          createdAt: 'surplus',
          updatedAt: 'surplus',
          publishedAt: 'surplus',
        },
      },
    },
  },
  {
    id: 'auth.register',
    auth: 'none (the public role has `auth.register`)',
    method: 'POST',
    path: '/api/auth/local/register',
    callers: ['public'],
    reader: 'server/api/auth/register.post.ts (`toPublicUser`)',
    note: 'The new account, with no `jwt` and no `role`: the frontend shows it as a reader until the person confirms the address and signs in.',
    body: {
      user: {
        use: 'required',
        of: {
          username: 'required',
          email: 'required',
          createdAt: 'required',
          id: 'surplus',
          documentId: 'surplus',
          provider: 'surplus',
          confirmed: 'surplus',
          blocked: 'surplus',
          updatedAt: 'surplus',
          publishedAt: 'surplus',
        },
      },
    },
  },
  {
    id: 'users.me',
    auth: 'JWT of the signed-in user',
    method: 'GET',
    path: '/api/users/me?populate=role',
    callers: ['user', 'editor'],
    reader: 'server/utils/auth.ts, app/helpers/auth.ts (`toPublicUser`)',
    note: "The caller's own account: a JWT is needed and nobody else's row is returned. `role` is added by `src/extensions/users-permissions/strapi-server.ts`. Password hash, reset and confirmation tokens are private and never appear.",
    body: {
      username: 'required',
      email: 'required',
      createdAt: 'required',
      role: {
        use: 'required',
        of: { type: 'required', id: 'surplus', documentId: 'surplus', name: 'surplus' },
      },
      id: 'surplus',
      documentId: 'surplus',
      provider: 'surplus',
      confirmed: 'surplus',
      blocked: 'surplus',
      updatedAt: 'surplus',
      publishedAt: 'surplus',
    },
  },
  {
    id: 'subscribers.find',
    auth: 'API token with `find`; no role',
    method: 'GET',
    path: '/api/subscribers',
    callers: ['frontend'],
    reader: 'server/utils/subscribers.ts (`findSubscriber`)',
    note: 'Token only. The CMS stores the tokens as the frontend sends them: the frontend stores SHA-256 hashes (`hashToken` in micelio), but rows written before it did keep the token in clear, and `find`, `create` and `update` return the stored values to the token holder. The frontend reads `documentId`, `email`, `confirmed`, `language` and both tokens.',
    body: {
      data: {
        use: 'required',
        of: {
          ...SUBSCRIBER_FIELDS,
          documentId: 'required',
          email: 'required',
          confirmationToken: 'required',
          unsubscribeToken: 'required',
          confirmed: 'required',
          language: 'required',
        },
      },
      meta: { use: 'surplus', of: { pagination: { use: 'surplus', of: 'pagination-unread' } } },
    },
  },
  {
    id: 'subscribers.create',
    auth: 'API token with `create`; no role',
    method: 'POST',
    path: '/api/subscribers',
    callers: ['frontend'],
    reader: 'server/utils/subscribers.ts (`createSubscriber`)',
    note: 'Token only. The frontend reads `documentId` of the answer; the rest is the stored row, with the `confirmationToken` the frontend sent (as stored, see `subscribers.find`) and a null `unsubscribeToken`, which `createSubscriber` never sends.',
    body: {
      data: { use: 'required', of: { ...SUBSCRIBER_FIELDS, documentId: 'required' } },
      meta: { use: 'surplus', of: {} },
    },
  },
  {
    id: 'subscribers.update',
    auth: 'API token with `update`; no role',
    method: 'PUT',
    path: '/api/subscribers/:documentId',
    callers: ['frontend'],
    reader: 'server/utils/subscribers.ts (`updateSubscriber`)',
    note: 'Token only. The frontend ignores the body, so every field is surplus. It returns the stored row, tokens as stored (see `subscribers.find`).',
    body: {
      data: { use: 'surplus', of: SUBSCRIBER_FIELDS },
      meta: { use: 'surplus', of: {} },
    },
  },
];
