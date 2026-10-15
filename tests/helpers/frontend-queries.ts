// The Strapi queries the frontend sends (micelio: `server/lib/constants.ts`,
// `server/utils/pageSections.ts`, `server/utils/site.ts` and the routes under
// `server/api/`), copied so the field suites call the CMS as the frontend does.
// When micelio changes a query, change it here and re-read the response fields.
// Copied from micelio at commit ba1fc0e1a3b792ecd5f124c8df0c748b7fec3798
// (`git -C ../micelio rev-parse HEAD`); `tests/frontend-queries.test.ts` compares
// the populate constants with a checkout of micelio when there is one.

const IMAGE = { fields: ['url', 'alternativeText', 'caption', 'width', 'height'] };

/** `POST_CARD_POPULATE`: a post of a list. */
export const POST_CARD_POPULATE = {
  cover: IMAGE,
  category: { fields: ['name', 'slug'] },
  author: { fields: ['name'], populate: { avatar: IMAGE } },
  seo: { populate: { metaImage: IMAGE } },
  tags: { fields: ['name', 'slug'] },
};

/** `ARTICLE_POPULATE`: a whole article. */
export const ARTICLE_POPULATE = {
  ...POST_CARD_POPULATE,
  coverCredit: true,
  blocks: {
    on: {
      'shared.rich-text': true,
      'shared.quote': true,
      'shared.media': { populate: { file: IMAGE, credit: true } },
      'shared.playground': true,
      'shared.slider': {
        populate: { items: { populate: { file: IMAGE, credit: true } }, files: IMAGE },
      },
    },
  },
  references: true,
  localizations: { fields: ['slug', 'locale', 'publishedAt'] },
};

/** `ABOUT_POPULATE`: the About page and its blocks. */
export const ABOUT_POPULATE = {
  blocks: {
    on: {
      'about.profile': { populate: { facts: true, links: true, photo: IMAGE } },
      'about.statement': true,
      'about.topics': { populate: { topics: true } },
      'about.projects': {
        populate: { projects: { populate: { facts: true, stack: true, links: true } } },
      },
      'about.principles': { populate: { principles: true } },
      'about.open-source': { populate: { guide: true } },
      'about.contact': { populate: { fediverseLink: true, extraLink: true, socials: true } },
      'shared.rich-text': true,
      'shared.quote': true,
      'shared.media': { populate: { file: IMAGE, credit: true } },
      'shared.slider': {
        populate: { items: { populate: { file: IMAGE, credit: true } }, files: IMAGE },
      },
    },
  },
  seo: { populate: { metaImage: IMAGE } },
};

/** `PAGE_POPULATE`: a page and its sections. */
export const PAGE_POPULATE = {
  seo: { populate: '*' },
  localizations: { fields: ['slug', 'locale'] },
  sections: {
    on: {
      'section.hero': { populate: { primaryLink: true, secondaryLink: true, media: true } },
      'section.feature-grid': { populate: { items: { populate: { icon: true } } } },
      'section.media-showcase': { populate: { media: true, link: true } },
      'section.stats': { populate: { items: true } },
      'section.logo-cloud': { populate: { logos: { populate: { image: true } } } },
      'section.testimonials': { populate: { items: { populate: { avatar: true } } } },
      'section.pricing': { populate: { plans: { populate: { link: true } } } },
      'section.faq': { populate: { items: true } },
      'section.cta': { populate: { primaryLink: true, secondaryLink: true } },
      'section.post-list': {
        populate: { category: { fields: ['slug'] }, tag: { fields: ['slug'] } },
      },
      'section.newsletter': { populate: '*' },
      'section.rich-text': { populate: '*' },
      'section.gallery': { populate: { images: true } },
      'section.scene': { populate: { model: true, poster: true } },
    },
  },
};

/** `SITE_POPULATE`: the site settings. */
export const SITE_POPULATE = {
  author: true,
  logo: true,
  favicon: true,
  defaultOgImage: true,
  socialLinks: true,
  modules: true,
  theme: { populate: '*' },
  homePage: { fields: ['slug'] },
};
