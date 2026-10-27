import { withSiteScope } from '@micelio/strapi-plugin-core/strapi-server'

// A page belongs to a site (ADR-0017, section 4). This is `schema.ts` and not `schema.json` because
// Strapi reads a content type of `src/api` from the folder's file named `schema` and ignores an
// `index.ts` beside it, so the schema has to be code to go through `withSiteScope`.
export default withSiteScope({
  kind: 'collectionType',
  collectionName: 'pages',
  info: {
    singularName: 'page',
    pluralName: 'pages',
    displayName: 'Page',
    description: 'A page built from the section catalog (landing pages, home page)',
  },
  options: {
    draftAndPublish: true,
  },
  pluginOptions: {
    i18n: {
      localized: true,
    },
  },
  attributes: {
    title: {
      type: 'string',
      required: true,
      pluginOptions: {
        i18n: {
          localized: true,
        },
      },
    },
    slug: {
      type: 'uid',
      regex: '^(?!\\.{1,2}$)[A-Za-z0-9-_.~]*$',
      targetField: 'title',
      required: true,
      pluginOptions: {
        i18n: {
          localized: true,
        },
      },
    },
    seo: {
      type: 'component',
      repeatable: false,
      component: 'shared.seo',
      pluginOptions: {
        i18n: {
          localized: true,
        },
      },
    },
    sections: {
      type: 'dynamiczone',
      components: [
        'section.hero',
        'section.feature-grid',
        'section.media-showcase',
        'section.stats',
        'section.logo-cloud',
        'section.testimonials',
        'section.pricing',
        'section.faq',
        'section.cta',
        'section.post-list',
        'section.newsletter',
        'section.rich-text',
        'section.gallery',
        'section.scene',
      ],
      pluginOptions: {
        i18n: {
          localized: true,
        },
      },
    },
  },
})
