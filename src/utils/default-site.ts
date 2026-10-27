import type { Core } from '@strapi/strapi'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'

/** A relation value that names one site by the id of its row. */
export interface SiteRelation {
  id: number
}

/**
 * The relation to the default site, for the `site` of a category or tag created outside a request.
 *
 * @remarks
 * Category and tag belong to a site (ADR-0017, section 4), and a boot migration, a script or a test
 * has no request to take it from. The core creates the default site in its own `bootstrap`, which
 * runs before the host's, so after that it exists on any instance. The relation names the row by
 * `id`, not by `documentId`: the `site` type is localised, and a `documentId` is looked up in the
 * locale of the entry being created, which fails when the default site has no row in that locale.
 *
 * @throws `Error` when no site has `isDefault`: the entry could not be created.
 */
export async function defaultSiteRelation(strapi: Core.Strapi): Promise<SiteRelation> {
  const site = (await strapi.db.query(SITE_UID).findOne({
    where: { isDefault: true },
    select: ['id'],
  })) as { id: number } | null
  if (!site) throw new Error('There is no default site: the core plugin creates it at boot')
  return { id: site.id }
}
