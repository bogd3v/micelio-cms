/** `Cache-Control` value for answers a browser or shared cache must not keep. */
export const NO_STORE = 'private, no-store'

/** Paths whose answers are per user or per token, at any method. */
const SENSITIVE_PREFIXES = [
  '/api/auth',
  '/api/users/me',
  // Never public: only an API token may read or write them.
  '/api/site-settings',
  '/api/subscribers',
]

function lowerPath(path: string): string {
  const lower = path.toLowerCase().replace(/\/{2,}/g, '/')
  return lower.length > 1 ? lower.replace(/\/+$/, '') : lower
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function asksForDrafts(query: Record<string, unknown>): boolean {
  const status = query.status
  return (Array.isArray(status) ? status : [status]).some((value) => value === 'draft')
}

/**
 * Whether the answer to a request must carry `Cache-Control: private, no-store`.
 *
 * @remarks
 * True for the auth routes, the current user, the token-only content types
 * (site settings, subscribers) and any content API read with `status=draft`.
 * Public content stays cacheable: the frontend and its CDN rely on it.
 *
 * @param method - The HTTP method.
 * @param path - The request path, as routed.
 * @param query - The parsed query string.
 */
export function needsNoStore(
  method: string,
  path: string,
  query: Record<string, unknown>
): boolean {
  const normalized = lowerPath(path)
  if (SENSITIVE_PREFIXES.some((prefix) => under(normalized, prefix))) return true
  const isRead = method === 'GET' || method === 'HEAD'
  return isRead && under(normalized, '/api') && asksForDrafts(query)
}
