import { createHmac } from 'node:crypto';
import { ipBucket } from '../client-ip';

/** HMAC-SHA256 of `value`, hex: what the shared store and the email buckets hold. */
export function hmacKey(secret: Buffer, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * Bucket key of a request in a group: the client (IPv6 by its /64), plus the
 * path where one client may use each route up to the limit (`auth`). The body
 * never takes part, so varying a field can't open a new bucket.
 */
export function groupKey(ip: string, path: string, byPath: boolean): string {
  return byPath ? `${ipBucket(ip)}|${path}` : ipBucket(ip);
}

/**
 * Bucket key of an account: the HMAC of the trimmed, lower-cased email or
 * login identifier, so the store never holds it. A missing or non-string value
 * shares one bucket per client instead of opening one per invalid value.
 */
export function identityKey(secret: Buffer, value: unknown, ip: string): string {
  if (typeof value !== 'string') return `invalid:${hmacKey(secret, ipBucket(ip))}`;
  return hmacKey(secret, value.trim().toLowerCase());
}

/** Bucket key of the `auth-email` group (see {@link identityKey}). */
export const emailKey = identityKey;

/** Bucket key of a content-API token. */
export function tokenKey(id: number | string): string {
  return `token:${id}`;
}
