// Reset-code expiry and JWT revocation after a password change (advisory
// GHSA-xfrm-8c63-m3cj, ASVS V6.4.3). Both rely on two private columns this
// extension adds to the users-permissions user, so no plugin file is patched.
import type { Context } from 'koa';
import { errors } from '@strapi/utils';

const USER_UID = 'plugin::users-permissions.user';

/** How long a password reset code works after `forgotPassword` issued it. */
export const RESET_CODE_TTL_MS = 60 * 60 * 1000;

/** Attributes added to the user: when the reset code was issued, and when the password last changed. */
export const SECURITY_ATTRIBUTES = {
  resetPasswordIssuedAt: { type: 'datetime', private: true, configurable: false },
  passwordChangedAt: { type: 'datetime', private: true, configurable: false },
} as const;

type Params = Record<string, unknown>;

/**
 * Adds the timestamps that go with a write: a new reset code stamps its issue
 * time, clearing it clears the stamp, and a new password stamps the change.
 * Every plugin path (`forgotPassword`, `resetPassword`, `changePassword`,
 * admin edits) goes through `user.edit`, so this is the one place to do it.
 */
export function withSecurityStamps(params: Params, now: Date = new Date()): Params {
  const stamped: Params = { ...params };
  if ('resetPasswordToken' in params) {
    stamped.resetPasswordIssuedAt = params.resetPasswordToken ? now.toISOString() : null;
  }
  if (typeof params.password === 'string' && params.password !== '') {
    stamped.passwordChangedAt = now.toISOString();
  }
  return stamped;
}

/** Whether a reset code issued at `issuedAt` still works. A code with no stamp (issued before this fix) does not. */
export function isResetCodeFresh(issuedAt: unknown, now: number = Date.now()): boolean {
  if (typeof issuedAt !== 'string') return false;
  const issued = Date.parse(issuedAt);
  return Number.isFinite(issued) && now - issued <= RESET_CODE_TTL_MS;
}

/**
 * Whether a JWT was issued before the password last changed. `iat` has
 * second precision, so the token the reset itself returns (same second) stays valid.
 */
export function isIssuedBeforePasswordChange(iat: unknown, changedAt: unknown): boolean {
  if (typeof iat !== 'number' || typeof changedAt !== 'string') return false;
  const changed = Date.parse(changedAt);
  return Number.isFinite(changed) && iat < Math.floor(changed / 1000);
}

type Service = Record<string, (...args: never[]) => unknown>;
type ServiceFactory = (args: { strapi: unknown }) => Service;

/** Wraps `user.edit` so every write carries the stamps of `withSecurityStamps`. */
export function wrapUserService(factory: ServiceFactory): ServiceFactory {
  return (args) => {
    const service = factory(args) as Record<string, unknown> & {
      edit: (id: number, params?: Params) => Promise<unknown>;
    };
    const edit = service.edit;
    service.edit = (id, params = {}) => edit.call(service, id, withSecurityStamps(params));
    return service as unknown as Service;
  };
}

/** Wraps `jwt.verify` so a legacy token older than the last password change is rejected. */
export function wrapJwtService(factory: ServiceFactory): ServiceFactory {
  return (args) => {
    const service = factory(args) as Record<string, unknown> & {
      verify: (token: string) => Promise<{ id?: number; iat?: number }>;
    };
    const verify = service.verify;
    service.verify = async (token) => {
      const payload = await verify.call(service, token);
      // `refresh` mode revokes through its sessions and carries no `iat` here.
      if (payload?.id === undefined || payload.iat === undefined) return payload;
      const user = (await strapi.db
        .query(USER_UID)
        .findOne({ select: ['passwordChangedAt'], where: { id: payload.id } })) as {
        passwordChangedAt?: string | null;
      } | null;
      if (isIssuedBeforePasswordChange(payload.iat, user?.passwordChangedAt)) {
        throw new Error('Invalid token.');
      }
      return payload;
    };
    return service as unknown as Service;
  };
}

/**
 * Wraps `resetPassword` to refuse a code older than `RESET_CODE_TTL_MS`, and
 * burns it so it can't be tried again.
 *
 * @throws `ValidationError` with the plugin's own message for an unknown code,
 * so an expired code is indistinguishable from a wrong one.
 */
export function wrapResetPassword(
  resetPassword: (ctx: Context) => Promise<unknown>
): (ctx: Context) => Promise<unknown> {
  return async (ctx) => {
    const code = (ctx.request as unknown as { body?: { code?: unknown } }).body?.code;
    if (typeof code === 'string' && code !== '') {
      const user = (await strapi.db.query(USER_UID).findOne({
        select: ['id', 'resetPasswordIssuedAt'],
        where: { resetPasswordToken: code },
      })) as {
        id: number;
        resetPasswordIssuedAt?: string | null;
      } | null;
      if (user && !isResetCodeFresh(user.resetPasswordIssuedAt)) {
        await strapi
          .plugin('users-permissions')
          .service('user')
          .edit(user.id, { resetPasswordToken: null });
        throw new errors.ValidationError('Incorrect code provided');
      }
    }
    return resetPassword(ctx);
  };
}
