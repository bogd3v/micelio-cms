import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { setupStrapi, cleanupStrapi } from './strapi';

type DraftUid = 'api::article.article' | 'api::page.page';
type Uid = 'api::article.article' | 'api::page.page' | 'api::category.category' | 'api::tag.tag';

// Strapi skips the `regex` check on drafts, so types with draft and publish refuse the slug when
// publishing (the moment an article is federated); the others refuse it on create.
const CASES: { uid: Uid; titleField: 'title' | 'name'; hasDrafts: boolean }[] = [
  { uid: 'api::article.article', titleField: 'title', hasDrafts: true },
  { uid: 'api::page.page', titleField: 'title', hasDrafts: true },
  { uid: 'api::category.category', titleField: 'name', hasDrafts: false },
  { uid: 'api::tag.tag', titleField: 'name', hasDrafts: false },
];

describe('Slugs that are dot segments', () => {
  const created: { uid: Uid; documentId: string }[] = [];

  beforeAll(async () => {
    await setupStrapi();
  });

  afterAll(async () => {
    for (const { uid, documentId } of created) {
      await strapi.documents(uid).delete({ documentId });
    }
    await cleanupStrapi();
  });

  const create = async (uid: Uid, titleField: string, slug: string) => {
    const doc = await strapi.documents(uid).create({
      data: { [titleField]: `Slug ${slug}`, slug },
    });
    created.push({ uid, documentId: doc.documentId });
    return doc;
  };

  describe.each(CASES)('$uid', ({ uid, titleField, hasDrafts }) => {
    it.each(['.', '..'])('refuses the slug %j', async (slug) => {
      const attempt = async () => {
        const doc = await create(uid, titleField, slug);
        if (hasDrafts)
          await strapi.documents(uid as DraftUid).publish({ documentId: doc.documentId });
      };
      await expect(attempt()).rejects.toMatchObject({
        name: 'ValidationError',
        details: { errors: expect.arrayContaining([expect.objectContaining({ path: ['slug'] })]) },
      });
    });

    it.each(['a.b', '..a', 'a..', '.a', 'v1.2'])('keeps accepting the slug %j', async (slug) => {
      const doc = await create(uid, titleField, `${slug}-${uid.split('.')[1]}`);
      expect(doc.slug).toBe(`${slug}-${uid.split('.')[1]}`);
    });
  });
});
