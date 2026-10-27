// Gives the core's `category` and `tag` the inverse side of `article.category` and `article.tags`.
//
// A plugin's type cannot target a type of the host, so the core cannot declare `articles`; the
// distribution adds it while `article` is still its own (ADR-0017, amendment of 2026-10-26, D5), as
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
  }
}

export default (plugin: MicelioPlugin): MicelioPlugin => {
  const { category, tag } = plugin.contentTypes

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

  return plugin
}
