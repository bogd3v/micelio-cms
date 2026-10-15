/** Public REST prefix of strapi-plugin-comments. */
export const COMMENTS_API_PREFIX = '/api/comments/';

/**
 * Comment attributes that identify an author. A public list query may not
 * filter on them at any depth: the response hides them, a filter would still
 * confirm them one guess at a time.
 */
export const AUTHOR_FILTER_KEYS: ReadonlySet<string> = new Set([
  'author',
  'authorId',
  'authorName',
  'authorEmail',
  'authorUser',
  'authorAvatar',
]);

/**
 * Query keys that filter a populated relation. A public query may not use them
 * inside `populate`: they would reach the author attributes of the relation.
 */
export const POPULATE_FILTER_KEYS: ReadonlySet<string> = new Set(['filters', 'where']);
