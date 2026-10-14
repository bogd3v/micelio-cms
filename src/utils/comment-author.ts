/**
 * Copy of a comments API response without the email of any comment's author.
 *
 * @remarks
 * The plugin's `blockedAuthorProps` setting is not applied on the public read
 * routes, and `autopopulate` hands out `author.email`, so a role allowed to
 * read comments would get every commenter's address. Walks the shapes the
 * plugin returns: a bare array, a single comment, `{ data: [...] }`, and nested `children`.
 */
export function stripAuthorEmails<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripAuthorEmails(item)) as T;
  if (value == null || typeof value !== 'object') return value;
  const node: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  const author = node.author;
  if (author != null && typeof author === 'object' && !Array.isArray(author)) {
    const rest: Record<string, unknown> = { ...(author as Record<string, unknown>) };
    delete rest.email;
    node.author = rest;
  }
  if ('data' in node) node.data = stripAuthorEmails(node.data);
  if ('children' in node) node.children = stripAuthorEmails(node.children);
  return node as T;
}
