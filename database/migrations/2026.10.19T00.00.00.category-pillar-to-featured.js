'use strict'

/**
 * Copies `category.pillar` to `category.featured` before Strapi drops the
 * `pillar` column (the attribute was removed from the schema; issue
 * bogd3v/micelio#462 item 7). Strapi runs the files of this folder before it
 * syncs the schema, so the column still exists here. Self-contained on
 * purpose: it keeps its own constants and imports nothing from `src/`.
 *
 * - A fresh database has no `categories` table, and a database that already
 *   lost the column has nothing to copy: both are a no-op.
 * - A row whose `featured` is already true is never touched, and `featured` is
 *   never set to false.
 * - `pillar` is shared across locales, so a document with any row marked as a
 *   pillar is featured in every locale row.
 */

const TABLE = 'categories'
const SOURCE_COLUMN = 'pillar'
const TARGET_COLUMN = 'featured'
const DOCUMENT_COLUMN = 'document_id'

/**
 * @param {import('knex').Knex} knex - The migration transaction.
 * @returns {Promise<void>}
 */
async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return
  if (!(await knex.schema.hasColumn(TABLE, SOURCE_COLUMN))) return

  // An instance upgraded from before `featured` existed gets the column here,
  // as Strapi would create it (nullable boolean, the default is applied by
  // the Document Service), so the schema sync later finds nothing to change.
  if (!(await knex.schema.hasColumn(TABLE, TARGET_COLUMN))) {
    await knex.schema.alterTable(TABLE, (table) => {
      table.boolean(TARGET_COLUMN)
    })
  }

  const pillars = knex(TABLE).where(SOURCE_COLUMN, true).select(DOCUMENT_COLUMN)
  await knex(TABLE)
    .whereIn(DOCUMENT_COLUMN, pillars)
    .andWhere((builder) => builder.where(TARGET_COLUMN, false).orWhereNull(TARGET_COLUMN))
    .update({ [TARGET_COLUMN]: true })
}

/** Nothing to undo: the copied flags stay, and the dropped column is not restored. */
async function down() {}

module.exports = { up, down }
