import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';

/**
 * Logs each request like `strapi::logger` does, without the query string.
 *
 * @remarks
 * Strapi's logger writes `ctx.url`. Account confirmation and the newsletter
 * lookups carry an email address or a live token in the query, so anyone who
 * reads the logs would collect them. The path is enough to follow a request.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    const start = Date.now();
    await next();
    const delta = Math.ceil(Date.now() - start);
    strapi.log.http(`${ctx.method} ${ctx.path} (${delta} ms) ${ctx.status}`);
  };
