import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { setupStrapi, cleanupStrapi } from './strapi';
import { seedDemoContent } from '../src/migrations/demo-seed';

// MICELIO_DEMO=landing (#84): also sets the showcase page as the localized home page.

const SITE_SETTING_UID = 'api::site-setting.site-setting';
const PAGE_UID = 'api::page.page';

type Page = { documentId: string; locale: string; slug: string };
type Settings = { homePage: Page | null };

describe('Demo profile landing', () => {
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.MICELIO_DEMO = 'landing';
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    process.env = { ...saved };
  });

  it('points each language at its own version of the showcase page', async () => {
    for (const [locale, slug] of [
      ['en', 'showcase'],
      ['es', 'muestra'],
    ]) {
      const page = (await strapi
        .documents(PAGE_UID)
        .findFirst({ locale, status: 'published', filters: { slug } } as never)) as Page;
      const settings = (await strapi.documents(SITE_SETTING_UID).findFirst({
        locale,
        status: 'published',
        populate: ['homePage'],
      } as never)) as unknown as Settings;
      expect(settings.homePage).toMatchObject({ documentId: page.documentId, locale, slug });
    }
  });

  it('writes the same content as the other profiles and runs once', async () => {
    expect(await strapi.documents('api::article.article').count({ locale: 'es' })).toBeGreaterThan(
      0
    );
    expect(await seedDemoContent(strapi)).toBe('already-applied');
  });
});
