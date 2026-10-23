import type { Core } from '@strapi/strapi'
import type { Context, Next } from 'koa'
import { SECURITY_EVENTS } from '../constants/security-events'
import { isRefusalLogged, logAccessRefusal } from '../utils/access-log'

/**
 * Logs an `access.forbidden` security event for every request that ends in
 * 403 without a more specific refusal line (ASVS V16.3.2).
 *
 * @remarks
 * Sits just inside `global::request-logger` and outside `strapi::errors`, so
 * it sees the final status. Content API, admin panel and admin API routes are
 * all covered, whatever the API prefix. Not sampled or throttled: each refusal
 * is one line. It only reads: the response is never changed. See
 * `docs/security/logging.md`.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    await next()
    if (ctx.status !== 403 || isRefusalLogged(ctx)) return
    logAccessRefusal(strapi, ctx, SECURITY_EVENTS.accessForbidden)
  }
