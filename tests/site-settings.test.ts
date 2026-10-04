import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions, setRolePermissions } from './helpers/permissions';
import type { ApiSiteSetting } from './helpers/api-types';
import {
  BOGDEV_SITE_SETTINGS,
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

  async function read(locale?: string): Promise<ApiSiteSetting> {
    const res = await http()
      .get('/api/site-setting')
      .query({ populate: '*', ...(locale ? { locale } : {}) })
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

  it("returns BogDev's settings, seeded on boot, to the frontend token", async () => {
    const settings = await read();

    expect(settings).toMatchObject({
      locale: 'en',
      name: 'BogDev',
      description: 'Personal blog about AI, Software, Linux and more',
      url: 'https://bogdev.com.co',
      defaultLocale: 'en',
      author: { name: 'Alejandro Ramirez', url: 'https://bogdev.com.co/about' },
      contactEmail: 'gx_alejandro@hotmail.com',
      privacyContactEmail: 'gx_alejandro@hotmail.com',
      privacyUpdatedAt: '2026-10-01T17:00:00.000Z',
      supportHandle: 'ale9420',
      logo: null,
      favicon: null,
      defaultOgImage: null,
    });
    expect(settings.socialLinks.map(({ network, url }) => ({ network, url }))).toEqual(
      BOGDEV_SITE_SETTINGS.socialLinks
    );
    expect(Object.fromEntries(MODULES.map((name) => [name, settings.modules[name]]))).toEqual(
      Object.fromEntries(MODULES.map((name) => [name, true]))
    );
  });

  it('seeds every configured locale among English and Spanish, only once', async () => {
    expect(await seedSiteSettings(strapi)).toEqual([]);

    await strapi.plugin('i18n').service('locales').create({ code: 'es', name: 'Spanish (es)' });
    await strapi.documents(SITE_SETTING).delete({ documentId: await documentId(), locale: '*' });

    expect(await seedSiteSettings(strapi)).toEqual(['en', 'es']);
    expect(await seedSiteSettings(strapi)).toEqual([]);

    const spanish = await read('es');
    expect(spanish).toMatchObject({ locale: 'es', name: 'BogDev', supportHandle: 'ale9420' });
    expect(spanish.description).toBe(BOGDEV_SITE_SETTINGS.description);
    expect(spanish.socialLinks).toHaveLength(4);
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
