import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'

// Self-contained on purpose (standard, section 6): the single type and the markers are named here
// so the step keeps working after `api::site-setting` is retired (ADR-0017, amendment of
// 2026-10-26, D6).
const SITE_SETTING_UID = 'api::site-setting.site-setting'
const MARKER = { type: 'core', name: 'migrations', key: 'site-settings-to-site' }
const VERSION = 1

/** Locales the core writes its default site in, as `ensureDefaultSite` of the core does. */
const SITE_LOCALES = ['en', 'es']
/** The name the core gives the default site it creates. */
const CORE_DEFAULT_NAME = 'Micelio'

interface Attribute {
  type: string
  component?: string
  repeatable?: boolean
  multiple?: boolean
  pluginOptions?: { i18n?: { localized?: boolean } }
}

type Attributes = Record<string, Attribute>
type Row = Record<string, unknown>

/** What the step did, for the boot log. */
export interface SiteSettingsCopyReport {
  /** Locales of the single type that were visited. */
  locales: string[]
  /** Attributes written, as `<locale>.<attribute>`. */
  written: string[]
  /** Attributes the site refused, as `<locale>.<attribute>`; the marker is not set while any. */
  failed: string[]
}

/** What Strapi adds to every type; the single type does not declare them and they are not copied. */
const SYSTEM_ATTRIBUTES = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
])

const isLocalized = (attribute: Attribute): boolean =>
  attribute.pluginOptions?.i18n?.localized === true

function componentAttributes(strapi: Core.Strapi, uid: string): Attributes {
  const component = (strapi.components as unknown as Record<string, { attributes: Attributes }>)[
    uid
  ]
  if (!component) throw new Error(`The component ${uid} is not registered`)
  return component.attributes
}

/** The `populate` that reaches every media, relation and component of `attributes`, nested too. */
function populateFor(strapi: Core.Strapi, attributes: Attributes): Record<string, unknown> {
  const populate: Record<string, unknown> = {}
  for (const [name, attribute] of Object.entries(attributes)) {
    if (attribute.type === 'media' || attribute.type === 'relation') {
      populate[name] = true
    } else if (attribute.type === 'component') {
      const nested = populateFor(strapi, componentAttributes(strapi, attribute.component as string))
      populate[name] = Object.keys(nested).length > 0 ? { populate: nested } : true
    }
  }
  return populate
}

/** True for a value that holds nothing: no value, an empty string or list, a component of those. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.every(isEmpty)
  if (typeof value === 'object') {
    return Object.entries(value as Row).every(([key, nested]) => key === 'id' || isEmpty(nested))
  }
  return false
}

/** True when every flag of a `site.modules` value is on: what the core creates the site with. */
function isCoreDefaultModules(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value as Row).every(([key, flag]) => key === 'id' || flag === true)
}

/**
 * Turns a value read with `populate` into the input of a write: no row ids, media and relations
 * named by id and `documentId`.
 */
function inputFor(strapi: Core.Strapi, attribute: Attribute, value: unknown): unknown {
  if (attribute.type === 'media') {
    if (Array.isArray(value)) return value.map((file) => (file as { id: number }).id)
    return (value as { id: number }).id
  }
  if (attribute.type === 'relation') {
    return (value as { documentId: string }).documentId
  }
  if (attribute.type === 'component') {
    const nested = componentAttributes(strapi, attribute.component as string)
    const entryInput = (entry: Row): Row => {
      const input: Row = {}
      for (const [name, child] of Object.entries(nested)) {
        const childValue = entry[name]
        if (childValue === null || childValue === undefined) continue
        input[name] = inputFor(strapi, child, childValue)
      }
      return input
    }
    return Array.isArray(value)
      ? value.map((entry) => entryInput(entry as Row))
      : entryInput(value as Row)
  }
  return value
}

/**
 * Whether the default site already holds a value of its own for an attribute, as opposed to none
 * or what the core gave it when it created the site.
 */
function siteHoldsValue(name: string, value: unknown, defaultLocale: string): boolean {
  if (isEmpty(value)) return false
  if (name === 'name') return value !== CORE_DEFAULT_NAME
  if (name === 'modules') return !isCoreDefaultModules(value)
  if (name === 'defaultLocale')
    return value !== (SITE_LOCALES.includes(defaultLocale) ? defaultLocale : 'en')
  return true
}

/**
 * Copies every attribute of `api::site-setting` into the default site (`plugin::micelio.site`), per
 * locale, once (ADR-0017, section 4, and D3 of the amendment of 2026-10-26).
 *
 * @remarks
 * The single type stays where it is and the readers keep reading it: this only fills the site. The
 * attributes are the ones the single type declares, so a field added to it later is copied too;
 * media, components and the `homePage` relation travel with them. A localized attribute is copied
 * in each locale of the single type (the site gets the locale it lacks), a non-localized one from
 * the default locale. A value the site already holds is never overwritten: an attribute is written
 * only when the site's is empty, or is what the core gave the site when it created it (the name
 * `Micelio`, every module on, the default locale). A store marker records that it ran, so the later
 * edits of the single type are not copied again and a second boot writes nothing. Runs after
 * `ensureDefaultSiteUrl`, which gives the site the origin of the frontend as its `url`.
 *
 * Three failures are logged and retried, not thrown, since nothing reads the copy yet: the default
 * site lacks an attribute of the single type (the installed core is older than the single type
 * needs: nothing is written), no site has `isDefault`, or the site refuses a value. The step logs
 * with `strapi.log.error`, naming the attributes and never their values, and leaves the marker
 * unset so the next boot tries again; a value already written is then left alone. While a value
 * stays refused the marker is never set. A read that fails (`findFirst`, the site's `findOne`, the
 * default locale, a component schema) is not caught and still stops the boot.
 *
 * @returns What was written and refused, or `null` when it had already run, there is nothing to
 * copy or it could not start.
 */
export async function copySiteSettingsToSite(
  strapi: Core.Strapi
): Promise<SiteSettingsCopyReport | null> {
  if (await strapi.store.get(MARKER)) return null

  const source = strapi.contentType(SITE_SETTING_UID as UID.ContentType)
  const target = strapi.contentType(SITE_UID as UID.ContentType)
  // The single type's own attributes: the runtime schema adds the system fields to them.
  const sourceAttributes = Object.fromEntries(
    Object.entries(source.attributes as unknown as Attributes).filter(
      ([name]) => !SYSTEM_ATTRIBUTES.has(name)
    )
  )
  const targetAttributes = target.attributes as unknown as Attributes
  const missing = Object.keys(sourceAttributes).filter((name) => !(name in targetAttributes))
  if (missing.length > 0) {
    strapi.log.error(
      `[sites] the default site has no attribute for ${missing.join(', ')} of the site settings: update @micelio/strapi-plugin-core; nothing was copied`
    )
    return null
  }

  const rows = (await strapi.db
    .query(SITE_SETTING_UID)
    .findMany({ select: ['documentId', 'locale'] })) as { documentId: string; locale: string }[]
  if (rows.length === 0) return null
  const site = (await strapi.db
    .query(SITE_UID)
    .findOne({ where: { isDefault: true }, select: ['documentId'] })) as {
    documentId: string
  } | null
  if (!site) {
    strapi.log.error('[sites] there is no default site to copy the site settings into')
    return null
  }
  const siteLocales = (
    (await strapi.db
      .query(SITE_UID)
      .findMany({ where: { documentId: site.documentId }, select: ['locale'] })) as {
      locale: string
    }[]
  ).map((row) => row.locale)

  const defaultLocale = (await (
    strapi.plugin('i18n').service('locales') as { getDefaultLocale: () => Promise<string> }
  ).getDefaultLocale()) as string
  // The default locale first: it carries the attributes that are not localized.
  const locales = rows
    .map((row) => row.locale)
    .sort((a, b) => Number(b === defaultLocale) - Number(a === defaultLocale))

  const settings = strapi.documents(SITE_SETTING_UID as UID.ContentType)
  const sites = strapi.documents(SITE_UID as UID.ContentType)
  const populate = populateFor(strapi, sourceAttributes)
  // The host's types do not know the core's attributes.
  type Data = Parameters<typeof sites.update>[0]['data']

  const report: SiteSettingsCopyReport = { locales, written: [], failed: [] }
  const readSite = async (locale: string): Promise<Row | null> =>
    (await sites.findOne({ documentId: site.documentId, locale, populate } as never)) as Row | null
  const write = async (locale: string, data: Row): Promise<void> => {
    await sites.update({ documentId: site.documentId, locale, data: data as unknown as Data })
  }
  for (const locale of locales) {
    const first = locale === locales[0]
    const from = (await settings.findFirst({ locale, populate } as never)) as Row | null
    if (!from) continue
    // A localized value is held by the site's row of the same locale. A value that is not localized
    // is shared by the rows, so any row of the site holds it, even when none is in this locale.
    const own = siteLocales.includes(locale) ? await readSite(locale) : null
    const shared = own ?? (siteLocales.length > 0 ? await readSite(siteLocales[0]) : null)
    const data: Row = {}
    for (const [name, attribute] of Object.entries(sourceAttributes)) {
      if (!first && !isLocalized(attribute)) continue
      const value = from[name]
      if (isEmpty(value)) continue
      const held = isLocalized(attribute) ? own : shared
      if (held && siteHoldsValue(name, held[name], defaultLocale)) continue
      data[name] = inputFor(strapi, attribute, value)
    }
    if (Object.keys(data).length === 0) continue
    try {
      await write(locale, data)
      report.written.push(...Object.keys(data).map((name) => `${locale}.${name}`))
    } catch {
      // One refused value must not keep the rest out: try each attribute on its own.
      for (const [name, value] of Object.entries(data)) {
        try {
          await write(locale, { [name]: value })
          report.written.push(`${locale}.${name}`)
        } catch (error) {
          report.failed.push(`${locale}.${name}`)
          strapi.log.error(
            `[sites] the default site refused ${locale}.${name} of the site settings (${error instanceof Error ? error.name : 'error'})`
          )
        }
      }
    }
  }

  if (report.failed.length > 0) return report
  await strapi.store.set({ ...MARKER, value: { version: VERSION } })
  return report
}
