/** A published article as the federation layer sees it. */

/** The image attached to a federated article. */
export interface MediaRecord {
  url: string;
  mime: string | null;
  alternativeText: string | null;
  /** Attribution line (HTML) owed by the image's license, when it has a credit. */
  creditHtml: string | null;
}

/** A published article with a slug: what its `Article` object and frontend link are built from. */
export interface ArticleRecord {
  documentId: string;
  title: string;
  description: string;
  slug: string;
  locale: string | null;
  publishedAt: string;
  updatedAt: string | null;
  image: MediaRecord | null;
}
