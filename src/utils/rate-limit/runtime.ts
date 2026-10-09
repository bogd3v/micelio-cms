import { createHmac } from 'node:crypto';
import type { Core } from '@strapi/strapi';
import { MIN_FORWARDER_SECRET_LENGTH } from '../../constants/rate-limit';
import type { RateLimitConfig, TrustProxy } from '../../types/rate-limit';
import { parseTrustProxy } from '../client-ip';
import { createTokenResolver } from './api-token';
import { createForwarder } from './forwarder';
import { createRequestGuard } from './guard';
import { createLimiters } from './stores';
import type { ClientIpSettings, RateLimitRuntime } from './types';

const runtimes = new WeakMap<Core.Strapi, RateLimitRuntime>();
const clientIpSettings = new WeakMap<Core.Strapi, ClientIpSettings>();

/** Minimum time between two equal warnings. */
const WARN_EVERY_MS = 60_000;

/**
 * The runtime of an instance with rate limiting on; undefined when it is off,
 * and the middlewares then pass every request through.
 */
export function getRateLimitRuntime(strapi: Core.Strapi): RateLimitRuntime | undefined {
  return runtimes.get(strapi);
}

/**
 * How to read the client address, set up on register whether or not rate
 * limiting is on (`ctx.request.ip` is fixed for the admin and users-permissions
 * limiters too).
 */
export function getClientIpSettings(strapi: Core.Strapi): ClientIpSettings | undefined {
  return clientIpSettings.get(strapi);
}

/** Stops the boot on a setting that would leave the limiter unsafe or inert. */
export function assertRateLimitConfig(config: RateLimitConfig): TrustProxy {
  const secret = config.forwarderSecret;
  if (secret && secret.length < MIN_FORWARDER_SECRET_LENGTH) {
    throw new Error(
      `RATE_LIMIT_FORWARDER_SECRET must be at least ${MIN_FORWARDER_SECRET_LENGTH} characters`
    );
  }
  return parseTrustProxy(config.trustProxy);
}

/**
 * Builds the runtime when `RATE_LIMIT_ENABLED` is on and hands the fediverse
 * plugin its guard (`plugin::fediverse.requestGuard`). Throws on an invalid
 * `TRUST_PROXY` or forwarder secret.
 */
export function registerRateLimit(strapi: Core.Strapi): void {
  const config = strapi.config.get<RateLimitConfig>('rate-limit');
  if (!config) return;
  const trustSetting = config.trustProxy || 'private';

  const lastWarned = new Map<string, number>();
  const warn = (key: string, message: string) => {
    const now = Date.now();
    if (now - (lastWarned.get(key) ?? 0) < WARN_EVERY_MS) return;
    lastWarned.set(key, now);
    strapi.log.warn(`[rate-limit] ${message}`);
  };

  if (!config.enabled) {
    const trust = parseTrustProxy(config.trustProxy);
    clientIpSettings.set(strapi, { trust, header: config.proxyIpHeader, warn });
    strapi.log.info(`[rate-limit] off: client address from TRUST_PROXY=${trustSetting}`);
    return;
  }
  const trust = assertRateLimitConfig(config);

  // Derived from the first APP_KEY, which is required and shared by every
  // instance of a deployment. Rotating it only resets the counters.
  const appKey = String(strapi.config.get<string[]>('server.app.keys')[0]);
  const secret = createHmac('sha256', appKey).update('micelio:rate-limit:v1').digest();

  const runtime: RateLimitRuntime = {
    config,
    trust,
    header: config.proxyIpHeader,
    secret,
    limiters: createLimiters(strapi, config, secret, warn),
    tokens: createTokenResolver(strapi),
    forwarder: createForwarder(config.forwarderSecret),
    warn,
  };
  runtimes.set(strapi, runtime);
  clientIpSettings.set(strapi, runtime);
  strapi.config.set('plugin::fediverse.requestGuard', createRequestGuard(runtime));
  strapi.log.info(`[rate-limit] on: ${config.store} store, TRUST_PROXY=${trustSetting}`);
}

/** Closes the database store's connection pool. */
export async function destroyRateLimit(strapi: Core.Strapi): Promise<void> {
  const runtime = runtimes.get(strapi);
  runtimes.delete(strapi);
  clientIpSettings.delete(strapi);
  await runtime?.limiters.destroy();
}
