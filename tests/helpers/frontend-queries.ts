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
