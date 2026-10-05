import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { setupStrapi, cleanupStrapi } from './strapi';
import { seedDemoContent } from '../src/migrations/demo-seed';

// MICELIO_DEMO=static (#84): seeds like true, with no home page.

const SITE_SETTING_UID = 'api::site-setting.site-setting';
const PAGE_UID = 'api::page.page';
const MARKER = { type: 'core', name: 'migrations', key: 'demo-seed' };

type Page = { documentId: string; locale: string; slug: string };
type Settings = { homePage: Page | null };

describe('Demo profile static', () => {
  const saved = { ...process.env };

  beforeAll(async () => {
    process.env.MICELIO_DEMO = 'static';
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    process.env = { ...saved };
  });

  it('runs on boot and leaves its marker', async () => {
    // setupStrapi() already ran the seed on boot; the marker proves it applied.
    expect(await strapi.store.get(MARKER)).toMatchObject({ version: 1 });
  });

  it('seeds the demo (applied once) without a home page', async () => {
    expect(await strapi.documents(PAGE_UID).count({ locale: 'en', status: 'published' })).toBe(1);
    for (const locale of ['en', 'es']) {
      const settings = (await strapi
        .documents(SITE_SETTING_UID)
        .findFirst({ locale, populate: ['homePage'] })) as unknown as Settings;
      expect(settings.homePage).toBeNull();
    }
    expect(await seedDemoContent(strapi)).toBe('already-applied');
    await strapi.store.delete(MARKER);
    expect(await seedDemoContent(strapi)).toBe('skipped-existing-content');
  });
});
