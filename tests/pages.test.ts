import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions } from './helpers/permissions';
import { revokePagePermissions } from '../src/migrations/page-permissions';

// Pages built from the section catalog (#75, micelio ADR 0005 section 11).

const PAGE_UID = 'api::page.page';
const SITE_SETTING_UID = 'api::site-setting.site-setting';
const FRONTEND_KEY = 'pages-frontend-token-0123456789abcdef0123';
const BUILD_KEY = 'pages-build-token-0123456789abcdef01234567';

type Data = Record<string, unknown>;

describe('Pages', () => {
  const pages = () =>
    strapi.documents(PAGE_UID) as unknown as {
      create(params: Data): Promise<{ documentId: string }>;
      findOne(params: Data): Promise<Data | null>;
    };
  let counter = 0;
  const createPage = (sections: Data[], extra: Data = {}) =>
    pages().create({
      data: { title: `Page ${++counter}`, slug: `page-${counter}`, sections, ...extra },
    });
  // Drafts may be incomplete, as everywhere in Strapi: the rules apply on publish.
  const publishPage = (sections: Data[]) =>
    pages().create({
      status: 'published',
      data: { title: `Page ${++counter}`, slug: `page-${counter}`, sections },
    });

  async function upload(name: string, content: string, mimetype: string): Promise<number> {
    const dir = await mkdtemp(path.join(tmpdir(), 'pages-test-'));
    const filepath = path.join(dir, name);
    try {
      await writeFile(filepath, content);
      const [file] = await strapi
        .plugin('upload')
        .service('upload')
        .upload({
          files: { filepath, originalFilename: name, mimetype, size: content.length },
          data: { fileInfo: { name } },
        });
      return file.id;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const saved = { ...process.env };
  const http = () => request(strapi.server.httpServer);
  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY;
    process.env.BUILD_API_TOKEN = BUILD_KEY;
    await setupStrapi();
    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }
  });

  afterAll(async () => {
    await cleanupStrapi();
    process.env = { ...saved };
  });

  it('stores a page with sections and their default variants', async () => {
    const { documentId } = await createPage([
      { __component: 'section.hero', title: 'Hello', primaryLink: { label: 'Go', url: '/blog' } },
      { __component: 'section.rich-text', body: 'Some **text**' },
    ]);
    const page = await pages().findOne({ documentId, populate: { sections: { populate: '*' } } });
    const sections = page!.sections as Data[];
    expect(sections[0]).toMatchObject({ __component: 'section.hero', variant: 'centered' });
    expect(sections[1]).toMatchObject({ __component: 'section.rich-text', body: 'Some **text**' });
  });

  it.each([
    ['a hero without a title', { __component: 'section.hero' }],
    ['an unknown variant', { __component: 'section.hero', title: 'x', variant: 'diagonal' }],
    [
      'a link that is not a URL or a path',
      {
        __component: 'section.cta',
        title: 'x',
        primaryLink: { label: 'Go', url: 'javascript:alert(1)' },
      },
    ],
    [
      'a link without a label',
      { __component: 'section.cta', title: 'x', primaryLink: { url: '/a' } },
    ],
    [
      'a feature grid with two items',
      {
        __component: 'section.feature-grid',
        items: [{ title: 'a' }, { title: 'b' }],
      },
    ],
    [
      'stats with five figures',
      {
        __component: 'section.stats',
        items: Array.from({ length: 5 }, (_, i) => ({ value: String(i), label: 'x' })),
      },
    ],
    ['a feature without a title', { __component: 'section.feature-grid', items: [{}, {}, {}] }],
    ['a post list with a count of 20', { __component: 'section.post-list', count: 20 }],
  ])('rejects %s', async (_case, section) => {
    await expect(publishPage([section])).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('keeps an incomplete draft, so an editor can save work in progress', async () => {
    await expect(createPage([{ __component: 'section.hero' }])).resolves.toBeTruthy();
  });

  it('rejects a post list with both a category and a tag, even as a draft', async () => {
    const category = await strapi
      .documents('api::category.category')
      .create({ data: { name: 'Garden', slug: 'garden' } });
    const tag = await strapi
      .documents('api::tag.tag')
      .create({ data: { name: 'Compost', slug: 'compost' } });
    const section = { __component: 'section.post-list', category: category.documentId };

    await expect(createPage([section])).resolves.toBeTruthy();
    await expect(createPage([{ ...section, tag: tag.documentId }])).rejects.toMatchObject({
      name: 'ValidationError',
    });
  });

  it('accepts a glTF model in a scene and rejects any other file', async () => {
    const poster = await upload(
      'poster.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'image/svg+xml'
    );
    const model = await upload('model.gltf', '{"asset":{"version":"2.0"}}', 'model/gltf+json');
    const notModel = await upload('notes.txt', 'not a model', 'text/plain');
    const scene = { __component: 'section.scene', poster, alt: 'A hill', model };

    await expect(publishPage([scene])).resolves.toBeTruthy();
    await expect(publishPage([{ ...scene, model: notModel }])).rejects.toMatchObject({
      name: 'ValidationError',
    });
  });

  it('allows the same slug in each language but not twice in one', async () => {
    const english = await pages().create({
      status: 'published',
      data: { title: 'Welcome', slug: 'welcome' },
    });
    await expect(
      strapi.documents(PAGE_UID).update({
        documentId: english.documentId,
        locale: 'es',
        status: 'published',
        data: { title: 'Bienvenida', slug: 'welcome' },
      } as never)
    ).resolves.toBeTruthy();
    await expect(
      pages().create({ status: 'published', data: { title: 'Again', slug: 'welcome' } })
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it("is the site's home page, in each language's version, when the settings point at it", async () => {
    const english = await pages().create({
      status: 'published',
      data: { title: 'Home', slug: 'home' },
    });
    await strapi.documents(PAGE_UID).update({
      documentId: english.documentId,
      locale: 'es',
      status: 'published',
      data: { title: 'Inicio', slug: 'inicio' },
    } as never);

    const settings = await strapi.documents(SITE_SETTING_UID).findFirst();
    // The Spanish site settings (the locale was added after the boot seed).
    await strapi.documents(SITE_SETTING_UID).update({
      documentId: settings!.documentId,
      locale: 'es',
      data: { name: 'Micelio', defaultLocale: 'en', modules: {} },
    } as never);
    // Localized: each language's settings point at the page, and get its own
    // version of it.
    for (const locale of ['en', 'es']) {
      await strapi.documents(SITE_SETTING_UID).update({
        documentId: settings!.documentId,
        locale,
        data: { homePage: english.documentId },
      } as never);
    }

    for (const [locale, title] of [
      ['en', 'Home'],
      ['es', 'Inicio'],
    ]) {
      const read = (await strapi.documents(SITE_SETTING_UID).findFirst({
        locale,
        status: 'published',
        populate: { homePage: true },
      } as never)) as Data | null;
      expect([locale, (read?.homePage as Data | null)?.title]).toEqual([locale, title]);
    }
  });

  describe('access', () => {
    it('lets the frontend and the build read published pages', async () => {
      await pages().create({ status: 'published', data: { title: 'Open', slug: 'open' } });
      for (const key of [FRONTEND_KEY, BUILD_KEY]) {
        const res = await http().get('/api/pages').query({ populate: '*' }).set(bearer(key));
        expect(res.status).toBe(200);
        expect((res.body.data as Data[]).map((page) => page.slug)).toContain('open');
      }
    });

    it('gives the build token published content only, and no writes', async () => {
      for (const path of ['/api/articles', '/api/categories', '/api/site-setting', '/api/about']) {
        const res = await http().get(path).set(bearer(BUILD_KEY));
        expect([path, res.status]).not.toEqual([path, 403]);
      }
      expect(
        (await http().get('/api/pages').query({ status: 'draft' }).set(bearer(BUILD_KEY))).status
      ).toBe(403);
      expect((await http().get('/api/subscribers').set(bearer(BUILD_KEY))).status).toBe(403);
      expect(
        (
          await http()
            .post('/api/pages')
            .set(bearer(BUILD_KEY))
            .send({ data: { title: 'Nope', slug: 'nope' } })
        ).status
      ).toBe(403);
    });

    it('keeps pages off every role, also when someone grants them', async () => {
      expect((await http().get('/api/pages')).status).toBe(403);
      await setPublicPermissions('page', ['find']);
      expect((await http().get('/api/pages')).status).toBe(200);

      expect(await revokePagePermissions(strapi)).toBe(1);
      expect(await revokePagePermissions(strapi)).toBe(0);
      expect((await http().get('/api/pages')).status).toBe(403);
    });
  });
});
