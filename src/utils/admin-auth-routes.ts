import type { Context } from 'koa';
import { SECURITY_EVENTS, type SecurityEvent } from '../constants/security-events';
import type { SecurityReason } from '../types/security-events';
import { userIdFromState } from './auth-events';

/** A refused admin sign-in, with the reason when the error tells it. */
export interface AdminLoginRefusal {
  reason?: 'invalid-credentials' | 'blocked-account';
}

/** What a route knows about the answer it logs: the thrown error, or the finished context. */
export interface AdminAnswer {
  ctx: Context;
  error?: unknown;
}

/** One admin route that takes or issues credentials, and the events it writes. */
export interface AdminAuthRoute {
  method: string;
  /** Normalised path (lower case, no trailing slash). */
  path: string;
  /** Event for the answer `successStatus`, or `null` when only refusals are events. */
  success: SecurityEvent | null;
  /** Event for a refused request, or `null` when only successes are events. */
  failure: SecurityEvent | null;
  successStatus: number;
  /** Where the user id comes from: the response body, or the signed-in user of the request. */
  actor: 'body' | 'state';
  /** Whether a 5xx (answered or thrown) is a failure without reason: the route issues credentials. */
  logUnexpected: boolean;
  /** `reason` of a failure; only values of the closed set. */
  reason?: (answer: AdminAnswer) => SecurityReason | undefined;
  /** `false` when the request is not an authentication attempt (no event either way). */
  isAttempt?: (answer: AdminAnswer) => boolean;
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
const MISSING_REFRESH_MESSAGE = 'Missing refresh token';

/**
 * Classifies an error thrown by an admin auth route: the refusal to log, or
 * `null` when it is not a refusal (the rate limiter's `RateLimitError`, or an
 * unexpected error).
 *
 * @remarks
 * `reason` is set only for the two messages Strapi's login gives for a wrong
 * password or unknown account (`invalid-credentials`) and an inactive user
 * (`blocked-account`); a malformed body has none. It is meaningful for the
 * login route only; the other routes derive theirs in {@link ADMIN_AUTH_ROUTES}.
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
 * Whether a response status is a refused request: a 4xx other than 429 (the
 * limiter's event), or 501.
 *
 * @internal
 */
export function isRefusedStatus(status: number): boolean {
  return (
    (status >= 400 && status < 500 && status !== TOO_MANY_REQUESTS) || status === NOT_IMPLEMENTED
  );
}

/**
 * The admin routes `global::admin-login-log` writes events for (ASVS V16.3.1).
 * `forgot-password` has no failure event: the answer is the same whether or
 * not the account exists, and so is the log.
 */
export const ADMIN_AUTH_ROUTES: readonly AdminAuthRoute[] = [
  {
    method: 'POST',
    path: '/admin/login',
    success: SECURITY_EVENTS.authLoginSuccess,
    failure: SECURITY_EVENTS.authLoginFailure,
    successStatus: 200,
    actor: 'body',
    logUnexpected: true,
    reason: ({ error }) => (error ? adminLoginRefusal(error)?.reason : undefined),
  },
  {
    method: 'POST',
    path: '/admin/forgot-password',
    success: SECURITY_EVENTS.authPasswordResetRequested,
    failure: null,
    successStatus: 204,
    actor: 'body',
    logUnexpected: false,
  },
  {
    method: 'POST',
    path: '/admin/reset-password',
    success: SECURITY_EVENTS.authPasswordResetCompleted,
    failure: SECURITY_EVENTS.authPasswordResetFailure,
    successStatus: 200,
    actor: 'body',
    logUnexpected: true,
    // An unknown or expired code is an ApplicationError; a rejected password is a ValidationError.
    reason: ({ error }) =>
      (error as { name?: unknown } | undefined)?.name === 'ApplicationError'
        ? 'invalid-code'
        : undefined,
  },
  {
    method: 'POST',
    path: '/admin/register',
    success: SECURITY_EVENTS.authRegister,
    failure: SECURITY_EVENTS.authRegisterFailure,
    successStatus: 200,
    actor: 'body',
    logUnexpected: true,
  },
  {
    method: 'POST',
    path: '/admin/register-admin',
    success: SECURITY_EVENTS.authRegister,
    failure: SECURITY_EVENTS.authRegisterFailure,
    successStatus: 200,
    actor: 'body',
    logUnexpected: true,
  },
  {
    // The invitation lookup returns the invitee's email and is exempt from the limiter.
    // A valid token is no sign-in, so only a refusal is an event.
    method: 'GET',
    path: '/admin/registration-info',
    success: null,
    failure: SECURITY_EVENTS.authRegisterFailure,
    successStatus: 200,
    actor: 'body',
    logUnexpected: false,
    reason: () => 'invalid-token',
  },
  {
    method: 'POST',
    path: '/admin/access-token',
    success: SECURITY_EVENTS.authSessionRefreshCompleted,
    failure: SECURITY_EVENTS.authSessionRefreshFailure,
    successStatus: 200,
    actor: 'body',
    logUnexpected: true,
    reason: () => 'invalid-token',
    // Without the cookie nothing was presented: the panel asks on every load, signed in or not.
    isAttempt: (answer) => messageOf(answer) !== MISSING_REFRESH_MESSAGE,
  },
  {
    method: 'PUT',
    path: '/admin/users/me',
    success: SECURITY_EVENTS.authPasswordChangeSuccess,
    failure: SECURITY_EVENTS.authPasswordChangeFailure,
    successStatus: 200,
    actor: 'state',
    logUnexpected: false,
    reason: (answer) =>
      'currentPassword' in detailsOf(answer) ? 'invalid-credentials' : undefined,
    isAttempt: isPasswordChange,
  },
];

/** Message of the error a route answered with, thrown or written to the body. */
function messageOf({ ctx, error }: AdminAnswer): unknown {
  if (error instanceof Error) return error.message;
  return (ctx.body as { error?: { message?: unknown } } | null | undefined)?.error?.message;
}

/** The `details` of the error a route answered with. */
function detailsOf({ ctx, error }: AdminAnswer): Record<string, unknown> {
  const details =
    (error as { details?: unknown } | null | undefined)?.details ??
    (ctx.body as { error?: { details?: unknown } } | null | undefined)?.error?.details;
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : {};
}

/**
 * Names of the fields a refused request complains about: the keys of the
 * error's `details` (`currentPassword`, `email`) and the paths of a schema
 * validation's `details.errors`.
 */
function refusedFields(answer: AdminAnswer): Set<string> {
  const details = detailsOf(answer);
  const fields = new Set(Object.keys(details));
  if (Array.isArray(details.errors)) {
    for (const entry of details.errors as Array<{ path?: unknown }>) {
      const path = Array.isArray(entry?.path) ? entry.path[0] : entry?.path;
      if (typeof path === 'string') fields.add(path.split('.')[0]);
    }
  }
  return fields;
}

/**
 * Whether the profile update is a password change that was checked: it sent
 * both the current and a new password, and was not refused for another field.
 * A new password refused by policy, or a taken email after a correct current
 * password, says nothing about the current password and is not an event.
 */
function isPasswordChange(answer: AdminAnswer): boolean {
  const { ctx } = answer;
  const body = (ctx.request as unknown as { body?: Record<string, unknown> }).body;
  if (
    userIdFromState(ctx.state.user) === undefined ||
    typeof body?.currentPassword !== 'string' ||
    body.currentPassword === '' ||
    typeof body.password !== 'string' ||
    body.password === ''
  ) {
    return false;
  }
  const fields = refusedFields(answer);
  return fields.has('currentPassword') || !(fields.has('password') || fields.has('email'));
}
