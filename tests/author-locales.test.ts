import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { ensureAuthorLocales } from '../src/migrations/author-locales';

// Authors are localized (only `bio` differs) so an article links to its author
// in its own language (#93).

const ARTICLE = 'api::article.article';
const AUTHOR = 'api::author.author';
const FRONTEND_KEY = 'author-frontend-token-0123456789abcdef012345678';
const BUILD_KEY = 'author-build-token-0123456789abcdef0123456789ab';

type AuthorRow = {
  id: number;
  documentId: string;
  locale: string;
  name: string | null;
  email: string | null;
  bio: string | null;
};
type ArticleRow = { id: number; documentId: string; locale: string; updatedAt: string };

describe('Author locales', () => {
  const saved = { ...process.env };
  const http = () => request(strapi.server.httpServer);
  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
  type Docs = {
    create(p: object): Promise<{ documentId: string; id: number }>;
    update(p: object): Promise<unknown>;
    findOne(p: object): Promise<{ author: Record<string, unknown> }>;
  };
  const authors = () => strapi.documents(AUTHOR) as unknown as Docs;
  const articles = () => strapi.documents(ARTICLE) as unknown as Docs;

  const authorRows = (documentId: string) =>
    strapi.db.query(AUTHOR).findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
    }) as Promise<AuthorRow[]>;

  function linkTable() {
    const link = (
      strapi.db.metadata.get(ARTICLE).attributes.author as unknown as {
        joinTable: {
          name: string;
          joinColumn: { name: string };
          inverseJoinColumn: { name: string };
        };
      }
    ).joinTable;
    return {
      table: link.name,
      article: link.joinColumn.name,
      author: link.inverseJoinColumn.name,
    };
  }

  /** The author row ids that the given article rows are linked to. */
  async function linkedAuthors(articleIds: number[]): Promise<Record<number, number[]>> {
    const { table, article, author } = linkTable();
    const rows = (await strapi.db.connection(table).whereIn(article, articleIds)) as Record<
      string,
      number
    >[];
    const result: Record<number, number[]> = {};
    for (const row of rows) (result[row[article]] ??= []).push(row[author]);
    return result;
  }

  async function createArticle(title: string, locale: string, authorDocumentId: string) {
    const created = (await articles().create({
      locale,
      data: { title, slug: title.toLowerCase().replace(/\s+/g, '-'), author: authorDocumentId },
      status: 'published',
    })) as ArticleRow;
    return created;
  }

  async function articleRows(documentId: string) {
    return (await strapi.db.query(ARTICLE).findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
    })) as (ArticleRow & { publishedAt: string | null })[];
  }

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY;
    process.env.BUILD_API_TOKEN = BUILD_KEY;
    await setupStrapi();
    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }
  });

  afterAll(async () => {
    await cleanupStrapi();
    process.env = { ...saved };
  });

  describe('creating an author', () => {
    it('creates the other localizations with the shared fields and an empty bio', async () => {
      const created = await authors().create({
        locale: 'en',
        data: { name: 'Ana Pérez', email: 'ana@example.com', bio: 'English bio' },
      });
      const rows = await authorRows(created.documentId);
      expect(rows.map((row) => row.locale).sort()).toEqual(['en', 'es']);
      const es = rows.find((row) => row.locale === 'es')!;
      expect(es).toMatchObject({ name: 'Ana Pérez', email: 'ana@example.com' });
      expect(es.bio).toBeNull();
      expect(rows.find((row) => row.locale === 'en')!.bio).toBe('English bio');
    });
  });

  describe('cloning and deleting', () => {
    type Extra = {
      clone(p: object): Promise<{ documentId: string; entries: { locale: string }[] }>;
      delete(p: object): Promise<unknown>;
    };
    const extra = () => strapi.documents(AUTHOR) as unknown as Extra;

    it('creates every localization of a cloned author', async () => {
      const source = await authors().create({
        locale: 'en',
        data: { name: 'Clone Me', email: 'clone@example.com' },
      });
      const cloned = await extra().clone({
        documentId: source.documentId,
        locale: 'en',
        data: { name: 'Cloned' },
      });
      expect(cloned.documentId).not.toBe(source.documentId);
      const rows = await authorRows(cloned.documentId);
      expect(rows.map((row) => row.locale).sort()).toEqual(['en', 'es']);
      expect(rows.every((row) => row.name === 'Cloned')).toBe(true);
    });

    it('refuses to delete a single language but deletes all with locale *', async () => {
      const created = await authors().create({ locale: 'en', data: { name: 'Doomed' } });
      await expect(
        extra().delete({ documentId: created.documentId, locale: 'es' })
      ).rejects.toThrow(/every language at once/);
      expect(await authorRows(created.documentId)).toHaveLength(2);

      await extra().delete({ documentId: created.documentId, locale: '*' });
      expect(await authorRows(created.documentId)).toHaveLength(0);
    });

    it('deletes every language when no locale is given (the default would orphan the others)', async () => {
      const created = await authors().create({ locale: 'en', data: { name: 'Doomed too' } });
      await extra().delete({ documentId: created.documentId });
      expect(await authorRows(created.documentId)).toHaveLength(0);
    });
  });

  describe('linking articles', () => {
    let documentId: string;
    let english: ArticleRow;
    let spanish: ArticleRow;

    beforeAll(async () => {
      const author = await authors().create({
        locale: 'en',
        data: { name: 'Luis Gómez', email: 'luis@example.com', bio: 'Writes about gardens' },
      });
      documentId = author.documentId;
      await authors().update({ documentId, locale: 'es', data: { bio: 'Escribe sobre huertas' } });
      english = await createArticle('Garden notes', 'en', documentId);
      spanish = await createArticle('Notas de huerta', 'es', documentId);
    });

    it('populates the author in the article language', async () => {
      const en = await articles().findOne({
        documentId: english.documentId,
        locale: 'en',
        status: 'published',
        populate: ['author'],
      });
      const es = await articles().findOne({
        documentId: spanish.documentId,
        locale: 'es',
        status: 'published',
        populate: ['author'],
      });
      expect(en.author).toMatchObject({ locale: 'en', bio: 'Writes about gardens' });
      expect(es.author).toMatchObject({ locale: 'es', bio: 'Escribe sobre huertas' });
    });

    it('serves the localized bio and never the email to the frontend token', async () => {
      const res = await http()
        .get('/api/articles')
        .query({ locale: 'es', populate: 'author' })
        .set(bearer(FRONTEND_KEY));
      expect(res.status).toBe(200);
      const article = res.body.data.find((a: { title: string }) => a.title === 'Notas de huerta');
      expect(article.author.bio).toBe('Escribe sobre huertas');
      expect(article.author.name).toBe('Luis Gómez');
      expect(article.author).not.toHaveProperty('email');
    });

    it('never returns emails from /api/authors', async () => {
      const res = await http().get('/api/authors').set(bearer(FRONTEND_KEY));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const author of res.body.data) expect(author).not.toHaveProperty('email');
      expect(JSON.stringify(res.body)).not.toContain('luis@example.com');
    });

    it.each([
      ['/api/authors?fields[]=email'],
      ['/api/authors?filters[email][$startsWith]=a'],
      ['/api/articles?filters[author][email][$startsWith]=a'],
    ])('rejects probing the private email through %s', async (url) => {
      const res = await http().get(url).set(bearer(FRONTEND_KEY));
      expect(res.status).toBe(400);
    });

    it('rejects public callers on /api/authors', async () => {
      expect((await http().get('/api/authors')).status).toBe(403);
    });
  });

  describe('API token permissions', () => {
    it('lets the build token read authors but not write them', async () => {
      const read = await http().get('/api/authors').set(bearer(BUILD_KEY));
      expect(read.status).toBe(200);
      expect(read.body.data.length).toBeGreaterThan(0);
      for (const author of read.body.data) expect(author).not.toHaveProperty('email');

      const id = read.body.data[0].documentId;
      const before = await authorRows(id);
      expect(
        (
          await http()
            .post('/api/authors')
            .set(bearer(BUILD_KEY))
            .send({ data: { name: 'X' } })
        ).status
      ).toBe(403);
      expect(
        (
          await http()
            .put(`/api/authors/${id}`)
            .set(bearer(BUILD_KEY))
            .send({ data: { name: 'Hacked' } })
        ).status
      ).toBe(403);
      expect((await http().delete(`/api/authors/${id}`).set(bearer(BUILD_KEY))).status).toBe(403);
      expect(await authorRows(id)).toEqual(before);
    });

    it('does not let the frontend token write authors either', async () => {
      expect(
        (
          await http()
            .post('/api/authors')
            .set(bearer(FRONTEND_KEY))
            .send({ data: { name: 'X' } })
        ).status
      ).toBe(403);
    });
  });

  describe('ensureAuthorLocales migration', () => {
    it('recreates missing localizations, relinks articles and is idempotent', async () => {
      const author = await authors().create({
        locale: 'en',
        data: { name: 'Old Author', email: 'old@example.com', bio: 'Old bio' },
      });
      const documentId = author.documentId;
      const english = await createArticle('Legacy english', 'en', documentId);
      const spanish = await createArticle('Legacy spanish', 'es', documentId);

      // Pre-migration state: only the `en` author row exists and the `es`
      // article (draft and published rows) is linked to it.
      const [enAuthor, esAuthor] = await authorRows(documentId);
      expect([enAuthor.locale, esAuthor.locale]).toEqual(['en', 'es']);
      const esArticleRows = await articleRows(spanish.documentId);
      expect(esArticleRows).toHaveLength(2);
      const { table, article, author: authorColumn } = linkTable();
      const knex = strapi.db.connection;
      await knex(table)
        .whereIn(
          article,
          esArticleRows.map((row) => row.id)
        )
        .update({ [authorColumn]: enAuthor.id });
      await knex(table).whereIn(authorColumn, [esAuthor.id]).delete();
      await strapi.db.query(AUTHOR).delete({ where: { id: esAuthor.id } });

      const enArticleRows = await articleRows(english.documentId);
      const updatedBefore = Object.fromEntries(
        [...esArticleRows, ...enArticleRows].map((row) => [row.id, row.updatedAt])
      );
      const links = await linkedAuthors(esArticleRows.map((row) => row.id));
      expect(
        Object.values(links)
          .flat()
          .every((id) => id === enAuthor.id)
      ).toBe(true);

      const first = await ensureAuthorLocales(strapi);
      expect(first.created).toBe(1);
      expect(first.relinked).toBe(esArticleRows.length);

      const rows = await authorRows(documentId);
      const newEs = rows.find((row) => row.locale === 'es')!;
      expect(newEs).toMatchObject({ name: 'Old Author', email: 'old@example.com' });
      expect(newEs.bio).toBeNull();

      const after = await linkedAuthors(esArticleRows.map((row) => row.id));
      for (const row of esArticleRows) expect(after[row.id]).toEqual([newEs.id]);
      const afterEn = await linkedAuthors(enArticleRows.map((row) => row.id));
      for (const row of enArticleRows) expect(afterEn[row.id]).toEqual([enAuthor.id]);

      const updatedAfter = Object.fromEntries(
        [
          ...(await articleRows(spanish.documentId)),
          ...(await articleRows(english.documentId)),
        ].map((row) => [row.id, row.updatedAt])
      );
      expect(updatedAfter).toEqual(updatedBefore);

      expect(await ensureAuthorLocales(strapi)).toEqual({ created: 0, relinked: 0 });
    });
  });

  describe('a locale added later', () => {
    it('gets a localization of every existing author', async () => {
      const english = await strapi.db.query(AUTHOR).findMany({ where: { locale: 'en' } });
      const total = english.length;
      expect(total).toBeGreaterThan(0);
      await strapi.plugin('i18n').service('locales').create({ code: 'fr', name: 'French (fr)' });
      const french = (await strapi.db
        .query(AUTHOR)
        .findMany({ where: { locale: 'fr' } })) as AuthorRow[];
      expect(french).toHaveLength(total);
      expect(french.every((row) => row.bio === null)).toBe(true);
    });
  });
});
