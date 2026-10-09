import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { resolveClientIp } from '../utils/client-ip';
import { normalizePath } from '../utils/rate-limit/groups';
import { getClientIpSettings, getRateLimitRuntime } from '../utils/rate-limit/runtime';
import { rateLimitState } from '../utils/rate-limit/state';

/**
 * Sets `ctx.request.ip` to the address `TRUST_PROXY` resolves (Koa's default is
 * the leftmost `X-Forwarded-For`, which the client writes), so the limiters,
 * the admin and users-permissions rate limiters and the logs agree; this holds
 * with rate limiting off too. With it on, also reads the frontend's forwarder
 * headers, taking the forwarded client only on `/api/*`. Nothing in the app
 * reads `ctx.ips`.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    const settings = getClientIpSettings(strapi);
    if (!settings) return next();

    const header = ctx.get(settings.header);
    const resolved = resolveClientIp(settings.trust, ctx.req.socket.remoteAddress, header);
    if (resolved.shortChain) {
      settings.warn(
        'short-chain',
        'TRUST_PROXY counts more proxy hops than the request went through: using the socket address'
      );
    }
    if (settings.trust.kind === 'none' && header) {
      settings.warn(
        'ignored-header',
        'TRUST_PROXY=false but requests carry a proxy header: behind a proxy every client shares its address'
      );
    }

    const runtime = getRateLimitRuntime(strapi);
    if (!runtime) {
      ctx.request.ip = resolved.ip;
      return next();
    }
    // The visitor's address, as the frontend forwards it, only counts on the API.
    const api = normalizePath(ctx.path).startsWith('/api/');
    const forwarded = runtime.forwarder.apply(ctx, resolved.ip, runtime.warn, api);
    ctx.request.ip = forwarded.ip;
    const state = rateLimitState(ctx);
    state.peerIp = resolved.ip;
    state.forwarded = forwarded.forwarded;
    state.clientSupplied = forwarded.clientSupplied;
    return next();
  };
