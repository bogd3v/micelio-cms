import type { Core } from '@strapi/strapi'

import { ACTOR_IDENTIFIER, ACTOR_USERNAME } from '../constants/actor'
import { GLOBAL_UID, SITE_SETTING_UID } from '../constants/uids'
import type { ActorProfile } from '../types/actor-profile'
import { frontendBaseUrl } from '../utils/frontend-url'

const DEFAULT_NAME = 'Micelio'
// Micelio's own code, not the site's: every instance runs it.
const DEFAULT_SOURCE_URL = 'https://github.com/bogd3v/micelio-cms'

interface Media {
  url?: string | null
}

interface GlobalSettings {
  siteName?: string | null
  siteDescription?: string | null
  favicon?: Media | null
  fediverseHeader?: Media | null
}

/** The `fediverse` component of the site settings (`site.fediverse`). */
interface FediverseSettings {
  username?: string | null
  displayName?: string | null
  summary?: string | null
  header?: Media | null
  discoverable?: boolean | null
  sourceUrl?: string | null
}

interface SiteSettings {
  name?: string | null
  description?: string | null
  fediverse?: FediverseSettings | null
}

function absoluteUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null
  try {
    return new URL(url, baseUrl).href
  } catch {
    return null
  }
}

function frontendHome(): string {
  return new URL(frontendBaseUrl()).href
}

/** The first of the values that is not empty or only spaces, trimmed. */
function firstFilled(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return null
}

/**
 * Reads the site settings of the default locale with the component's header
 * populated: the document service does not populate media by itself.
 */
async function loadSiteSettings(strapi: Core.Strapi): Promise<SiteSettings | null> {
  try {
    return (await strapi.documents(SITE_SETTING_UID).findFirst({
      populate: { fediverse: { populate: { header: true } } },
    })) as SiteSettings | null
  } catch (error) {
    strapi.log.warn('[fediverse] failed to load site settings for actor profile', { error })
    return null
  }
}

function resolveUsername(settings: SiteSettings | null): string {
  return firstFilled(settings?.fediverse?.username, ACTOR_USERNAME, ACTOR_IDENTIFIER) ?? ''
}

/**
 * The handle's `@user` (`preferredUsername`): the site settings' `fediverse.username`, then the
 * deprecated `FEDIVERSE_ACTOR_USERNAME`, then the actor identifier.
 */
export async function getActorUsername(strapi: Core.Strapi): Promise<string> {
  return resolveUsername(await loadSiteSettings(strapi))
}

/**
 * Usernames WebFinger resolves to the blog, lowercase: the current handle and, as former handles,
 * the deprecated `FEDIVERSE_ACTOR_USERNAME` and the identifier.
 */
export async function getActorUsernames(strapi: Core.Strapi): Promise<string[]> {
  const usernames = [await getActorUsername(strapi), ACTOR_USERNAME, ACTOR_IDENTIFIER]
  return [...new Set(usernames.filter(Boolean).map((username) => username.toLowerCase()))]
}

/**
 * Resolves the blog actor's profile. The `fediverse` component of the site settings wins; each
 * empty field falls back, in order, to what a site had before it existed, so no site changes
 * until its editor fills the component:
 *
 *   username ← fediverse.username → FEDIVERSE_ACTOR_USERNAME → the actor identifier
 *   name     ← fediverse.displayName → global.siteName → site-setting.name → FEDIVERSE_ACTOR_NAME → "Micelio"
 *   summary  ← fediverse.summary → global.siteDescription → site-setting.description → FEDIVERSE_ACTOR_SUMMARY → none
 *   icon     ← global.favicon (resolved against the actor URL)
 *   header   ← fediverse.header → global.fediverseHeader (resolved against the actor URL)
 *   fields   ← Blog (FRONTEND_URL) and Código (fediverse.sourceUrl → FEDIVERSE_ACTOR_SOURCE_URL → this repository)
 *
 * `discoverable` is true unless the component says otherwise. `about.title` is deliberately not
 * a fallback: it's the About page heading ("Acerca de este blog"), not a name. The `FEDIVERSE_ACTOR_*`
 * variables are deprecated (a boot warning names the setting that replaces each); `global`'s
 * `fediverseHeader` is too.
 */
export async function getActorProfile(strapi: Core.Strapi, baseUrl: string): Promise<ActorProfile> {
  let globalSettings: GlobalSettings | null = null

  try {
    globalSettings = (await strapi.documents(GLOBAL_UID).findFirst({
      populate: { favicon: true, fediverseHeader: true },
    })) as GlobalSettings | null
  } catch (error) {
    strapi.log.warn('[fediverse] failed to load global settings for actor profile', { error })
  }

  // The default locale, like every other read of the actor.
  const siteSettings = await loadSiteSettings(strapi)
  const fediverse = siteSettings?.fediverse

  const url = frontendHome()
  const name =
    firstFilled(
      fediverse?.displayName,
      globalSettings?.siteName,
      siteSettings?.name,
      process.env.FEDIVERSE_ACTOR_NAME
    ) ?? DEFAULT_NAME
  const summary = firstFilled(
    fediverse?.summary,
    globalSettings?.siteDescription,
    siteSettings?.description,
    process.env.FEDIVERSE_ACTOR_SUMMARY
  )
  const sourceUrl =
    firstFilled(fediverse?.sourceUrl, process.env.FEDIVERSE_ACTOR_SOURCE_URL) ?? DEFAULT_SOURCE_URL

  return {
    username: resolveUsername(siteSettings),
    name,
    summary,
    iconUrl: absoluteUrl(globalSettings?.favicon?.url, baseUrl),
    headerUrl: absoluteUrl(fediverse?.header?.url ?? globalSettings?.fediverseHeader?.url, baseUrl),
    discoverable: fediverse?.discoverable ?? true,
    url,
    fields: [
      { name: 'Blog', url },
      { name: 'Código', url: sourceUrl },
    ],
  }
}

export default (): {
  getActorProfile: typeof getActorProfile
} => ({
  getActorProfile,
})
