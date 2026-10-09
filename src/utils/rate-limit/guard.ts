import type { Context } from 'koa';
import type { RequestGuard } from '../../types/rate-limit';
import { resolveClientIp } from '../client-ip';
import { groupKey } from './keys';
import { setRateLimitHeaders, writeTooManyRequests } from './respond';
import type { RateLimitRuntime } from './types';
import { rateLimitState } from './state';

/**
 * The guard the fediverse plugin calls before Fedify (the plugin's middleware
 * runs before `strapi::errors` and before the client-ip middleware, and Fedify
 * reads the raw body). It resolves the address itself from the connection and
 * never touches the body. `true` means the 429 is already written. Any failure
 * answers `false`: federation keeps working without the limit.
 */
export function createRequestGuard(runtime: RateLimitRuntime): RequestGuard {
  return async (ctx: Context, kind) => {
    try {
      const group = kind === 'inbox' ? 'fediverse-inbox' : 'api';
      if (!runtime.limiters.rule(group)) return false;

      const { ip } = resolveClientIp(
        runtime.trust,
        ctx.req.socket.remoteAddress,
        ctx.get(runtime.config.proxyIpHeader)
      );
      // The root middlewares skip a request the guard already counted.
      rateLimitState(ctx).checked = true;

      const decision = await runtime.limiters.consume(group, groupKey(ip, '', false));
      if (!decision) return false;
      if (decision.allowed) {
        setRateLimitHeaders(ctx, decision);
        return false;
      }
      writeTooManyRequests(ctx, decision);
      return true;
    } catch {
      return false;
    }
  };
}
