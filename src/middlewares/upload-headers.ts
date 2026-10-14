import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { normalizePath } from '../utils/rate-limit/groups';
import { uploadResponseHeaders } from '../utils/upload-headers';

/**
 * Makes files served from `/uploads` inert when opened as a page
 * (`uploadResponseHeaders`). Sets the headers after the route answered, so they
 * replace the CSP of `strapi::security`, which allows inline scripts.
 */
export default (_config: unknown, _: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    await next();
    if (!normalizePath(ctx.path).startsWith('/uploads/')) return;
    if (ctx.status >= 300 && ctx.status !== 304) return;
    const headers = uploadResponseHeaders(ctx.response.get('Content-Type') || undefined);
    for (const [name, value] of Object.entries(headers)) ctx.set(name, value);
  };
