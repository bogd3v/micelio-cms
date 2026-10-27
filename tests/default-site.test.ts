import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

describe('The default site, for entries created outside a request', () => {
  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  const sites = () => strapi.db.query(SITE_UID)

  it('names the row of the site with isDefault, which the core creates at boot', async () => {
    const site = await sites().findOne({ where: { isDefault: true } })

    expect(site).not.toBeNull()
    expect(await defaultSiteRelation(strapi)).toEqual({ id: site.id })
  })

  it('lets a category be created in a locale the default site has no row in', async () => {
    const locales = strapi.plugin('i18n').service('locales')
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' })
    }

    const category = await strapi.documents('plugin::micelio.category').create({
      locale: 'es',
      data: { name: 'Huerta', slug: 'huerta', site: await defaultSiteRelation(strapi) },
    })

    const row = await strapi.db.query('plugin::micelio.category').findOne({
      where: { documentId: category.documentId, locale: 'es' },
      populate: { site: true },
    })
    expect(row.site.isDefault).toBe(true)
  })

  it('refuses to guess when no site is the default', async () => {
    await sites().updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    try {
      await expect(defaultSiteRelation(strapi)).rejects.toThrow('no default site')
    } finally {
      await sites().updateMany({ where: {}, data: { isDefault: true } })
    }
  })
})
