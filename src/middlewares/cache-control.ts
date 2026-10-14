import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { NO_STORE, needsNoStore } from '../utils/cache-control';

/**
 * Keeps per-user and token-only answers out of browser and shared caches
 * (`needsNoStore`). Sets the header after the route answered, and leaves one
 * the route set itself alone, including on an answer that is an error.
 */
export default (_config: unknown, _: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    try {
      await next();
    } finally {
      // Also when a route throws: `strapi::errors`, further out, turns it into the answer.
      if (!ctx.response.get('Cache-Control') && needsNoStore(ctx.method, ctx.path, ctx.query)) {
        ctx.set('Cache-Control', NO_STORE);
      }
    }
  };
