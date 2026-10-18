import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import qs from 'qs';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions } from './helpers/permissions';
import { assertShape, routeById, unexercisedCallers } from './helpers/response-fields';
import { authorize, getAs, http, type Get, type Jwts } from './helpers/response-fields-callers';
import { ARTICLE_POPULATE, FEED_POPULATE, POST_CARD_POPULATE } from './helpers/frontend-queries';
import {
  BUILD_KEY,
  FRONTEND_KEY,
  SEEDED,
  seedContent,
  signIn,
  type SeededContent,
} from './helpers/response-fields-seed';
import { RESPONSE_ROUTES, type Caller } from '../src/constants/response-fields';

// ASVS V15.3.1 for the article routes: each one returns only the fields listed in
// `src/constants/response-fields`, which `docs/security/response-fields.md` renders.
// One fully populated article is read as each caller that may.

const ARTICLE_UID = 'api::article.article';
const ARTICLE_STAT_UID = 'api::article-stat.article-stat';
const PUBLIC_FIND = ['article', 'category', 'author'];
const READ_CALLERS: Caller[] = ['public', 'frontend', 'build'];

/** The requests that make up each route, as the frontend sends them. */
const CALLS: Record<string, (get: Get) => Promise<unknown[]>> = {
  'articles.list': async (get) => [
    await get('/api/articles', { populate: POST_CARD_POPULATE, locale: 'en' }),
    await get('/api/articles', { locale: 'en' }),
  ],
  'articles.detail': async (get) => [
    await get('/api/articles', {
      filters: { slug: { $eq: SEEDED.articleSlug } },
      locale: 'en',
      populate: ARTICLE_POPULATE,
    }),
  ],
  'articles.feed': async (get) => [
    await get('/api/articles', {
      populate: FEED_POPULATE,
      sort: 'publishedAt:desc',
      locale: 'en',
    }),
  ],
  'articles.sitemap': async (get) => [
    await get('/api/articles', {
      locale: 'en',
      fields: ['slug', 'locale', 'publishedAt', 'updatedAt'],
      populate: { localizations: { fields: ['slug', 'locale', 'publishedAt'] } },
    }),
  ],
  'articles.reading-path': async (get) => [
    await get('/api/articles', { fields: ['documentId', 'slug', 'title'], locale: 'en' }),
  ],
  'articles.slugs': async (get) => [
    await get('/api/articles', {
      locale: 'en',
      fields: ['slug'],
      pagination: { page: 1, pageSize: 100 },
      sort: 'slug:asc',
    }),
  ],
  'articles.search': async (get) => [
    await get('/api/articles/search', { q: 'article', content: '1', locale: 'en' }),
  ],
  'articles.popular': async (get) => [await get('/api/articles/popular', { locale: 'en' })],
};

/** Queries that name a private attribute: no caller may read it, so the answer is 400. */
const PRIVATE_QUERIES: [string, object][] = [
  ['fields[0]=plainText', { fields: ['plainText'] }],
  ['populate[author][fields][0]=email', { populate: { author: { fields: ['email'] } } }],
  ['filters[plainText][$contains]=x', { filters: { plainText: { $contains: 'x' } } }],
  ['filters[author][email][$contains]=x', { filters: { author: { email: { $contains: 'x' } } } }],
];

describe('Response fields of the article routes (ASVS V15.3.1)', () => {
  const saved = { ...process.env };
  const jwts: Jwts = {};
  let seeded: SeededContent;
  let readerJwt: string;

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY;
    process.env.BUILD_API_TOKEN = BUILD_KEY;
    await setupStrapi();
    seeded = await seedContent();
    for (const contentType of PUBLIC_FIND) await setPublicPermissions(contentType, ['find']);
    await strapi.db.query(ARTICLE_STAT_UID).create({
      data: {
        articleDocumentId: seeded.articleDocumentId,
        articleLocale: 'en',
        views: 10,
        views30d: 5,
        syncedAt: new Date().toISOString(),
      },
    });
    readerJwt = (await signIn('reader', 'authenticated')).jwt;
    jwts.user = readerJwt;
    jwts.editor = (await signIn('editor', 'editor')).jwt;
  });

  afterAll(async () => {
    await cleanupStrapi();
    process.env = { ...saved };
  });

  describe.each(READ_CALLERS)('as the %s caller', (caller) => {
    const ids = Object.keys(CALLS).filter((id) => routeById(id).callers.includes(caller));

    it.each(ids)('%s returns only listed fields and every required one', async (id) => {
      const bodies = await CALLS[id]!(getAs(caller, jwts));
      assertShape(routeById(id), caller, bodies);
      expect(JSON.stringify(bodies)).not.toContain(SEEDED.authorEmail);
    });

    it.each(PRIVATE_QUERIES)('refuses %s with 400', async (_name, query) => {
      const res = await authorize(caller, http().get(`/api/articles?${qs.stringify(query)}`));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(SEEDED.authorEmail);
    });
  });

  describe('as an editor', () => {
    it('reads a draft with the same fields as a published article', async () => {
      const get = getAs('editor', jwts);
      const bodies = [
        await get('/api/articles', {
          filters: { slug: { $eq: SEEDED.articleSlug } },
          status: 'draft',
          locale: 'en',
          populate: ARTICLE_POPULATE,
        }),
        await get(`/api/articles/${seeded.articleDocumentId}`, {
          status: 'draft',
          locale: 'en',
          populate: ARTICLE_POPULATE,
        }),
      ];
      assertShape(routeById('articles.detail'), 'editor', bodies);
    });

    it('lists drafts with only the fields of articles.drafts', async () => {
      await strapi.documents(ARTICLE_UID).create({
        data: {
          title: 'A draft',
          category: seeded.categoryDocumentId,
          author: seeded.authorDocumentId,
        },
      });
      const body = await getAs('editor', jwts)('/api/articles/drafts', { locale: 'en' });
      assertShape(routeById('articles.drafts'), 'editor', [body]);
    });
  });

  describe('who cannot read what', () => {
    it('articles.drafts refuses the public role, a reader, the frontend token and the build token', async () => {
      const path = '/api/articles/drafts';
      expect((await http().get(path)).status).toBe(403);
      for (const key of [readerJwt, FRONTEND_KEY, BUILD_KEY]) {
        const res = await http().get(path).set('Authorization', `Bearer ${key}`);
        expect(res.status).toBe(403);
      }
    });
  });

  it('read every route as every caller that may', () => {
    expect(
      unexercisedCallers(
        RESPONSE_ROUTES.filter((route) => route.id.startsWith('articles.')).map((route) => route.id)
      )
    ).toEqual([]);
  });
});
