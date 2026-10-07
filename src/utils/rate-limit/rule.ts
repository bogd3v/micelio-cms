import type { Core } from '@strapi/strapi';
import type { RateLimitRule } from '../../types/rate-limit';

/**
 * Parses a `points/seconds` setting such as `10/60`. `0` (or `0/…`) turns the
 * group off; an unset or unparsable value keeps the default, so a typo never
 * leaves a route unprotected.
 */
export function parseRule(
  value: string | undefined,
  fallback: RateLimitRule
): RateLimitRule | null {
  const text = value?.trim();
  if (!text) return fallback;
  const match = /^(\d+)\s*(?:\/\s*(\d+))?$/.exec(text);
  if (!match) return fallback;
  const points = Number(match[1]);
  if (points === 0) return null;
  const duration = match[2] === undefined ? fallback.duration : Number(match[2]);
  return duration > 0 ? { points, duration } : fallback;
}

type Env = Core.Config.Shared.ConfigParams['env'];

/** Default of the `auth` group, also what decides whether it replaces the plugin's limiter. */
export const AUTH_DEFAULT: RateLimitRule = { points: 10, duration: 60 };

/** `RATE_LIMIT_ENABLED`: on, except under `NODE_ENV=test`. */
export function rateLimitEnabled(env: Env): boolean {
  return env.bool('RATE_LIMIT_ENABLED', process.env.NODE_ENV !== 'test');
}

/** Whether our limiter covers the auth routes (so the plugin's can be turned off). */
export function limitsAuth(env: Env): boolean {
  return rateLimitEnabled(env) && parseRule(env('RATE_LIMIT_AUTH'), AUTH_DEFAULT) !== null;
}
