import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import type { Context, Next } from 'koa';
import { filtersDepth, populateDepth, sortDepth } from '../utils/populate-depth';
import { normalizePath } from '../utils/rate-limit/groups';

/** Relation levels a content API request may nest in `populate`, `filters` or `sort` when `POPULATE_MAX_DEPTH` is unset. */
const DEFAULT_MAX_DEPTH = 3;

/** Query parameters bounded by the limit, with how each one counts its levels. */
const BOUNDED_PARAMS: Record<string, (value: unknown) => number> = {
  populate: populateDepth,
  filters: filtersDepth,
  sort: sortDepth,
};

/**
 * Answers 400 to a content API request whose `populate`, `filters` or `sort`
 * nests deeper than `maxDepth` levels (`POPULATE_MAX_DEPTH`, default 3).
 *
 * @remarks
 * Articles, categories and tags relate back to each other, so a deeply nested
 * query fans out into many joined queries (and, for `populate`, a very large
 * response) from a single request that stays under the rate limit. Strapi has
 * no depth limit. The frontend asks for 3 levels at most (`sections`, `items`,
 * `icon`); its deepest filter is `category.slug.$eq`, 2 levels.
 */
export default (config: { maxDepth?: number } | undefined, _: { strapi: Core.Strapi }) => {
  const maxDepth = config?.maxDepth ?? DEFAULT_MAX_DEPTH;
  return async (ctx: Context, next: Next): Promise<void> => {
    if (normalizePath(ctx.path).startsWith('/api/')) {
      const query = ctx.query as Record<string, unknown>;
      for (const [param, depthOf] of Object.entries(BOUNDED_PARAMS)) {
        const depth = depthOf(query[param]);
        if (depth > maxDepth) {
          throw new errors.ValidationError(
            `${param} is nested ${depth} levels deep; the limit is ${maxDepth}`
          );
        }
      }
    }
    return next();
  };
};
