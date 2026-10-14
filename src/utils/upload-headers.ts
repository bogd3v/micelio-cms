/** Policy for an upload opened as a page: no script runs, nothing loads, the origin is opaque. */
const SANDBOX_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; sandbox";

/** Types a browser shows inline without running anything of the file's own. */
const PASSIVE_TYPE = /^(image\/(?!svg)|video\/|audio\/|application\/pdf$)/i;

/**
 * Headers for a file served from `/uploads`, by its content type.
 *
 * @remarks
 * The local provider serves uploads from the admin origin, so a scripted
 * file (HTML, SVG) opened directly would run there with the admin's session.
 * Every upload gets `nosniff`. Anything but a plain image, video, audio or PDF
 * also gets a sandbox policy and `Content-Disposition: attachment`; as an
 * `<img>` or `<video>` an upload renders as usual.
 *
 * @param contentType - The `Content-Type` of the response, `undefined` when it has none.
 */
export function uploadResponseHeaders(contentType: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  if (contentType && PASSIVE_TYPE.test(contentType.trim())) return headers;
  return {
    ...headers,
    'Content-Security-Policy': SANDBOX_POLICY,
    'Content-Disposition': 'attachment',
  };
}
