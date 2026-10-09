/**
 * Checks `securityContact` in the site settings. The value becomes the
 * `Contact` field of the public `/.well-known/security.txt` (RFC 9116), so the
 * schema's length limit is not enough: it must be one `mailto:` or `https:` URI.
 */

import { errors } from '@strapi/utils';

// RFC 3986 characters only: no whitespace, control, bidi or other non-ASCII characters.
const URI_CHARACTERS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
// Percent-encoded C0 controls and DEL, which a mail client would decode.
const ENCODED_CONTROL = /%(?:[01][0-9a-f]|7f)/i;
const MAILTO_ADDRESS = /^[^@\s,;%<>]+@[^@\s,;%<>]+\.[^@\s,;%<>]+$/;
const MAILTO_SUBJECT = /^\?subject=[^&]*$/;

function isValidContact(value: string): boolean {
  if (!URI_CHARACTERS.test(value) || ENCODED_CONTROL.test(value)) return false;
  if (value.startsWith('https://')) {
    try {
      const uri = new URL(value);
      return uri.protocol === 'https:' && uri.hostname !== '' && !uri.username && !uri.password;
    } catch {
      return false;
    }
  }
  if (!value.startsWith('mailto:')) return false;
  const [address, ...rest] = value.slice('mailto:'.length).split('?');
  // One address; the only header field allowed is `subject`.
  if (!MAILTO_ADDRESS.test(address)) return false;
  return rest.length === 0 || (rest.length === 1 && MAILTO_SUBJECT.test(`?${rest[0]}`));
}

/**
 * Rejects a security contact that is not a single `mailto:` or `https:` URI on
 * one line, and trims the surrounding whitespace of one that is. Empty, `null`
 * or absent is allowed. The value is public once the frontend serves it.
 */
export function assertSecurityContactValid(data: Record<string, unknown>): void {
  const contact = data.securityContact;
  if (contact === undefined || contact === null || contact === '') return;

  if (typeof contact === 'string') {
    const trimmed = contact.trim();
    if (trimmed === '') {
      data.securityContact = '';
      return;
    }
    if (isValidContact(trimmed)) {
      data.securityContact = trimmed;
      return;
    }
  }

  const message =
    'The security contact must be one mailto: or https: URI on a single line. It is published in /.well-known/security.txt, so do not use a private address';
  throw new errors.ValidationError(message, {
    errors: [{ path: ['securityContact'], message, name: 'ValidationError' }],
  });
}
