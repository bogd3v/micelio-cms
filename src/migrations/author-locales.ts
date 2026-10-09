import type { Core } from '@strapi/strapi';
import { ARTICLE_UID, AUTHOR_UID } from '../constants/uids';
import {
  configuredLocales,
  createMissingAuthorLocales,
  type AuthorBase,
} from '../utils/author-locales';

/** What `ensureAuthorLocales` changed in one run. */
export interface AuthorLocalesReport {
  /** Author localizations created. */
  created: number;
  /** Article-to-author links moved to the author's row in the article's locale. */
  relinked: number;
}

type AuthorRow = AuthorBase & { documentId: string; locale: string | null };

/**
 * Authors became localized (only `bio` differs per language). Makes sure
 * every author exists in every configured locale, then points every article
 * row (draft and published, every locale) at its author's row in the
 * article's own locale. The links are rewritten in the join table so the
 * articles' `updatedAt` stays as it was: touching it would make published
 * articles show as modified. Idempotent.
 */
export async function ensureAuthorLocales(strapi: Core.Strapi): Promise<AuthorLocalesReport> {
  const report: AuthorLocalesReport = { created: 0, relinked: 0 };
  const locales = await configuredLocales(strapi);
  if (locales.length === 0) return report;

  const rows = (await strapi.db.query(AUTHOR_UID).findMany({
    populate: ['avatar'],
    orderBy: { id: 'asc' },
  })) as AuthorRow[];
  const byDocument = new Map<string, AuthorRow[]>();
  for (const row of rows) {
    byDocument.set(row.documentId, [...(byDocument.get(row.documentId) ?? []), row]);
  }

  for (const [documentId, localizations] of byDocument) {
    const existing = localizations.map((row) => row.locale).filter((l): l is string => !!l);
    report.created += await createMissingAuthorLocales(
      strapi,
      documentId,
      localizations[0],
      existing,
      locales
    );
  }

  report.relinked = await relinkArticleAuthors(strapi);
  return report;
}

/** Moves each article's author link to the same author document in the article's locale. */
async function relinkArticleAuthors(strapi: Core.Strapi): Promise<number> {
  const link = (
    strapi.db.metadata.get(ARTICLE_UID).attributes.author as unknown as {
      joinTable: {
        name: string;
        joinColumn: { name: string };
        inverseJoinColumn: { name: string };
      };
    }
  ).joinTable;
  const articles = strapi.db.metadata.get(ARTICLE_UID).tableName;
  const authors = strapi.db.metadata.get(AUTHOR_UID).tableName;
  const knex = strapi.db.connection;
  const documentIdColumn =
    (
      strapi.db.metadata.get(AUTHOR_UID).attributes.documentId as
        { columnName?: string } | undefined
    )?.columnName ?? 'document_id';
  const articleColumn = link.joinColumn.name;
  const authorColumn = link.inverseJoinColumn.name;

  // Links whose author is in another locale than the article.
  const mismatched = (await knex(link.name)
    .join(articles, `${articles}.id`, `${link.name}.${articleColumn}`)
    .join(authors, `${authors}.id`, `${link.name}.${authorColumn}`)
    .whereNotNull(`${articles}.locale`)
    .whereNotNull(`${authors}.locale`)
    .whereRaw('?? <> ??', [`${articles}.locale`, `${authors}.locale`])
    .select({
      linkId: `${link.name}.id`,
      documentId: `${authors}.${documentIdColumn}`,
      locale: `${articles}.locale`,
    })) as { linkId: number; documentId: string; locale: string }[];

  let relinked = 0;
  for (const { linkId, documentId, locale } of mismatched) {
    const target = (await knex(authors)
      .where({ [documentIdColumn]: documentId, locale })
      .first('id')) as { id: number } | undefined;
    if (!target) continue;
    await knex(link.name)
      .where({ id: linkId })
      .update({ [authorColumn]: target.id });
    relinked += 1;
  }
  return relinked;
}
