import type { Core } from '@strapi/strapi';

import { GLOBAL_UID, SITE_SETTING_UID } from '../constants/uids';
import type { ActorProfile } from '../types/actor-profile';
import { frontendBaseUrl } from '../utils/frontend-url';

const DEFAULT_NAME = 'Micelio';
const DEFAULT_SUMMARY = 'A Micelio site, federated on the fediverse.';
// Micelio's own code, not the site's: every instance runs it.
const DEFAULT_SOURCE_URL = 'https://github.com/bogd3v/micelio-cms';

interface GlobalSettings {
  siteName?: string | null;
  siteDescription?: string | null;
  favicon?: { url?: string | null } | null;
  fediverseHeader?: { url?: string | null } | null;
}

function absoluteUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}

interface SiteSettings {
  name?: string | null;
  description?: string | null;
}

function frontendHome(): string {
  return new URL(frontendBaseUrl()).href;
}

/**
 * Resolves the blog actor's display profile from the `global` single type,
 * then the site settings, with env-var and neutral fallbacks so the actor is
 * always presentable even on a fresh install:
 *
 *   name    ← global.siteName → site-setting.name → FEDIVERSE_ACTOR_NAME → "Micelio"
 *   summary ← global.siteDescription → site-setting.description → FEDIVERSE_ACTOR_SUMMARY → default
 *   icon    ← global.favicon (resolved against the actor URL)
 *   header  ← global.fediverseHeader (resolved against the actor URL)
 *   fields  ← Blog (FRONTEND_URL) and Código (FEDIVERSE_ACTOR_SOURCE_URL)
 *
 * `about.title` is deliberately not a fallback: it's the About page heading
 * ("Acerca de este blog"), not a name.
 */
export async function getActorProfile(strapi: Core.Strapi, baseUrl: string): Promise<ActorProfile> {
  let globalSettings: GlobalSettings | null = null;

  try {
    globalSettings = (await strapi.documents(GLOBAL_UID).findFirst({
      populate: { favicon: true, fediverseHeader: true },
    })) as GlobalSettings | null;
  } catch (error) {
    strapi.log.warn('[fediverse] failed to load global settings for actor profile', { error });
  }

  let siteSettings: SiteSettings | null = null;
  try {
    // The default locale, like every other read of the actor.
    siteSettings = (await strapi.documents(SITE_SETTING_UID).findFirst()) as SiteSettings | null;
  } catch (error) {
    strapi.log.warn('[fediverse] failed to load site settings for actor profile', { error });
  }

  const name =
    globalSettings?.siteName ||
    siteSettings?.name ||
    process.env.FEDIVERSE_ACTOR_NAME ||
    DEFAULT_NAME;

  const summary =
    globalSettings?.siteDescription ||
    siteSettings?.description ||
    process.env.FEDIVERSE_ACTOR_SUMMARY ||
    DEFAULT_SUMMARY;

  const url = frontendHome();

  return {
    name,
    summary,
    iconUrl: absoluteUrl(globalSettings?.favicon?.url, baseUrl),
    headerUrl: absoluteUrl(globalSettings?.fediverseHeader?.url, baseUrl),
    url,
    fields: [
      { name: 'Blog', url },
      { name: 'Código', url: process.env.FEDIVERSE_ACTOR_SOURCE_URL || DEFAULT_SOURCE_URL },
    ],
  };
}

export default () => ({
  getActorProfile,
});
