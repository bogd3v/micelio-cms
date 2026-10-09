import type { BlockList } from 'node:net';
import type { Context } from 'koa';

/** Contracts of the application-level rate limiter (issue #100). */

/** `points` requests per `duration` seconds. A group set to `null` is off. */
export interface RateLimitRule {
  points: number;
  duration: number;
}

/** Groups limited by client (or token) and, where noted, by path. */
export type RateLimitGroupName =
  | 'auth'
  | 'auth-identifier'
  | 'admin-auth'
  | 'auth-email'
  | 'comments'
  | 'upload'
  | 'fediverse-inbox'
  | 'api';

/** Where counters live: process `memory` or the shared `database` (`RATE_LIMIT_STORE`). */
export type RateLimitStoreName = 'memory' | 'database';

/** `config/rate-limit.ts`, read through `strapi.config.get('rate-limit')`. */
export interface RateLimitConfig {
  enabled: boolean;
  store: RateLimitStoreName;
  /** Raw `TRUST_PROXY`; parsed (and validated) by `parseTrustProxy`. */
  trustProxy: string;
  proxyIpHeader: string;
  forwarderSecret: string;
  groups: Record<RateLimitGroupName, RateLimitRule | null>;
  /** Per content-API token, `api` group only. */
  token: RateLimitRule | null;
}

/** How the client address is read from the connection and the proxy header. */
export type TrustProxy =
  | { kind: 'none' }
  | { kind: 'hops'; hops: number }
  /** The header is read while the peer, and each next hop, is in `trusted`. */
  | { kind: 'peers'; trusted: BlockList };

/** What the limiter learned about one request, kept in `ctx.state.rateLimit`. */
export interface RateLimitState {
  /** Set by the fediverse guard or the middleware, so a request is counted once. */
  checked?: boolean;
  /** Address the trust model resolved, before a forwarded one replaces it. */
  peerIp?: string;
  /** The frontend sent a valid forwarder secret. */
  forwarded?: boolean;
  /** ... and named the visitor: the visitor's buckets count, not a token's. */
  clientSupplied?: boolean;
}

/**
 * Registered by the root in `plugin::fediverse.requestGuard`; the plugin calls
 * it before Fedify. `true`: it wrote the 429 response itself.
 */
export type RequestGuard = (ctx: Context, kind: 'inbox' | 'read') => Promise<boolean>;
