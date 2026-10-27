import { defaultSiteRelation } from '../../src/utils/default-site'
import { SEEDED, credit, documents, seoOf, type SeededImages } from './response-fields-seed-base'

const ARTICLE_UID = 'api::article.article'
const AUTHOR_UID = 'api::author.author'
const CATEGORY_UID = 'plugin::micelio.category'
const TAG_UID = 'plugin::micelio.tag'

/** Document ids of the authors, taxonomy and articles `seedArticles` creates. */
export interface SeededArticles {
  articleDocumentId: string
  categoryDocumentId: string
  tagDocumentId: string
  authorDocumentId: string
  /** Another published article with a reading order, in the same category. */
  secondArticleDocumentId: string
}

/** Creates an author, a category, a tag and two published articles, one of them with every field and a Spanish translation. */
export async function seedArticles(images: SeededImages): Promise<SeededArticles> {
  const { cover, avatar, metaImage, slide: sliderFile } = images
  const seo = seoOf(metaImage)

  const author = await documents(AUTHOR_UID).create({
    data: {
      name: 'Ana Example',
      email: SEEDED.authorEmail,
      bio: 'Bio of the author',
      avatar,
    },
  })

  const site = await defaultSiteRelation(strapi)
  const category = await documents(CATEGORY_UID).create({
    data: {
      site,
      name: 'Fields category',
      slug: SEEDED.categorySlug,
      description: 'A category with every field',
      featured: true,
      color: 2,
      order: 3,
    },
  })

  const tag = await documents(TAG_UID).create({
    data: { name: 'Fields tag', slug: SEEDED.tagSlug, site },
  })

  const article = await documents(ARTICLE_UID).create({
    data: {
      title: 'Fields article',
      description: 'An article with every field',
      slug: SEEDED.articleSlug,
      cover,
      coverCredit: credit,
      author: author.documentId,
      category: category.documentId,
      tags: [tag.documentId],
      pathOrder: 1,
      seo,
      blocks: [
        { __component: 'shared.rich-text', body: 'Some **text**' },
        { __component: 'shared.quote', title: 'A quote', body: 'Quoted text' },
        { __component: 'shared.media', file: sliderFile, caption: 'A figure', credit },
        {
          __component: 'shared.playground',
          runtime: 'python',
          code: 'print(1)',
          expectedOutput: '1',
          setup: 'x = 1',
          caption: 'A snippet',
        },
        {
          __component: 'shared.slider',
          items: [{ file: sliderFile, caption: 'Slide', credit }],
          files: [sliderFile],
        },
      ],
      references: [
        {
          key: 'doe2026',
          type: 'journal',
          authors: 'Doe, J.',
          year: '2026',
          title: 'A study',
          container: 'Journal of Examples',
          volume: '3',
          issue: '2',
          pages: '1-10',
          venueLabel: 'JoE',
          doi: '10.0000/example',
          url: 'https://example.test/paper',
          accessedAt: '2026-01-02',
        },
      ],
    },
  })
  await documents(ARTICLE_UID).publish({ documentId: article.documentId })
  // A published translation, so `localizations` has an entry.
  await documents(ARTICLE_UID).update({
    documentId: article.documentId,
    locale: 'es',
    data: { title: 'Artículo de campos', slug: 'articulo-de-campos' },
  })
  await documents(ARTICLE_UID).publish({ documentId: article.documentId, locale: 'es' })

  const second = await documents(ARTICLE_UID).create({
    data: {
      title: 'Second article',
      slug: 'fields-second',
      description: 'Another article',
      category: category.documentId,
      pathOrder: 2,
    },
  })
  await documents(ARTICLE_UID).publish({ documentId: second.documentId })

  return {
    articleDocumentId: article.documentId,
    categoryDocumentId: category.documentId,
    tagDocumentId: tag.documentId,
    authorDocumentId: author.documentId,
    secondArticleDocumentId: second.documentId,
  }
}
