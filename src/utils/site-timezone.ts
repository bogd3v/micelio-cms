/**
 * Checks `timezone` in the site settings: the schema's regex only checks the
 * shape of an IANA name; whether the zone exists is up to the runtime's tz data.
 */

import { errors } from '@strapi/utils';

/** Rejects a timezone the runtime does not know and normalizes its case. Empty, null or absent is allowed. */
export function assertTimezoneValid(data: Record<string, unknown>): void {
  const timezone = data.timezone;
  if (timezone === undefined || timezone === null || timezone === '') return;

  if (typeof timezone === 'string') {
    try {
      const resolved = new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions()
        .timeZone;
      // Fixes the case ("america/bogota" becomes "America/Bogota"); aliases such as
      // EST5EDT resolve to another zone, so they stay as the editor wrote them.
      if (resolved.toLowerCase() === timezone.toLowerCase()) data.timezone = resolved;
      return;
    } catch {
      // Unknown zone: rejected below.
    }
  }

  const message = `"${String(timezone)}" is not a known IANA timezone`;
  throw new errors.ValidationError(message, {
    errors: [{ path: ['timezone'], message, name: 'ValidationError' }],
  });
}
