import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import qs from 'qs';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setRolePermissions } from './helpers/permissions';
import { populateDepth } from '../src/utils/populate-depth';

describe('populateDepth', () => {
  it.each([
    [undefined, 0],
    ['*', 1],
    [true, 1],
    ['category', 1],
    ['category.articles.category', 3],
    ['author,category.articles', 2],
    [['category', 'author.articles'], 2],
    [{ category: true, author: true }, 1],
    [{ category: { populate: '*' } }, 2],
    [{ category: { populate: { articles: { populate: { author: true } } } } }, 3],
    [{ category: { fields: ['slug'] } }, 1],
    // A dynamic zone fragment adds no level of its own.
    [{ blocks: { on: { 'a.b': { populate: { items: { populate: { icon: true } } } } } } }, 3],
  ])('%j is %i levels', (populate, depth) => {
    expect(populateDepth(populate)).toBe(depth);
  });
});

describe('Populate depth on the content API', () => {
  const get = (populate: unknown) =>
    request(strapi.server.httpServer).get(`/api/articles?${qs.stringify({ populate })}`);

  beforeAll(async () => {
    await setupStrapi();
    for (const type of ['article', 'category', 'author', 'tag']) {
      await setRolePermissions('public', type, ['find', 'findOne']);
    }
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('answers 400 to a populate nested 4 levels deep through back-relations', async () => {
    const res = await get({
      category: { populate: { articles: { populate: { category: { populate: 'articles' } } } } },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/populate is nested 4 levels deep; the limit is 3/);
  });

  it.each([
    ['dotted string', { populate: 'category.articles.category.articles' }],
    ['array', { populate: ['category.articles.category.articles'] }],
  ])('answers 400 to a %s that is 4 levels deep', async (_name, query) => {
    const res = await request(strapi.server.httpServer).get(`/api/articles?${qs.stringify(query)}`);
    expect(res.status).toBe(400);
  });

  it('answers 400 for the same request on the other public routes', async () => {
    const res = await request(strapi.server.httpServer).get(
      `/api/categories?${qs.stringify({
        populate: {
          articles: { populate: { category: { populate: { articles: { populate: 'author' } } } } },
        },
      })}`
    );
    expect(res.status).toBe(400);
  });

  it('serves a populate 3 levels deep, the deepest the frontend asks for', async () => {
    const nested = await get({
      category: { populate: { articles: { populate: { author: true } } } },
    });
    expect(nested.status).toBe(200);
    expect((await get('*')).status).toBe(200);
    expect((await get({ category: { populate: '*' }, author: { populate: '*' } })).status).toBe(
      200
    );
  });

  it('leaves requests without populate alone', async () => {
    expect((await request(strapi.server.httpServer).get('/api/articles')).status).toBe(200);
  });
});
