import type { SecurityOutcome } from '../types/security-events';

/**
 * Catalogue of security events written by `logSecurityEvent` (issue #180,
 * ASVS V16.3). The names are stable: operators filter and alert on them.
 * Where each one is emitted is listed in `docs/security/logging.md`.
 */
export const SECURITY_EVENTS = {
  /** A sign-in succeeded (reader or admin). */
  authLoginSuccess: 'auth.login.success',
  /** A sign-in failed: unknown account, wrong password or blocked account. */
  authLoginFailure: 'auth.login.failure',
  /** A reader account was registered. */
  authRegister: 'auth.register',
  /** A password reset email was requested. */
  authPasswordResetRequested: 'auth.password-reset.requested',
  /** A password was reset with a valid code. */
  authPasswordResetCompleted: 'auth.password-reset.completed',
  /** An email address was confirmed with a valid token. */
  authEmailConfirmed: 'auth.email-confirmation.confirmed',
  /** A request for draft content was refused. */
  accessDraftRefused: 'access.draft.refused',
  /** The `is-editor` policy refused a request. */
  accessEditorRefused: 'access.editor.refused',
  /** A request was answered 403 for lack of permission. */
  accessForbidden: 'access.forbidden',
  /** The rate limiter rejected a request (429). */
  rateLimitRejected: 'rate-limit.rejected',
  /** A request carried a wrong forwarder secret. */
  rateLimitForwarderSecretInvalid: 'rate-limit.forwarder-secret.invalid',
  /** A fediverse inbox request was refused because its signature did not verify. */
  fediverseInboxSignatureRefused: 'fediverse.inbox.signature-refused',
} as const;

/** A name from {@link SECURITY_EVENTS}. */
export type SecurityEvent = (typeof SECURITY_EVENTS)[keyof typeof SECURITY_EVENTS];

/**
 * Closed set of values for the `reason` field: a free-text reason could carry
 * what the log must not hold, so anything outside this list is dropped.
 */
export const SECURITY_REASONS = [
  'invalid-credentials',
  'unknown-account',
  'blocked-account',
  'invalid-code',
  'invalid-signature',
  'invalid-secret',
  'not-editor',
  'draft-requested',
  'missing-permission',
  'rate-limited',
] as const;

/** Outcome of each event, which also decides the log level (`info` or `warn`). */
export const SECURITY_EVENT_OUTCOMES: Readonly<Record<SecurityEvent, SecurityOutcome>> = {
  'auth.login.success': 'success',
  'auth.login.failure': 'failure',
  'auth.register': 'success',
  'auth.password-reset.requested': 'success',
  'auth.password-reset.completed': 'success',
  'auth.email-confirmation.confirmed': 'success',
  'access.draft.refused': 'failure',
  'access.editor.refused': 'failure',
  'access.forbidden': 'failure',
  'rate-limit.rejected': 'failure',
  'rate-limit.forwarder-secret.invalid': 'failure',
  'fediverse.inbox.signature-refused': 'failure',
};
