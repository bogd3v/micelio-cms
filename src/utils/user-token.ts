import { createHash } from 'node:crypto';

/**
 * The SHA-256 hex of an emailed token, which is what `up_users` keeps in
 * `confirmationToken` and `resetPasswordToken`: a read of the database
 * cannot be replayed as a link, because a lookup hashes what it receives.
 */
export function hashUserToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
