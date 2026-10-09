import { errors } from '@strapi/utils';
import type { Context } from 'koa';
import { RATE_LIMIT_MESSAGE } from '../../constants/rate-limit';
import type { RateLimitDecision } from './types';

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
