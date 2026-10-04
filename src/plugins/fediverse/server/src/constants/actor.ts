/**
 * Identity of the blog's actor, read from the environment when the plugin
 * loads.
 */

/**
 * The actor's internal identifier: the path segment of every actor URI
 * (`/fediverse/user/<identifier>`). Remote servers key the account and its
 * followers by that URI, so it must never change, and it has no default: a
 * default would silently become the URI of every instance that forgot it.
 */
export const ACTOR_IDENTIFIER = process.env.FEDIVERSE_ACTOR_IDENTIFIER?.trim() ?? '';

/**
 * The `user` of the public handle `@user@domain` (`preferredUsername`).
 * Unlike the identifier it can change: WebFinger maps it to the identifier,
 * so the account keeps its URI and followers.
 */
export const ACTOR_USERNAME = process.env.FEDIVERSE_ACTOR_USERNAME?.trim() ?? '';

/** Usernames WebFinger resolves to the blog: the handle, and the identifier as a former one. */
export const ACTOR_USERNAMES = [...new Set([ACTOR_USERNAME, ACTOR_IDENTIFIER])].filter(Boolean);

/**
 * Stops the boot when the actor's identity is not configured: both variables
 * are required while the plugin is enabled, and the identifier, once
 * federated, can never change.
 */
export function assertActorConfigured(
  identifier: string = ACTOR_IDENTIFIER,
  username: string = ACTOR_USERNAME
): void {
  const missing = [
    ['FEDIVERSE_ACTOR_IDENTIFIER', identifier],
    ['FEDIVERSE_ACTOR_USERNAME', username],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `[fediverse] ${missing.join(' and ')} must be set while FEDIVERSE_ENABLED=true`
    );
  }
}
