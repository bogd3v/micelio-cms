/**
 * Env of the rate-limit suites. `config/rate-limit.ts` reads it when Strapi
 * loads, so set it before `setupStrapi()` and restore it in `afterAll`.
 */
const KEYS = [
  'RATE_LIMIT_ENABLED',
  'RATE_LIMIT_STORE',
  'RATE_LIMIT_AUTH',
  'RATE_LIMIT_ADMIN_AUTH',
  'RATE_LIMIT_AUTH_EMAIL',
  'RATE_LIMIT_AUTH_IDENTIFIER',
  'RATE_LIMIT_COMMENTS',
  'RATE_LIMIT_UPLOAD',
  'RATE_LIMIT_FEDIVERSE_INBOX',
  'RATE_LIMIT_API',
  'RATE_LIMIT_TOKEN',
  'RATE_LIMIT_FORWARDER_SECRET',
  'TRUST_PROXY',
  'PROXY_IP_HEADER',
  'TRUST_PROXY_PROTOCOL',
  'FEDIVERSE_ENABLED',
  'FEDIVERSE_ACTOR_IDENTIFIER',
  'FEDIVERSE_ACTOR_USERNAME',
] as const;

const saved: Record<string, string | undefined> = {};

/** Sets `values` (and clears every other rate-limit variable); `restoreRateLimitEnv` undoes it. */
export function setRateLimitEnv(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, values);
}

export function restoreRateLimitEnv(): void {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

/** Distinct client for the test client: loopback is a trusted proxy under `TRUST_PROXY=private`. */
export const asClient = (ip: string) => ({ 'X-Forwarded-For': ip });
