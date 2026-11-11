/**
 * site-setting controller: answers `GET /api/site-setting` from the default site.
 */

import { factories } from '@strapi/strapi'
import type { Context } from 'koa'
import { SITE_SETTING_UID } from '../../../constants/uids'

/** The helpers `createCoreController` gives every controller, which its typing leaves optional. */
interface CoreHelpers {
  validateQuery(ctx: Context): Promise<void>
  sanitizeQuery(ctx: Context): Promise<Record<string, unknown>>
  sanitizeOutput(entity: unknown, ctx: Context): Promise<unknown>
  transformResponse(entity: unknown): unknown
}

export default factories.createCoreController(SITE_SETTING_UID, ({ strapi }) => ({
  /**
   * The settings of the default site in the shape the single type answered in 0.6: the same
   * fields, the same `populate`, `fields` and `locale`, and the same sanitizing of relations and
   * private fields. The attributes a site adds (`slug`, `hosts`, `isDefault`, `editorialPolicy`) are
   * left out, so the content API the frontend reads does not change (standard, section 6).
   */
  async find(ctx: Context) {
    const core = this as unknown as CoreHelpers
    await core.validateQuery(ctx)
    const query = await core.sanitizeQuery(ctx)
    const entity = await strapi.service(SITE_SETTING_UID).find(query)
    if (!entity) return ctx.notFound('Not Found')
    const sanitized = await core.sanitizeOutput(entity, ctx)
    return core.transformResponse(sanitized)
  },
}))
