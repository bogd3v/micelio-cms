import type { ResponseRoute } from './types';

/** The routes of categories and tags. */
export const TAXONOMY_ROUTES: readonly ResponseRoute[] = [
  {
    id: 'categories.find',
    auth: 'public role with `find`, or an API token with `find`',
    method: 'GET',
    path: '/api/categories',
    callers: ['public', 'frontend', 'build'],
    reader: 'server/api/categories.get.ts',
    note: 'The frontend asks for `name`, `slug` and the ids of `articles`. An unrestricted call also returns `description`, `key`, `bird`, `pillar`, `featured`, `color` and `order`, which the frontend does not read. Strapi adds `documentId` whatever `fields` says.',
    body: {
      data: {
        use: 'required',
        of: {
          id: 'required',
          name: 'required',
          slug: 'required',
          articles: { use: 'required', of: { id: 'required', documentId: 'surplus' } },
          documentId: 'surplus',
          description: 'surplus',
          key: 'surplus',
          bird: 'surplus',
          pillar: 'surplus',
          featured: 'surplus',
          color: 'surplus',
          order: 'surplus',
          createdAt: 'surplus',
          updatedAt: 'surplus',
          publishedAt: 'surplus',
          locale: 'surplus',
        },
      },
      meta: { use: 'surplus', of: { pagination: { use: 'surplus', of: 'pagination-unread' } } },
    },
  },
  {
    id: 'tags.find',
    auth: 'public role (granted by default), or an API token with `find`',
    method: 'GET',
    path: '/api/tags',
    callers: ['public', 'frontend', 'build'],
    reader: 'server/api/tags.get.ts',
    note: 'Public by default. The frontend reads `name`, `slug` and the number of `articles`; `id` and `documentId` are added by Strapi whatever `fields` says.',
    body: {
      data: {
        use: 'required',
        of: {
          name: 'required',
          slug: 'required',
          articles: { use: 'required', of: { id: 'surplus', documentId: 'surplus' } },
          id: 'surplus',
          documentId: 'surplus',
          createdAt: 'surplus',
          updatedAt: 'surplus',
          publishedAt: 'surplus',
          locale: 'surplus',
        },
      },
      meta: { use: 'surplus', of: { pagination: { use: 'surplus', of: 'pagination-unread' } } },
    },
  },
];
