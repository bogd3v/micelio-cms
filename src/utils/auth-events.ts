import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import type { SecurityEvent } from '../constants/security-events';
import {
  hashIdentifier,
  logSecurityEvent,
  securityLogSecret,
  type SecurityEventFields,
} from './security-log';

/** Fields of an authentication event that depend on the outcome, not on the request. */
export type AuthEventFields = Pick<SecurityEventFields, 'actor' | 'reason'>;

/**
 * Writes one authentication security event for a request, with the keyed hash
 * of its client address and its path.
 *
 * @remarks
 * Never throws: a log that cannot be written (for example no `APP_KEYS`) must
 * not change the answer to the person signing in, so the failure is reported
 * once per call without the event's data.
 */
export function logAuthEvent(
  strapi: Core.Strapi,
  ctx: Context,
  event: SecurityEvent,
  fields: AuthEventFields = {}
): void {
  try {
    logSecurityEvent(strapi, event, {
      ...fields,
      client: hashIdentifier(ctx.request.ip, securityLogSecret(strapi)),
      path: ctx.path,
    });
  } catch (error) {
    strapi.log.error(
      `[security-log] could not write ${event}: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }
}

/** The numeric id of `user` in a response body such as `{ user: { id } }` or `{ data: { user: { id } } }`, or `undefined`. */
export function userIdFromBody(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as { user?: unknown; data?: unknown };
  const holder = record.user ?? (record.data as { user?: unknown } | null | undefined)?.user;
  const id = (holder as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'number' && Number.isInteger(id) ? id : undefined;
}
