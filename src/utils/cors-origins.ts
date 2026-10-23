import { DEV_FRONTEND_URL } from './frontend-url'

/**
 * The browser origins allowed by CORS (`strapi::cors`).
 *
 * @remarks
 * `CORS_ORIGINS` wins when set. Otherwise only the frontend's origin
 * (`FRONTEND_URL`) is allowed, so an instance that never set the variable no
 * longer lets any page call the API with credentials. Outside production
 * an unset `FRONTEND_URL` means the local dev frontend; in production it
 * means no origin at all (the boot stops on the missing `FRONTEND_URL` anyway).
 *
 * @param configured - The parsed `CORS_ORIGINS`, empty or `undefined` when unset.
 * @param frontendUrl - `FRONTEND_URL`.
 */
export function corsOrigins(
  configured: readonly string[] | undefined,
  frontendUrl: string | undefined
): string[] {
  const listed = (configured ?? []).map((origin) => origin.trim()).filter(Boolean)
  if (listed.length > 0) return listed
  const value =
    frontendUrl?.trim() || (process.env.NODE_ENV === 'production' ? '' : DEV_FRONTEND_URL)
  try {
    const { origin } = new URL(value)
    return origin === 'null' ? [] : [origin]
  } catch {
    return []
  }
}

/**
 * Whether the browser may send cookies and `Authorization` with a cross-origin
 * call: only to origins that are listed, never to a wildcard that reflects any page.
 */
export function corsAllowsCredentials(origins: readonly string[]): boolean {
  return origins.length > 0 && !origins.includes('*')
}
