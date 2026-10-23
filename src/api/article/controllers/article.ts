/**
 *  article controller
 */

import { factories } from '@strapi/strapi'
import { ARTICLE_UID } from '../../../constants/uids'
import { configuredLocales } from '../../../utils/author-locales'
import { SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from '../services/article'

const TRUE_VALUES = new Set(['1', 'true', 'yes'])

export default factories.createCoreController(ARTICLE_UID, ({ strapi }) => ({
  /** GET /api/articles/search?q=…&locale=…&content=1&limit=… */
  async search(ctx) {
    const { q, locale, content, limit } = ctx.query as Record<string, string | undefined>
    const query = typeof q === 'string' ? q.trim() : ''
    if (query.length < SEARCH_MIN_LENGTH) {
      return ctx.badRequest(`q must be at least ${SEARCH_MIN_LENGTH} characters long`)
    }

    if (query.length > SEARCH_MAX_LENGTH) {
      return ctx.badRequest(`q must be at most ${SEARCH_MAX_LENGTH} characters long`)
    }
    const localeCode = typeof locale === 'string' && locale ? locale : undefined
    if (localeCode && !(await configuredLocales(strapi)).includes(localeCode)) {
      return ctx.badRequest('locale is not a configured locale')
    }

    const data = await strapi.service(ARTICLE_UID).search({
      query,
      locale: localeCode,
      content: typeof content === 'string' && TRUE_VALUES.has(content.toLowerCase()),
      limit: Number.parseInt(String(limit ?? ''), 10) || SEARCH_DEFAULT_LIMIT,
    })
    return { data, meta: { query, count: data.length } }
  },

  /** GET /api/articles/drafts?locale=… (editors only, see routes/03-drafts.ts) */
  async drafts(ctx) {
    const { locale } = ctx.query as Record<string, string | undefined>
    const data = await strapi.service(ARTICLE_UID).drafts({
      locale: typeof locale === 'string' && locale ? locale : undefined,
    })
    ctx.set('Cache-Control', 'private, no-store')
    return { data, meta: { count: data.length } }
  },
}))
