import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context } from 'koa';
import { FORWARDED_IP_HEADER, FORWARDER_SECRET_HEADER } from '../../constants/rate-limit';
import { normalizeIp } from '../client-ip';
import type { Forwarded } from './types';

const digest = (value: string) => createHash('sha256').update(value).digest();

export interface Forwarder {
  /** `useClient`: whether this path may take the forwarded address (only `/api/*`). */
  apply(
    ctx: Context,
    resolved: string,
    warn: (key: string, message: string) => void,
    useClient?: boolean
  ): Forwarded;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null;
}

/**
 * The frontend calls the CMS from one address, so a limit on it would throttle
 * every user together. With `RATE_LIMIT_FORWARDER_SECRET` set, a request that
 * carries the same secret in `X-Micelio-Forwarder-Secret` may name the real
 * client in `X-Micelio-Client-IP`. Both headers are removed from the request
 * whatever happens, so nothing downstream sees them, and neither value is ever
 * logged. The secret is compared as hashes with `timingSafeEqual`.
 */
export function createForwarder(secret: string): Forwarder {
  const expected = secret ? digest(secret) : null;

  return {
    apply(ctx, resolved, warn, useClient = true) {
      const headers = ctx.req.headers;
      const provided = headerValue(headers[FORWARDER_SECRET_HEADER]);
      const claimed = headerValue(headers[FORWARDED_IP_HEADER]);
      delete headers[FORWARDER_SECRET_HEADER];
      delete headers[FORWARDED_IP_HEADER];

      const plain = { forwarded: false, clientSupplied: false, ip: resolved };
      if (!expected || provided === null || !useClient) return plain;
      if (!timingSafeEqual(digest(provided), expected)) {
        warn('forwarder-secret', 'a request sent a wrong forwarder secret, ignoring it');
        return plain;
      }
      if (claimed === null) return { ...plain, forwarded: true };
      const ip = normalizeIp(claimed);
      if (!ip) {
        warn('forwarder-ip', 'the forwarder sent an invalid client address, using the peer');
        return { ...plain, forwarded: true };
      }
      return { forwarded: true, clientSupplied: true, ip };
    },
  };
}
