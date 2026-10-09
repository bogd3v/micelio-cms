import type { Core } from '@strapi/strapi';
import { SITE_SETTING_UID } from '../constants/uids';
import { frontendBaseUrl } from '../utils/frontend-url';

interface NeutralSiteSettings {
  name: string;
  description: string;
  url: string;
  defaultLocale: string;
  modules: Record<string, never>;
}

const PERMISSION_UID = 'plugin::users-permissions.permission';
const SITE_SETTING_ACTION_PREFIX = `${SITE_SETTING_UID}.`;

/** Locales the site settings are translated into. */
const SITE_LOCALES = ['en', 'es'];

/** Text of a new site, per locale; the admin panel replaces it. */
const NEUTRAL_TEXT: Record<string, { name: string; description: string }> = {
  en: { name: 'Micelio', description: 'A site built with Micelio' },
  es: { name: 'Micelio', description: 'Un sitio hecho con Micelio' },
};

/**
 * What a new instance starts with: a neutral name and description, the
 * frontend's URL, and every module on. No author, links or contacts: each
 * site fills in its own in the admin panel.
 */
export function neutralSiteSettings(locale: string, defaultLocale: string): NeutralSiteSettings {
  return {
    ...(NEUTRAL_TEXT[locale] ?? NEUTRAL_TEXT.en),
    url: frontendBaseUrl(),
    defaultLocale: SITE_LOCALES.includes(defaultLocale) ? defaultLocale : 'en',
    // Every module defaults to on.
    modules: {},
  };
}

/**
 * Creates neutral site settings, in the default locale and in every other
 * configured locale among English and Spanish, when they don't exist yet.
 * Afterwards the admin panel owns them: an existing document is never
 * touched. Returns the locales created.
 */
export async function seedSiteSettings(strapi: Core.Strapi): Promise<string[]> {
  const settings = strapi.documents(SITE_SETTING_UID);
  const existing = await strapi.db.query(SITE_SETTING_UID).count();
  if (existing > 0) return [];

  const localesService = strapi.plugin('i18n').service('locales');
  const defaultLocale: string = await localesService.getDefaultLocale();
  const otherLocales = ((await localesService.find()) as { code: string }[])
    .map((locale) => locale.code)
    .filter((code) => SITE_LOCALES.includes(code) && code !== defaultLocale);

  type Data = Parameters<typeof settings.create>[0]['data'];
  const dataFor = (locale: string) => neutralSiteSettings(locale, defaultLocale) as unknown as Data;
  const created = await settings.create({ locale: defaultLocale, data: dataFor(defaultLocale) });
  for (const locale of otherLocales) {
    // Updating a locale the document does not have yet creates that localization.
    await settings.update({ documentId: created.documentId, locale, data: dataFor(locale) });
  }
  return [defaultLocale, ...otherLocales];
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
  })) as { id: number }[];
  if (permissions.length === 0) return 0;

  await strapi.db.query(PERMISSION_UID).deleteMany({
    where: { id: { $in: permissions.map((permission) => permission.id) } },
  });
  await strapi.service('plugin::users-permissions.users-permissions').initialize();
  return permissions.length;
}
