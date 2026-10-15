/**
 * Copy of a comments API response without what a reader must not get: the
 * email of any comment's author (also on `threadOf`) and the abuse reports.
 *
 * @remarks
 * The plugin's `blockedAuthorProps` setting is not applied on the public read
 * routes, `autopopulate` hands out `author.email`, and `reports` carries the
 * text of unresolved reports. Walks the shapes the plugin returns: a bare
 * array, a single comment, `{ data: [...] }`, and nested `children` and `threadOf`.
 */
export function stripPrivateCommentFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripPrivateCommentFields(item)) as T;
  if (value == null || typeof value !== 'object') return value;
  const node: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete node.reports;
  const author = node.author;
  if (author != null && typeof author === 'object' && !Array.isArray(author)) {
    const rest: Record<string, unknown> = { ...(author as Record<string, unknown>) };
    delete rest.email;
    node.author = rest;
  }
  for (const key of ['data', 'children', 'threadOf']) {
    if (key in node) node[key] = stripPrivateCommentFields(node[key]);
  }
  return node as T;
}

/**
 * The first key of a `filters` query value that names an author attribute, at
 * any depth (`$and`, `$or` and relations included), or `null` when none does.
 *
 * @param blocked - The attribute names a public query may not filter on.
 */
export function findBlockedFilterKey(
  filters: unknown,
  blocked: ReadonlySet<string>
): string | null {
  if (filters == null || typeof filters !== 'object') return null;
  if (Array.isArray(filters)) {
    for (const item of filters) {
      const found = findBlockedFilterKey(item, blocked);
      if (found) return found;
    }
    return null;
  }
  for (const [key, value] of Object.entries(filters)) {
    if (blocked.has(key)) return key;
    const found = findBlockedFilterKey(value, blocked);
    if (found) return found;
  }
  return null;
}
