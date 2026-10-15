import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import qs from 'qs';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setRolePermissions } from './helpers/permissions';
import { filtersDepth, populateDepth, sortDepth } from '../src/utils/populate-depth';

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

describe('filtersDepth', () => {
  it.each([
    [undefined, 0],
    [{ title: { $containsi: 'x' } }, 1],
    [{ category: { slug: { $eq: 'a' } } }, 2],
    [{ documentId: { $in: ['a', 'b'] } }, 1],
    [{ $and: [{ category: { slug: 'a' } }, { tags: { slug: 'b' } }] }, 2],
    [{ $or: [{ $not: { category: { slug: 'a' } } }] }, 2],
    [{ category: { $and: [{ articles: { category: { slug: 'a' } } }] } }, 4],
    [{ category: [{ slug: 'a' }] }, 2],
    [{ a: { b: { c: { d: { e: 'x' } } } } }, 5],
    ['nope', 0],
  ])('%j is %i levels', (filters, depth) => {
    expect(filtersDepth(filters)).toBe(depth);
  });
});

describe('sortDepth', () => {
  it.each([
    [undefined, 0],
    ['publishedAt:desc', 1],
    [['pathOrder:asc', 'category.articles.title:asc'], 3],
    ['category.articles.category.name', 4],
    [{ category: { articles: 'asc' } }, 2],
  ])('%j is %i levels', (sort, depth) => {
    expect(sortDepth(sort)).toBe(depth);
  });
});

describe('Filters and sort depth on the content API', () => {
  const get = (query: unknown) =>
    request(strapi.server.httpServer).get(`/api/articles?${qs.stringify(query)}`);

  beforeAll(async () => {
    await setupStrapi();
    for (const type of ['article', 'category', 'author', 'tag']) {
      await setRolePermissions('public', type, ['find', 'findOne']);
    }
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('answers 400 to filters nested 4 levels deep through back-relations', async () => {
    const res = await get({
      filters: { category: { articles: { category: { slug: { $eq: 'a' } } } } },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/filters is nested 4 levels deep; the limit is 3/);
  });

  it('answers 400 when $and and $or hide the depth', async () => {
    const res = await get({
      filters: { $or: [{ $and: [{ category: { articles: { category: { slug: 'a' } } } }] }] },
    });
    expect(res.status).toBe(400);
  });

  it('answers 400 to the array syntax filters[a][0][b][c][d]', async () => {
    const res = await request(strapi.server.httpServer).get(
      '/api/articles?filters[category][0][articles][0][category][slug]=a'
    );
    expect(res.status).toBe(400);
  });

  it('answers 400 to a sort path 4 levels deep', async () => {
    const res = await get({ sort: 'category.articles.category.name:asc' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/sort is nested 4 levels deep; the limit is 3/);
  });

  it('serves filters at the limit and the ones the frontend sends', async () => {
    for (const query of [
      { filters: { category: { articles: { slug: { $eq: 'a' } } } } },
      { filters: { category: { slug: { $eq: 'a' } } } },
      { filters: { tags: { slug: { $eq: 'a' } }, documentId: { $in: ['x', 'y'] } } },
      { filters: { slug: { $eq: 'a' } }, sort: 'publishedAt:desc' },
      { filters: { title: { $containsi: 'a' } }, sort: ['pathOrder:asc', 'publishedAt:asc'] },
    ]) {
      expect((await get(query)).status).toBe(200);
    }
  });

  it('keeps the auth answer of a protected route', async () => {
    const res = await request(strapi.server.httpServer).get(
      `/api/users?${qs.stringify({ filters: { a: { b: { c: { d: 'x' } } } } })}`
    );
    expect([400, 401, 403]).toContain(res.status);
    const ok = await request(strapi.server.httpServer).get('/api/users?filters[username]=x');
    expect([401, 403]).toContain(ok.status);
  });
});
