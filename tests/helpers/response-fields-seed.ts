// A minimal seed for the response field suites (ASVS V15.3.1,
// docs/security/response-fields.md): later changes grow it to one fully
// populated record of every content type.

const ARTICLE_UID = 'api::article.article';

/** Document ids of what `seedContent` created. */
export interface SeededContent {
  articleDocumentId: string;
  /** Another published article. */
  secondArticleDocumentId: string;
}

/** The Document Service without the generated types: the seed stores plain data. */
interface Articles {
  create(params: { data: Record<string, unknown> }): Promise<{ documentId: string }>;
  publish(params: { documentId: string }): Promise<unknown>;
}

async function publishedArticle(title: string, slug: string): Promise<string> {
  const articles = strapi.documents(ARTICLE_UID) as unknown as Articles;
  const article = await articles.create({ data: { title, slug, description: 'An article' } });
  await articles.publish({ documentId: article.documentId });
  return article.documentId;
}

/** Creates two published articles. */
export async function seedContent(): Promise<SeededContent> {
  return {
    articleDocumentId: await publishedArticle('Fields article', 'fields-article'),
    secondArticleDocumentId: await publishedArticle('Second article', 'fields-second'),
  };
}
