import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { MCP_PATH } from '../constants/rate-limit';
import { ipBucket } from '../utils/client-ip';
import { extractBearer, isTokenCandidate } from '../utils/rate-limit/api-token';
import { classifyRequest, normalizePath } from '../utils/rate-limit/groups';
import { groupKey, tokenKey } from '../utils/rate-limit/keys';
import { rejectTooManyRequests, setRateLimitHeaders } from '../utils/rate-limit/respond';
import { getRateLimitRuntime, type RateLimitRuntime } from '../utils/rate-limit/runtime';
import { rateLimitState } from '../utils/rate-limit/state';
import type { RateLimitDecision } from '../utils/rate-limit/stores';

/** Counts a decision: rejects when over the limit, else sets the headers. */
function enforce(ctx: Context, decision: RateLimitDecision | null): void {
  if (!decision) return;
  if (!decision.allowed) rejectTooManyRequests(ctx, decision);
  setRateLimitHeaders(ctx, decision);
}

/**
 * The `api` group. Requests count against the client; once a client is over
 * its limit, a content-API token it carries gets the token's own, larger
 * bucket (and an admin token on `/mcp` goes through). The token is looked up
 * only then, at most a few times a minute per client, and tokens found
 * before skip the client bucket. See docs/RATE_LIMITING.md.
 */
async function limitApi(ctx: Context, runtime: RateLimitRuntime, isMcp: boolean): Promise<void> {
  const { limiters, tokens } = runtime;
  if (!limiters.rule('api')) return;

  // A forwarded request that names the visitor stays on the visitor's bucket:
  // the frontend's token must not lift the limit its users share.
  const header = rateLimitState(ctx).clientSupplied
    ? null
    : extractBearer(ctx.get('authorization'));
  const bearer = header && isTokenCandidate(header) ? header : null;
  const tokenLimited = limiters.rule('token') !== null;
  let known = bearer ? tokens.peek(bearer) : null;

  const byToken = async (id: number) => enforce(ctx, await limiters.consume('token', tokenKey(id)));

  // RATE_LIMIT_TOKEN=0: a valid content-API token is not limited.
  if (known?.kind === 'content-api') return tokenLimited ? byToken(known.id) : undefined;
  if (known?.kind === 'admin' && isMcp) return;

  const ip = ctx.request.ip;
  const decision = await limiters.consume('api', groupKey(ip, '', false));
  if (!decision || decision.allowed) return enforce(ctx, decision);

  if (bearer && known === undefined) {
    const budget = await limiters.consume('token-lookup', ipBucket(ip));
    if (!budget || budget.allowed) known = await tokens.lookup(bearer);
  }
  if (known?.kind === 'content-api') return tokenLimited ? byToken(known.id) : undefined;
  if (known?.kind === 'admin' && isMcp) return;
  return rejectTooManyRequests(ctx, decision);
}

/**
 * Group limits by client address (docs/RATE_LIMITING.md), before the body is
 * read. `/_health`, `/uploads/*`, the favicon and the admin panel (except its
 * login routes) are exempt. A no-op while rate limiting is off, and for a
 * request the fediverse guard already counted.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next) => {
    const runtime = getRateLimitRuntime(strapi);
    const state = rateLimitState(ctx);
    if (!runtime || state.checked) return next();

    const path = normalizePath(ctx.path);
    const route = classifyRequest(ctx.method, path);
    if (route.kind === 'exempt') return next();

    // A frontend that forwards its visitors still counts as one peer per group,
    // at a multiple of the group's own limit.
    if (state.forwarded && state.peerIp) {
      const ceiling = await runtime.limiters.consume(
        `ceiling:${route.group}`,
        ipBucket(state.peerIp)
      );
      enforce(ctx, ceiling);
    }

    if (route.group === 'api') {
      await limitApi(ctx, runtime, route.mcp || path === MCP_PATH);
    } else {
      const key = groupKey(ctx.request.ip, route.pathKey, route.keyByPath);
      enforce(ctx, await runtime.limiters.consume(route.group, key));
    }
    return next();
  };
