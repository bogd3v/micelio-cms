import type { Core } from '@strapi/strapi';
import { isCommentsApiPath } from '../utils/comments-path';
import { stripPrivateCommentFields } from '../utils/comment-author';

/**
 * Removes the author's email (also on `threadOf`) and the abuse reports from
 * every successful response of the comments plugin's public API
 * (`stripPrivateCommentFields`). Moderators read both in the admin panel,
 * which is not this API.
 */
export default (_config: unknown, _: { strapi: Core.Strapi }) =>
  async (
    ctx: { path: string; status: number; body?: unknown },
    next: () => Promise<unknown>
  ): Promise<void> => {
    await next();
    if (!isCommentsApiPath(ctx.path) || ctx.status >= 300 || ctx.body == null) return;
    ctx.body = stripPrivateCommentFields(ctx.body);
  };
