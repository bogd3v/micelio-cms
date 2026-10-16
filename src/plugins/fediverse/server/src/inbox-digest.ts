/**
 * The `Digest` header check of inbox deliveries (ASVS V11.4.1, V11.4.3).
 *
 * Fedify 2.4.2 verifies a draft-cavage `Digest` header with SHA-1 (`SHA=`) as
 * readily as with SHA-256 and has no option to turn SHA-1 off, so the inbox
 * middleware runs this check before handing the request to Fedify. See
 * `docs/FEDIVERSE.md`, "Inbox digest algorithms".
 */

/** One `algorithm=value` entry of a `Digest` header (RFC 3230). */
export interface DigestEntry {
  /** The algorithm name, lower case (`sha-256`). */
  algorithm: string;
  /** The encoded digest as sent, trimmed; empty when the entry has none. */
  value: string;
}

/** Algorithms an inbox delivery's `Digest` may use, lower case. */
const APPROVED_ALGORITHMS: ReadonlySet<string> = new Set(['sha-256', 'sha-512']);

/**
 * Splits a `Digest` header into its entries.
 *
 * @remarks
 * Entries are separated by commas; each splits at its first `=`, so base64
 * padding stays in the value. Empty entries (`a=1,,b=2`) are skipped.
 *
 * @internal
 */
export function parseDigestHeader(header: string): DigestEntry[] {
  const entries: DigestEntry[] = [];
  for (const part of header.split(',')) {
    const entry = part.trim();
    if (entry === '') continue;
    const separator = entry.indexOf('=');
    entries.push(
      separator < 0
        ? { algorithm: entry.toLowerCase(), value: '' }
        : {
            algorithm: entry.slice(0, separator).trim().toLowerCase(),
            value: entry.slice(separator + 1).trim(),
          }
    );
  }
  return entries;
}

/**
 * Whether an inbox delivery's `Digest` header names an approved algorithm: at
 * least one SHA-256 or SHA-512 entry with a value.
 *
 * @remarks
 * Other entries next to an approved one (`SHA=…`, unknown algorithms) are
 * allowed: Fedify requires every entry it knows to match the body, so a SHA-1
 * entry can only add a check, never replace the SHA-256 or SHA-512 one. An
 * empty header, or one with only other algorithms (SHA-1, MD5), is refused.
 * Checks the algorithms only: whether the digest matches the body, and whether
 * the header is signed, is left to Fedify's signature verification.
 */
export function isInboxDigestAccepted(header: string): boolean {
  return parseDigestHeader(header).some(
    (entry) => APPROVED_ALGORITHMS.has(entry.algorithm) && entry.value !== ''
  );
}
