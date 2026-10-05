/**
 * The frontend's base URL, and article paths on it. The frontend serves its default locale without
 * a prefix (Nuxt i18n `prefix_except_default`) and every other locale under
 * `/<locale>`. Copy of the fediverse plugin's `parseFrontendArticleUrl`, which
 * the root can't import (see "Where code goes" in AGENTS.md), reduced to paths:
 * Umami reports paths, not full URLs.
 */

/** Where the frontend runs when `FRONTEND_URL` is unset outside production. */
export const DEV_FRONTEND_URL = 'http://localhost:3000';

/**
 * The frontend's base URL (`FRONTEND_URL`). Outside production it defaults to
 * a local Nuxt dev server; in production it is required, and
 * {@link assertFrontendUrlConfigured} stops the boot without it instead of
 * sending links to another site.
 */
export function frontendBaseUrl(): string {
  const value = process.env.FRONTEND_URL?.trim();
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FRONTEND_URL is required in production: the URL of the frontend');
  }
  return DEV_FRONTEND_URL;
}

/** Fails the boot when `FRONTEND_URL` is missing in production or is not a URL. */
export function assertFrontendUrlConfigured(): void {
  const value = frontendBaseUrl();
  try {
    new URL(value);
  } catch {
    throw new Error(`FRONTEND_URL is not a valid URL: "${value}"`);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Slug and locale of a frontend article path, or null if it isn't one. */
export function parseFrontendArticlePath(
  pathname: string
): { slug: string; locale: string } | null {
  const base = new URL(frontendBaseUrl());
  const template = process.env.FRONTEND_ARTICLE_PATH ?? '/blog/{slug}';
  const [before, after] = template.split('{slug}');
  const basePath = base.pathname.replace(/\/+$/, '');
  const pattern = new RegExp(
    `^${escapeRegExp(basePath)}(?:/([A-Za-z]{2}(?:-[A-Za-z]{2})?))?${escapeRegExp(before)}([^/]+)${escapeRegExp(after ?? '')}/?$`
  );
  const match = pattern.exec(pathname);
  if (!match) return null;

  let slug: string;
  try {
    slug = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  return { locale: match[1] ?? process.env.FRONTEND_DEFAULT_LOCALE ?? 'en', slug };
}
