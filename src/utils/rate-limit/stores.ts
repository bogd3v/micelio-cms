import knex, { type Knex } from 'knex';
import {
  RateLimiterMemory,
  RateLimiterPostgres,
  RateLimiterRes,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible';
import type { Core } from '@strapi/strapi';
import {
  FORWARDER_CEILING_FACTOR,
  RATE_LIMIT_TABLE,
  SHARED_GROUPS,
  TOKEN_LOOKUP_LIMIT,
} from '../../constants/rate-limit';
import type { RateLimitConfig, RateLimitGroupName, RateLimitRule } from '../../types/rate-limit';
import { hmacKey } from './keys';
import type { RateLimitDecision } from './types';

/** Counters that are not a route group. */
export type LimiterName =
  | RateLimitGroupName
  | 'token'
  | 'token-lookup'
  /** Everything the forwarding frontend sends in one group, per peer. */
  | `ceiling:${RateLimitGroupName}`;

/** The rate-limit counters of the app, in memory or, for the shared groups, in PostgreSQL. */
export interface Limiters {
  /** The rule behind a counter, or null when it is off. */
  rule(name: LimiterName): RateLimitRule | null;
  /**
   * Counts one request. Null when the counter is off, or when the store and
   * its in-memory insurance both failed: the request goes through.
   */
  consume(name: LimiterName, key: string): Promise<RateLimitDecision | null>;
  destroy(): Promise<void>;
}

type Warn = (key: string, message: string) => void;

function ruleOf(config: RateLimitConfig, name: LimiterName): RateLimitRule | null {
  if (name === 'token') return config.token;
  if (name.startsWith('ceiling:')) {
    const own = config.groups[name.slice('ceiling:'.length) as RateLimitGroupName];
    return own ? { points: own.points * FORWARDER_CEILING_FACTOR, duration: own.duration } : null;
  }
  if (name === 'token-lookup') return { ...TOKEN_LOOKUP_LIMIT };
  return config.groups[name as RateLimitGroupName];
}

/**
 * A second, small knex pool on the same database, so counting requests can't
 * starve the pool Strapi uses for content: at most 3 connections and a short
 * wait for one. Null (with a warning) when the database isn't Postgres.
 */
function createSharedClient(strapi: Core.Strapi, warn: Warn): Knex | null {
  const database = strapi.config.get<{ client?: string } & Record<string, unknown>>(
    'database.connection'
  );
  if (database.client !== 'postgres') {
    warn('store', 'RATE_LIMIT_STORE=database needs Postgres: counting in memory instead');
    return null;
  }
  return knex({
    ...database,
    client: 'pg',
    pool: { min: 0, max: 3, acquireTimeoutMillis: 1500, idleTimeoutMillis: 30_000 },
    acquireConnectionTimeout: 1500,
  } as Knex.Config);
}

/**
 * Counters per group. Created lazily: the memory ones count per process; with
 * `RATE_LIMIT_STORE=database` the shared groups count in Postgres (keys
 * HMAC'd, keys already blocked answered from memory without a query) and a
 * memory limiter covers a failing database. The `api` group, the token and
 * the forwarder ceiling always count in memory: they are the hot path.
 */
export function createLimiters(
  strapi: Core.Strapi,
  config: RateLimitConfig,
  secret: Buffer,
  warn: Warn
): Limiters {
  const limiters = new Map<LimiterName, RateLimiterAbstract>();
  let client: Knex | null | undefined;
  const shared = new Set<LimiterName>();

  const sharedClient = (): Knex | null => {
    if (client === undefined) client = createSharedClient(strapi, warn);
    return client;
  };

  const build = (name: LimiterName, rule: RateLimitRule): RateLimiterAbstract => {
    const base = { keyPrefix: name, points: rule.points, duration: rule.duration };
    const memory = new RateLimiterMemory(base);
    const useDatabase =
      config.store === 'database' && (SHARED_GROUPS as readonly string[]).includes(name);
    const storeClient = useDatabase ? sharedClient() : null;
    if (!storeClient) return memory;
    shared.add(name);
    return new RateLimiterPostgres({
      ...base,
      storeClient,
      storeType: 'knex',
      tableName: RATE_LIMIT_TABLE,
      schemaName: strapi.db.getSchemaName(),
      tableCreated: true,
      // Prunes rows expired an hour ago, every 5 minutes; stopped on destroy.
      clearExpiredByTimeout: true,
      // Once a key is over the limit its answer comes from memory until it resets.
      inMemoryBlockOnConsumed: rule.points + 1,
      insuranceLimiter: memory,
    });
  };

  return {
    rule: (name) => ruleOf(config, name),

    async consume(name, key) {
      const rule = ruleOf(config, name);
      if (!rule) return null;
      let limiter = limiters.get(name);
      if (!limiter) {
        limiter = build(name, rule);
        limiters.set(name, limiter);
      }
      const storeKey = shared.has(name) ? hmacKey(secret, key) : key;
      const policy = `${rule.points};w=${rule.duration}`;
      const decide = (allowed: boolean, result: RateLimiterRes): RateLimitDecision => ({
        allowed,
        limit: rule.points,
        remaining: result.remainingPoints,
        resetSeconds: Math.ceil(result.msBeforeNext / 1000),
        policy,
      });
      try {
        return decide(true, await limiter.consume(storeKey, 1));
      } catch (rejection) {
        if (rejection instanceof RateLimiterRes) return decide(false, rejection);
        // Never the key: it holds an address. The class is enough to diagnose.
        warn(`store:${name}`, `rate limit store failed for "${name}", letting requests through`);
        return null;
      }
    },

    async destroy() {
      for (const limiter of limiters.values()) {
        // rate-limiter-flexible 11.2.1 has no public way to stop its prune
        // timer; these private fields must be rechecked on any version bump.
        const timed = limiter as unknown as {
          _clearExpiredTimeoutId?: NodeJS.Timeout;
          _clearExpiredHourAgo?: () => void;
        };
        if (timed._clearExpiredTimeoutId) clearTimeout(timed._clearExpiredTimeoutId);
        // A prune already running would schedule the next one on a closed pool.
        if (timed._clearExpiredHourAgo) timed._clearExpiredHourAgo = () => undefined;
      }
      limiters.clear();
      await client?.destroy();
      client = undefined;
    },
  };
}
