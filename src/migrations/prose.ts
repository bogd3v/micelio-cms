import type { Core } from '@strapi/strapi'

// Self-contained on purpose (`AGENTS.md`, "Where code goes"): the names, the vocabulary defaults and
// the heading rule are copied here so this migration keeps working when the code it migrated away
// from changes. The rule is the one of `@micelio/strapi-plugin-core` 0.6 (`prose-headings/rules`),
// which the package does not export.

/** A heading of a Markdown body. */
interface Heading {
  level: number
  text: string
  /** Its line in the body, from 1. */
  line: number
}

/** The first heading that breaks the rule of a `prose` body, and why. */
interface HeadingFault extends Heading {
  reason: 'opensWithH1' | 'opensBelowH2' | 'h1' | 'skipsLevel'
  previousLevel?: number
}

/** Where a migrated entry is: enough for an operator to open it in the admin panel. */
export interface ProseEntry {
  documentId: string
  slug: string
  locale: string
  status: 'draft' | 'published'
  /** The entry's position in the page's `sections`, from 0. */
  position: number
}

/** What a run of {@link migrateRichTextToProse} did. */
export interface ProseMigrationReport {
  /** How many `section.rich-text` entries became `shared.rich-text`. */
  migrated: number
  /** The migrated entries whose body breaks the heading rule; their body is kept as it was. */
  headingFaults: (ProseEntry & { fault: string })[]
  /** The migrated entries that set `tone` or `align`, which `shared.rich-text` does not carry. */
  droppedStyles: (ProseEntry & { tone: string | null; align: string | null })[]
}

/** A row of the page's dynamic zone join table. */
interface ZoneLink {
  id: number
  entity: number
  component: number
  type: string
  order: number
}

/** The columns of the page's dynamic zone join table, read from Strapi's metadata. */
interface ZoneTable {
  name: string
  entity: string
  component: string
  type: string
  field: string
  order: string
}

/** The stored row of a `section.rich-text`. */
interface RetiredRow {
  id: number
  blockId?: string | null
  body?: string | null
  tone?: string | null
  align?: string | null
}

/** The page version a link belongs to. */
interface PageRow {
  id: number
  documentId: string
  slug?: string | null
  locale?: string | null
  publishedAt?: string | Date | null
}

const PAGE_UID = 'api::page.page'
const ZONE = 'sections'
const RETIRED_UID = 'section.rich-text'
const PROSE_UID = 'shared.rich-text'
/** The vocabulary defaults of `tone` and `align`: a value other than these was set by an editor. */
const DEFAULT_TONE = 'default'
const DEFAULT_ALIGN = 'start'
const OPENING_LEVEL = 2

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const SETEXT_H1 = /^ {0,3}=+[ \t]*$/
const SETEXT_H2 = /^ {0,3}-+[ \t]*$/
const PARAGRAPH = /^ {0,3}[^\s#>*+\-=_`~|\d<]/

/**
 * Turns every `section.rich-text` of a page's `sections` into a `shared.rich-text` (`prose`) in
 * place (#445): drafts and published versions, every locale, at the same position, with the same
 * `body` and `blockId`. It writes a new `shared.rich-text` row, points the zone's link at it and
 * deletes the old row, one page version per transaction, so nothing gets republished.
 *
 * @remarks
 * A body is never rewritten. The boot log names each migrated body that breaks the heading rule of
 * `prose` (it opens at `h2`, has no `h1`, skips no level), which the core refuses on the next save,
 * and each entry that set `tone` or `align` (a value other than `default` and `start`), which
 * `shared.rich-text` does not have and the migration does not carry. Idempotent: once no link points
 * at a `section.rich-text`, a run changes nothing and logs nothing. The component stays in the
 * schema for one release, so Strapi's schema sync keeps its rows until this has read them.
 *
 * @returns What the run migrated and reported.
 */
export async function migrateRichTextToProse(strapi: Core.Strapi): Promise<ProseMigrationReport> {
  const report: ProseMigrationReport = { migrated: 0, headingFaults: [], droppedStyles: [] }
  const table = zoneTableOf(strapi)
  const knex = strapi.db.connection

  const retired = (await knex(table.name)
    .distinct(table.entity)
    .where({ [table.type]: RETIRED_UID, [table.field]: ZONE })) as Record<string, number>[]
  const entities = retired.map((row) => Number(row[table.entity])).sort((a, b) => a - b)

  for (const entityId of entities) {
    const page = (await strapi.db.query(PAGE_UID).findOne({
      select: ['id', 'documentId', 'slug', 'locale', 'publishedAt'],
      where: { id: entityId },
    })) as PageRow | null

    await strapi.db.transaction(async ({ trx }) => {
      const links = (
        (await trx(table.name)
          .select(
            'id',
            `${table.entity} as entity`,
            `${table.component} as component`,
            `${table.type} as type`,
            `${table.order} as order`
          )
          .where({ [table.entity]: entityId, [table.field]: ZONE })
          .orderBy([
            { column: table.order, order: 'asc' },
            { column: 'id', order: 'asc' },
          ])) as ZoneLink[]
      ).map((link) => ({ ...link, component: Number(link.component) }))

      for (const [position, link] of links.entries()) {
        if (link.type !== RETIRED_UID) continue
        const row = (await strapi.db.query(RETIRED_UID).findOne({
          where: { id: link.component },
        })) as RetiredRow | null
        const created = (await strapi.db.query(PROSE_UID).create({
          data: { blockId: row?.blockId ?? null, body: row?.body ?? null },
        })) as { id: number }
        await trx(table.name)
          .where({ id: link.id })
          .update({ [table.component]: created.id, [table.type]: PROSE_UID })
        if (row) await strapi.db.query(RETIRED_UID).delete({ where: { id: row.id } })
        report.migrated += 1

        const entry: ProseEntry = {
          documentId: page?.documentId ?? `#${entityId}`,
          slug: page?.slug ?? '',
          locale: page?.locale ?? '',
          status: page?.publishedAt ? 'published' : 'draft',
          position,
        }
        const fault = typeof row?.body === 'string' ? findHeadingFault(row.body) : null
        if (fault) report.headingFaults.push({ ...entry, fault: describeFault(fault) })
        const tone = setValue(row?.tone, DEFAULT_TONE)
        const align = setValue(row?.align, DEFAULT_ALIGN)
        if (tone !== null || align !== null) report.droppedStyles.push({ ...entry, tone, align })
      }
    })
  }

  for (const entry of report.headingFaults) {
    strapi.log.warn(
      `[prose] ${describeEntry(entry)} ${entry.fault}: kept as it was, fix its headings before the next save`
    )
  }
  for (const entry of report.droppedStyles) {
    const values = [
      entry.tone === null ? null : `tone "${entry.tone}"`,
      entry.align === null ? null : `align "${entry.align}"`,
    ].filter(Boolean)
    strapi.log.warn(
      `[prose] ${describeEntry(entry)} set ${values.join(' and ')}, which prose does not carry: dropped`
    )
  }
  return report
}

function zoneTableOf(strapi: Core.Strapi): ZoneTable {
  const attribute = strapi.db.metadata.get(PAGE_UID).attributes[ZONE] as unknown as {
    joinTable?: {
      name: string
      joinColumn: { name: string }
      morphColumn: { idColumn: { name: string }; typeColumn: { name: string } }
      on?: Record<string, unknown>
      orderBy?: Record<string, unknown>
    }
  }
  const joinTable = attribute.joinTable
  if (!joinTable) throw new Error(`[prose] ${PAGE_UID}.${ZONE} has no join table`)
  return {
    name: joinTable.name,
    entity: joinTable.joinColumn.name,
    component: joinTable.morphColumn.idColumn.name,
    type: joinTable.morphColumn.typeColumn.name,
    field: Object.keys(joinTable.on ?? { field: ZONE })[0],
    order: Object.keys(joinTable.orderBy ?? { order: 'asc' })[0],
  }
}

function headingsOf(markdown: string): Heading[] {
  const headings: Heading[] = []
  const lines = markdown.split(/\r\n|\r|\n/)
  let fence: { char: string; size: number } | null = null
  for (const [index, line] of lines.entries()) {
    if (fence) {
      const closing = FENCE_CLOSE.exec(line)
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.size) fence = null
      continue
    }
    const opening = FENCE.exec(line)
    if (opening) {
      fence = { char: opening[1][0], size: opening[1].length }
      continue
    }
    const atx = ATX.exec(line)
    if (atx) {
      const text = (atx[2] ?? '').replace(/[ \t]+#+$/, '').replace(/^#+$/, '')
      headings.push({ level: atx[1].length, text: text.trim(), line: index + 1 })
      continue
    }
    const previous = index > 0 ? lines[index - 1] : ''
    const level = SETEXT_H1.test(line) ? 1 : SETEXT_H2.test(line) ? 2 : 0
    if (level && PARAGRAPH.test(previous) && !ATX.test(previous)) {
      headings.push({ level, text: previous.trim(), line: index })
    }
  }
  return headings
}

/**
 * The first heading of a Markdown body that breaks the rule of a `prose` block: it opens at `h2`,
 * has no `h1` and does not skip a level going down; going back up is free.
 */
function findHeadingFault(markdown: string): HeadingFault | null {
  let previous: Heading | null = null
  for (const heading of headingsOf(markdown)) {
    if (!previous) {
      if (heading.level === 1) return { reason: 'opensWithH1', ...heading }
      if (heading.level > OPENING_LEVEL) return { reason: 'opensBelowH2', ...heading }
    } else if (heading.level === 1) {
      return { reason: 'h1', ...heading }
    } else if (heading.level > previous.level + 1) {
      return { reason: 'skipsLevel', ...heading, previousLevel: previous.level }
    }
    previous = heading
  }
  return null
}

function describeFault(fault: HeadingFault): string {
  const found = `the h${fault.level} "${fault.text}" on line ${fault.line}`
  switch (fault.reason) {
    case 'opensWithH1':
    case 'opensBelowH2':
      return `opens with ${found}; a block opens at h2`
    case 'h1':
      return `has ${found}; a block has no h1`
    case 'skipsLevel':
      return `has ${found}, which skips from h${fault.previousLevel}`
  }
}

function describeEntry(entry: ProseEntry): string {
  return `page "${entry.slug}" (${entry.documentId}, ${entry.locale}, ${entry.status}) ${ZONE}.${entry.position}`
}

/** A stored `tone` or `align` other than the vocabulary's default, or `null` when not set. */
function setValue(value: string | null | undefined, byDefault: string): string | null {
  return value === null || value === undefined || value === '' || value === byDefault ? null : value
}
