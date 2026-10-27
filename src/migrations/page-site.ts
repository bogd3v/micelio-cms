import type { Core } from '@strapi/strapi'
import { defaultSiteRelation } from '../utils/default-site'

const PAGE_UID = 'api::page.page'

interface PageRow {
  id: number
  updatedAt: string
  site?: { id: number } | null
}

/**
 * Gives every page with no site the default site (#373), once the page belongs to a site
 * (`withSiteScope`, ADR-0017 section 4).
 *
 * @remarks
 * A page stored before the relation existed has no site, and the content API of a site-scoped type
 * serves only the rows of the request's site, so none would be served. Covers every locale and both
 * the draft and the published row. Writes through the database layer, so no publish event fires and
 * the rebuild hook stays quiet, and puts `updatedAt` back: the admin shows a draft as modified when
 * it is newer than the published row. Idempotent: a page with a site is never touched. Runs in
 * `bootstrap`, before anything reads pages through the content API.
 *
 * @returns How many rows were given the default site.
 * @throws `Error` when there are pages to migrate and no default site: the core creates it at boot.
 */
export async function assignPagesToDefaultSite(strapi: Core.Strapi): Promise<number> {
  const query = strapi.db.query(PAGE_UID)
  const rows = (await query.findMany({
    select: ['id', 'updatedAt'],
    populate: { site: { select: ['id'] } },
  })) as PageRow[]
  const orphans = rows.filter((row) => !row.site)
  if (orphans.length === 0) return 0

  const site = await defaultSiteRelation(strapi)
  const { tableName, attributes } = strapi.db.metadata.get(PAGE_UID)
  const updatedAtColumn = (attributes.updatedAt as { columnName: string }).columnName
  for (const row of orphans) {
    await query.update({ where: { id: row.id }, data: { site } })
    // The database layer stamps `updatedAt` on every update; this one changes no content.
    await strapi.db
      .connection(tableName)
      .where({ id: row.id })
      .update({ [updatedAtColumn]: new Date(row.updatedAt) })
  }
  return orphans.length
}
