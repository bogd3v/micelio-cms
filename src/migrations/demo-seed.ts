import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Core } from '@strapi/strapi';
import { ABOUT_UID, ARTICLE_UID, AUTHOR_UID, PAGE_UID, SITE_SETTING_UID } from '../constants/uids';
import { frontendBaseUrl } from '../utils/frontend-url';
import {
  coverSvg,
  DEMO_ABOUT,
  DEMO_ARTICLES,
  DEMO_AUTHOR,
  DEMO_CATEGORIES,
  DEMO_LOCALES,
  DEMO_LOGO_SVG,
  DEMO_SHOWCASE_SLUG,
  DEMO_SITE,
  DEMO_SOCIAL_LINKS,
  DEMO_TAGS,
  iconSvg,
  showcaseSections,
  triangleGltf,
  type DemoLocale,
  type ShowcaseMedia,
} from './demo/content';

const CATEGORY_UID = 'api::category.category';
const TAG_UID = 'api::tag.tag';
// Marks that the demo content was written once; afterwards it is the user's.
const MARKER = { type: 'core', name: 'migrations', key: 'demo-seed' };
const VERSION = 1;
// `true` and `static` write the same site; `landing` also makes the showcase page the home page.
const DEMO_PROFILES = ['true', 'static', 'landing'];

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

async function uploadFile(
  strapi: Core.Strapi,
  filename: string,
  content: string,
  mimetype: string,
  caption = ''
): Promise<number> {
  const dir = await mkdtemp(path.join(tmpdir(), 'micelio-demo-'));
  const filepath = path.join(dir, filename);
  try {
    await writeFile(filepath, content);
    const { size } = await stat(filepath);
    const [file] = await strapi
      .plugin('upload')
      .service('upload')
      .upload({
        files: { filepath, originalFilename: filename, mimetype, size },
        data: { fileInfo: { name: filename, alternativeText: '', caption } },
      });
    return file.id;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const uploadSvg = (strapi: Core.Strapi, name: string, svg: string, caption = '') =>
  uploadFile(strapi, `${name}.svg`, svg, 'image/svg+xml', caption);

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
 * When `MICELIO_DEMO` is `true`, `static` or `landing`, writes the demo content
 * once (#74): site settings for a fictional site, an author, two categories,
 * three tags, three published articles with generated covers, an About page
 * and a page that uses every section of the catalog (#75), in English and
 * Spanish. `landing` also sets that page as the site settings' `homePage` in
 * each language (#84). Any other value leaves the demo disabled. It never
 * touches an instance that already has articles, and a store marker keeps it
 * from running again, so whatever the user changes or deletes afterwards stays
 * that way. Runs after `seedSiteSettings`.
 */
export async function seedDemoContent(strapi: Core.Strapi): Promise<DemoSeedReport> {
  const profile = process.env.MICELIO_DEMO ?? '';
  if (!DEMO_PROFILES.includes(profile)) return 'disabled';
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

  const showcaseId = await seedShowcasePage(strapi, categoryIds.garden);
  if (profile === 'landing' && settings) {
    // `homePage` is localized: each language points at its own version of the page.
    await forEachLocale((locale) =>
      documents(strapi, SITE_SETTING_UID).update({
        documentId: settings.documentId,
        locale,
        data: { homePage: showcaseId },
      })
    );
  }

  await strapi.store.set({ ...MARKER, value: { version: VERSION } });
  return 'applied';
}

/** A published page with every section of the catalog, in both languages (#75). */
async function seedShowcasePage(strapi: Core.Strapi, category: string): Promise<string> {
  const [main, ...others] = DEMO_LOCALES;
  const palettes = DEMO_ARTICLES.map((article) => article.palette);
  const gallery: number[] = [];
  for (const [index, palette] of palettes.entries()) {
    gallery.push(
      await uploadSvg(strapi, `showcase-${index + 1}`, coverSvg(palette), `Season ${index + 1}`)
    );
  }
  const shapes = ['circle', 'square', 'triangle'] as const;
  const icons = [] as number[];
  const logos = [] as number[];
  for (const [index, shape] of shapes.entries()) {
    icons.push(await uploadSvg(strapi, `icon-${shape}`, iconSvg(palettes[index][1], shape)));
    logos.push(await uploadSvg(strapi, `logo-${shape}`, iconSvg('#5a5a5a', shape)));
  }
  const media: ShowcaseMedia = {
    hero: gallery[0],
    icons: icons as ShowcaseMedia['icons'],
    logos: logos as ShowcaseMedia['logos'],
    gallery,
    poster: gallery[1],
    model: await uploadFile(strapi, 'triangle.gltf', triangleGltf(), 'model/gltf+json'),
    category,
  };

  const dataFor = (locale: DemoLocale) => ({
    title: locale === 'es' ? 'Muestra de secciones' : 'Section showcase',
    slug: DEMO_SHOWCASE_SLUG[locale],
    sections: showcaseSections(locale, media),
  });
  const created = await documents(strapi, PAGE_UID).create({
    locale: main,
    status: 'published',
    data: dataFor(main),
  });
  for (const locale of others) {
    await documents(strapi, PAGE_UID).update({
      documentId: created.documentId,
      locale,
      status: 'published',
      data: dataFor(locale),
    });
  }
  return created.documentId;
}
