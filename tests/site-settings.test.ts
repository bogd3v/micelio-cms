import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions, setRolePermissions } from './helpers/permissions';
import type { ApiSiteSetting } from './helpers/api-types';
import {
  neutralSiteSettings,
  revokeSiteSettingPermissions,
  seedSiteSettings,
} from '../src/migrations/site-settings';

// The frontend reads the site's identity and modules (micelio#233, #234)
// with its custom API token; nobody else reads them.

const SITE_SETTING = 'api::site-setting.site-setting';
const MODULES = ['newsletter', 'comments', 'accounts', 'drafts', 'fediverse', 'search', 'support'];

describe('Site settings', () => {
  let auth: { Authorization: string };

  const http = () => request(strapi.server.httpServer);

  async function read(locale?: string, populate: unknown = '*'): Promise<ApiSiteSetting> {
    const res = await http()
      .get('/api/site-setting')
      .query({ populate, ...(locale ? { locale } : {}) })
      .set(auth);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  async function documentId(): Promise<string> {
    const settings = await strapi.documents(SITE_SETTING).findFirst();
    return settings!.documentId;
  }

  beforeAll(async () => {
    await setupStrapi();
    const { accessKey } = await strapi.service('admin::api-token').create({
      name: 'frontend',
      type: 'custom',
      lifespan: null,
      permissions: [`${SITE_SETTING}.find`],
    });
    auth = { Authorization: `Bearer ${accessKey}` };
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('returns neutral settings, seeded on boot, to the frontend token', async () => {
    const settings = await read();

    expect(settings).toMatchObject({
      locale: 'en',
      name: 'Micelio',
      description: 'A site built with Micelio',
      // FRONTEND_URL is unset in tests: the development default.
      url: 'http://localhost:3000',
      defaultLocale: 'en',
      author: null,
      contactEmail: null,
      privacyContactEmail: null,
      privacyUpdatedAt: null,
      supportHandle: null,
      logo: null,
      favicon: null,
      defaultOgImage: null,
      // No theme: the frontend keeps its default theme as it is.
      theme: null,
    });
    expect(settings.socialLinks).toEqual([]);
    expect(Object.fromEntries(MODULES.map((name) => [name, settings.modules[name]]))).toEqual(
      Object.fromEntries(MODULES.map((name) => [name, true]))
    );
  });

  it('seeds every configured locale among English and Spanish, only once', async () => {
    expect(await seedSiteSettings(strapi)).toEqual([]);

    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' });
    await strapi.documents(SITE_SETTING).delete({ documentId: await documentId(), locale: '*' });

    process.env.FRONTEND_URL = 'https://example.test';
    try {
      expect(await seedSiteSettings(strapi)).toEqual(['en', 'es']);
    } finally {
      delete process.env.FRONTEND_URL;
    }
    expect(await seedSiteSettings(strapi)).toEqual([]);

    const spanish = await read('es');
    expect(spanish).toMatchObject({
      locale: 'es',
      name: 'Micelio',
      description: 'Un sitio hecho con Micelio',
      url: 'https://example.test',
    });
    expect(spanish.socialLinks).toEqual([]);
  });

  it('never seeds anything that identifies BogDev', () => {
    const seeded = JSON.stringify([
      neutralSiteSettings('en', 'en'),
      neutralSiteSettings('es', 'es'),
    ]);
    expect(seeded).not.toMatch(/bogdev|bogd3v|ale9420|alejandro|hotmail/i);
  });

  it('keeps the other modules on when one is turned off', async () => {
    await strapi.documents(SITE_SETTING).update({
      documentId: await documentId(),
      locale: 'en',
      // @ts-expect-error the generated type requires every module; the defaults fill the rest
      data: { modules: { newsletter: false } },
    });

    const { modules } = await read();
    expect(modules.newsletter).toBe(false);
    for (const name of MODULES.filter((module) => module !== 'newsletter')) {
      expect(modules[name]).toBe(true);
    }
  });

  describe('theme', () => {
    const VALID_THEME = {
      themeId: 'bogota',
      defaultMode: 'dia',
      accentOverrides: [
        { mode: 'noche', color: '#FF7A1A' },
        { mode: 'dia', color: '#a3410f' },
      ],
      displayFont: 'fraunces',
    };

    async function saveTheme(theme: unknown) {
      return strapi.documents(SITE_SETTING).update({
        documentId: await documentId(),
        locale: 'en',
        // @ts-expect-error the cases below include invalid values on purpose
        data: { theme },
      });
    }

    it('saves a theme for every locale and returns its overrides when populated', async () => {
      await saveTheme(VALID_THEME);

      const populated = await read('en', { theme: { populate: '*' } });
      expect(populated.theme).toMatchObject({
        themeId: 'bogota',
        defaultMode: 'dia',
        displayFont: 'fraunces',
      });
      expect(populated.theme!.accentOverrides!.map(({ mode, color }) => ({ mode, color }))).toEqual(
        VALID_THEME.accentOverrides
      );

      // populate=* reaches the theme but not the component nested in it.
      const shallow = await read();
      expect(shallow.theme).toMatchObject({ themeId: 'bogota', displayFont: 'fraunces' });
      expect(shallow.theme!.accentOverrides).toBeUndefined();

      // Not localized: the Spanish settings share it.
      expect((await read('es')).theme).toMatchObject({ themeId: 'bogota' });
    });

    it('accepts an empty theme, which keeps the default', async () => {
      await saveTheme({});
      expect((await read('en', { theme: { populate: '*' } })).theme).toMatchObject({
        themeId: null,
        defaultMode: null,
        displayFont: null,
        accentOverrides: [],
      });
    });

    it.each([
      ['a three-digit hex', { accentOverrides: [{ mode: 'noche', color: '#fff' }] }],
      ['a color name', { accentOverrides: [{ mode: 'noche', color: 'red' }] }],
      ['a hex with a non-hex digit', { accentOverrides: [{ mode: 'noche', color: '#12345g' }] }],
      ['a hex with alpha', { accentOverrides: [{ mode: 'noche', color: '#ff7a1a80' }] }],
      ['a hex without #', { accentOverrides: [{ mode: 'noche', color: 'ff7a1a' }] }],
      ['an override without a color', { accentOverrides: [{ mode: 'noche' }] }],
      ['an override without a mode', { accentOverrides: [{ color: '#ff7a1a' }] }],
      ['a mode that is not a slug', { accentOverrides: [{ mode: 'Noche', color: '#ff7a1a' }] }],
      ['a theme id that is not a slug', { themeId: '../bogota' }],
      ['a default mode that is not a slug', { defaultMode: 'día' }],
      ['a display font outside the curated list', { displayFont: 'comic-sans' }],
      [
        'two overrides for the same mode',
        {
          accentOverrides: [
            { mode: 'noche', color: '#ff7a1a' },
            { mode: 'noche', color: '#2ee6b6' },
          ],
        },
      ],
    ])('rejects %s', async (_case, theme) => {
      await expect(saveTheme(theme)).rejects.toMatchObject({ name: 'ValidationError' });
    });
  });

  it('rejects readers without the frontend token', async () => {
    expect((await http().get('/api/site-setting')).status).toBe(403);

    const { accessKey } = await strapi
      .service('admin::api-token')
      .create({ name: 'other', type: 'custom', lifespan: null, permissions: [] });
    const other = await http()
      .get('/api/site-setting')
      .set({ Authorization: `Bearer ${accessKey}` });
    expect(other.status).toBe(403);
  });

  it('revokes every role permission on the site settings', async () => {
    await setPublicPermissions('site-setting', ['find']);
    await setRolePermissions('authenticated', 'site-setting', ['find']);
    expect((await http().get('/api/site-setting')).status).toBe(200);

    expect(await revokeSiteSettingPermissions(strapi)).toBe(2);
    expect(await revokeSiteSettingPermissions(strapi)).toBe(0);
    expect((await http().get('/api/site-setting')).status).toBe(403);
  });

  it.each([
    ['a site URL that is not http(s)', { url: 'ftp://bogdev.com.co' }],
    ['an author URL that is not http(s)', { author: { name: 'Ana', url: 'javascript:alert(1)' } }],
    [
      'a social link URL that is not http(s)',
      { socialLinks: [{ network: 'github', url: 'github.com/ale9420' }] },
    ],
    ['an unknown network', { socialLinks: [{ network: 'myspace', url: 'https://myspace.com' }] }],
    ['a malformed contact email', { contactEmail: 'not-an-email' }],
    ['a malformed privacy email', { privacyContactEmail: 'ana@' }],
  ])('rejects %s', async (_case, data) => {
    await expect(
      strapi.documents(SITE_SETTING).update({
        documentId: await documentId(),
        locale: 'en',
        // @ts-expect-error invalid on purpose: the values break the schema
        data,
      })
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});
