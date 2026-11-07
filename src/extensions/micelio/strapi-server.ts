// Gives the core's `category` and `tag` the inverse side of `article.category` and `article.tags`,
// and its `site` the `homePage` of the single type `site-setting`.
//
// A plugin's type cannot target a type of the host, so the core cannot declare `articles` or
// `homePage`; the distribution adds them while `article` and `page` are still its own (ADR-0017,
// amendment of 2026-10-26, D5), as
// `src/extensions/comments/strapi-server.ts` does for `strapi-plugin-comments`. It is an extension
// rather than a `schema.json` because Strapi merges schema files shallowly: a `schema.json` that
// declared `attributes` would replace every attribute of the core's type. The attribute moves into
// the core together with the type it targets.
interface TaxonomySchema {
  attributes: Record<string, unknown>
}

interface MicelioPlugin {
  contentTypes: {
    category: { schema: TaxonomySchema }
    tag: { schema: TaxonomySchema }
    site: { schema: TaxonomySchema }
  }
}

export default (plugin: MicelioPlugin): MicelioPlugin => {
  const { category, tag, site } = plugin.contentTypes

  category.schema.attributes = {
    ...category.schema.attributes,
    articles: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'api::article.article',
      mappedBy: 'category',
    },
  }
  tag.schema.attributes = {
    ...tag.schema.attributes,
    articles: {
      type: 'relation',
      relation: 'manyToMany',
      target: 'api::article.article',
      mappedBy: 'tags',
    },
  }

  // The page the site opens on, per locale, as `api::site-setting.homePage` is.
  site.schema.attributes = {
    ...site.schema.attributes,
    homePage: {
      type: 'relation',
      relation: 'oneToOne',
      target: 'api::page.page',
      pluginOptions: { i18n: { localized: true } },
    },
  }

  return plugin
}
