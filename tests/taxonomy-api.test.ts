import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

// The content API of category and tag is a contract with the frontend (standard, section 6). The
// core plugin owns the types now and the distribution adds `articles` to them
// (src/extensions/micelio/strapi-server.ts); these literals are what `main` answered while the
// types were a local plugin, ids, document ids and timestamps aside.

const ARTICLE_UID = 'api::article.article'
const CATEGORY_UID = 'plugin::micelio.category'
const TAG_UID = 'plugin::micelio.tag'
const FRONTEND_KEY = 'taxonomy-frontend-token-0123456789abcdef012345'
const VOLATILE = new Set(['id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt'])

/** The body without the keys that differ on every run, at any depth. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !VOLATILE.has(key))
      .map(([key, entry]) => [key, stable(entry)])
  )
}

describe('Category and tag in the content API', () => {
  const saved = { ...process.env }
  const get = (path: string) =>
    request(strapi.server.httpServer).get(path).set('Authorization', `Bearer ${FRONTEND_KEY}`)

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY
    await setupStrapi()
    const locales = strapi.plugin('i18n').service('locales')
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' })
    }

    const site = await defaultSiteRelation(strapi)
    const category = await strapi.documents(CATEGORY_UID).create({
      data: { name: 'Garden', slug: 'garden', description: 'Plants.', order: 1, color: 2, site },
    })
    await strapi.documents(CATEGORY_UID).update({
      documentId: category.documentId,
      locale: 'es',
      data: { name: 'Huerta', slug: 'garden', description: 'Plantas.', order: 1, color: 2 },
    })
    const tag = await strapi
      .documents(TAG_UID)
      .create({ data: { name: 'Compost', slug: 'compost', site } })
    const article = await strapi.documents(ARTICLE_UID).create({
      data: {
        title: 'Beds',
        slug: 'beds',
        description: 'Raised beds.',
        category: category.documentId,
        tags: [tag.documentId],
      },
    })
    await strapi.documents(ARTICLE_UID).publish({ documentId: article.documentId })
  })

  afterAll(async () => {
    await cleanupStrapi()
    process.env = { ...saved }
  })

  it('lists the categories of a locale', async () => {
    const res = await get('/api/categories?locale=en')

    expect(res.status).toBe(200)
    expect(stable(res.body)).toEqual({
      data: [
        {
          name: 'Garden',
          slug: 'garden',
          description: 'Plants.',
          order: 1,
          featured: false,
          color: 2,
          locale: 'en',
        },
      ],
      meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
    })
  })

  it('populates the articles of a category, the inverse of article.category', async () => {
    const res = await get('/api/categories?populate=articles')

    expect(res.status).toBe(200)
    expect(stable(res.body)).toEqual({
      data: [
        {
          name: 'Garden',
          slug: 'garden',
          description: 'Plants.',
          order: 1,
          featured: false,
          color: 2,
          locale: 'en',
          articles: [
            {
              title: 'Beds',
              slug: 'beds',
              description: 'Raised beds.',
              pathOrder: null,
              locale: 'en',
            },
          ],
        },
      ],
      meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
    })
  })

  it('lists the tags and populates their articles, the inverse of article.tags', async () => {
    const tags = await get('/api/tags')
    expect(tags.status).toBe(200)
    expect(stable(tags.body)).toEqual({
      data: [{ name: 'Compost', slug: 'compost', locale: 'en' }],
      meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
    })

    const populated = await get('/api/tags?populate=articles')
    expect(populated.status).toBe(200)
    expect(
      (stable(populated.body) as { data: { articles: { slug: string }[] }[] }).data[0].articles.map(
        ({ slug }) => slug
      )
    ).toEqual(['beds'])
  })
})
