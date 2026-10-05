import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { seedDemoContent } from '../src/migrations/demo-seed';
import {
  ensureFrontendToken,
  FRONTEND_TOKEN_NAME,
  FRONTEND_TOKEN_PERMISSIONS,
  BUILD_TOKEN_NAME,
  BUILD_TOKEN_PERMISSIONS,
} from '../src/migrations/api-tokens';

// The demo instance (#74): MICELIO_DEMO seeds a neutral bilingual site on
// boot, and FRONTEND_API_TOKEN becomes the frontend's API token, so
// compose.demo.yml needs no manual step.

const ARTICLE_UID = 'api::article.article';
const CATEGORY_UID = 'api::category.category';
const TAG_UID = 'api::tag.tag';
const ABOUT_UID = 'api::about.about';
const SITE_SETTING_UID = 'api::site-setting.site-setting';
const TOKEN_UID = 'admin::api-token';
const MARKER = { type: 'core', name: 'migrations', key: 'demo-seed' };
const ACCESS_KEY = 'demo-frontend-token-0123456789abcdef0123456789';
const BUILD_KEY = 'demo-build-token-0123456789abcdef0123456789abc';

type Named = { name?: string; title?: string; slug?: string; locale?: string };

describe('Demo instance', () => {
  const saved = { ...process.env };
  const http = () => request(strapi.server.httpServer);
  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

  beforeAll(async () => {
    process.env.MICELIO_DEMO = 'true';
    process.env.FRONTEND_API_TOKEN = ACCESS_KEY;
    process.env.BUILD_API_TOKEN = BUILD_KEY;
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    process.env = { ...saved };
  });

  describe('demo content', () => {
    it('publishes three articles in English and Spanish, with covers', async () => {
      for (const locale of ['en', 'es']) {
        const articles = (await strapi.documents(ARTICLE_UID).findMany({
          locale,
          status: 'published',
          populate: ['cover', 'category', 'tags', 'author'],
        })) as (Named & {
          cover: { url: string } | null;
          category: Named | null;
          tags: Named[];
          author: Named | null;
        })[];
        expect(articles).toHaveLength(3);
        for (const article of articles) {
          expect(article.cover?.url).toMatch(/\.svg$/);
          expect(article.category).not.toBeNull();
          expect(article.tags.length).toBeGreaterThan(0);
          expect(article.author?.name).toBe('Alex Moreno');
        }
      }
      const spanish = await strapi
        .documents(ARTICLE_UID)
        .findMany({ locale: 'es', status: 'published' });
      expect((spanish as Named[]).map((article) => article.slug)).toContain(
        'empezar-una-huerta-en-el-balcon'
      );
    });

    it('creates only its own categories, translated, and none of BogDev', async () => {
      const english = (await strapi.documents(CATEGORY_UID).findMany({ locale: 'en' })) as Named[];
      const spanish = (await strapi.documents(CATEGORY_UID).findMany({ locale: 'es' })) as Named[];
      expect(english.map((category) => category.slug).sort()).toEqual(['garden', 'kitchen']);
      expect(spanish.map((category) => category.name).sort()).toEqual(['Cocina', 'Huerta']);
      expect(await strapi.documents(TAG_UID).count({ locale: 'es' })).toBe(3);
    });

    it('names the site and fills the About page in both languages', async () => {
      const english = (await strapi
        .documents(SITE_SETTING_UID)
        .findFirst({ locale: 'en' })) as Named;
      const spanish = (await strapi
        .documents(SITE_SETTING_UID)
        .findFirst({ locale: 'es' })) as Named;
      expect(english.name).toBe('Field Notes');
      expect(
        await strapi.documents(SITE_SETTING_UID).findFirst({ locale: 'en', populate: '*' })
      ).toMatchObject({
        author: { name: 'Alex Moreno', url: 'http://localhost:3000/about' },
        socialLinks: [{ network: 'github', url: 'https://github.com/bogd3v/micelio' }],
        contactEmail: 'alex@example.com',
        privacyContactEmail: 'alex@example.com',
        logo: { name: 'field-notes-logo.svg' },
        favicon: { name: 'field-notes-logo.svg' },
      });
      expect(spanish.name).toBe('Notas de campo');
      expect(((await strapi.documents(ABOUT_UID).findFirst({ locale: 'es' })) as Named).title).toBe(
        'Acerca de'
      );
    });

    it('publishes a page that uses every section of the catalog, in both languages', async () => {
      const catalog = (
        strapi.contentType('api::page.page' as never) as unknown as {
          attributes: { sections: { components: string[] } };
        }
      ).attributes.sections.components;
      for (const [locale, slug] of [
        ['en', 'showcase'],
        ['es', 'muestra'],
      ]) {
        const page = (await strapi.documents('api::page.page').findFirst({
          locale,
          status: 'published',
          filters: { slug },
          populate: { sections: { populate: '*' } },
        } as never)) as { sections: { __component: string }[] } | null;
        expect(page?.sections.map((section) => section.__component).sort()).toEqual(
          [...catalog].sort()
        );
      }
    });

    it('leaves the home page empty with MICELIO_DEMO=true', async () => {
      for (const locale of ['en', 'es']) {
        expect(
          await strapi.documents(SITE_SETTING_UID).findFirst({ locale, populate: ['homePage'] })
        ).toMatchObject({ homePage: null });
      }
    });

    it('never mentions BogDev or a real person', async () => {
      const everything = JSON.stringify(
        await Promise.all(
          [
            ARTICLE_UID,
            CATEGORY_UID,
            TAG_UID,
            ABOUT_UID,
            SITE_SETTING_UID,
            'api::page.page',
          ].flatMap((uid) =>
            ['en', 'es'].map((locale) =>
              strapi.documents(uid as typeof ARTICLE_UID).findMany({ locale, populate: '*' })
            )
          )
        )
      );
      expect(everything).not.toMatch(/bogdev|bogd3v\.com|ale9420|alejandro|hotmail|bogot/i);
    });

    it('runs once, and never on an instance that already has articles', async () => {
      expect(await seedDemoContent(strapi)).toBe('already-applied');

      await strapi.store.delete(MARKER);
      expect(await seedDemoContent(strapi)).toBe('skipped-existing-content');
      expect(await strapi.db.query(ARTICLE_UID).count()).toBe(6 * 2); // drafts and published

      process.env.MICELIO_DEMO = 'false';
      expect(await seedDemoContent(strapi)).toBe('disabled');
      process.env.MICELIO_DEMO = 'true';
    });
  });

  describe('build token', () => {
    it('is created read-only from BUILD_API_TOKEN and reads pages', async () => {
      const token = await strapi.db.query(TOKEN_UID).findOne({
        where: { name: BUILD_TOKEN_NAME },
        populate: ['permissions'],
      });
      expect(token.type).toBe('custom');
      expect(token.permissions.map(({ action }: { action: string }) => action).sort()).toEqual(
        [...BUILD_TOKEN_PERMISSIONS].sort()
      );
      const res = await http().get('/api/pages').set(bearer(BUILD_KEY));
      expect(res.status).toBe(200);
      expect(res.body.data.map((page: { slug: string }) => page.slug)).toContain('showcase');
      expect(
        (await http().post('/api/pages').set(bearer(BUILD_KEY)).send({ data: {} })).status
      ).toBe(403);
    });
  });

  describe('frontend token', () => {
    it('lets the frontend read what it needs with FRONTEND_API_TOKEN', async () => {
      for (const path of [
        '/api/site-setting',
        '/api/articles',
        '/api/categories',
        '/api/tags',
        '/api/about',
        '/api/subscribers',
      ]) {
        const res = await http().get(path).set(bearer(ACCESS_KEY));
        expect([path, res.status]).toEqual([path, 200]);
      }
    });

    it('grants nothing beyond the documented permissions', async () => {
      expect((await http().get('/api/authors').set(bearer(ACCESS_KEY))).status).toBe(403);
      const token = await strapi.db.query(TOKEN_UID).findOne({
        where: { name: FRONTEND_TOKEN_NAME },
        populate: ['permissions'],
      });
      expect(token.type).toBe('custom');
      expect(token.permissions.map(({ action }: { action: string }) => action).sort()).toEqual(
        [...FRONTEND_TOKEN_PERMISSIONS].sort()
      );
    });

    it('is idempotent, and follows a new key or missing permissions', async () => {
      expect(await ensureFrontendToken(strapi)).toBe('unchanged');

      const rotated = `${ACCESS_KEY}-rotated`;
      process.env.FRONTEND_API_TOKEN = rotated;
      expect(await ensureFrontendToken(strapi)).toBe('updated');
      expect((await http().get('/api/site-setting').set(bearer(ACCESS_KEY))).status).toBe(401);
      expect((await http().get('/api/site-setting').set(bearer(rotated))).status).toBe(200);

      const token = await strapi.db
        .query(TOKEN_UID)
        .findOne({ where: { name: FRONTEND_TOKEN_NAME } });
      await strapi.service(TOKEN_UID).update(token.id, {
        type: 'custom',
        permissions: ['api::article.article.find'],
      });
      expect(await ensureFrontendToken(strapi)).toBe('updated');
      expect((await http().get('/api/site-setting').set(bearer(rotated))).status).toBe(200);
      expect(await strapi.db.query(TOKEN_UID).count({ where: { name: FRONTEND_TOKEN_NAME } })).toBe(
        1
      );
    });

    it('does nothing without the variable and rejects a short key', async () => {
      delete process.env.FRONTEND_API_TOKEN;
      expect(await ensureFrontendToken(strapi)).toBe('disabled');

      process.env.FRONTEND_API_TOKEN = 'short';
      await expect(ensureFrontendToken(strapi)).rejects.toThrow('at least 32 characters');
      process.env.FRONTEND_API_TOKEN = ACCESS_KEY;
    });
  });
});
