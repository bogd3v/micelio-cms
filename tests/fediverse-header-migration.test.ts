import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { migrateFediverseHeader } from '../src/migrations/fediverse-header'

const GLOBAL_UID = 'api::global.global'
const SITE_SETTING_UID = 'api::site-setting.site-setting'
const RELATIONS = 'files_related_mph'

interface Profile {
  username?: string | null
  header?: { id: number } | null
}

describe('Migration of global.fediverseHeader into the site settings (#307)', () => {
  let defaultLocale: string
  let otherLocale: string
  let globalId: number

  const createImage = async (name: string): Promise<{ id: number }> =>
    strapi.db.query('plugin::upload.file').create({
      data: {
        name,
        hash: name.replace(/\W/g, '_'),
        ext: '.png',
        mime: 'image/png',
        size: 1,
        url: `/uploads/${name}`,
        provider: 'local',
      },
    })

  /** Leaves the row `global.fediverseHeader` had before the field was removed from the schema. */
  const leaveLegacyHeader = (fileId: number) =>
    strapi.db.connection(RELATIONS).insert({
      file_id: fileId,
      related_id: globalId,
      related_type: GLOBAL_UID,
      field: 'fediverseHeader',
      order: 1,
    })

  const legacyRows = () =>
    strapi.db
      .connection(RELATIONS)
      .where({ related_type: GLOBAL_UID, field: 'fediverseHeader' })
      .count({ total: '*' })
      .first() as Promise<{ total: number | string }>

  const writeProfile = async (fediverse: Record<string, unknown> | null) => {
    const site = await strapi.documents(SITE_SETTING_UID).findFirst({ locale: defaultLocale })
    await strapi.documents(SITE_SETTING_UID).update({
      documentId: site!.documentId,
      locale: defaultLocale,
      data: { fediverse } as never,
    })
  }

  const readProfile = async (locale = defaultLocale): Promise<Profile | null> => {
    const site = (await strapi.documents(SITE_SETTING_UID).findFirst({
      locale,
      populate: { fediverse: { populate: { header: true } } },
    } as never)) as { fediverse?: Profile | null } | null
    return site?.fediverse ?? null
  }

  beforeAll(async () => {
    await setupStrapi()
    defaultLocale = await strapi.plugin('i18n').service('locales').getDefaultLocale()
    otherLocale = defaultLocale === 'es' ? 'en' : 'es'
    const global = await strapi.documents(GLOBAL_UID).create({
      data: { siteName: 'Site', siteDescription: 'A site' },
    })
    globalId = (
      await strapi.db.query(GLOBAL_UID).findOne({ where: { documentId: global.documentId } })
    ).id
  })

  beforeEach(async () => {
    await strapi.db.connection(RELATIONS).where({ related_type: GLOBAL_UID }).delete()
    await writeProfile(null)
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('copies the image into an empty header once, keeps the rest of the component, and drops the old row', async () => {
    const legacy = await createImage('legacy-header.png')
    await writeProfile({ username: 'news_desk' })
    // A second localization of the site settings, as a site with two languages has.
    const site = await strapi.documents(SITE_SETTING_UID).findFirst({ locale: defaultLocale })
    await strapi.documents(SITE_SETTING_UID).update({
      documentId: site!.documentId,
      locale: otherLocale,
      data: { name: 'Other locale' } as never,
    })
    await leaveLegacyHeader(legacy.id)

    expect(await migrateFediverseHeader(strapi)).toBe(1)

    const profile = await readProfile()
    expect(profile?.header?.id).toBe(legacy.id)
    expect(profile?.username).toBe('news_desk')
    // The component is not localized: the other locale of the site settings shows the image too.
    expect((await readProfile(otherLocale))?.header?.id).toBe(legacy.id)
    expect(Number((await legacyRows()).total)).toBe(0)
  })

  it('makes no change when it runs again, even after the editor changes or clears the header', async () => {
    const legacy = await createImage('legacy-again.png')
    const replacement = await createImage('replacement.png')
    await leaveLegacyHeader(legacy.id)
    expect(await migrateFediverseHeader(strapi)).toBe(1)

    expect(await migrateFediverseHeader(strapi)).toBe(0)
    expect((await readProfile())?.header?.id).toBe(legacy.id)

    await writeProfile({ header: replacement.id })
    expect(await migrateFediverseHeader(strapi)).toBe(0)
    expect((await readProfile())?.header?.id).toBe(replacement.id)

    await writeProfile({ header: null })
    expect(await migrateFediverseHeader(strapi)).toBe(0)
    expect((await readProfile())?.header ?? null).toBeNull()
  })

  it('never overwrites a header that is filled, and drops the old row', async () => {
    const legacy = await createImage('legacy-ignored.png')
    const own = await createImage('own-header.png')
    await writeProfile({ header: own.id })
    await leaveLegacyHeader(legacy.id)

    expect(await migrateFediverseHeader(strapi)).toBe(0)

    expect((await readProfile())?.header?.id).toBe(own.id)
    expect(Number((await legacyRows()).total)).toBe(0)
  })

  it('creates the component when the site settings have none', async () => {
    const legacy = await createImage('legacy-new-component.png')
    await leaveLegacyHeader(legacy.id)
    expect(await readProfile()).toBeNull()

    expect(await migrateFediverseHeader(strapi)).toBe(1)

    expect((await readProfile())?.header?.id).toBe(legacy.id)
  })

  it('runs at boot, so an upgraded site has its header without a step by hand', async () => {
    const legacy = await createImage('legacy-boot.png')
    await leaveLegacyHeader(legacy.id)

    await cleanupStrapi({ keepDatabase: true })
    await setupStrapi({ keepDatabase: true })

    expect((await readProfile())?.header?.id).toBe(legacy.id)
    expect(Number((await legacyRows()).total)).toBe(0)
  })

  it('touches nothing when the file behind the relation is gone, and tries again at the next boot', async () => {
    // The table's foreign key makes this state unreachable through Strapi (deleting a file removes
    // its rows); a database restored without constraints can have it.
    const { connection } = strapi.db
    const sqlite =
      connection.client.config.client !== 'pg' && connection.client.config.client !== 'postgres'
    if (sqlite) {
      // Knex gives SQLite a pool of one connection, so the pragma reaches the insert.
      await connection.raw('PRAGMA foreign_keys = OFF')
      try {
        await leaveLegacyHeader(987654)
      } finally {
        await connection.raw('PRAGMA foreign_keys = ON')
      }
    } else {
      // One transaction, so the setting and the insert share a connection; it ends with it.
      await connection.transaction(async (trx) => {
        await trx.raw("SET LOCAL session_replication_role = 'replica'")
        await trx(RELATIONS).insert({
          file_id: 987654,
          related_id: globalId,
          related_type: GLOBAL_UID,
          field: 'fediverseHeader',
          order: 1,
        })
      })
    }
    await writeProfile({ username: 'news_desk' })

    expect(await migrateFediverseHeader(strapi)).toBe(0)

    expect((await readProfile())?.header ?? null).toBeNull()
    expect(Number((await legacyRows()).total)).toBe(1)

    const restored = await createImage('legacy-restored.png')
    await strapi.db
      .connection(RELATIONS)
      .where({ related_type: GLOBAL_UID, field: 'fediverseHeader' })
      .update({ file_id: restored.id })
    expect(await migrateFediverseHeader(strapi)).toBe(1)
    expect((await readProfile())?.header?.id).toBe(restored.id)
  })

  it('does nothing when global never had a header', async () => {
    expect(await migrateFediverseHeader(strapi)).toBe(0)
    expect(await readProfile()).toBeNull()
  })
})
