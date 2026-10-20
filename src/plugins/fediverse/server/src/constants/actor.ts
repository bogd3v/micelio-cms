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
 * The `user` of the public handle `@user@domain`, from the environment.
 *
 * @deprecated Use the site settings' `fediverse.username`; this variable is only its fallback
 * until #307 removes it.
 *
 * @remarks
 * Unlike the identifier it can change: WebFinger maps it to the identifier,
 * so the account keeps its URI and followers.
 */
export const ACTOR_USERNAME = process.env.FEDIVERSE_ACTOR_USERNAME?.trim() ?? '';

/**
 * Stops the boot when the actor's identifier is not configured: it is
 * required while the plugin is enabled and, once federated, can never change.
 * The username is not: without a setting or variable the handle is the
 * identifier.
 */
export function assertActorConfigured(identifier: string = ACTOR_IDENTIFIER): void {
  if (!identifier) {
    throw new Error(
      '[fediverse] FEDIVERSE_ACTOR_IDENTIFIER must be set while FEDIVERSE_ENABLED=true'
    );
  }
}
