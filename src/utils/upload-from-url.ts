import { normalizePath } from './rate-limit/groups';

/** Path of the Media Library route that imports files from URLs (the upload plugin's admin API). */
const UPLOAD_FROM_URL_PATH = '/upload/actions/upload-from-urls';

/**
 * Whether the Media Library import-from-URL feature is enabled: only when
 * `UPLOAD_FROM_URL_ENABLED` is exactly `true`. Anything else, unset included,
 * leaves it off.
 *
 * @param value - The raw environment value.
 */
export function isUploadFromUrlEnabled(value: string | undefined): boolean {
  return value === 'true';
}

/**
 * Whether a request is the import-from-URL call: `POST` to the upload plugin's
 * `actions/upload-from-urls` route, in any letter case, with or without a trailing slash.
 */
export function isUploadFromUrlRequest(method: string, path: string): boolean {
  return method.toUpperCase() === 'POST' && normalizePath(path) === UPLOAD_FROM_URL_PATH;
}
