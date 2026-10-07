import { posix } from 'node:path';
import {
  ADMIN_API_PREFIXES,
  ADMIN_AUTH_PATHS,
  AUTH_KEY_PATHS,
  AUTH_EMAIL_PATHS,
  EXEMPT_PATHS,
  EXEMPT_PREFIXES,
  MCP_PATH,
} from '../../constants/rate-limit';
import type { RateLimitGroupName } from '../../types/rate-limit';

/**
 * Where a request falls. `exempt` is never limited. `mcp` goes through the
 * `api` group, unless its bearer is an admin token (see api-token.ts).
 */
export type RouteClass =
  | { kind: 'exempt' }
  | {
      kind: 'group';
      group: RateLimitGroupName;
      keyByPath: boolean;
      /** Path family the bucket key uses (auth group); never a client-chosen segment. */
      pathKey: string;
      mcp: boolean;
    };

/**
 * POSIX-normalised, lower-cased path without trailing slashes, so
 * `/API/Auth/Local/` matches the route Strapi's case-insensitive router does.
 */
export function normalizePath(path: unknown): string {
  if (typeof path !== 'string' || path === '') return '/';
  const lower = posix.normalize(path.startsWith('/') ? path : `/${path}`).toLowerCase();
  return lower.replace(/\/+$/, '') || '/';
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const group = (name: RateLimitGroupName, pathKey = '', mcp = false): RouteClass => ({
  kind: 'group',
  group: name,
  keyByPath: pathKey !== '',
  pathKey,
  mcp,
});

/**
 * Bucket path of an auth route: its exact path when known, one family for the
 * OAuth callbacks and `/api/connect/*`, one for any other `/api/auth/*`, so a
 * made-up segment can't open a new bucket.
 */
function authPathKey(path: string): string {
  if ((AUTH_KEY_PATHS as readonly string[]).includes(path)) return path;
  if (under(path, '/api/connect')) return '/api/connect/*';
  if (/^\/api\/auth\/[^/]+\/callback$/.test(path)) return '/api/auth/:provider/callback';
  return '/api/auth/*';
}

/** Group of a request, from its method and its normalised path. */
export function classifyRequest(method: string, path: string): RouteClass {
  const verb = method.toUpperCase();

  if ((EXEMPT_PATHS as readonly string[]).includes(path)) return { kind: 'exempt' };
  if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return { kind: 'exempt' };

  if (ADMIN_API_PREFIXES.some((prefix) => under(path, prefix))) return { kind: 'exempt' };

  if (under(path, '/admin')) {
    if (verb === 'POST' && (ADMIN_AUTH_PATHS as readonly string[]).includes(path)) {
      return group('admin-auth');
    }
    return { kind: 'exempt' };
  }

  if (path === MCP_PATH) return group('api', '', true);

  if (under(path, '/api/auth') || under(path, '/api/connect')) {
    return group('auth', authPathKey(path));
  }
  if (verb === 'DELETE' && path === '/api/users/me') return group('auth', '/api/users/me');

  if (verb !== 'GET' && verb !== 'HEAD' && verb !== 'OPTIONS') {
    if (under(path, '/api/comments')) return group('comments');
    if (under(path, '/api/upload')) return group('upload');
  }

  return group('api');
}

/** Whether the route sends an email to the address in its body. */
export function isAuthEmailRoute(method: string, path: string): boolean {
  return method.toUpperCase() === 'POST' && (AUTH_EMAIL_PATHS as readonly string[]).includes(path);
}
