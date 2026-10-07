import type { Core } from '@strapi/strapi';
import type { RateLimitConfig } from '../src/types/rate-limit';
import { AUTH_DEFAULT, parseRule as rule, rateLimitEnabled } from '../src/utils/rate-limit/rule';

/**
 * Application-level rate limiting (docs/RATE_LIMITING.md). Parsed and checked
 * on boot by `registerRateLimit` (src/utils/rate-limit/runtime.ts): this file
 * only reads the env.
 */
const config = ({ env }: Core.Config.Shared.ConfigParams): RateLimitConfig => ({
  // Off under `NODE_ENV=test` so suites don't trip over it; they turn it on.
  enabled: rateLimitEnabled(env),
  store: env('RATE_LIMIT_STORE', 'memory') === 'database' ? 'database' : 'memory',
  // `private`, `false`, a number of proxy hops or a comma separated CIDR list.
  trustProxy: env('TRUST_PROXY', 'private'),
  proxyIpHeader: env('PROXY_IP_HEADER', 'X-Forwarded-For'),
  forwarderSecret: env('RATE_LIMIT_FORWARDER_SECRET', ''),
  groups: {
    auth: rule(env('RATE_LIMIT_AUTH'), AUTH_DEFAULT),
    // Sign-in attempts per account (identifier), whatever the client
    'auth-identifier': rule(env('RATE_LIMIT_AUTH_IDENTIFIER'), { points: 10, duration: 900 }),
    'admin-auth': rule(env('RATE_LIMIT_ADMIN_AUTH'), { points: 20, duration: 300 }),
    'auth-email': rule(env('RATE_LIMIT_AUTH_EMAIL'), { points: 5, duration: 3600 }),
    comments: rule(env('RATE_LIMIT_COMMENTS'), { points: 10, duration: 600 }),
    upload: rule(env('RATE_LIMIT_UPLOAD'), { points: 30, duration: 600 }),
    'fediverse-inbox': rule(env('RATE_LIMIT_FEDIVERSE_INBOX'), { points: 60, duration: 60 }),
    api: rule(env('RATE_LIMIT_API'), { points: 600, duration: 60 }),
  },
  token: rule(env('RATE_LIMIT_TOKEN'), { points: 6000, duration: 60 }),
});

export default config;
