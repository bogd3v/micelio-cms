/** Fewest characters (code points) a reader password may have (ASVS V6.2.1). */
export const MIN_PASSWORD_LENGTH = 8

/** Context words shorter than this are ignored, so a short word cannot ban honest passphrases. */
export const MIN_BANNED_WORD_LENGTH = 4

/** Words about the software itself that no password may contain (ASVS V6.1.2). */
export const BUILT_IN_BANNED_WORDS: readonly string[] = ['micelio', 'strapi']
