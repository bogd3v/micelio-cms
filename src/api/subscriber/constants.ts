/** Subscriber attributes `POST /api/subscribers/lookup` can match on. */
export const LOOKUP_FIELDS = ['email', 'confirmationToken', 'unsubscribeToken'] as const

/** Longest `value` the lookup accepts: a valid email address (RFC 5321) is the longest thing it matches. */
export const LOOKUP_MAX_LENGTH = 254
