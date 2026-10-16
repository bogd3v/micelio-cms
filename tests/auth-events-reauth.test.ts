import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  jest,
} from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { getRole } from './helpers/permissions';

const PASSWORD = 'Sup3r-secret';
const ADMIN_PASSWORD = 'Password123!';
const NEW_ADMIN_PASSWORD = 'An0ther-Pass1';

interface Line {
  level: 'info' | 'warn';
  message: string;
  meta: Record<string, unknown>;
}

describe('Re-authentication, admin and token events (ASVS V16.3.1)', () => {
  /** Every info and warn call of the current test, serialised, for the leak check. */
  let seen: string[] = [];
  let lines: Line[] = [];
  let failLogging = false;
  const spies: Array<ReturnType<typeof jest.spyOn>> = [];

  const http = () => request(strapi.server.httpServer);
  const securityLines = () => lines.filter((l) => l.message.startsWith('security: auth.'));
  const events = () => securityLines().map((l) => l.meta.event);
  const only = () => {
    expect(securityLines()).toHaveLength(1);
    return securityLines()[0];
  };
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const jwtFor = (user: { id: number }) =>
    strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
  const createUser = async (username: string) => {
    const role = await getRole('authenticated');
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
  const createAdmin = async (name: string, extra: Record<string, unknown> = {}) => {
    const superAdmin = await strapi.service('admin::role').getSuperAdmin();
    return strapi.service('admin::user').create({
      email: `${name}@example.com`,
      firstname: name,
      password: ADMIN_PASSWORD,
      isActive: true,
      registrationToken: null,
      roles: [superAdmin.id],
      ...extra,
    });
  };
  /** Signs in as an admin: the access token and the refresh cookie pair (`name=value`). */
  const adminSession = async (name: string) => {
    const res = await http()
      .post('/admin/login')
      .send({ email: `${name}@example.com`, password: ADMIN_PASSWORD })
      .expect(200);
    const cookie = String(
      ([] as string[])
        .concat(res.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith('strapi_admin_refresh=')) ?? ''
    ).split(';')[0];
    lines = [];
    return { token: res.body.data.token as string, cookie };
  };

  beforeAll(async () => {
    await setupStrapi();
    // The admin reset email is sent after the answer, from a detached promise.
    const mail = strapi.plugin('email').service('email');
    mail.send = async () => undefined;
    mail.sendTemplatedEmail = async () => undefined;
    for (const level of ['info', 'warn'] as const) {
      spies.push(
        jest.spyOn(strapi.log, level).mockImplementation(((
          message: string,
          meta?: Record<string, unknown>
        ) => {
          if (failLogging && String(message).startsWith('security: ')) {
            throw new Error('the log is down');
          }
          lines.push({ level, message: String(message), meta: meta ?? {} });
          seen.push(JSON.stringify({ message, meta }));
        }) as never)
      );
    }
  });

  beforeEach(() => {
    lines = [];
    seen = [];
    failLogging = false;
  });

  /** No test may write an email, password, code, token, cookie or raw address. */
  afterEach(() => {
    const output = seen.join('\n');
    for (const secret of [
      '@example.com',
      PASSWORD,
      ADMIN_PASSWORD,
      NEW_ADMIN_PASSWORD,
      'An0ther-secret',
      'Wrong-pass-1',
      '127.0.0.1',
      '::1',
      'eyJ',
      'strapi_admin_refresh',
      'garbage-token',
      'reset-code',
      'Bearer',
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    await cleanupStrapi();
  });

  describe('reader re-authentication', () => {
    const change = (user: { id: number }, body: Record<string, unknown>) =>
      http()
        .post('/api/auth/change-password')
        .set(bearer(jwtFor(user)))
        .send(body);

    it('logs a wrong current password, a rejected new password and a change', async () => {
      const user = await createUser('pw-change');

      const wrong = await change(user, {
        currentPassword: 'Wrong-pass-1',
        password: 'An0ther-secret',
        passwordConfirmation: 'An0ther-secret',
      }).expect(400);
      expect(wrong.body.error.message).toBe('The provided current password is invalid');
      expect(only()).toMatchObject({
        level: 'warn',
        message: 'security: auth.password-change.failure',
        meta: {
          outcome: 'failure',
          reason: 'invalid-credentials',
          actor: String(user.id),
          path: '/api/auth/change-password',
          client: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
      });

      lines = [];
      await change(user, {
        currentPassword: PASSWORD,
        password: 'Ab1-xyz',
        passwordConfirmation: 'Ab1-xyz',
      }).expect(400);
      expect(only().meta).toMatchObject({ event: 'auth.password-change.failure' });
      expect(only().meta).not.toHaveProperty('reason');

      lines = [];
      const ok = await change(user, {
        currentPassword: PASSWORD,
        password: 'An0ther-secret',
        passwordConfirmation: 'An0ther-secret',
      }).expect(200);
      expect(ok.body.jwt).toEqual(expect.any(String));
      expect(only()).toMatchObject({
        level: 'info',
        meta: { event: 'auth.password-change.success', outcome: 'success', actor: String(user.id) },
      });
    });

    it('logs nothing for a change without a signed-in user', async () => {
      await http().post('/api/auth/change-password').send({ currentPassword: 'x' }).expect(403);
      expect(securityLines()).toHaveLength(0);
    });

    it('logs a refused and a completed account deletion', async () => {
      const user = await createUser('deleting');
      const destroy = (body: object) =>
        http()
          .delete('/api/users/me')
          .set(bearer(jwtFor(user)))
          .send(body);

      for (const body of [{ password: 'Wrong-pass-1' }, {}]) {
        lines = [];
        const res = await destroy(body).expect(400);
        expect(res.body.error.message).toBe('Invalid password');
        expect(only()).toMatchObject({
          level: 'warn',
          meta: {
            event: 'auth.account-deletion.failure',
            reason: 'invalid-credentials',
            actor: String(user.id),
            path: '/api/users/me',
          },
        });
      }

      lines = [];
      await destroy({ password: PASSWORD }).expect(204);
      expect(only()).toMatchObject({
        level: 'info',
        meta: { event: 'auth.account-deletion.success', actor: String(user.id) },
      });
    });

    it('logs nothing for a deletion without a JWT', async () => {
      await http().delete('/api/users/me').send({ password: PASSWORD }).expect(401);
      expect(securityLines()).toHaveLength(0);
    });
  });

  describe('admin routes', () => {
    it('logs a password reset request without telling whether the account exists', async () => {
      await createAdmin('forgot');
      const known = await http()
        .post('/admin/forgot-password')
        .send({ email: 'forgot@example.com' });
      const unknown = await http()
        .post('/admin/forgot-password')
        .send({ email: 'nobody@example.com' });

      expect(known.status).toBe(204);
      expect(unknown.status).toBe(204);
      expect(unknown.body).toEqual(known.body);
      expect(events()).toEqual(['auth.password-reset.requested', 'auth.password-reset.requested']);
      for (const line of securityLines()) {
        expect(line.level).toBe('info');
        expect(line.meta).not.toHaveProperty('actor');
        expect(line.meta).toMatchObject({ path: '/admin/forgot-password' });
      }

      lines = [];
      await http().post('/admin/forgot-password').send({ email: 'not-an-email' }).expect(400);
      expect(securityLines()).toHaveLength(0);
    });

    it('logs a refused and a completed password reset', async () => {
      const admin = await createAdmin('reset');
      await strapi.db.query('admin::user').update({
        where: { id: admin.id },
        data: {
          resetPasswordToken: 'reset-code-0123456789',
          resetPasswordTokenExpiresAt: new Date(Date.now() + 60_000),
        },
      });
      const reset = (resetPasswordToken: string, password: string) =>
        http().post('/admin/reset-password').send({ resetPasswordToken, password });

      await reset('reset-code-unknown-000', NEW_ADMIN_PASSWORD).expect(400);
      expect(only()).toMatchObject({
        level: 'warn',
        meta: {
          event: 'auth.password-reset.failure',
          reason: 'invalid-code',
          path: '/admin/reset-password',
        },
      });

      lines = [];
      await reset('reset-code-0123456789', 'weak').expect(400);
      expect(only().meta).toMatchObject({ event: 'auth.password-reset.failure' });
      expect(only().meta).not.toHaveProperty('reason');

      lines = [];
      const ok = await reset('reset-code-0123456789', NEW_ADMIN_PASSWORD).expect(200);
      expect(ok.body.data.token).toEqual(expect.any(String));
      expect(only()).toMatchObject({
        level: 'info',
        meta: { event: 'auth.password-reset.completed', actor: String(admin.id) },
      });
    });

    it('logs a refused and a completed registration', async () => {
      const superAdmin = await strapi.service('admin::role').getSuperAdmin();
      const invited = await strapi.service('admin::user').create({
        email: 'invited@example.com',
        firstname: 'Invited',
        isActive: false,
        registrationToken: 'invite-0123456789abcdef',
        roles: [superAdmin.id],
      });
      const register = (registrationToken: string) =>
        http()
          .post('/admin/register')
          .send({
            registrationToken,
            userInfo: { firstname: 'Invited', lastname: 'User', password: ADMIN_PASSWORD },
          });

      await register('invite-unknown-000000').expect(400);
      expect(only()).toMatchObject({
        level: 'warn',
        meta: { event: 'auth.register.failure', path: '/admin/register' },
      });
      expect(only().meta).not.toHaveProperty('reason');

      lines = [];
      await register('invite-0123456789abcdef').expect(200);
      expect(only()).toMatchObject({
        level: 'info',
        meta: { event: 'auth.register', actor: String(invited.id), path: '/admin/register' },
      });
    });

    it('logs a refused first-admin registration once an admin exists', async () => {
      const res = await http()
        .post('/admin/register-admin')
        .send({ email: 'late@example.com', firstname: 'Late', password: ADMIN_PASSWORD });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(only()).toMatchObject({
        meta: { event: 'auth.register.failure', path: '/admin/register-admin' },
      });
    });

    it('logs the exchange of a refresh cookie, and nothing when there is none', async () => {
      await createAdmin('renew');
      const { cookie } = await adminSession('renew');

      const missing = await http().post('/admin/access-token').expect(401);
      expect(missing.body.error.message).toBe('Missing refresh token');
      expect(securityLines()).toHaveLength(0);

      const bad = await http()
        .post('/admin/access-token')
        .set('Cookie', 'strapi_admin_refresh=garbage-token')
        .expect(401);
      expect(bad.body.error.message).toBe('Invalid refresh token');
      expect(only()).toMatchObject({
        level: 'warn',
        meta: {
          event: 'auth.session-refresh.failure',
          reason: 'invalid-token',
          path: '/admin/access-token',
        },
      });

      lines = [];
      const ok = await http().post('/admin/access-token').set('Cookie', cookie).expect(200);
      expect(ok.body.data.token).toEqual(expect.any(String));
      expect(only()).toMatchObject({
        level: 'info',
        meta: { event: 'auth.session-refresh.completed', path: '/admin/access-token' },
      });
    });

    it('logs the profile password check, and nothing for an edit without a password', async () => {
      const admin = await createAdmin('profile');
      const { token } = await adminSession('profile');
      const update = (body: object) => http().put('/admin/users/me').set(bearer(token)).send(body);

      await update({ firstname: 'Renamed' }).expect(200);
      expect(securityLines()).toHaveLength(0);

      const wrong = await update({
        currentPassword: 'Wrong-pass-1',
        password: NEW_ADMIN_PASSWORD,
      }).expect(400);
      expect(wrong.body.error.details.currentPassword).toBeDefined();
      expect(only()).toMatchObject({
        level: 'warn',
        meta: {
          event: 'auth.password-change.failure',
          reason: 'invalid-credentials',
          actor: String(admin.id),
          path: '/admin/users/me',
        },
      });

      lines = [];
      await update({ currentPassword: ADMIN_PASSWORD, password: NEW_ADMIN_PASSWORD }).expect(200);
      expect(only()).toMatchObject({
        level: 'info',
        meta: { event: 'auth.password-change.success', actor: String(admin.id) },
      });
    });

    it('logs a refused invitation lookup, and nothing for a valid one', async () => {
      const superAdmin = await strapi.service('admin::role').getSuperAdmin();
      await strapi.service('admin::user').create({
        email: 'lookup@example.com',
        firstname: 'Lookup',
        isActive: false,
        registrationToken: 'invite-lookup-0123456789',
        roles: [superAdmin.id],
      });

      const bad = await http()
        .get('/admin/registration-info?registrationToken=invite-unknown-0000000')
        .expect(400);
      expect(bad.body.error.message).toBe('Invalid registrationToken');
      expect(only()).toMatchObject({
        level: 'warn',
        meta: {
          event: 'auth.register.failure',
          reason: 'invalid-token',
          path: '/admin/registration-info',
        },
      });

      lines = [];
      const ok = await http()
        .get('/admin/registration-info?registrationToken=invite-lookup-0123456789')
        .expect(200);
      expect(ok.body.data.email).toBe('lookup@example.com');
      expect(securityLines()).toHaveLength(0);
    });

    it('does not log a profile update refused for a field other than the current password', async () => {
      await createAdmin('profile-other');
      await createAdmin('profile-taken');
      const { token } = await adminSession('profile-other');
      const update = (body: object) => http().put('/admin/users/me').set(bearer(token)).send(body);

      // A new password the policy refuses.
      await update({ currentPassword: ADMIN_PASSWORD, password: 'weak' }).expect(400);
      expect(securityLines()).toHaveLength(0);

      // A taken email, after a correct current password.
      const taken = await update({
        currentPassword: ADMIN_PASSWORD,
        password: NEW_ADMIN_PASSWORD,
        email: 'profile-taken@example.com',
      }).expect(400);
      expect(taken.body.error.details.email).toBeDefined();
      expect(securityLines()).toHaveLength(0);
    });

    it('does not log a request the body parser refused', async () => {
      const res = await http()
        .post('/admin/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');
      expect(res.status).toBe(400);
      expect(securityLines()).toHaveLength(0);
    });

    it('logs an admin sign-in answered 500 as a failure without a reason', async () => {
      await createAdmin('unexpected');
      const getter = jest
        .spyOn(strapi as unknown as { sessionManager: unknown }, 'sessionManager', 'get')
        .mockReturnValue(undefined);
      try {
        await http()
          .post('/admin/login')
          .send({ email: 'unexpected@example.com', password: ADMIN_PASSWORD })
          .expect(500);
      } finally {
        getter.mockRestore();
      }
      expect(only()).toMatchObject({
        level: 'warn',
        meta: { event: 'auth.login.failure', path: '/admin/login' },
      });
      expect(only().meta).not.toHaveProperty('reason');
    });
  });

  it('does not change any answer when the log cannot be written', async () => {
    const user = await createUser('quiet');
    await createAdmin('quiet');
    const answers = async () => {
      const statuses: number[] = [];
      statuses.push(
        (
          await http()
            .post('/api/auth/change-password')
            .set(bearer(jwtFor(user)))
            .send({
              currentPassword: 'Wrong-pass-1',
              password: 'An0ther-secret',
              passwordConfirmation: 'An0ther-secret',
            })
        ).status,
        (
          await http()
            .delete('/api/users/me')
            .set(bearer(jwtFor(user)))
            .send({ password: 'Wrong-pass-1' })
        ).status,
        (await http().post('/admin/forgot-password').send({ email: 'quiet@example.com' })).status,
        (
          await http()
            .post('/admin/reset-password')
            .send({ resetPasswordToken: 'reset-code-none-000', password: NEW_ADMIN_PASSWORD })
        ).status,
        (
          await http()
            .post('/admin/access-token')
            .set('Cookie', 'strapi_admin_refresh=garbage-token')
        ).status,
        (await http().get('/api/users/me').set(bearer('garbage-token-0123456789'))).status
      );
      return statuses;
    };

    const normal = await answers();
    expect(securityLines()).toHaveLength(6);
    failLogging = true;
    lines = [];
    expect(await answers()).toEqual(normal);
    expect(normal).toEqual([400, 400, 204, 400, 401, 401]);
    expect(securityLines()).toHaveLength(0);
  });
});
