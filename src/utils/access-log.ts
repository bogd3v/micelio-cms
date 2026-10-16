import type { SECURITY_REASONS, SecurityEvent } from '../constants/security-events';
import type { AccessLogContext } from '../types/security-events';
import {
  hashIdentifier,
  logSecurityEvent,
  securityLogSecret,
  type SecurityLogHost,
} from './security-log';

/** Key in `ctx.state` that marks a refusal already written, so the generic 403 log skips it. */
const LOGGED_KEY = 'securityRefusalLogged';

/** Reasons a refusal can carry: the subset of `SECURITY_REASONS` that describes an access refusal. */
type AccessRefusalReason = Extract<
  (typeof SECURITY_REASONS)[number],
  'not-editor' | 'draft-requested'
>;

/**
 * Writes the security event for a refused request and marks the request as
 * logged, so `global::forbidden-log` does not write a second line for it.
 *
 * @remarks
 * Never throws and never changes the response: a logging failure must not
 * turn a 403 into a 500. The actor is the numeric user id when there is one;
 * the client is a keyed hash of the address, left out (the rest is still
 * written) when the app keys are missing. `reason` is left out for a 403 that
 * no specific control classified.
 */
export function logAccessRefusal(
  strapi: SecurityLogHost,
  ctx: AccessLogContext | undefined,
  event: SecurityEvent,
  reason?: AccessRefusalReason
): void {
  let client: string | undefined;
  try {
    const ip = ctx?.request?.ip;
    if (ip) client = hashIdentifier(ip, securityLogSecret(strapi));
  } catch {
    // No app keys: the event is still worth writing, only without the client hash.
  }
  try {
    const id = ctx?.state?.user?.id;
    logSecurityEvent(strapi, event, {
      actor: typeof id === 'number' ? id : undefined,
      client,
      path: ctx?.request?.path,
      reason,
    });
    if (ctx?.state) ctx.state[LOGGED_KEY] = true;
  } catch {
    // Logging is best effort; the refusal itself is already decided.
  }
}

/** Whether {@link logAccessRefusal} already wrote a line for this request. */
export function isRefusalLogged(ctx: AccessLogContext): boolean {
  return ctx.state?.[LOGGED_KEY] === true;
}
