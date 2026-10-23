/** Port that speaks TLS from the first byte (SMTPS). */
const IMPLICIT_TLS_PORT = 465

/** The TLS options nodemailer needs for an SMTP port. */
export interface SmtpTlsOptions {
  /** Implicit TLS: the connection is encrypted before any SMTP command. */
  secure: boolean
  /** Fail instead of sending in clear when the server does not offer `STARTTLS`. */
  requireTLS: boolean
}

/**
 * TLS options for the SMTP connection.
 *
 * @remarks
 * Port 465 is implicit TLS. Any other port upgrades with `STARTTLS`, which
 * nodemailer skips when the server does not advertise it, so an attacker on
 * the path could strip it; `requireTLS` refuses to continue in that case.
 *
 * @param port - The configured `SMTP_PORT`.
 * @param requireTls - `SMTP_REQUIRE_TLS` as read from the environment; only the exact value `false` (any case) turns the requirement off.
 */
export function smtpTlsOptions(port: number, requireTls: string | undefined): SmtpTlsOptions {
  const secure = port === IMPLICIT_TLS_PORT
  const required = (requireTls ?? 'true').trim().toLowerCase() !== 'false'
  return { secure, requireTLS: required && !secure }
}
