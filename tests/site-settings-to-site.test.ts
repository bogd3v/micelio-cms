import type { UID } from '@strapi/strapi'
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import { copySiteSettingsToSite } from '../src/migrations/site-settings-to-site'
import siteSettingSchema from '../src/api/site-setting/content-types/site-setting/schema.json'
import {
  COPY_MARKER,
  SITE_SETTING_UID,
  readSite,
  resetDefaultSite,
  seedSingleType,
  type SeededSettings,
} from './helpers/site-settings-seed'

// Boot step of #415 (ADR-0017, D3): the single type's attributes are copied into the default site,
// per locale, once. The readers still read the single type.

/**
 * Attributes of `api::site-setting` with no counterpart on `plugin::micelio.site`, each with the
 * reason. Empty today: the core carries every attribute but `homePage`, which the host extension
 * `src/extensions/micelio/strapi-server.ts` adds (D5). A new attribute of the single type must
 * either exist on the site or be listed here with its reason.
 */
const NO_COUNTERPART: Record<string, string> = {}

describe('Site settings copied into the default site', () => {
  let seeded: SeededSettings
  let markerAfterBoot: unknown

  beforeAll(async () => {
    await setupStrapi()
    markerAfterBoot = await strapi.store.get(COPY_MARKER)
    seeded = await seedSingleType()
    // The boot copied the neutral settings: start from the site as the core creates it.
    await resetDefaultSite()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('runs at boot, once the neutral settings exist', () => {
    expect(markerAfterBoot).toEqual({ version: 1 })
  })

  it('copies every attribute of the single type into the default site, per locale', async () => {
    const report = await copySiteSettingsToSite(strapi)
    expect(report?.locales.sort()).toEqual(['en', 'es'])

    const en = await readSite('en')
    const es = await readSite('es')
    expect(en).toMatchObject({
      name: 'Acme Garden',
      description: 'A garden blog',
      tagline: 'Grow',
      addressLocality: 'Bogota',
      defaultLocale: 'es',
      url: 'https://garden.example.com',
      contactEmail: 'hello@garden.example.com',
      privacyContactEmail: 'privacy@garden.example.com',
      securityContact: 'mailto:security@garden.example.com',
      privacyJurisdiction: 'colombia',
      supportHandle: 'acme',
      timezone: 'America/Bogota',
      author: { name: 'Ada', url: 'https://ada.example.com' },
      modules: { comments: false },
      theme: {
        themeId: 'paper',
        themeVersion: '1.2.0',
        themeDigest: `sha256:${'a'.repeat(64)}`,
        defaultMode: 'dark',
        displayFont: 'fraunces',
        accentOverrides: [{ mode: 'dark', color: '#112233' }],
      },
      fediverse: {
        username: 'acme',
        displayName: 'Acme Garden',
        summary: 'Plants and posts',
        discoverable: false,
        objectType: 'article',
        sourceUrl: 'https://garden.example.com/about',
      },
    })
    expect(new Date(en?.privacyUpdatedAt ?? '').toISOString()).toBe('2026-01-15T10:00:00.000Z')
    expect(en?.logo.id).toBe(seeded.mediaIds.logo)
    expect(en?.favicon.id).toBe(seeded.mediaIds.favicon)
    expect(en?.defaultOgImage.id).toBe(seeded.mediaIds.ogImage)
    expect(en?.fediverse.header.id).toBe(seeded.mediaIds.header)
    expect(en?.socialLinks.map((link: { network: string }) => link.network)).toEqual([
      'github',
      'mastodon',
    ])
    expect(en?.homePage.title).toBe('Home')

    expect(es).toMatchObject({
      name: 'Huerta Acme',
      description: 'Un blog de huerta',
      tagline: 'Cultiva',
      addressLocality: 'Bogotá',
      // Not localized: the one value of the default locale, in both rows.
      url: 'https://garden.example.com',
      theme: { themeVersion: '1.2.0' },
    })
    expect(es?.homePage.title).toBe('Inicio')
  })

  it('a second boot changes nothing and keeps a value set on the site', async () => {
    const sites = strapi.documents(SITE_UID as never) as unknown as {
      update(params: object): Promise<unknown>
    }
    const site = await readSite('en')
    await sites.update({
      documentId: site?.documentId,
      locale: 'en',
      data: { name: 'Operator name', fediverse: { username: 'operator' } },
    })
    await cleanupStrapi({ keepDatabase: true })
    await setupStrapi({ keepDatabase: true })

    expect(await copySiteSettingsToSite(strapi)).toBeNull()
    expect((await readSite('en'))?.name).toBe('Operator name')
    expect((await readSite('en'))?.fediverse.username).toBe('operator')

    // Without the marker the step runs again and still leaves what the site holds.
    await strapi.store.delete(COPY_MARKER)
    const before = await strapi.db.query(SITE_UID).findMany({ orderBy: { id: 'asc' } })
    const report = await copySiteSettingsToSite(strapi)
    expect(report?.written).toEqual([])
    const after = await strapi.db.query(SITE_UID).findMany({ orderBy: { id: 'asc' } })
    expect(after).toEqual(before)
    expect((await readSite('en'))?.name).toBe('Operator name')
    expect((await readSite('en'))?.fediverse.username).toBe('operator')
  })

  it('every attribute of site-setting has a counterpart on the site or a recorded reason', () => {
    const site = strapi.contentType(SITE_UID as UID.ContentType).attributes as Record<
      string,
      unknown
    >
    const singleType = Object.keys(siteSettingSchema.attributes)
    expect(strapi.contentType(SITE_SETTING_UID as UID.ContentType).attributes).toBeDefined()

    const unexplained = singleType.filter((name) => !(name in site) && !(name in NO_COUNTERPART))
    expect(unexplained).toEqual([])
    // A reason for an attribute that has a counterpart, or that no longer exists, is stale.
    const stale = Object.keys(NO_COUNTERPART).filter(
      (name) => name in site || !singleType.includes(name)
    )
    expect(stale).toEqual([])
  })

  it('copies only the attributes the single type declares, not the system fields', async () => {
    await resetDefaultSite()
    const report = await copySiteSettingsToSite(strapi)

    const declared = Object.keys(siteSettingSchema.attributes)
    const written = (report?.written ?? []).map((entry) => entry.split('.')[1])
    expect(written.length).toBeGreaterThan(0)
    expect(written.filter((name) => !declared.includes(name))).toEqual([])
  })

  it('keeps a value the site holds when it has no row in the default locale', async () => {
    await resetDefaultSite()
    const site = await readSite('en')
    const sites = strapi.documents(SITE_UID as UID.ContentType)
    await sites.update({
      documentId: site?.documentId as string,
      locale: 'en',
      data: { timezone: 'Europe/Madrid' } as never,
    })
    const locales = strapi.plugin('i18n').service('locales')
    await locales.setDefaultLocale({ code: 'es' })
    try {
      await copySiteSettingsToSite(strapi)
    } finally {
      await locales.setDefaultLocale({ code: 'en' })
    }

    expect(
      (await strapi.db.query(SITE_UID).findOne({ where: { isDefault: true, locale: 'en' } }))
        .timezone
    ).toBe('Europe/Madrid')
  })

  it('logs and leaves the marker unset when the site lacks an attribute of the single type', async () => {
    await strapi.store.delete(COPY_MARKER)
    const error = jest.spyOn(strapi.log, 'error').mockImplementation(() => strapi.log)
    const attributes = strapi.contentType(SITE_UID as UID.ContentType).attributes as Record<
      string,
      unknown
    >
    const saved = attributes.timezone
    delete attributes.timezone
    try {
      expect(await copySiteSettingsToSite(strapi)).toBeNull()
      expect(error).toHaveBeenCalledWith(expect.stringContaining('timezone'))
      expect(await strapi.store.get(COPY_MARKER)).toBeNull()
    } finally {
      attributes.timezone = saved
      error.mockRestore()
    }
  })

  it('logs the attribute the site refuses, copies the rest and retries on the next boot', async () => {
    await resetDefaultSite()
    // Stored before the constraint existed: the database layer does not validate.
    await strapi.db
      .query(SITE_SETTING_UID)
      .updateMany({ where: {}, data: { timezone: 'not a zone!' } })
    const error = jest.spyOn(strapi.log, 'error').mockImplementation(() => strapi.log)
    try {
      const report = await copySiteSettingsToSite(strapi)

      expect(report?.failed).toEqual(['en.timezone'])
      expect(report?.written).toContain('en.name')
      expect(await strapi.store.get(COPY_MARKER)).toBeNull()
      expect(error).toHaveBeenCalledWith(expect.stringContaining('en.timezone'))
      expect(error.mock.calls.flat().join(' ')).not.toContain('not a zone')
      expect((await readSite('en'))?.name).toBe('Acme Garden')
    } finally {
      error.mockRestore()
      await strapi.db
        .query(SITE_SETTING_UID)
        .updateMany({ where: {}, data: { timezone: 'America/Bogota' } })
    }
  })
})
