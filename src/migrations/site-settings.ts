import type { Core } from '@strapi/strapi'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { SITE_SETTING_UID } from '../constants/uids'
import { defaultSiteDocumentId } from '../utils/default-site'

interface NeutralSiteSettings {
  description: string
  defaultLocale: string
}

const PERMISSION_UID = 'plugin::users-permissions.permission'
const SITE_SETTING_ACTION_PREFIX = `${SITE_SETTING_UID}.`
// Marks that the neutral values were written (or not needed) once; afterwards the admin owns them.
const MARKER = { type: 'core', name: 'migrations', key: 'site-seed' }

/** Locales the site settings are translated into. */
const SITE_LOCALES = ['en', 'es']

/** Text of a new site, per locale; the admin panel replaces it. */
const NEUTRAL_TEXT: Record<string, { description: string }> = {
  en: { description: 'A site built with Micelio' },
  es: { description: 'Un sitio hecho con Micelio' },
}

/**
 * What a new instance's default site starts with: a neutral description and the default locale.
 * The name (`Micelio`), the modules (every one on) come from the core, which creates the default
 * site; the `url` comes from `ensureDefaultSiteUrl`. No author, links or contacts: each site
 * fills in its own in the admin panel.
 */
export function neutralSiteSettings(locale: string, defaultLocale: string): NeutralSiteSettings {
  return {
    ...(NEUTRAL_TEXT[locale] ?? NEUTRAL_TEXT.en),
    defaultLocale: SITE_LOCALES.includes(defaultLocale) ? defaultLocale : 'en',
  }
}

/**
 * Gives the default site a neutral description in the default locale and in every other
 * configured locale among English and Spanish, once. Afterwards the admin panel owns them.
 * Returns the locales written.
 *
 * @remarks
 * The single type `api::site-setting` is retired and no longer written (ADR-0017, D6). An instance
 * that has rows in it is an upgrade: `copySiteSettingsToSite` fills the site from them, so nothing
 * is written here and the marker is set. A store marker keeps a description the admin cleared from
 * coming back at the next boot.
 */
export async function seedSiteSettings(strapi: Core.Strapi): Promise<string[]> {
  if (await strapi.store.get(MARKER)) return []
  if ((await strapi.db.query(SITE_SETTING_UID).count()) > 0) {
    await strapi.store.set({ ...MARKER, value: { version: 1 } })
    return []
  }
  const documentId = await defaultSiteDocumentId(strapi)
  if (!documentId) return []

  const localesService = strapi.plugin('i18n').service('locales')
  const defaultLocale: string = await localesService.getDefaultLocale()
  const otherLocales = ((await localesService.find()) as { code: string }[])
    .map((locale) => locale.code)
    .filter((code) => SITE_LOCALES.includes(code) && code !== defaultLocale)

  // The host's types do not know the core's attributes.
  const sites = strapi.documents(SITE_UID as never) as unknown as {
    update(params: object): Promise<unknown>
  }
  const locales = [defaultLocale, ...otherLocales]
  for (const locale of locales) {
    // Updating a locale the site does not have yet creates that localization, which needs a name.
    const name = locale === defaultLocale ? {} : { name: 'Micelio' }
    await sites.update({
      documentId,
      locale,
      data: { ...name, ...neutralSiteSettings(locale, defaultLocale) },
    })
  }
  await strapi.store.set({ ...MARKER, value: { version: 1 } })
  return locales
}

/**
 * Removes every users-permissions permission on the site settings: only the
 * frontend reads them, with its API token, so neither the public role nor
 * signed-in readers get them. Idempotent. Returns how many were removed.
 */
export async function revokeSiteSettingPermissions(strapi: Core.Strapi): Promise<number> {
  const permissions = (await strapi.db.query(PERMISSION_UID).findMany({
    select: ['id'],
    where: { action: { $startsWith: SITE_SETTING_ACTION_PREFIX } },
  })) as { id: number }[]
  if (permissions.length === 0) return 0

  await strapi.db.query(PERMISSION_UID).deleteMany({
    where: { id: { $in: permissions.map((permission) => permission.id) } },
  })
  await strapi.service('plugin::users-permissions.users-permissions').initialize()
  return permissions.length
}
