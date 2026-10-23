import { createHmac } from 'node:crypto'
import {
  SECURITY_EVENT_OUTCOMES,
  SECURITY_REASONS,
  type SecurityEvent,
} from '../constants/security-events'
import type { SecurityLogHost, SecurityOutcome } from '../types/security-events'
import { appKeySecret } from './app-key-secret'

/** Hex characters kept of a keyed hash: enough to correlate, too short to look up. */
const HASH_LENGTH = 16
/** Longest `path` written. */
const MAX_TEXT = 200
/** Label that makes this key differ from the rate-limit key derived from the same app key. */
const HASH_CONTEXT = 'micelio:security-log:v1'
/** Control and format characters (bidi overrides, zero-width) and the Unicode line and paragraph separators. */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu
const HASH_PATTERN = new RegExp(`^[0-9a-f]{${HASH_LENGTH}}$`)
const USER_ID_PATTERN = /^\d{1,18}$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
/** Redactions applied to a path, in order: emails, IPv4, IPv6, then token-like runs (16+ with a digit). */
const PATH_REDACTIONS: readonly RegExp[] = [
  /[^\s/@]+@[^\s/@]+/g,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
  /(?:[0-9a-f]{0,4}:){2,7}[0-9a-f.]{0,45}/gi,
  /(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}/g,
]
const secrets = new WeakMap<object, Buffer>()

/**
 * Fields of a security event. There is deliberately no field for an address,
 * an email, a token or a password: an identifier that is none of those goes
 * through {@link hashIdentifier} first. Values that do not fit are dropped.
 */
export interface SecurityEventFields {
  /** A server-generated request id (letters, digits, hyphens, up to 64). Never a client-supplied value. */
  requestId?: string
  /** The user's numeric id. Never an email or a username. */
  actor?: number | string
  /** Output of {@link hashIdentifier} for the client (address or account), never the raw value. */
  client?: string
  /** Request path; query string dropped, emails, addresses and token-like runs redacted. */
  path?: string
  /** One of `SECURITY_REASONS`; anything else is dropped. */
  reason?: string
  /** Count of events of this kind left unwritten by a flood limit; a non-negative safe integer, else dropped. */
  suppressed?: number
}

interface SecurityLogMeta {
  event: SecurityEvent
  outcome: SecurityOutcome
  requestId?: string
  actor?: string
  client?: string
  path?: string
  reason?: string
  suppressed?: number
}

/**
 * Truncated HMAC-SHA256 of an identifier, in hex, so a log can correlate
 * lines without holding the identifier.
 *
 * @remarks
 * Keyed, so as long as `APP_KEYS` is secret a leaked log cannot be checked
 * against a list of addresses or emails. The value is trimmed and lower-cased first.
 *
 * @param value - The address, email or other opaque identifier.
 * @param secret - The key; see {@link securityLogSecret}.
 */
export function hashIdentifier(value: string, secret: Buffer | string): string {
  return createHmac('sha256', secret)
    .update(value.trim().toLowerCase())
    .digest('hex')
    .slice(0, HASH_LENGTH)
}

/**
 * Key of the identifier hashes of one instance, derived from the first app key.
 *
 * @throws `Error` naming `APP_KEYS` when the keys are missing or empty.
 */
export function securityLogSecret(strapi: SecurityLogHost): Buffer {
  const cached = secrets.get(strapi)
  if (cached) return cached
  const secret = appKeySecret(strapi, HASH_CONTEXT)
  secrets.set(strapi, secret)
  return secret
}

/**
 * Writes one security event to the Strapi logger: `info` when it succeeded,
 * `warn` when it failed or was refused, with the message `security: <event>`
 * and the fields as metadata.
 *
 * @remarks
 * Takes no address, email, token or password; values that do not fit the
 * field's shape (`actor` a numeric id, `client` a 16-character hex hash,
 * `reason` from `SECURITY_REASONS`) are dropped, not written. See
 * `docs/security/logging.md`.
 */
export function logSecurityEvent(
  strapi: SecurityLogHost,
  event: SecurityEvent,
  fields: SecurityEventFields = {}
): void {
  const meta = buildMeta(event, fields)
  const message = `security: ${event}`
  if (meta.outcome === 'success') strapi.log.info(message, { ...meta })
  else strapi.log.warn(message, { ...meta })
}

function sanitizePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  let text = value.split(/[?#]/, 1)[0] ?? ''
  try {
    text = decodeURIComponent(text)
  } catch {
    // Malformed escapes stay as they are; the redactions below still apply.
  }
  text = text.replace(CONTROL_CHARACTERS, ' ')
  for (const pattern of PATH_REDACTIONS) text = text.replace(pattern, '[redacted]')
  text = text.trim().slice(0, MAX_TEXT)
  return text === '' ? undefined : text
}

function buildMeta(event: SecurityEvent, fields: SecurityEventFields): SecurityLogMeta {
  const meta: SecurityLogMeta = { event, outcome: SECURITY_EVENT_OUTCOMES[event] }
  if (typeof fields.requestId === 'string' && REQUEST_ID_PATTERN.test(fields.requestId)) {
    meta.requestId = fields.requestId
  }
  const actor = String(fields.actor ?? '')
  if (USER_ID_PATTERN.test(actor)) meta.actor = actor
  if (typeof fields.client === 'string' && HASH_PATTERN.test(fields.client)) {
    meta.client = fields.client
  }
  const path = sanitizePath(fields.path)
  if (path) meta.path = path
  const reason = (SECURITY_REASONS as readonly string[]).find((r) => r === fields.reason)
  if (reason) meta.reason = reason
  if (Number.isSafeInteger(fields.suppressed) && (fields.suppressed as number) >= 0) {
    meta.suppressed = fields.suppressed
  }
  return meta
}
