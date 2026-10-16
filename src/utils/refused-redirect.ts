/** The `cause` message undici uses for `redirect: 'error'`; Node 22 and 24 were checked. */
const UNEXPECTED_REDIRECT = 'unexpected redirect';

/**
 * Whether a `fetch` rejection came from `redirect: 'error'` meeting a 3xx.
 *
 * @remarks
 * undici rejects with `TypeError: fetch failed` and puts the reason in `cause`.
 * Outbound calls refuse redirects because undici resends POST bodies and
 * non-`Authorization` headers on 307/308 (ASVS V15.3.2, `docs/security/outbound.md`).
 * The match is exact (`unexpected redirect`) because other messages, such as ENOTFOUND, can
 * contain a hostname with the word. The check is structural, not `instanceof`, because the error can come from another realm.
 */
export function isRefusedRedirect(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return false;
  const message = (cause as { message?: unknown }).message;
  return message === UNEXPECTED_REDIRECT;
}
