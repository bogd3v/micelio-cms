// The protection level of every attribute of the content types that hold
// people's data. `docs/security/data.md` explains the levels;
// `tests/data-classification.test.ts` checks this file against the schemas
// Strapi loads and against that document (ASVS V14.2.4).

/** The three protection levels of `docs/security/data.md`. */
type DataLevel = 'restricted' | 'personal' | 'public'

/** Attributes by name, each with its protection level. */
type AttributeLevels = Readonly<Record<string, DataLevel>>

/**
 * Attributes Strapi adds to every content type. They carry no data of their own,
 * so they are not classified.
 */
export const STRAPI_SYSTEM_ATTRIBUTES: readonly string[] = [
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]

/**
 * Level of each attribute, by content type UID (the literals are duplicated on
 * purpose: shared files carry declarations only, no runtime imports, standard
 * section 4), for the types that hold data
 * about people or credentials. Adding an attribute to one of these types without
 * a level here fails `tests/data-classification.test.ts`.
 *
 * @remarks
 * A `restricted` attribute is `private` or sits on a type no role may read; the
 * test fails otherwise. A `restricted` or `personal` attribute must also be named
 * in `docs/security/data.md`.
 */
export const DATA_CLASSIFICATION: Readonly<Record<string, AttributeLevels>> = {
  'plugin::users-permissions.user': {
    username: 'personal',
    email: 'personal',
    provider: 'personal',
    password: 'restricted',
    resetPasswordToken: 'restricted',
    confirmationToken: 'restricted',
    confirmed: 'personal',
    blocked: 'personal',
    role: 'personal',
    resetPasswordIssuedAt: 'personal',
    passwordChangedAt: 'personal',
  },
  'plugin::comments.comment': {
    content: 'personal',
    blocked: 'public',
    blockedThread: 'public',
    blockReason: 'public',
    authorUser: 'personal',
    authorId: 'personal',
    authorName: 'personal',
    authorEmail: 'personal',
    authorAvatar: 'personal',
    isAdminComment: 'public',
    removed: 'public',
    approvalStatus: 'public',
    related: 'public',
    reports: 'personal',
    threadOf: 'public',
    fediverseUri: 'personal',
    fediverseActorHandle: 'personal',
    fediverseNoteUri: 'public',
    fediverseNoteRetracted: 'public',
  },
  'plugin::comments.comment-report': {
    content: 'personal',
    reason: 'personal',
    resolved: 'public',
    related: 'public',
  },
  'api::subscriber.subscriber': {
    email: 'personal',
    confirmationToken: 'restricted',
    unsubscribeToken: 'restricted',
    confirmed: 'personal',
    language: 'personal',
  },
  'plugin::fediverse.follower': {
    actorId: 'personal',
    handle: 'personal',
    name: 'personal',
    inbox: 'personal',
    avatar: 'personal',
    blocked: 'personal',
    unreachableSince: 'personal',
  },
  'plugin::fediverse.interaction': {
    type: 'public',
    actorId: 'personal',
    handle: 'personal',
    articleDocumentId: 'public',
    interactionKey: 'personal',
  },
  'api::article-stat.article-stat': {
    articleDocumentId: 'public',
    articleLocale: 'public',
    views: 'public',
    views30d: 'public',
    syncedAt: 'public',
  },
}
