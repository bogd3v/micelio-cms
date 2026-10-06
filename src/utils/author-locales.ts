/**
 * Authors are localized only for their `bio`: name, email and avatar are the
 * same in every language. Strapi connects an article's author in the article's
 * locale and fails when that localization does not exist, so every author must
 * exist in every configured locale.
 */

import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { AUTHOR_UID } from '../constants/uids';

/** The fields every localization of an author shares. */
export interface AuthorBase {
  name?: string | null;
  email?: string | null;
  avatar?: { id: number } | null;
}

type AnyData = Record<string, unknown>;

const authors = (strapi: Core.Strapi) =>
  strapi.documents(AUTHOR_UID as never) as unknown as {
    update(params: AnyData): Promise<unknown>;
  };

/** Codes of the configured i18n locales. */
export async function configuredLocales(strapi: Core.Strapi): Promise<string[]> {
  const locales = (await strapi.plugin('i18n').service('locales').find()) as { code: string }[];
  return locales.map((locale) => locale.code);
}

/**
 * Creates the localizations of an author document that are missing, copying
 * its shared fields and leaving `bio` empty. Returns how many were created.
 */
export async function createMissingAuthorLocales(
  strapi: Core.Strapi,
  documentId: string,
  base: AuthorBase,
  existing: string[],
  locales: string[]
): Promise<number> {
  let created = 0;
  for (const locale of locales) {
    if (existing.includes(locale)) continue;
    // Updating a locale the document does not have yet creates that localization.
    await authors(strapi).update({
      documentId,
      locale,
      data: {
        name: base.name ?? null,
        email: base.email ?? null,
        avatar: base.avatar?.id ?? null,
      },
    });
    created += 1;
  }
  return created;
}

/**
 * Creates the missing localizations of an author document from its row in
 * `locale`. Returns how many were created.
 */
async function localizeFrom(
  strapi: Core.Strapi,
  documentId: string,
  locale: string | undefined
): Promise<number> {
  const row = (await strapi.db.query(AUTHOR_UID).findOne({
    where: { documentId, ...(locale ? { locale } : {}) },
    populate: ['avatar'],
  })) as (AuthorBase & { locale: string }) | null;
  if (!row) return 0;
  return createMissingAuthorLocales(
    strapi,
    documentId,
    row,
    [row.locale],
    await configuredLocales(strapi)
  );
}

/**
 * Creates the author localizations a locale lacks, for every author. Used
 * when a locale is added after the authors exist. Returns how many were created.
 */
export async function createAuthorsForLocale(strapi: Core.Strapi, code: string): Promise<number> {
  const rows = (await strapi.db.query(AUTHOR_UID).findMany({
    populate: ['avatar'],
    orderBy: { id: 'asc' },
  })) as (AuthorBase & { documentId: string; locale: string | null })[];
  const byDocument = new Map<string, typeof rows>();
  for (const row of rows) {
    byDocument.set(row.documentId, [...(byDocument.get(row.documentId) ?? []), row]);
  }
  let created = 0;
  for (const [documentId, localizations] of byDocument) {
    const existing = localizations.map((row) => row.locale).filter((l): l is string => !!l);
    created += await createMissingAuthorLocales(strapi, documentId, localizations[0], existing, [
      code,
    ]);
  }
  return created;
}

/**
 * Document Service middleware for authors. After `create` or `clone` the other
 * localizations are created too (`update` is a different action, so this does
 * not recurse). A delete must cover every language: removing one localization
 * would leave articles pointing at a row that is gone.
 */
export function registerAuthorLocalesMiddleware(strapi: Core.Strapi): void {
  strapi.documents.use(async (context, next) => {
    if (context.uid !== AUTHOR_UID) return next();

    if (context.action === 'delete') {
      const params = context.params as { locale?: string };
      const locale = params.locale;
      // Without a locale Strapi deletes only the default one: cover every language.
      if (locale === undefined || locale === null) params.locale = '*';
      else if (locale !== '*') {
        const message = 'An author is deleted in every language at once';
        throw new errors.ValidationError(message, {
          errors: [{ path: ['locale'], message, name: 'ValidationError' }],
        });
      }
      return next();
    }

    const result = await next();
    // The extra localizations are written after the create commits: not atomic.
    if (context.action === 'create') {
      const created = result as { documentId?: string; locale?: string } | undefined;
      if (created?.documentId) await localizeFrom(strapi, created.documentId, created.locale);
    } else if (context.action === 'clone') {
      const cloned = result as { documentId?: string; entries?: { locale?: string }[] } | undefined;
      if (cloned?.documentId) {
        await localizeFrom(strapi, cloned.documentId, cloned.entries?.[0]?.locale);
      }
    }
    return result;
  });
}
