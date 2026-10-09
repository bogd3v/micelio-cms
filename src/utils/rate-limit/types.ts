import type { TrustProxy, RateLimitConfig } from '../../types/rate-limit';
import type { TokenResolver } from './api-token';
import type { Forwarder } from './forwarder';
import type { Limiters } from './stores';

/** What a forwarder decided about one request. */
export interface Forwarded {
  /** The frontend identified itself with the shared secret. */
  forwarded: boolean;
  /** The request also named a valid client: its buckets, not a token's, apply. */
  clientSupplied: boolean;
  /** Client address to count: the forwarded one when valid, else `resolved`. */
  ip: string;
}

/** What resolving the client address needs; present even with rate limiting off. */
export interface ClientIpSettings {
  trust: TrustProxy;
  /** `PROXY_IP_HEADER`. */
  header: string;
  /** Logs a warning, at most once a minute per `key`. Never pass an address or an email. */
  warn(key: string, message: string): void;
}

/** Everything the middlewares and the fediverse guard share, built once on register. */
export interface RateLimitRuntime extends ClientIpSettings {
  config: RateLimitConfig;
  /** Keys the HMACs of emails and of the shared store's keys. */
  secret: Buffer;
  limiters: Limiters;
  tokens: TokenResolver;
  forwarder: Forwarder;
}

/** Outcome of counting one request. */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets (and when to retry, if not allowed). */
  resetSeconds: number;
  /** `RateLimit-Policy` value, e.g. `10;w=60`. */
  policy: string;
}
