/**
 * site-setting service: reads the default site in the shape of the retired single type.
 */

import { factories } from '@strapi/strapi'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { SITE_SETTING_UID } from '../../../constants/uids'

/** What a site has and the single type never had: not part of the 0.6 answer. */
const SITE_ONLY_ATTRIBUTES = ['slug', 'hosts', 'isDefault', 'editorialPolicy', 'localizations']

/** A site as the Document Service returns it. */
interface SiteDocument {
  id: number
  documentId: string
  [attribute: string]: unknown
}

interface Params {
  filters?: unknown
  [option: string]: unknown
}

export default factories.createCoreService(SITE_SETTING_UID, ({ strapi }) => ({
  /**
   * The default site, read with the caller's `fields`, `populate` and `locale`, without the
   * attributes only a site has; `null` when no site is the default or it has no row in the locale.
   */
  async find(params: object = {}) {
    const query = params as Params
    const sites = strapi.documents(SITE_UID as never) as unknown as {
      findFirst(query: object): Promise<SiteDocument | null>
    }
    const own = { isDefault: true }
    const site = await sites.findFirst({
      ...query,
      filters: query.filters ? { $and: [query.filters, own] } : own,
    })
    if (!site) return null
    for (const name of SITE_ONLY_ATTRIBUTES) delete site[name]
    return site
  },
}))
