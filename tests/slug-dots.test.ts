import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

type DraftUid = 'api::article.article' | 'api::page.page'
type Uid =
  'api::article.article' | 'api::page.page' | 'plugin::micelio.category' | 'plugin::micelio.tag'

// Strapi skips the `regex` check on drafts, so types with draft and publish refuse the slug when
// publishing (the moment an article is federated); the others refuse it on create.
const CASES: { uid: Uid; titleField: 'title' | 'name'; hasDrafts: boolean }[] = [
  { uid: 'api::article.article', titleField: 'title', hasDrafts: true },
  { uid: 'api::page.page', titleField: 'title', hasDrafts: true },
  { uid: 'plugin::micelio.category', titleField: 'name', hasDrafts: false },
  { uid: 'plugin::micelio.tag', titleField: 'name', hasDrafts: false },
]

describe('Slugs that are dot segments', () => {
  const created: { uid: Uid; documentId: string }[] = []

  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    for (const { uid, documentId } of created) {
      await strapi.documents(uid).delete({ documentId })
    }
    await cleanupStrapi()
  })

  const create = async (uid: Uid, titleField: string, slug: string) => {
    const site = await defaultSiteRelation(strapi)
    const doc = await strapi.documents(uid).create({
      // Category, tag and page belong to a site; an article takes no such attribute.
      data: {
        [titleField]: `Slug ${slug}`,
        slug,
        ...(uid !== 'api::article.article' ? { site } : {}),
      },
    })
    created.push({ uid, documentId: doc.documentId })
    return doc
  }

  describe.each(CASES)('$uid', ({ uid, titleField, hasDrafts }) => {
    it.each(['.', '..'])('refuses the slug %j', async (slug) => {
      const attempt = async () => {
        const doc = await create(uid, titleField, slug)
        if (hasDrafts)
          await strapi.documents(uid as DraftUid).publish({ documentId: doc.documentId })
      }
      await expect(attempt()).rejects.toMatchObject({
        name: 'ValidationError',
        details: { errors: expect.arrayContaining([expect.objectContaining({ path: ['slug'] })]) },
      })
    })

    it.each(['a.b', '..a', 'a..', '.a', 'v1.2'])('keeps accepting the slug %j', async (slug) => {
      const doc = await create(uid, titleField, `${slug}-${uid.split('.')[1]}`)
      expect(doc.slug).toBe(`${slug}-${uid.split('.')[1]}`)
    })
  })
})
