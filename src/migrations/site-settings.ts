import type { Core } from '@strapi/strapi';
import { SITE_SETTING_UID } from '../constants/uids';

const PERMISSION_UID = 'plugin::users-permissions.permission';
const SITE_SETTING_ACTION_PREFIX = `${SITE_SETTING_UID}.`;

/** Locales the site settings are translated into. */
const SITE_LOCALES = ['en', 'es'];

/**
 * BogDev's identity as the frontend had it in `app/app.config.ts` before it
 * moved here (micelio-cms#72). The logo, favicon and default OG image are
 * uploaded by hand in the admin panel.
 */
export const BOGDEV_SITE_SETTINGS = {
  name: 'BogDev',
  description: 'Personal blog about AI, Software, Linux and more',
  url: 'https://bogdev.com.co',
  defaultLocale: 'en',
  author: { name: 'Alejandro Ramirez', url: 'https://bogdev.com.co/about' },
  socialLinks: [
    { network: 'github', url: 'https://github.com/ale9420' },
    {
      network: 'linkedin',
      url: 'https://www.linkedin.com/in/alejandro-ramirez-garcia-046713139',
    },
    { network: 'codeberg', url: 'https://codeberg.org/alejo9420' },
    { network: 'mastodon', url: 'https://mastodon.social/@bogdev' },
  ],
  contactEmail: 'gx_alejandro@hotmail.com',
  privacyContactEmail: 'gx_alejandro@hotmail.com',
  privacyUpdatedAt: '2026-10-01T17:00:00.000Z',
  supportHandle: 'ale9420',
  // Every module defaults to on.
  modules: {},
} as const;

/**
 * Creates the site settings with BogDev's values, in the default locale and
 * in every other configured locale among English and Spanish, when they don't
 * exist yet. Afterwards the admin panel owns them: an existing document is
 * never touched. Returns the locales created.
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

  const data = BOGDEV_SITE_SETTINGS as unknown as Parameters<typeof settings.create>[0]['data'];
  const created = await settings.create({ locale: defaultLocale, data });
  for (const locale of otherLocales) {
    // Updating a locale the document does not have yet creates that localization.
    await settings.update({ documentId: created.documentId, locale, data });
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
