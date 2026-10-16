import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import type { SecurityEvent } from '../constants/security-events';
import type { SecurityReason } from '../types/security-events';
import { logAuthEvent, userIdFromBody, userIdFromState } from '../utils/auth-events';
import { normalizePath } from '../utils/rate-limit/groups';
import {
  ADMIN_AUTH_ROUTES,
  adminLoginRefusal,
  isRefusedStatus,
  type AdminAnswer,
  type AdminAuthRoute,
} from '../utils/admin-auth-routes';

const INTERNAL_ERROR = 500;

/**
 * Logs the admin routes that take or issue credentials (`ADMIN_AUTH_ROUTES`:
 * sign-in, registration, password reset, session renewal and the profile
 * password change) as authentication events, without Enterprise code and
 * without changing the answer.
 *
 * @remarks
 * Wraps the routes from outside, so it sees the final status. Strapi's own
 * `admin.auth.success` and `admin.auth.error` events carry no client address,
 * which is why this is a middleware. A 429 is the rate limiter's, not an
 * authentication result, and is not logged here. A thrown or answered 5xx (or an error with no status) on
 * a route that issues credentials is logged as a failure without a reason: the
 * attempt did not complete. Other statuses that are no refusal (a body-parser 400 or 413, a 404)
 * are not authentication failures and are not logged. The request body is read only after the route ran,
 * and only to tell whether a password was sent, never to log a value.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    const route = ADMIN_AUTH_ROUTES.find(
      (candidate) =>
        candidate.method === ctx.method.toUpperCase() && candidate.path === normalizePath(ctx.path)
    );
    if (!route) return next();

    try {
      await next();
    } catch (error) {
      if (adminLoginRefusal(error)) {
        logFailure(strapi, route, { ctx, error });
      } else if (route.logUnexpected && isServerError(error)) {
        logFailure(strapi, route, { ctx, error }, false);
      }
      throw error;
    }
    if (ctx.status === route.successStatus) {
      if (!route.success || (route.isAttempt && !route.isAttempt({ ctx }))) return;
      logAuthEvent(strapi, ctx, route.success, {
        actor: route.actor === 'state' ? userIdFromState(ctx.state.user) : userIdFromBody(ctx.body),
      });
    } else if (isRefusedStatus(ctx.status)) {
      logFailure(strapi, route, { ctx });
    } else if (route.logUnexpected && ctx.status >= INTERNAL_ERROR) {
      logFailure(strapi, route, { ctx }, false);
    }
  };

/** Writes the route's failure event; `withReason` is off for an unexpected error, which tells nothing. */
function logFailure(
  strapi: Core.Strapi,
  route: AdminAuthRoute,
  answer: AdminAnswer,
  withReason = true
): void {
  const event: SecurityEvent | null = route.failure;
  if (!event || (route.isAttempt && !route.isAttempt(answer))) return;
  const reason: SecurityReason | undefined = withReason ? route.reason?.(answer) : undefined;
  logAuthEvent(strapi, answer.ctx, event, {
    reason,
    actor: route.actor === 'state' ? userIdFromState(answer.ctx.state.user) : undefined,
  });
}

/**
 * Whether an error that is no refusal is an unexpected failure of the route:
 * its status is 5xx, or it has none (a plain `Error`). A body-parser 400 or
 * 413, a 404 or the limiter's `RateLimitError` (429) are not.
 */
function isServerError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return (typeof status === 'number' ? status : INTERNAL_ERROR) >= INTERNAL_ERROR;
}
