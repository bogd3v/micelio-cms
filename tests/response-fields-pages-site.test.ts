import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions } from './helpers/permissions';
import { assertShape, routeById, unexercisedCallers } from './helpers/response-fields';
import { getAs, http, type Get, type Jwts } from './helpers/response-fields-callers';
import { ABOUT_POPULATE, PAGE_POPULATE, SITE_POPULATE } from './helpers/frontend-queries';
import {
  BUILD_KEY,
  FRONTEND_KEY,
  SEEDED,
  seedContent,
  signIn,
} from './helpers/response-fields-seed';
import { RESPONSE_ROUTES, type Caller } from '../src/constants/response-fields';

// ASVS V15.3.1 for categories, tags, About, pages, authors, the global type and the
// site settings. One fully populated record of each is read as each caller that may.

const PUBLIC_FIND = ['article', 'category', 'about', 'author', 'global'];
const READ_CALLERS: Caller[] = ['public', 'frontend', 'build'];
const PREFIXES = [
  'categories.',
  'tags.',
  'about.',
  'pages.',
  'authors.',
  'global.',
  'site-setting.',
];

/** The requests that make up each route, as the frontend sends them. */
const CALLS: Record<string, (get: Get) => Promise<unknown[]>> = {
  'categories.find': async (get) => [
    await get('/api/categories', {
      pagination: { pageSize: 100 },
      fields: ['name', 'slug'],
      populate: { articles: { fields: ['id'], filters: { locale: { $eq: 'en' } } } },
    }),
    await get('/api/categories'),
  ],
  'tags.find': async (get) => [
    await get('/api/tags', {
      locale: 'en',
      pagination: { pageSize: 100 },
      fields: ['name', 'slug'],
      populate: { articles: { fields: ['id'], filters: { locale: { $eq: 'en' } } } },
    }),
    await get('/api/tags'),
  ],
  'about.find': async (get) => [
    await get('/api/about', { locale: 'en', populate: ABOUT_POPULATE }),
  ],
  'pages.find': async (get) => [
    await get('/api/pages', {
      filters: { slug: { $eq: SEEDED.pageSlug } },
      locale: 'en',
      pagination: { limit: 1 },
      populate: PAGE_POPULATE,
    }),
  ],
  'pages.slugs': async (get) => [
    await get('/api/pages', {
      locale: 'en',
      fields: ['slug'],
      pagination: { page: 1, pageSize: 100 },
      sort: 'slug:asc',
    }),
  ],
  'authors.find': async (get) => [await get('/api/authors')],
  'global.find': async (get) => [await get('/api/global')],
  'site-setting.find': async (get) => [
    await get('/api/site-setting', { populate: SITE_POPULATE, locale: 'en' }),
    await get('/api/site-setting', { locale: 'en' }),
    await get('/api/site-setting', { locale: 'en', populate: { homePage: { fields: ['slug'] } } }),
  ],
};

describe('Response fields of categories, tags, About, pages, authors and site settings (ASVS V15.3.1)', () => {
  const saved = { ...process.env };
  const jwts: Jwts = {};

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY;
    process.env.BUILD_API_TOKEN = BUILD_KEY;
    await setupStrapi();
    await seedContent();
    for (const contentType of PUBLIC_FIND) await setPublicPermissions(contentType, ['find']);
    jwts.user = (await signIn('reader', 'authenticated')).jwt;
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
  });

  describe('who cannot read what', () => {
    const guarded = ['/api/pages', '/api/site-setting'];

    it.each(guarded)(
      '%s refuses the public role, a signed-in reader and an editor',
      async (path) => {
        expect((await http().get(path)).status).toBe(403);
        for (const jwt of [jwts.user, jwts.editor]) {
          const res = await http().get(path).set('Authorization', `Bearer ${jwt}`);
          expect(res.status).toBe(403);
        }
      }
    );

    it('global answers the frontend token and the build token with 403: only the public role may read it', async () => {
      for (const key of [FRONTEND_KEY, BUILD_KEY]) {
        const res = await http().get('/api/global').set('Authorization', `Bearer ${key}`);
        expect(res.status).toBe(403);
      }
    });
  });

  it('read every route as every caller that may', () => {
    const ids = RESPONSE_ROUTES.map((route) => route.id).filter((id) =>
      PREFIXES.some((prefix) => id.startsWith(prefix))
    );
    expect(ids.sort()).toEqual(Object.keys(CALLS).sort());
    expect(unexercisedCallers(ids)).toEqual([]);
  });
});
