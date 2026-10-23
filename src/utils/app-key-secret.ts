import { createHmac } from 'node:crypto'

/** The part of Strapi that holds the app keys. */
export interface AppKeyHost {
  config: { get<T = unknown>(path: string): T }
}

/**
 * Derives a 32-byte key for one purpose from the first `APP_KEYS` entry.
 *
 * @param label - Names the purpose, so two purposes never share a key.
 * @throws `Error` naming `APP_KEYS` when the keys are missing, not a list or the first is empty:
 * a key derived from nothing would be public.
 */
export function appKeySecret(strapi: AppKeyHost, label: string): Buffer {
  const keys = strapi.config.get<unknown>('server.app.keys')
  const first = Array.isArray(keys) ? keys[0] : undefined
  if (typeof first !== 'string' || first.trim() === '') {
    throw new Error(`APP_KEYS is missing or empty: cannot derive the key for ${label}`)
  }
  return createHmac('sha256', first).update(label).digest()
}
