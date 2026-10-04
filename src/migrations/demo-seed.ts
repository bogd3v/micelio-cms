import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Core } from '@strapi/strapi';
import { ABOUT_UID, ARTICLE_UID, SITE_SETTING_UID } from '../constants/uids';
import { frontendBaseUrl } from '../utils/frontend-url';
import {
  coverSvg,
  DEMO_ABOUT,
  DEMO_ARTICLES,
  DEMO_AUTHOR,
  DEMO_CATEGORIES,
  DEMO_LOCALES,
  DEMO_LOGO_SVG,
  DEMO_SITE,
  DEMO_SOCIAL_LINKS,
  DEMO_TAGS,
  type DemoLocale,
} from './demo/content';

const AUTHOR_UID = 'api::author.author';
const CATEGORY_UID = 'api::category.category';
const TAG_UID = 'api::tag.tag';
// Marks that the demo content was written once; afterwards it is the user's.
const MARKER = { type: 'core', name: 'migrations', key: 'demo-seed' };
const VERSION = 1;

export type DemoSeedReport =
  'disabled' | 'applied' | 'skipped-existing-content' | 'already-applied';

type AnyData = Record<string, unknown>;
// The Document Service's generated types require every field; the demo sets
// the ones it needs and lets the defaults fill the rest.
const documents = (strapi: Core.Strapi, uid: string) =>
  strapi.documents(uid as never) as unknown as {
    create(params: AnyData): Promise<{ documentId: string; id: number }>;
    update(params: AnyData): Promise<unknown>;
    findFirst(params?: AnyData): Promise<{ documentId: string } | null>;
  };

async function uploadSvg(strapi: Core.Strapi, name: string, svg: string): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), 'micelio-demo-'));
  const filepath = path.join(dir, `${name}.svg`);
  try {
    await writeFile(filepath, svg);
    const { size } = await stat(filepath);
    const [file] = await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        files: { filepath, originalFilename: `${name}.svg`, mimetype: 'image/svg+xml', size },
        data: { fileInfo: { name: `${name}.svg`, alternativeText: '', caption: '' } },
      });
    return file.id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Makes sure every demo locale exists; the demo is bilingual. */
async function ensureLocales(strapi: Core.Strapi): Promise<void> {
  const locales = strapi.plugin('i18n').service('locales');
  for (const code of DEMO_LOCALES) {
    if (!(await locales.findByCode(code))) {
      await locales.create({ code, name: code === 'es' ? 'Spanish (es)' : 'English (en)' });
    }
  }
}

/**
 * When `MICELIO_DEMO=true`, writes the demo content once (#74): site settings
 * for a fictional site, an author, two categories, three tags, three
 * published articles with generated covers and an About page, in English and
 * Spanish. It never touches an instance that already has articles, and a
 * store marker keeps it from running again, so whatever the user changes or
 * deletes afterwards stays that way. Runs after `seedSiteSettings`.
 */
export async function seedDemoContent(strapi: Core.Strapi): Promise<DemoSeedReport> {
  if (process.env.MICELIO_DEMO !== 'true') return 'disabled';
  if (await strapi.store.get(MARKER)) return 'already-applied';
  if ((await strapi.db.query(ARTICLE_UID).count()) > 0) return 'skipped-existing-content';

  await ensureLocales(strapi);
  const [main, ...others] = DEMO_LOCALES;
  const forEachLocale = async (fn: (locale: DemoLocale) => Promise<unknown>) => {
    for (const locale of DEMO_LOCALES) await fn(locale);
  };

  const settings = await documents(strapi, SITE_SETTING_UID).findFirst();
  if (settings) {
    const logo = await uploadSvg(strapi, 'field-notes-logo', DEMO_LOGO_SVG);
    await forEachLocale((locale) =>
      documents(strapi, SITE_SETTING_UID).update({
        documentId: settings.documentId,
        locale,
        data: {
          ...DEMO_SITE[locale],
          // Set rather than left empty: the frontend falls back field by field
          // to its own config for what the site settings leave out.
          author: { name: DEMO_AUTHOR.name, url: `${frontendBaseUrl().replace(/\/+$/, '')}/about` },
          socialLinks: DEMO_SOCIAL_LINKS,
          contactEmail: DEMO_AUTHOR.email,
          privacyContactEmail: DEMO_AUTHOR.email,
          privacyUpdatedAt: new Date().toISOString(),
          logo,
          favicon: logo,
        },
      })
    );
  }

  const author = await documents(strapi, AUTHOR_UID).create({ data: DEMO_AUTHOR });

  const categoryIds: Record<string, string> = {};
  for (const category of DEMO_CATEGORIES) {
    const created = await documents(strapi, CATEGORY_UID).create({
      locale: main,
      data: { slug: category.slug, ...category.text[main] },
    });
    for (const locale of others) {
      await documents(strapi, CATEGORY_UID).update({
        documentId: created.documentId,
        locale,
        // Non-localized, but a new localization is validated with it.
        data: { slug: category.slug, ...category.text[locale] },
      });
    }
    categoryIds[category.slug] = created.documentId;
  }

  const tagIds: Record<string, string> = {};
  for (const tag of DEMO_TAGS) {
    const created = await documents(strapi, TAG_UID).create({
      locale: main,
      data: { slug: tag.slug, name: tag.name[main] },
    });
    for (const locale of others) {
      await documents(strapi, TAG_UID).update({
        documentId: created.documentId,
        locale,
        data: { slug: tag.slug, name: tag.name[locale] },
      });
    }
    tagIds[tag.slug] = created.documentId;
  }

  for (const article of DEMO_ARTICLES) {
    const cover = await uploadSvg(strapi, article.text[main].slug, coverSvg(article.palette));
    const dataFor = (locale: DemoLocale) => ({
      ...article.text[locale],
      cover,
      author: author.documentId,
      category: categoryIds[article.category],
      tags: article.tags.map((slug) => tagIds[slug]),
    });
    const created = await documents(strapi, ARTICLE_UID).create({
      locale: main,
      status: 'published',
      data: dataFor(main),
    });
    for (const locale of others) {
      await documents(strapi, ARTICLE_UID).update({
        documentId: created.documentId,
        locale,
        status: 'published',
        data: dataFor(locale),
      });
    }
  }

  let aboutId = (await documents(strapi, ABOUT_UID).findFirst())?.documentId;
  await forEachLocale(async (locale) => {
    const data = {
      title: DEMO_ABOUT[locale].title,
      blocks: [{ __component: 'shared.rich-text', body: DEMO_ABOUT[locale].body }],
    };
    if (aboutId) {
      // Updating a locale the document does not have yet creates that localization.
      await documents(strapi, ABOUT_UID).update({ documentId: aboutId, locale, data });
    } else {
      aboutId = (await documents(strapi, ABOUT_UID).create({ locale, data })).documentId;
    }
  });

  await strapi.store.set({ ...MARKER, value: { version: VERSION } });
  return 'applied';
}
