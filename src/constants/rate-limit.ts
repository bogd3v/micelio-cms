import type { RateLimitGroupName } from '../types/rate-limit';

/** Headers the frontend sends so the CMS limits its users, not its one IP. */
export const FORWARDER_SECRET_HEADER = 'x-micelio-forwarder-secret';
export const FORWARDED_IP_HEADER = 'x-micelio-client-ip';

/** `RATE_LIMIT_FORWARDER_SECRET` must be at least this long. */
export const MIN_FORWARDER_SECRET_LENGTH = 32;

/** Forwarded requests of one peer count in a bucket this many times the api limit. */
export const FORWARDER_CEILING_FACTOR = 20;

/** Database lookups of unknown bearers one client may trigger per minute. */
export const TOKEN_LOOKUP_LIMIT = { points: 60, duration: 60 } as const;

/** Table of the database store (src/migrations/rate-limit-table.ts). */
export const RATE_LIMIT_TABLE = 'micelio_rate_limits';

/** Groups whose counters live in the shared store when `RATE_LIMIT_STORE=database`. */
export const SHARED_GROUPS: readonly RateLimitGroupName[] = [
  'auth',
  'auth-identifier',
  'admin-auth',
  'auth-email',
  'comments',
  'upload',
  'fediverse-inbox',
];

/** Paths never limited (compared after normalisation). */
export const EXEMPT_PATHS = ['/_health', '/favicon.ico'] as const;
export const EXEMPT_PREFIXES = ['/uploads/'] as const;

/** Admin routes that take credentials: limited by client IP, the rest of /admin is exempt. */
export const ADMIN_AUTH_PATHS = [
  '/admin/login',
  '/admin/forgot-password',
  '/admin/reset-password',
  '/admin/register-admin',
  '/admin/register',
] as const;

/**
 * Admin-panel API prefixes outside `/admin` (plugins' admin routes), exempt
 * like `/admin`: they need an admin session. From the routes registered with
 * type `admin`; add the prefix of any plugin or `routes({ type: 'admin' })` added later.
 * The content API's own `/api/upload` and `/api/comments` are not these.
 */
export const ADMIN_API_PREFIXES = [
  '/content-manager',
  '/content-type-builder',
  '/upload',
  '/i18n',
  '/users-permissions',
  '/email',
  '/seo',
  '/comments',
  '/article-stats',
] as const;

/** Routes that send an email to the address in the body (group `auth-email`). */
export const AUTH_EMAIL_PATHS = [
  '/api/auth/forgot-password',
  '/api/auth/send-email-confirmation',
  '/api/auth/local/register',
] as const;

/** Login by identifier and password: also limited per account, not only per client. */
export const AUTH_LOCAL_PATH = '/api/auth/local';

/** `/api/auth/*` routes keyed by their exact path; any other one shares one key. */
export const AUTH_KEY_PATHS = [
  '/api/auth/local',
  '/api/auth/local/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/send-email-confirmation',
  '/api/auth/change-password',
  '/api/auth/email-confirmation',
  '/api/auth/refresh',
  '/api/auth/logout',
] as const;

export const MCP_PATH = '/mcp';

export const RATE_LIMIT_MESSAGE = 'Too many requests, please try again later.';
