// Stores a `section.rich-text` in a page as a release before #445 did. The Document Service now
// refuses that component (`src/utils/page-sections.ts`), so a page is created with a
// `shared.rich-text` placeholder and the zone's link of each version (draft and published) is
// pointed at a new `section.rich-text` row, which is the shape the boot migration reads.

const PAGE_UID = 'api::page.page'
const RETIRED_UID = 'section.rich-text'
const PROSE_UID = 'shared.rich-text'

/** The stored values of a retired `section.rich-text`. */
export interface RetiredValues {
  body: string
  blockId?: string | null
  tone?: string | null
  align?: string | null
}

/** The dynamic zone join table of `page.sections`, from Strapi's metadata. */
function sectionsTable(): {
  name: string
  entity: string
  component: string
  type: string
  order: string
} {
  const joinTable = (
    strapi.db.metadata.get(PAGE_UID).attributes.sections as unknown as {
      joinTable: {
        name: string
        joinColumn: { name: string }
        morphColumn: { idColumn: { name: string }; typeColumn: { name: string } }
        orderBy: Record<string, unknown>
      }
    }
  ).joinTable
  return {
    name: joinTable.name,
    entity: joinTable.joinColumn.name,
    component: joinTable.morphColumn.idColumn.name,
    type: joinTable.morphColumn.typeColumn.name,
    order: Object.keys(joinTable.orderBy)[0],
  }
}

/**
 * Turns the section at `position` of every version of the page `documentId` (a `shared.rich-text`
 * placeholder) into a `section.rich-text` with `values`, as an earlier release stored it; with
 * `locale`, only the versions in that locale.
 */
export async function plantRetiredRichText(
  documentId: string,
  position: number,
  values: RetiredValues,
  locale?: string
): Promise<void> {
  const table = sectionsTable()
  const knex = strapi.db.connection
  const versions = (await strapi.db.query(PAGE_UID).findMany({
    select: ['id'],
    where: locale ? { documentId, locale } : { documentId },
  })) as { id: number }[]
  if (versions.length === 0) throw new Error(`No page ${documentId}`)

  for (const { id } of versions) {
    const links = (await knex(table.name)
      .select('id', `${table.component} as component`, `${table.type} as type`)
      .where({ [table.entity]: id, field: 'sections' })
      .orderBy([
        { column: table.order, order: 'asc' },
        { column: 'id', order: 'asc' },
      ])) as { id: number; component: number; type: string }[]
    const link = links[position]
    if (link?.type !== PROSE_UID) {
      throw new Error(`Section ${position} of page ${id} is not a ${PROSE_UID} placeholder`)
    }
    const retired = (await strapi.db.query(RETIRED_UID).create({
      data: {
        body: values.body,
        blockId: values.blockId ?? null,
        tone: values.tone ?? null,
        align: values.align ?? null,
      },
    })) as { id: number }
    await knex(table.name)
      .where({ id: link.id })
      .update({ [table.component]: retired.id, [table.type]: RETIRED_UID })
    await strapi.db.query(PROSE_UID).delete({ where: { id: Number(link.component) } })
  }
}

/** How many links of `page.sections` point at a `section.rich-text`. */
export async function retiredLinkCount(): Promise<number> {
  const table = sectionsTable()
  const [row] = (await strapi.db
    .connection(table.name)
    .where({ [table.type]: RETIRED_UID })
    .count({ count: '*' })) as { count: number | string }[]
  return Number(row.count)
}
