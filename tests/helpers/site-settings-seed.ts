import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { createImage } from './response-fields-seed-base'
import { defaultSiteRelation } from '../../src/utils/default-site'

/** The single type with the site's identity, as `src/api/site-setting` declares it. */
export const SITE_SETTING_UID = 'api::site-setting.site-setting'
const PAGE_UID = 'api::page.page'

/** The marker `copySiteSettingsToSite` stores when it has run. */
export const COPY_MARKER = { type: 'core', name: 'migrations', key: 'site-settings-to-site' }

const DIGEST = `sha256:${'a'.repeat(64)}`

/** What the seed wrote, to compare with what the site holds. */
export interface SeededSettings {
  mediaIds: { logo: number; favicon: number; ogImage: number; header: number }
  homePage: { en: string; es: string }
  pageDocumentId: string
}

/** Locales the suites of this migration run in. */
export async function ensureSpanish(): Promise<void> {
  const locales = strapi.plugin('i18n').service('locales')
  if (!(await locales.findByCode('es'))) {
    await locales.create({ code: 'es', name: 'Spanish (es)' })
  }
}

/**
 * Puts the default site back as the core creates it (`ensureDefaultSite`): one row in the default
 * locale, the name `Micelio`, no `url`, every module on. The boot of a test has already copied the
 * neutral settings into it; an upgrade copies a real single type into this one.
 */
export async function resetDefaultSite(): Promise<void> {
  const sites = strapi.documents(SITE_UID as never) as unknown as {
    update(params: object): Promise<unknown>
  }
  const locale = (await strapi.plugin('i18n').service('locales').getDefaultLocale()) as string
  const rows = (await strapi.db
    .query(SITE_UID)
    .findMany({ where: { isDefault: true }, select: ['id', 'documentId', 'locale'] })) as {
    id: number
    documentId: string
    locale: string
  }[]
  // The core refuses to delete the default site, and a locale row is not part of its creation.
  for (const row of rows.filter((candidate) => candidate.locale !== locale)) {
    await strapi.db.query(SITE_UID).delete({ where: { id: row.id } })
  }
  await sites.update({
    documentId: rows[0].documentId,
    locale,
    data: {
      name: 'Micelio',
      defaultLocale: locale === 'es' ? 'es' : 'en',
      description: null,
      tagline: null,
      url: null,
      addressLocality: null,
      author: null,
      logo: null,
      favicon: null,
      defaultOgImage: null,
      socialLinks: [],
      contactEmail: null,
      privacyContactEmail: null,
      securityContact: null,
      privacyJurisdiction: null,
      privacyUpdatedAt: null,
      supportHandle: null,
      timezone: null,
      modules: {},
      theme: null,
      fediverse: null,
      homePage: null,
    },
  })
  await strapi.store.delete(COPY_MARKER)
}

/**
 * Creates the single type's rows (the boot no longer writes it: an instance upgraded from 0.6 is
 * the only one that has them), in `en` and `es`, with a value in every attribute it declares: the
 * identity, three images, the author, social links, the theme pin with an accent override, the
 * fediverse profile with its header, and the home page.
 */
export async function seedSingleType(): Promise<SeededSettings> {
  await ensureSpanish()
  const settings = strapi.documents(SITE_SETTING_UID as never) as unknown as {
    findFirst(params?: object): Promise<{ documentId: string } | null>
    create(params: object): Promise<{ documentId: string }>
    update(params: object): Promise<unknown>
  }
  const logo = await createImage('logo.png')
  const favicon = await createImage('favicon.png')
  const ogImage = await createImage('og.png')
  const header = await createImage('header.png')

  const pages = strapi.documents(PAGE_UID as never) as unknown as {
    create(params: object): Promise<{ documentId: string }>
    update(params: object): Promise<unknown>
  }
  const page = await pages.create({
    locale: 'en',
    data: { title: 'Home', slug: 'home', site: await defaultSiteRelation(strapi) },
  })
  await pages.update({
    documentId: page.documentId,
    locale: 'es',
    data: { title: 'Inicio', slug: 'inicio', site: await defaultSiteRelation(strapi) },
  })

  // Nothing in the code writes the single type any more: this is how a 0.6 database holds it.
  const { documentId } =
    (await settings.findFirst({ locale: 'en' })) ??
    (await settings.create({
      locale: 'en',
      data: { name: 'Micelio', defaultLocale: 'en', modules: {} },
    }))
  await settings.update({
    documentId,
    locale: 'en',
    data: {
      name: 'Acme Garden',
      description: 'A garden blog',
      tagline: 'Grow',
      addressLocality: 'Bogota',
      defaultLocale: 'es',
      url: 'https://garden.example.com',
      author: { name: 'Ada', url: 'https://ada.example.com' },
      logo: logo,
      favicon,
      defaultOgImage: ogImage,
      socialLinks: [
        { network: 'github', url: 'https://github.com/acme' },
        { network: 'mastodon', url: 'https://social.example/@acme' },
      ],
      contactEmail: 'hello@garden.example.com',
      privacyContactEmail: 'privacy@garden.example.com',
      securityContact: 'mailto:security@garden.example.com',
      privacyJurisdiction: 'colombia',
      privacyUpdatedAt: '2026-01-15T10:00:00.000Z',
      supportHandle: 'acme',
      timezone: 'America/Bogota',
      modules: { comments: false },
      theme: {
        themeId: 'paper',
        themeVersion: '1.2.0',
        themeDigest: DIGEST,
        defaultMode: 'dark',
        accentOverrides: [{ mode: 'dark', color: '#112233' }],
        displayFont: 'fraunces',
      },
      fediverse: {
        username: 'acme',
        displayName: 'Acme Garden',
        summary: 'Plants and posts',
        header,
        discoverable: false,
        objectType: 'article',
        sourceUrl: 'https://garden.example.com/about',
      },
      homePage: page.documentId,
    },
  })
  await settings.update({
    documentId,
    locale: 'es',
    data: {
      name: 'Huerta Acme',
      description: 'Un blog de huerta',
      tagline: 'Cultiva',
      addressLocality: 'Bogotá',
      homePage: page.documentId,
    },
  })
  return {
    mediaIds: { logo, favicon, ogImage, header },
    homePage: { en: 'Home', es: 'Inicio' },
    pageDocumentId: page.documentId,
  }
}

/** A media file as a populated site returns it. */
interface Media {
  id: number
}

/** A site row as the Document Service returns it, with what the suites read. */
export interface SiteRow {
  documentId: string
  name: string
  description: string
  tagline: string
  addressLocality: string
  defaultLocale: string
  url: string
  privacyUpdatedAt: string
  author: { name: string; url: string }
  logo: Media
  favicon: Media
  defaultOgImage: Media
  socialLinks: { network: string; url: string }[]
  modules: Record<string, boolean>
  theme: { themeVersion: string; accentOverrides: { mode: string; color: string }[] }
  fediverse: { username: string; header: Media }
  homePage: { documentId: string; title: string }
}

/** The default site in one locale, with every relation, media and component populated. */
export async function readSite(locale: string): Promise<SiteRow | null> {
  const site = (await strapi.db
    .query(SITE_UID)
    .findOne({ where: { isDefault: true }, select: ['documentId'] })) as { documentId: string }
  const sites = strapi.documents(SITE_UID as never) as unknown as {
    findOne(params: object): Promise<SiteRow | null>
  }
  return sites.findOne({
    documentId: site.documentId,
    locale,
    populate: {
      author: true,
      logo: true,
      favicon: true,
      defaultOgImage: true,
      socialLinks: true,
      modules: true,
      theme: { populate: { accentOverrides: true } },
      fediverse: { populate: { header: true } },
      homePage: true,
    },
  })
}
