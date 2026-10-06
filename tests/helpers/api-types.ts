/**
 * Shapes of the JSON the suites read from responses. Supertest types every
 * body as `any`; these name the fields a test relies on, nothing more.
 */

/** A comment as strapi-plugin-comments returns it, with our fediverse fields. */
export interface ApiComment {
  id: number;
  content: string;
  blocked?: boolean;
  approvalStatus?: string;
  author?: Record<string, unknown> | null;
  fediverseUri?: string | null;
  fediverseActorHandle?: string | null;
  children?: ApiComment[];
}

/** A document in a content API list (`data: [...]`). */
export interface ApiDocument {
  id: number;
  documentId: string;
  slug?: string | null;
  title?: string | null;
  locale?: string | null;
}

/**
 * An ActivityPub object or activity as JSON-LD (actor, Article, collection,
 * Create...). Only the fields the suites read are named; JSON-LD allows a
 * value or an array for most of them.
 */
export interface ActivityJson {
  id?: string;
  type?: string;
  actor?: string;
  object?: ActivityJson;
  name?: string;
  summary?: string;
  content?: string;
  url?: string;
  attributedTo?: string;
  to?: string | string[];
  cc?: string | string[];
  published?: string;
  image?: { url: string; mediaType?: string; name?: string };
  outbox?: string;
  totalItems?: number;
  orderedItems?: ActivityJson | ActivityJson[];
  [field: string]: unknown;
}

/** The site settings single type (`GET /api/site-setting?populate=*`). */
export interface ApiSiteSetting {
  documentId: string;
  locale: string;
  name: string;
  description: string | null;
  tagline?: string | null;
  timezone?: string | null;
  addressLocality?: string | null;
  url: string | null;
  defaultLocale: string;
  author: { name: string; url: string | null } | null;
  logo: unknown;
  favicon: unknown;
  defaultOgImage: unknown;
  socialLinks: { network: string; url: string }[];
  contactEmail: string | null;
  privacyContactEmail: string | null;
  privacyUpdatedAt: string | null;
  supportHandle: string | null;
  modules: Record<string, boolean>;
  theme: ApiSiteTheme | null;
}

export interface ApiSiteTheme {
  themeId: string | null;
  defaultMode: string | null;
  /** Only returned when populated explicitly (`populate[theme][populate]=*`). */
  accentOverrides?: { mode: string; color: string }[];
  displayFont: string | null;
}
