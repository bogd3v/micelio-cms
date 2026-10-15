import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import type { Context, Next } from 'koa';
import { AUTHOR_FILTER_KEYS, POPULATE_FILTER_KEYS } from '../constants/comments';
import { findBlockedFilterKey } from '../utils/comment-author';
import { isCommentsApiPath } from '../utils/comments-path';

/**
 * Answers 400 to a request to the comments plugin's public API whose `filters`
 * name an author attribute (`AUTHOR_FILTER_KEYS`) at any depth. The response
 * hides those attributes, and a filter would otherwise confirm them by
 * matching. A `filters` or `where` key anywhere inside `populate` is refused
 * too, since the plugin applies it to the populated author relation. Requests
 * without either pass unchanged.
 */
export default (_config: unknown, _: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    if (isCommentsApiPath(ctx.path)) {
      const query = ctx.query as Record<string, unknown>;
      const key =
        findBlockedFilterKey(query.filters, AUTHOR_FILTER_KEYS) ??
        findBlockedFilterKey(query.populate, POPULATE_FILTER_KEYS);
      if (key) throw new errors.ValidationError(`"${key}" is not allowed in this query`);
    }
    return next();
  };
