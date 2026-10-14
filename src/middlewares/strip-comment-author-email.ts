import type { Core } from '@strapi/strapi';
import { isCommentsApiPath } from '../utils/comments-path';
import { stripAuthorEmails } from '../utils/comment-author';

/**
 * Removes the author's email from every response of the comments plugin's
 * public API (`stripAuthorEmails`). Moderators read emails in the admin panel,
 * which is not this API.
 */
export default (_config: unknown, _: { strapi: Core.Strapi }) =>
  async (
    ctx: { path: string; status: number; body?: unknown },
    next: () => Promise<unknown>
  ): Promise<void> => {
    await next();
    if (!isCommentsApiPath(ctx.path) || ctx.status >= 300 || ctx.body == null) return;
    ctx.body = stripAuthorEmails(ctx.body);
  };
