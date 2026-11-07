import type { UID } from '@strapi/strapi'
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import { copySiteSettingsToSite } from '../src/migrations/site-settings-to-site'
import { readSite, resetDefaultSite, seedSingleType } from './helpers/site-settings-seed'

// ADR-0017 marks the extension of a core type from `src/extensions/micelio/` "not verified"; D5
// gives `site` the `homePage` of the single type. Proved here on a real boot.

describe('The home page on the core site', () => {
  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('the default site carries the home page of the single type', async () => {
    const attribute = (
      strapi.contentType(SITE_UID as UID.ContentType).attributes as Record<
        string,
        Record<string, unknown>
      >
    ).homePage
    expect(attribute).toMatchObject({
      type: 'relation',
      relation: 'oneToOne',
      target: 'api::page.page',
    })

    const seeded = await seedSingleType()
    await resetDefaultSite()
    await copySiteSettingsToSite(strapi)

    expect((await readSite('en'))?.homePage).toMatchObject({
      documentId: seeded.pageDocumentId,
      title: 'Home',
    })
    expect((await readSite('es'))?.homePage).toMatchObject({
      documentId: seeded.pageDocumentId,
      title: 'Inicio',
    })
  })

  it('keeps the attributes of the core and the other extensions', () => {
    const site = strapi.contentType(SITE_UID as UID.ContentType).attributes as Record<
      string,
      unknown
    >
    expect(Object.keys(site)).toEqual(expect.arrayContaining(['name', 'isDefault', 'homePage']))
    const category = strapi.contentType('plugin::micelio.category' as UID.ContentType)
      .attributes as Record<string, unknown>
    expect(category).toHaveProperty('articles')
  })
})
