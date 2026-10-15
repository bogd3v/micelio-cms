import type { Core } from '@strapi/strapi';
import { COMMENT_UID } from '../constants/uids';
import { isCommentsApiPath } from '../utils/comments-path';

const HIDDEN_STATUSES = new Set(['PENDING', 'REJECTED']);

function isHidden(value: unknown, hiddenIds: ReadonlySet<number> = new Set()): boolean {
  if (value == null || typeof value !== 'object') return false;
  const { approvalStatus, id } = value as { approvalStatus?: string; id?: unknown };
  return HIDDEN_STATUSES.has(approvalStatus ?? '') || (typeof id === 'number' && hiddenIds.has(id));
}

/**
 * Collects the ids of the comments in a response body: a bare array, a single
 * comment, or `{ data: [...] }`, with nested `children` arrays and `threadOf`
 * parents (an object, or a bare id).
 */
function collectIds(value: unknown, ids: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, ids);
    return;
  }
  if (value == null || typeof value !== 'object') return;
  const node = value as { id?: unknown; data?: unknown; children?: unknown; threadOf?: unknown };
  if (typeof node.id === 'number') ids.add(node.id);
  if (typeof node.threadOf === 'number') ids.add(node.threadOf);
  else if (node.threadOf != null) collectIds(node.threadOf, ids);
  if ('data' in node) collectIds(node.data, ids);
  if ('children' in node) collectIds(node.children, ids);
}

/**
 * Removes hidden comments — and, since they hang off a hidden parent, their
 * whole subtree — from the shapes the comments plugin returns: a bare array
 * (hierarchy), or `{ data: [...] }` (flat / per-author), with nested
 * `children` arrays. A `threadOf` that points to a hidden comment becomes
 * `null`.
 *
 * @param hiddenIds - Ids known to be hidden, for a response whose comments
 * carry no `approvalStatus` (a client can drop it with `omit` or `fields`).
 */
export function pruneHiddenComments<T>(value: T, hiddenIds?: ReadonlySet<number>): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !isHidden(item, hiddenIds))
      .map((item) => pruneHiddenComments(item, hiddenIds)) as T;
  }
  if (value != null && typeof value === 'object') {
    const node: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    if ('data' in node) node.data = pruneHiddenComments(node.data, hiddenIds);
    if ('children' in node) node.children = pruneHiddenComments(node.children, hiddenIds);
    // The parent of a visible reply may itself be hidden: it must not leak through `threadOf`.
    const parent = node.threadOf;
    if (typeof parent === 'number' ? hiddenIds?.has(parent) : isHidden(parent, hiddenIds)) {
      node.threadOf = null;
    }
    return node as T;
  }
  return value;
}

/**
 * The comments plugin's public endpoints return every comment unless the
 * caller filters by `approvalStatus`, and clients don't. Fediverse replies are
 * stored as `PENDING` so a moderator can approve them, so without this they
 * would be public the instant a remote server delivered them.
 *
 * Visibility is read from the database by comment id, not from the response:
 * the plugin accepts `omit` and `fields`, so a caller can drop `approvalStatus`
 * from the body.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (
    ctx: { method: string; path: string; status: number; body?: unknown; notFound: () => void },
    next: () => Promise<unknown>
  ): Promise<void> => {
    await next();

    if (ctx.method !== 'GET' || !isCommentsApiPath(ctx.path)) return;
    if (ctx.status !== 200 || ctx.body == null) return;

    const ids = new Set<number>();
    collectIds(ctx.body, ids);
    const hidden = (await strapi.db.query(COMMENT_UID).findMany({
      select: ['id'],
      where: { id: { $in: [...ids] }, approvalStatus: { $in: [...HIDDEN_STATUSES] } },
    })) as { id: number }[];
    const hiddenIds = new Set(hidden.map((row) => row.id));

    if (isHidden(ctx.body, hiddenIds)) {
      ctx.notFound();
      return;
    }
    ctx.body = pruneHiddenComments(ctx.body, hiddenIds);
  };
