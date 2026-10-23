import path from 'path'
import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'

const CATEGORY = 'plugin::micelio.category'
const TABLE = 'categories'
const MIGRATION_FILE = '2026.10.19T00.00.00.category-pillar-to-featured.js'

interface SchemaColumn {
  name: string
  [key: string]: unknown
}
interface StoredSchema {
  tables: { name: string; columns: SchemaColumn[] }[]
}
interface SchemaStorage {
  read(): Promise<{ schema: StoredSchema } | null>
  add(schema: StoredSchema): Promise<void>
}

const migration = require(path.join('..', 'database', 'migrations', MIGRATION_FILE)) as {
  up(knex: unknown): Promise<void>
}

const knex = () => strapi.db.connection
const flag = async (slug: string) =>
  Boolean((await knex()(TABLE).where({ slug }).first('featured')).featured)

/**
 * Makes the database look like the previous release: a `pillar` column the stored schema knows.
 * It mirrors the three-way diff of `@strapi/database` (`schema/index.js`), which drops a column
 * only when the stored schema lists it; `schemaStorage` is private, so a Strapi upgrade may move it.
 */
async function restoreOldSchema() {
  await knex().schema.alterTable(TABLE, (table) => {
    table.boolean('pillar').defaultTo(false)
  })
  const storage = (strapi.db.schema as unknown as { schemaStorage: SchemaStorage }).schemaStorage
  const stored = await storage.read()
  const categories = stored!.schema.tables.find((table) => table.name === TABLE)!
  const featured = categories.columns.find((column) => column.name === 'featured')!
  categories.columns.push({ ...featured, name: 'pillar' })
  await storage.add(stored!.schema)
  await knex()('strapi_migrations').where('name', MIGRATION_FILE).del()
}

describe('category pillar to featured migration', () => {
  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  // Every test starts from the current schema (`featured`, no `pillar`) and the same rows, so
  // none depends on another's leftovers and any can run alone.
  beforeEach(async () => {
    if (await knex().schema.hasColumn(TABLE, 'pillar')) {
      await knex().schema.alterTable(TABLE, (table) => table.dropColumn('pillar'))
    }
    if (!(await knex().schema.hasColumn(TABLE, 'featured'))) {
      await knex().schema.alterTable(TABLE, (table) => table.boolean('featured'))
    }
    await strapi.db.query(CATEGORY).deleteMany({})
    const documents = strapi.documents(CATEGORY)
    await documents.create({ data: { name: 'Pillar', slug: 'pillar', featured: false } })
    await documents.create({ data: { name: 'Plain', slug: 'plain', featured: false } })
    await documents.create({ data: { name: 'Kept', slug: 'kept', featured: true } })
    await documents.create({ data: { name: 'Both', slug: 'both', featured: true } })
    await documents.create({ data: { name: 'Unset', slug: 'unset' } })
    await knex()(TABLE).where({ slug: 'unset' }).update({ featured: null })
    await knex()('strapi_migrations').where('name', MIGRATION_FILE).del()
  })

  it('copies pillar to featured before the schema sync drops the column', async () => {
    await restoreOldSchema()
    await knex()(TABLE).whereIn('slug', ['pillar', 'both', 'unset']).update({ pillar: true })
    expect(await knex().schema.hasColumn(TABLE, 'pillar')).toBe(true)

    // The same call Strapi makes at startup, before bootstrap().
    await strapi.db.schema.sync()

    expect(await knex().schema.hasColumn(TABLE, 'pillar')).toBe(false)
    expect(await flag('pillar')).toBe(true)
    expect(await flag('unset')).toBe(true)
    expect(await flag('both')).toBe(true)
    expect(await flag('kept')).toBe(true)
    expect(await flag('plain')).toBe(false)
    expect(
      await knex()('strapi_migrations').where('name', MIGRATION_FILE).first('name')
    ).toBeTruthy()
  })

  it('is a no-op when the column is already gone, and on a second run', async () => {
    const before = await knex()(TABLE).select('slug', 'featured').orderBy('slug')
    await knex().transaction((trx) => migration.up(trx))
    await knex().transaction((trx) => migration.up(trx))
    expect(await knex()(TABLE).select('slug', 'featured').orderBy('slug')).toEqual(before)
  })

  it('copies once and a second run, with the column still there, changes nothing', async () => {
    await knex().schema.alterTable(TABLE, (table) => {
      table.boolean('pillar').defaultTo(false)
    })
    await knex()(TABLE).where({ slug: 'pillar' }).update({ pillar: true })

    await knex().transaction((trx) => migration.up(trx))
    const once = await knex()(TABLE).select('slug', 'featured').orderBy('slug')
    await knex().transaction((trx) => migration.up(trx))

    expect(await knex()(TABLE).select('slug', 'featured').orderBy('slug')).toEqual(once)
    expect(await flag('pillar')).toBe(true)
  })

  it('never turns a featured category off', async () => {
    await knex().schema.alterTable(TABLE, (table) => {
      table.boolean('pillar').defaultTo(false)
    })
    await knex()(TABLE).update({ pillar: false })
    await knex().transaction((trx) => migration.up(trx))
    expect(await flag('kept')).toBe(true)
    expect(await flag('both')).toBe(true)
    expect(await flag('pillar')).toBe(false)
    expect(await flag('plain')).toBe(false)
  })

  it('copies a pillar to every locale of the document and creates featured when missing', async () => {
    await knex().schema.alterTable(TABLE, (table) => {
      table.boolean('pillar').defaultTo(false)
    })
    // A second locale row of the same document, as only that row carries the flag.
    const plain = await knex()(TABLE).where({ slug: 'plain' }).first()
    delete plain.id
    await knex()(TABLE).insert({ ...plain, locale: 'zz', pillar: true })
    await knex().schema.alterTable(TABLE, (table) => table.dropColumn('featured'))

    await knex().transaction((trx) => migration.up(trx))

    const rows = await knex()(TABLE).where({ slug: 'plain' }).select('locale', 'featured')
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every((row) => Boolean(row.featured))).toBe(true)
  })

  it('does nothing when the categories table does not exist', async () => {
    const empty = {
      schema: {
        hasTable: async () => false,
        hasColumn: async () => {
          throw new Error('must not be asked')
        },
      },
    }
    await expect(migration.up(empty)).resolves.toBeUndefined()
  })
})
