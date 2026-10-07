import type { Context } from 'koa';
import type { RateLimitState } from '../../types/rate-limit';

/** The limiter's per-request notes, in `ctx.state.rateLimit`. */
export function rateLimitState(ctx: Context): RateLimitState {
  const state = ctx.state as { rateLimit?: RateLimitState };
  return (state.rateLimit ??= {});
}
