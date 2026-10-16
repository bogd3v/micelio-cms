import { errors } from '@strapi/utils';
import type { Context } from 'koa';
import { RATE_LIMIT_MESSAGE } from '../../constants/rate-limit';
import type { RateLimitDecision, RateLimitRuntime } from './types';

/** `RateLimit-*` headers of the group's current window. */
export function setRateLimitHeaders(ctx: Context, decision: RateLimitDecision): void {
  ctx.set('RateLimit-Limit', String(decision.limit));
  ctx.set('RateLimit-Remaining', String(Math.max(0, decision.remaining)));
  ctx.set('RateLimit-Reset', String(decision.resetSeconds));
  ctx.set('RateLimit-Policy', decision.policy);
}

/** Headers of a rejected request: the limits plus when to retry. */
function setRejectionHeaders(ctx: Context, decision: RateLimitDecision): void {
  setRateLimitHeaders(ctx, decision);
  ctx.set('Retry-After', String(Math.max(1, decision.resetSeconds)));
}

/** Rejects through `strapi::errors`, so the body is Strapi's standard 429. */
export function rejectTooManyRequests(ctx: Context, decision: RateLimitDecision): never {
  setRejectionHeaders(ctx, decision);
  throw new errors.RateLimitError();
}

/** Who a logged rejection names, when it is not the resolved client. */
export interface RejectionLogAs {
  /** The address to hash: the peer for the forwarder ceiling, not the claimed visitor. */
  ip?: string;
  /** The limiter's own opaque bucket key, for groups counted by account. */
  bucket?: string;
}

/**
 * Logs the rejection as a security event (throttled, see `log.ts`), then
 * rejects as {@link rejectTooManyRequests} does. `group` names the limiter
 * that said no; it only keys the throttle and is not written.
 */
export function rejectLogged(
  ctx: Context,
  runtime: RateLimitRuntime,
  group: string,
  decision: RateLimitDecision,
  logAs: RejectionLogAs = {}
): never {
  runtime.events.rejected(logAs.ip ?? ctx.request.ip, group, ctx.path, logAs.bucket);
  return rejectTooManyRequests(ctx, decision);
}

/**
 * Same response written directly, for the code that runs before
 * `strapi::errors` (the fediverse guard). Body as `formatApplicationError`
 * produces it.
 */
export function writeTooManyRequests(ctx: Context, decision: RateLimitDecision): void {
  setRejectionHeaders(ctx, decision);
  ctx.status = 429;
  ctx.body = {
    data: null,
    error: { status: 429, name: 'RateLimitError', message: RATE_LIMIT_MESSAGE, details: {} },
  };
}
