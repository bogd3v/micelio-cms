import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'

const SITE_SETTING_UID = 'api::site-setting.site-setting'

/** The `url` regex of the core's `site` schema; a value outside it would fail the write. */
const SITE_URL_PATTERN = /^https?:\/\/\S+$/

/** The origin (scheme, host, port) of an `http(s)` URL, or null when it is not one. */
function originOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return SITE_URL_PATTERN.test(url.origin) ? url.origin : null
  } catch {
    return null
  }
}

/**
 * Gives the default site the frontend's origin when it has no `url`, so the preview and the
 * frontend checks of `@micelio/strapi-plugin-core` have a frontend to reach.
 *
 * @remarks
 * The core creates the default site with no `url`. The origin comes from the `url` of
 * `api::site-setting` in the default locale, else from `FRONTEND_URL` as the environment holds
 * it (no development default: an unset variable leaves the site empty). A value that is not an
 * `http(s)` URL is ignored. A site that already has a `url` is never touched: the admin owns it
 * afterwards. Runs after `seedSiteSettings`, which writes the site setting's `url`.
 *
 * @returns The origin written, or `null` when nothing was written.
 */
export async function ensureDefaultSiteUrl(strapi: Core.Strapi): Promise<string | null> {
  const rows = (await strapi.db.query(SITE_UID).findMany({
    where: { isDefault: true },
    select: ['documentId', 'locale', 'url'],
  })) as { documentId: string; locale: string; url: string | null }[]
  if (rows.length === 0 || rows.some((row) => row.url)) return null

  const defaultLocale = (await (
    strapi.plugin('i18n').service('locales') as { getDefaultLocale: () => Promise<string> }
  ).getDefaultLocale()) as string
  const setting = (await strapi.db
    .query(SITE_SETTING_UID)
    .findOne({ where: { locale: defaultLocale }, select: ['url'] })) as { url?: string } | null

  const origin = originOf(setting?.url) ?? originOf(process.env.FRONTEND_URL)
  if (!origin) return null

  // `url` is not localized, so Strapi writes it to every locale of the site.
  const row = rows.find((candidate) => candidate.locale === defaultLocale) ?? rows[0]
  const sites = strapi.documents(SITE_UID as UID.ContentType)
  // The host's types do not know the core's attributes.
  type Data = Parameters<typeof sites.update>[0]['data']
  await sites.update({
    documentId: row.documentId,
    locale: row.locale,
    data: { url: origin } as unknown as Data,
  })
  return origin
}
