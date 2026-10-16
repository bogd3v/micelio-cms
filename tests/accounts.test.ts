import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { getPublicRole, getRole } from './helpers/permissions';
import { restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env';
import { NO_STORE } from '../src/utils/cache-control';
import { accountEmailTemplates, applyAccountSettings } from '../src/migrations/account-settings';

const USER_UID = 'plugin::users-permissions.user';
const PERMISSION_UID = 'plugin::users-permissions.permission';
const ARTICLE_UID = 'api::article.article';
const COMMENT_UID = 'plugin::comments.comment';
const SITE_SETTING_UID = 'api::site-setting.site-setting';
const MARKER = { type: 'core', name: 'migrations', key: 'account-settings' };
const PASSWORD = 'Sup3r-secret';

/** What the email service receives; tests read the link out of the body. */
interface SentEmail {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
}

type EmailTemplates = Record<string, { options: { object: string; message: string } }>;
type User = { id: number };

describe('Accounts (users-permissions)', () => {
  const sent: SentEmail[] = [];
  let relation: string;

  const http = () => request(strapi.server.httpServer);
  const pluginStore = () => strapi.store({ type: 'plugin', name: 'users-permissions' });
  const jwtFor = (user: User) =>
    strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
  const createUser = async (username: string, roleType = 'authenticated'): Promise<User> => {
    const role = await getRole(roleType);
    return strapi
      .plugin('users-permissions')
      .service('user')
      .add({
        username,
        email: `${username}@example.com`,
        password: PASSWORD,
        provider: 'local',
        confirmed: true,
        role: role.id,
      });
  };
  const linkIn = (email: SentEmail): string => {
    const link = /href="([^"]+)"/.exec(email.html ?? email.text ?? '')?.[1];
    if (!link) throw new Error('The email has no link');
    return link;
  };

  beforeAll(async () => {
    process.env.FRONTEND_URL = 'https://bogdev.test';
    // `RATE_LIMIT_ENABLED=true` turns on every app-level group for this suite and,
    // as a side effect, switches the plugin limiter off. The suite sends many
    // requests from one client, so the groups it can hit get high limits.
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_AUTH: '1000/60',
      RATE_LIMIT_AUTH_EMAIL: '1000/60',
      RATE_LIMIT_AUTH_IDENTIFIER: '1000/60',
      RATE_LIMIT_API: '1000/60',
    });
    await setupStrapi();

    // Captures what would go out through SMTP.
    strapi.plugin('email').service('email').send = async (options: SentEmail) => {
      sent.push(options);
    };

    const publicRole = await getPublicRole();
    await strapi.query(PERMISSION_UID).create({
      data: { action: 'plugin::comments.client.findAllFlat', role: publicRole.id },
    });
    await strapi.service('plugin::users-permissions.users-permissions').initialize();

    const draft = await strapi
      .documents(ARTICLE_UID)
      .create({ data: { title: 'Comment target', slug: 'comment-target' } });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    relation = `${ARTICLE_UID}:${draft.documentId}`;
  });

  afterAll(async () => {
    await cleanupStrapi();
    restoreRateLimitEnv();
    delete process.env.FRONTEND_URL;
  });

  describe('settings', () => {
    it('turns on sign-up with email confirmation and frontend links', async () => {
      expect(await pluginStore().get({ key: 'advanced' })).toMatchObject({
        allow_register: true,
        default_role: 'authenticated',
        unique_email: true,
        email_confirmation: true,
        email_confirmation_redirection: 'https://bogdev.test/account/confirmed',
        email_reset_password: 'https://bogdev.test/account/reset-password',
      });
    });

    it("writes the email templates with the site's name, in its language", async () => {
      // The neutral site settings seeded on a fresh instance: Micelio, in English.
      const email = (await pluginStore().get({ key: 'email' })) as EmailTemplates;
      expect(email.email_confirmation.options.object).toBe('Confirm your email for Micelio');
      expect(email.reset_password.options.object).toBe('Reset your Micelio password');
    });

    it('applies the settings once and keeps what an admin changes', async () => {
      const advanced = (await pluginStore().get({ key: 'advanced' })) as Record<string, unknown>;
      await pluginStore().set({ key: 'advanced', value: { ...advanced, allow_register: false } });

      const report = await applyAccountSettings(strapi);

      expect(report).toEqual({ settingsApplied: false, permissionsGranted: 0 });
      expect(await pluginStore().get({ key: 'advanced' })).toMatchObject({ allow_register: false });
      await pluginStore().set({ key: 'advanced', value: advanced });
    });

    it('issues JWTs with the reader type and audience', async () => {
      const user = await createUser('claims-reader');
      const [, payload] = jwtFor(user).split('.');
      expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
        id: user.id,
        type: 'reader',
        aud: 'micelio:reader',
      });
    });

    it('refuses a JWT signed with the same secret but without the claims, or for another audience', async () => {
      const user = await createUser('claims-refused');
      const secret = strapi.config.get('plugin::users-permissions.jwtSecret') as string;
      const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const sign = (payload: object) => {
        const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
        return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
      };
      const me = (token: string) =>
        http().get('/api/users/me').set('Authorization', `Bearer ${token}`);

      await me(sign({ id: user.id })).expect(401);
      await me(sign({ id: user.id, type: 'reader' })).expect(401);
      await me(sign({ id: user.id, aud: 'micelio:reader' })).expect(401);
      await me(sign({ id: user.id, type: 'access', aud: 'micelio:reader' })).expect(401);
      await me(sign({ id: user.id, type: 'reader', aud: 'other' })).expect(401);
      await me(sign({ id: user.id, type: 'reader', aud: 'micelio:reader' })).expect(200);
    });

    it('issues JWTs that last 7 days', async () => {
      const user = await createUser('jwt-reader');
      const [, payload] = jwtFor(user).split('.');
      const { iat, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      expect(exp - iat).toBe(7 * 24 * 60 * 60);
    });
  });

  describe('password rules', () => {
    const register = (username: string, password: string) =>
      http()
        .post('/api/auth/local/register')
        .send({ username, email: `${username}@example.com`, password });

    it.each([
      ['a short password', 'Ab1-xyz', 'at least 8 characters'],
      ['a common password', 'password', 'too common'],
      ['a password with the software name', 'my-micelio-1', 'tied to this site'],
    ])('refuses %s on sign-up', async (_label, password, message) => {
      const res = await register('rule-signup', password).expect(400);
      expect(res.body.error.message).toContain(message);
    });

    it('refuses a weak new password on change and on reset', async () => {
      const user = await createUser('rule-change');
      const change = await http()
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${jwtFor(user)}`)
        .send({ currentPassword: PASSWORD, password: 'Ab1-xyz', passwordConfirmation: 'Ab1-xyz' })
        .expect(400);
      expect(change.body.error.message).toContain('at least 8 characters');

      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'rule-change@example.com' })
        .expect(200);
      const code = new URL(linkIn(sent[sent.length - 1])).searchParams.get('code');
      const reset = await http()
        .post('/api/auth/reset-password')
        .send({ code, password: 'password', passwordConfirmation: 'password' })
        .expect(400);
      expect(reset.body.error.message).toContain('too common');
    });
  });

  describe('sign-up', () => {
    it('confirms the email before the account can sign in', async () => {
      sent.length = 0;
      await http()
        .post('/api/auth/local/register')
        .send({ username: 'ana', email: 'ana@example.com', password: PASSWORD })
        .expect(200);

      const login = () =>
        http().post('/api/auth/local').send({ identifier: 'ana@example.com', password: PASSWORD });
      expect((await login()).status).toBe(400);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        to: 'ana@example.com',
        subject: 'Confirm your email for Micelio',
      });
      const link = new URL(linkIn(sent[0]));
      expect(link.pathname).toBe('/api/auth/email-confirmation');

      // The link opens the frontend, which confirms with a POST (issue #178).
      const token = link.searchParams.get('confirmation');
      const visit = await http().get(`${link.pathname}${link.search}`).expect(303);
      expect(visit.headers.location).toBe(
        `https://bogdev.test/account/confirmed?confirmation=${token}`
      );
      expect((await login()).status).toBe(400);
      await http().post(link.pathname).send({ confirmation: token }).expect(204);

      const res = await login();
      expect(res.status).toBe(200);
      expect(res.body.jwt).toEqual(expect.any(String));
      // The JWT sign-in returns carries the reader claims, so the next request accepts it.
      await http().get('/api/users/me').set('Authorization', `Bearer ${res.body.jwt}`).expect(200);
    });

    it('rejects a role in the registration body', async () => {
      const res = await http()
        .post('/api/auth/local/register')
        .send({
          username: 'mallory',
          email: 'mallory@example.com',
          password: PASSWORD,
          role: (await getRole('editor')).id,
        });

      expect(res.status).toBe(400);
      expect(await strapi.query(USER_UID).count({ where: { username: 'mallory' } })).toBe(0);
    });
  });

  describe('email confirmation', () => {
    const CONFIRM_PATH = '/api/auth/email-confirmation';
    /** Signs up and returns the emailed token. */
    const signUp = async (username: string): Promise<string> => {
      sent.length = 0;
      await http()
        .post('/api/auth/local/register')
        .send({ username, email: `${username}@example.com`, password: PASSWORD })
        .expect(200);
      const token = new URL(linkIn(sent[0])).searchParams.get('confirmation');
      if (!token) throw new Error('The link has no token');
      return token;
    };
    const isConfirmed = async (username: string): Promise<boolean> =>
      (await strapi.query(USER_UID).findOne({ where: { username } })).confirmed;

    it('confirms with POST and the emailed token', async () => {
      const token = await signUp('post-confirm');

      const res = await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(204);
      expect(res.headers['cache-control']).toBe(NO_STORE);
      expect(await isConfirmed('post-confirm')).toBe(true);
      await http()
        .post('/api/auth/local')
        .send({ identifier: 'post-confirm@example.com', password: PASSWORD })
        .expect(200);
    });

    it('refuses a used, unknown or malformed token', async () => {
      const token = await signUp('post-refused');

      for (const body of [
        { confirmation: 'a'.repeat(40) },
        { confirmation: token.toUpperCase() },
        { confirmation: token.slice(1) },
        { confirmation: [token] },
        { confirmation: { $ne: '' } },
        {},
      ]) {
        const res = await http().post(CONFIRM_PATH).send(body).expect(400);
        expect(res.body.error.message).toBe('Invalid token');
        expect(await isConfirmed('post-refused')).toBe(false);
      }

      await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(204);
      const reused = await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(400);
      expect(reused.body.error.message).toBe('Invalid token');
    });

    it('ignores a token in the query of a POST', async () => {
      const token = await signUp('post-query');

      await http().post(`${CONFIRM_PATH}?confirmation=${token}`).send({}).expect(400);
      expect(await isConfirmed('post-query')).toBe(false);
    });

    it('GET does not confirm and redirects with the token', async () => {
      const token = await signUp('get-redirect');

      const res = await http().get(`${CONFIRM_PATH}?confirmation=${token}`).expect(303);
      expect(res.headers.location).toBe(
        `https://bogdev.test/account/confirmed?confirmation=${token}`
      );
      expect(res.headers['cache-control']).toBe(NO_STORE);
      expect(await isConfirmed('get-redirect')).toBe(false);
      await http()
        .post('/api/auth/local')
        .send({ identifier: 'get-redirect@example.com', password: PASSWORD })
        .expect(400);
    });

    it('a GET does not use up the token', async () => {
      const token = await signUp('get-twice');

      await http().get(`${CONFIRM_PATH}?confirmation=${token}`).expect(303);
      await http().get(`${CONFIRM_PATH}?confirmation=${token}`).expect(303);
      await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(204);
      await http()
        .post('/api/auth/local')
        .send({ identifier: 'get-twice@example.com', password: PASSWORD })
        .expect(200);
    });

    it('GET with a malformed or missing token redirects with an empty confirmation', async () => {
      const token = await signUp('get-malformed');
      const bare = 'https://bogdev.test/account/confirmed';

      for (const query of [
        `confirmation=${token.toUpperCase()}`,
        `confirmation=${token.slice(1)}`,
        'confirmation[$ne]=',
        'confirmation=a&confirmation=b',
        '',
      ]) {
        const res = await http().get(`${CONFIRM_PATH}?${query}`).expect(303);
        expect(res.headers.location).toBe(`${bare}?confirmation=`);
      }
      // A well-formed token nobody holds is indistinguishable from a real one.
      const unknown = await http()
        .get(`${CONFIRM_PATH}?confirmation=${'a'.repeat(40)}`)
        .expect(303);
      expect(unknown.headers.location).toBe(`${bare}?confirmation=${'a'.repeat(40)}`);
      expect(await isConfirmed('get-malformed')).toBe(false);
    });

    it('HEAD redirects like GET and does not confirm', async () => {
      const token = await signUp('head-redirect');

      const res = await http().head(`${CONFIRM_PATH}?confirmation=${token}`).expect(303);
      expect(res.headers.location).toBe(
        `https://bogdev.test/account/confirmed?confirmation=${token}`
      );
      expect(await isConfirmed('head-redirect')).toBe(false);
    });

    it('the 303 carries the security headers', async () => {
      const res = await http()
        .get(`${CONFIRM_PATH}?confirmation=${'a'.repeat(40)}`)
        .expect(303);
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    });

    it('GET keeps the query of the configured redirection', async () => {
      const token = await signUp('get-query');
      const advanced = (await pluginStore().get({ key: 'advanced' })) as Record<string, unknown>;
      await pluginStore().set({
        key: 'advanced',
        value: { ...advanced, email_confirmation_redirection: 'https://bogdev.test/c?lang=es' },
      });
      try {
        const res = await http().get(`${CONFIRM_PATH}?confirmation=${token}`).expect(303);
        expect(res.headers.location).toBe(`https://bogdev.test/c?lang=es&confirmation=${token}`);
      } finally {
        await pluginStore().set({ key: 'advanced', value: advanced });
      }
    });

    it.each([
      ['empty', ''],
      ['relative', '/account/confirmed'],
      ['not an http(s) URL', 'ftp://bogdev.test/c'],
    ])(
      'GET redirects to the root, without the token, when the redirection is %s',
      async (_n, value) => {
        const token = await signUp(`get-no-redirect-${_n.replace(/\W/g, '')}`);
        const advanced = (await pluginStore().get({ key: 'advanced' })) as Record<string, unknown>;
        await pluginStore().set({
          key: 'advanced',
          value: { ...advanced, email_confirmation_redirection: value },
        });
        try {
          const res = await http().get(`${CONFIRM_PATH}?confirmation=${token}`).expect(303);
          expect(res.headers.location).toBe('/');
          const bad = await http().get(`${CONFIRM_PATH}?confirmation=x`).expect(303);
          expect(bad.headers.location).toBe('/');
        } finally {
          await pluginStore().set({ key: 'advanced', value: advanced });
        }
      }
    );

    it('does not issue a JWT', async () => {
      const token = await signUp('post-no-jwt');

      const res = await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(204);
      expect(res.body).toEqual({});
      expect(res.text).toBe('');
    });
  });

  describe('password reset', () => {
    it('sends a frontend link whose code sets a new password', async () => {
      await createUser('forgetful');
      sent.length = 0;

      await http()
        .post('/api/auth/forgot-password')
        .send({ email: 'forgetful@example.com' })
        .expect(200);

      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe('Reset your Micelio password');
      const link = new URL(linkIn(sent[0]));
      expect(`${link.origin}${link.pathname}`).toBe('https://bogdev.test/account/reset-password');

      const newPassword = 'An0ther-secret';
      await http()
        .post('/api/auth/reset-password')
        .send({
          code: link.searchParams.get('code'),
          password: newPassword,
          passwordConfirmation: newPassword,
        })
        .expect(200);

      const res = await http()
        .post('/api/auth/local')
        .send({ identifier: 'forgetful@example.com', password: newPassword });
      expect(res.status).toBe(200);
    });
  });

  describe('reset code expiry and session revocation', () => {
    const requestCode = async (email: string): Promise<string> => {
      sent.length = 0;
      await http().post('/api/auth/forgot-password').send({ email }).expect(200);
      return new URL(linkIn(sent[0])).searchParams.get('code') as string;
    };
    const reset = (code: string, password: string) =>
      http()
        .post('/api/auth/reset-password')
        .send({ code, password, passwordConfirmation: password });
    const backdateCode = (email: string, ms: number) =>
      strapi.db.query(USER_UID).update({
        where: { email },
        data: { resetPasswordIssuedAt: new Date(Date.now() - ms).toISOString() },
      });

    it('refuses a code older than an hour and burns it', async () => {
      await createUser('stale-code');
      const code = await requestCode('stale-code@example.com');
      await backdateCode('stale-code@example.com', 61 * 60 * 1000);

      const res = await reset(code, 'N3w-secret-one');
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Incorrect code provided');

      // A fresh code for the same user no longer collides with the burnt one.
      const fresh = await requestCode('stale-code@example.com');
      await reset(fresh, 'N3w-secret-one').expect(200);
    });

    it('accepts a code issued just under an hour ago', async () => {
      await createUser('recent-code');
      const code = await requestCode('recent-code@example.com');
      await backdateCode('recent-code@example.com', 59 * 60 * 1000);
      await reset(code, 'N3w-secret-two').expect(200);
    });

    it('refuses a code that has no issue time (issued before this fix)', async () => {
      const user = await createUser('legacy-code');
      await strapi.db
        .query(USER_UID)
        .update({ where: { id: user.id }, data: { resetPasswordToken: 'a'.repeat(128) } });
      await reset('a'.repeat(128), 'N3w-secret-three').expect(400);
    });

    it('rejects a JWT issued before the reset, and accepts the one the reset returns', async () => {
      const user = await createUser('old-session');
      // `iat` has second precision: age the old token by a second.
      const old = strapi
        .plugin('users-permissions')
        .service('jwt')
        .issue({ id: user.id }, { notBefore: 0 }) as string;
      await http().get('/api/users/me').set('Authorization', `Bearer ${old}`).expect(200);

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const code = await requestCode('old-session@example.com');
      const res = await reset(code, 'N3w-secret-four').expect(200);

      await http().get('/api/users/me').set('Authorization', `Bearer ${old}`).expect(401);
      await http().get('/api/users/me').set('Authorization', `Bearer ${res.body.jwt}`).expect(200);
    });
  });

  describe('GET /api/users/me', () => {
    it('returns the editor role', async () => {
      const editor = await createUser('editor-me', 'editor');
      const res = await http()
        .get('/api/users/me?populate=role')
        .set('Authorization', `Bearer ${jwtFor(editor)}`)
        .expect(200);
      expect(res.body.role.type).toBe('editor');
    });
  });

  describe('DELETE /api/users/me', () => {
    const deleteMe = (user: User | null, body: object = { password: PASSWORD }) => {
      const req = http().delete('/api/users/me').send(body);
      return user ? req.set('Authorization', `Bearer ${jwtFor(user)}`) : req;
    };
    const exists = async (user: User) =>
      (await strapi.query(USER_UID).count({ where: { id: user.id } })) > 0;

    it('requires a JWT', async () => {
      await deleteMe(null).expect(401);
    });

    it('keeps the account when the password is wrong', async () => {
      const user = await createUser('wrong-password');

      const res = await deleteMe(user, { password: 'not-it' }).expect(400);

      expect(res.body.error.message).toBe('Invalid password');
      expect(await exists(user)).toBe(true);
    });

    it('deletes only the user of the JWT, whatever id the request carries', async () => {
      const user = await createUser('leaving');
      const other = await createUser('staying');

      await deleteMe(user, { password: PASSWORD, id: other.id }).expect(204);

      expect(await exists(user)).toBe(false);
      expect(await exists(other)).toBe(true);
    });

    it('works for editors', async () => {
      const editor = await createUser('leaving-editor', 'editor');
      await deleteMe(editor).expect(204);
      expect(await exists(editor)).toBe(false);
    });

    it('keeps the comments of the deleted account as «Anónimo»', async () => {
      const user = await createUser('commenter');
      await strapi.query(COMMENT_UID).create({
        data: {
          content: 'written before leaving',
          related: relation,
          approvalStatus: 'APPROVED',
          authorUser: user.id,
        },
      });

      await deleteMe(user).expect(204);

      const res = await http().get(`/api/comments/${relation}/flat`).expect(200);
      const items = Array.isArray(res.body) ? res.body : res.body.data;
      const comment = (items as { content: string; author: unknown }[]).find(
        (item) => item.content === 'written before leaving'
      );
      expect(comment?.author).toMatchObject({ id: 'anonymous', name: 'Anónimo' });
      // The public API never returns an author email (strip-comment-author-email).
      expect(comment?.author).not.toHaveProperty('email');

      const row = await strapi
        .query(COMMENT_UID)
        .findOne({ where: { content: 'written before leaving' }, populate: ['authorUser'] });
      expect(row).toMatchObject({ authorUser: null, authorEmail: null, authorName: 'Anónimo' });
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('stays closed to every role', async () => {
      const victim = await createUser('victim');
      const authenticated = await createUser('attacker');
      const editor = await createUser('attacker-editor', 'editor');

      await http().delete(`/api/users/${victim.id}`).expect(403);
      for (const user of [authenticated, editor]) {
        await http()
          .delete(`/api/users/${victim.id}`)
          .set('Authorization', `Bearer ${jwtFor(user)}`)
          .expect(403);
      }
      expect(await strapi.query(USER_UID).count({ where: { id: victim.id } })).toBe(1);
    });
  });

  // Last: it rewrites the templates the sign-up and reset tests read.
  describe('email templates of a Spanish site', () => {
    it("are written in Spanish with the site's name when the settings are applied", async () => {
      const settings = await strapi.documents(SITE_SETTING_UID).findFirst();
      await strapi.documents(SITE_SETTING_UID).update({
        documentId: settings!.documentId,
        locale: 'en',
        data: { name: 'La Huerta', defaultLocale: 'es' },
      });
      await strapi.store.delete(MARKER);

      expect((await applyAccountSettings(strapi)).settingsApplied).toBe(true);

      const email = (await pluginStore().get({ key: 'email' })) as EmailTemplates;
      // No Spanish site settings exist, so the name comes from the default locale.
      expect(email.email_confirmation.options.object).toBe('Confirma tu correo en La Huerta');
      expect(email.reset_password.options.object).toBe('Restablece tu contraseña de La Huerta');
    });

    it('removes the username placeholder from templates stored by earlier versions', async () => {
      const store = pluginStore();
      const email = (await store.get({ key: 'email' })) as EmailTemplates;
      email.email_confirmation.options.message = '<p>Hi <%= USER.username %>,</p><p><%= URL %></p>';
      await store.set({ key: 'email', value: email });

      await applyAccountSettings(strapi);

      const after = (await store.get({ key: 'email' })) as EmailTemplates;
      expect(after.email_confirmation.options.message).toBe('<p>Hi,</p><p><%= URL %></p>');

      await applyAccountSettings(strapi);
      expect(await store.get({ key: 'email' })).toEqual(after);
    });

    it('puts no user-chosen value in the emails, so none can inject HTML', () => {
      for (const language of ['en', 'es']) {
        const templates = accountEmailTemplates('La Huerta', language);
        for (const { message } of Object.values(templates)) {
          expect(message).not.toContain('USER.');
        }
      }
    });

    it('escapes the site name, so it cannot inject HTML or template code', () => {
      const templates = accountEmailTemplates('<b>Ana</b> <%= process.env %> & Co', 'en');
      const html = templates.email_confirmation.message;
      expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt; &lt;%= process.env %&gt; &amp; Co');
      expect(html).not.toContain('<%= process.env');
      expect(templates.reset_password.object).toContain('&lt;b&gt;Ana');
    });
  });
});
