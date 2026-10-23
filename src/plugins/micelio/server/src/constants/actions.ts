/** UID of the plugin's `category` content type. */
export const CATEGORY_UID = 'plugin::micelio.category'

/** UID of the plugin's `tag` content type. */
export const TAG_UID = 'plugin::micelio.tag'

/**
 * Content API actions a read-only token needs for the plugin's types. The host
 * spreads them into its token lists (`src/migrations/api-tokens.ts`), so the
 * plugin stays the source of truth for its own UIDs.
 */
export const READ_ACTIONS = [`${CATEGORY_UID}.find`, `${TAG_UID}.find`]
