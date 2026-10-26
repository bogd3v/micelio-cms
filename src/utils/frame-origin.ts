/** A hostname of letters, digits, dots and hyphens, or a bracketed IPv6 address. */
const SAFE_HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])$/i

/**
 * The origin the admin may frame for the preview: that of the frontend (`FRONTEND_URL`).
 *
 * @remarks
 * Scheme, host and port; the path, query and credentials are dropped. It answers
 * `null` when the value is unset or blank, is not an `http(s)` URL, or has a host
 * with anything but letters, digits, dots and hyphens (or an IPv6 address): the
 * URL parser accepts `*` and `;` in a host, and either would widen or split the
 * `frame-src` directive it ends up in. An IPv6 address passes but is inert: the CSP
 * source grammar has no IPv6 literal, so a browser drops that source.
 *
 * @param frontendUrl - `FRONTEND_URL`.
 */
export function frontendFrameOrigin(frontendUrl: string | undefined): string | null {
  const value = frontendUrl?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!SAFE_HOST.test(url.hostname)) return null
    return url.origin
  } catch {
    return null
  }
}
