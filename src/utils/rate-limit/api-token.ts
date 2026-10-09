import { createHash } from 'node:crypto';
import type { Core } from '@strapi/strapi';

/** The kind of API token a bearer belongs to. */
export type TokenKind = 'content-api' | 'admin';

/** A stored API token, identified by kind and id. */
export interface TokenInfo {
  kind: TokenKind;
  id: number;
}

interface StoredToken {
  id: number;
  kind?: string | null;
  expiresAt?: string | Date | null;
}

interface TokenService {
  hash(accessKey: string): string;
  getByAccessKey(hash: string): Promise<StoredToken | null | undefined>;
}

/** Entries kept, each way: the cache must not grow with attacker-chosen bearers. */
const CACHE_SIZE = 500;
const POSITIVE_TTL_MS = 60_000;
/** Short, so a token created a moment ago isn't refused for long. */
const NEGATIVE_TTL_MS = 10_000;
/** Real tokens are 128 hex characters; the bounds only avoid hashing junk. */
const MIN_LENGTH = 16;
const MAX_LENGTH = 512;

/** Token of `Authorization: Bearer <token>`, parsed as Strapi does. */
export function extractBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const parts = authorization.split(/\s+/);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

/**
 * Whether the bearer can be an API token: users' JWTs (three dot separated
 * parts) and out-of-range lengths are never looked up.
 */
export function isTokenCandidate(token: string): boolean {
  if (token.length < MIN_LENGTH || token.length > MAX_LENGTH) return false;
  return token.split('.').length !== 3;
}

/** Bounded map with expiry, oldest entry out first. */
class TtlCache<V> {
  private entries = new Map<string, { value: V; expires: number }>();

  get(key: string, now: number): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, expires: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires });
    if (this.entries.size > CACHE_SIZE) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}

/** Looks up which API token a bearer string belongs to. */
export interface TokenResolver {
  /** Cached answer: the token, null for a known miss, undefined when not cached. */
  peek(token: string): TokenInfo | null | undefined;
  /** Database lookup (cached). Null for unknown, expired or failed lookups. */
  lookup(token: string): Promise<TokenInfo | null>;
}

/**
 * Tells content-API and admin tokens apart, the way Strapi's own strategies do
 * (`content-api-token.js`, `authenticateAdminToken`): hash the bearer, look it
 * up, check `kind` and expiry. It does not check an admin token's owner nor
 * update `lastUsedAt`: the route still authenticates the request itself, this
 * only decides which bucket counts it. Answers are cached by the SHA-256 of
 * the bearer (never the bearer) for at most 60 s or the token's expiry, so a
 * revoked token keeps its bucket for up to a minute.
 */
export function createTokenResolver(strapi: Core.Strapi, now = Date.now): TokenResolver {
  const hits = new TtlCache<TokenInfo>();
  const misses = new TtlCache<true>();
  const pending = new Map<string, Promise<TokenInfo | null>>();
  const cacheKey = (token: string) => createHash('sha256').update(token).digest('hex');

  const service = (): TokenService =>
    (strapi.admin as unknown as { services: Record<string, TokenService> }).services[
      'api-token-content-api'
    ];

  const fetchToken = async (token: string, key: string): Promise<TokenInfo | null> => {
    try {
      const tokens = service();
      const stored = await tokens.getByAccessKey(tokens.hash(token));
      const kind = stored?.kind ?? 'content-api';
      const expiresAt = stored?.expiresAt ? new Date(stored.expiresAt).getTime() : null;
      const current = now();
      if (!stored || (kind !== 'content-api' && kind !== 'admin')) {
        misses.set(key, true, current + NEGATIVE_TTL_MS);
        return null;
      }
      if (expiresAt !== null && expiresAt < current) {
        misses.set(key, true, current + NEGATIVE_TTL_MS);
        return null;
      }
      const info: TokenInfo = { kind, id: stored.id };
      const ttl =
        expiresAt === null ? POSITIVE_TTL_MS : Math.min(POSITIVE_TTL_MS, expiresAt - current);
      hits.set(key, info, current + ttl);
      return info;
    } catch {
      return null;
    }
  };

  /** Runs the lookup and forgets it once settled, so concurrent callers share one request. */
  const fetchShared = async (token: string, key: string): Promise<TokenInfo | null> => {
    try {
      return await fetchToken(token, key);
    } finally {
      pending.delete(key);
    }
  };

  return {
    peek(token) {
      const key = cacheKey(token);
      const current = now();
      return hits.get(key, current) ?? (misses.get(key, current) ? null : undefined);
    },

    lookup(token) {
      const key = cacheKey(token);
      const current = now();
      const hit = hits.get(key, current);
      if (hit) return Promise.resolve(hit);
      if (misses.get(key, current)) return Promise.resolve(null);
      let inFlight = pending.get(key);
      if (!inFlight) {
        inFlight = fetchShared(token, key);
        pending.set(key, inFlight);
      }
      return inFlight;
    },
  };
}
