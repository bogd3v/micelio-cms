import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import type { Context, Next } from 'koa';
import { populateDepth } from '../utils/populate-depth';
import { normalizePath } from '../utils/rate-limit/groups';

/** Relation levels a content API request may populate when `POPULATE_MAX_DEPTH` is unset. */
const DEFAULT_MAX_DEPTH = 3;

/**
 * Answers 400 to a content API request whose `populate` nests deeper than
 * `maxDepth` levels (`POPULATE_MAX_DEPTH`, default 3).
 *
 * @remarks
 * Articles, categories and tags relate back to each other, so a deeply nested
 * populate fans out into many joined queries and a very large response, from a
 * single request that stays under the rate limit. Strapi has no depth limit.
 * The frontend asks for 3 levels at most (`sections`, `items`, `icon`).
 */
export default (config: { maxDepth?: number } | undefined, _: { strapi: Core.Strapi }) => {
  const maxDepth = config?.maxDepth ?? DEFAULT_MAX_DEPTH;
  return async (ctx: Context, next: Next): Promise<void> => {
    if (normalizePath(ctx.path).startsWith('/api/')) {
      const depth = populateDepth((ctx.query as Record<string, unknown>).populate);
      if (depth > maxDepth) {
        throw new errors.ValidationError(
          `populate is nested ${depth} levels deep; the limit is ${maxDepth}`
        );
      }
    }
    return next();
  };
};
