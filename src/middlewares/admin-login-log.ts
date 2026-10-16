import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { ADMIN_LOGIN_PATH } from '../constants/rate-limit';
import { SECURITY_EVENTS } from '../constants/security-events';
import { logAuthEvent, userIdFromBody } from '../utils/auth-events';
import { normalizePath } from '../utils/rate-limit/groups';

/** A refused admin sign-in, with the reason when the error tells it. */
export interface AdminLoginRefusal {
  reason?: 'invalid-credentials' | 'blocked-account';
}

/** Strapi answers `501` when the login strategy itself failed unexpectedly. */
const NOT_IMPLEMENTED = 501;
const TOO_MANY_REQUESTS = 429;
/** Names of the errors Strapi throws for a refused request; `strapi::errors` answers them 4xx. */
const REFUSAL_ERRORS = new Set([
  'ApplicationError',
  'ValidationError',
  'UnauthorizedError',
  'ForbiddenError',
]);
const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';
const INACTIVE_MESSAGE = 'User not active';

/**
 * Logs `POST /admin/login` as `auth.login.success` (with the admin user id) or
 * `auth.login.failure`, without Enterprise code and without changing the answer.
 *
 * @remarks
 * Wraps the route from outside, so it sees the final status. Strapi's own
 * `admin.auth.success` and `admin.auth.error` events carry no client address,
 * which is why this is a middleware. A 429 is the rate limiter's, not a
 * sign-in result, and an unexpected error (500) is not a refusal; neither is logged here.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    if (ctx.method.toUpperCase() !== 'POST' || normalizePath(ctx.path) !== ADMIN_LOGIN_PATH) {
      return next();
    }
    try {
      await next();
    } catch (error) {
      const refusal = adminLoginRefusal(error);
      if (refusal) logAuthEvent(strapi, ctx, SECURITY_EVENTS.authLoginFailure, refusal);
      throw error;
    }
    if (ctx.status === 200) {
      logAuthEvent(strapi, ctx, SECURITY_EVENTS.authLoginSuccess, {
        actor: userIdFromBody(ctx.body),
      });
    } else if (isRefusedStatus(ctx.status)) {
      logAuthEvent(strapi, ctx, SECURITY_EVENTS.authLoginFailure);
    }
  };

/**
 * Classifies an error thrown by the admin login route: the refusal to log, or
 * `null` when it is not a refused sign-in (the rate limiter's
 * `RateLimitError`, or an unexpected error).
 *
 * @remarks
 * `reason` is set only for the two messages Strapi's login gives for a wrong
 * password or unknown account (`invalid-credentials`) and an inactive user
 * (`blocked-account`); a malformed body has none.
 *
 * @internal
 */
export function adminLoginRefusal(error: unknown): AdminLoginRefusal | null {
  const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
  if (name === 'RateLimitError' || typeof name !== 'string' || !REFUSAL_ERRORS.has(name)) {
    return null;
  }
  if (name === 'ApplicationError' && message === INVALID_CREDENTIALS_MESSAGE) {
    return { reason: 'invalid-credentials' };
  }
  if (name === 'ApplicationError' && message === INACTIVE_MESSAGE) {
    return { reason: 'blocked-account' };
  }
  return {};
}

/**
 * Whether a response status is a refused sign-in: a 4xx other than 429 (the
 * limiter's event), or 501.
 *
 * @internal
 */
export function isRefusedStatus(status: number): boolean {
  return (
    (status >= 400 && status < 500 && status !== TOO_MANY_REQUESTS) || status === NOT_IMPLEMENTED
  );
}
