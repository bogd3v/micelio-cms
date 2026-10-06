import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import type { ApiSiteSetting } from './helpers/api-types';

// Site settings gained `tagline` and `addressLocality` (localized) and
// `timezone` (shared, checked against the runtime's IANA data) (#93).

const SITE_SETTING = 'api::site-setting.site-setting';
const FRONTEND_KEY = 'site-content-frontend-token-0123456789abcdef0123';

describe('Site content fields', () => {
  const saved = { ...process.env };
  const http = () => request(strapi.server.httpServer);
  const auth = { Authorization: `Bearer ${FRONTEND_KEY}` };
  const settings = () =>
    strapi.documents(SITE_SETTING) as unknown as {
      findFirst(p?: object): Promise<{ documentId: string } | null>;
      update(p: object): Promise<unknown>;
    };

  async function read(locale: string): Promise<ApiSiteSetting> {
    const res = await http().get('/api/site-setting').query({ locale }).set(auth);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  async function update(data: Record<string, unknown>, locale = 'en') {
    const doc = await settings().findFirst();
    return settings().update({ documentId: doc!.documentId, locale, data });
  }

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY;
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

  it('returns null for the new fields while they are empty', async () => {
    const en = await read('en');
    expect(en.tagline).toBeNull();
    expect(en.timezone).toBeNull();
    expect(en.addressLocality).toBeNull();
    expect(en.name).toBe('Micelio');
  });

  it('keeps tagline and addressLocality per locale and timezone shared', async () => {
    await update({
      tagline: 'Notes from the garden',
      addressLocality: 'Bogota',
      timezone: 'America/Bogota',
    });
    await update(
      { name: 'Notas', tagline: 'Notas desde la huerta', addressLocality: 'Bogotá' },
      'es'
    );

    const en = await read('en');
    const es = await read('es');
    expect(en).toMatchObject({ tagline: 'Notes from the garden', addressLocality: 'Bogota' });
    expect(es).toMatchObject({ tagline: 'Notas desde la huerta', addressLocality: 'Bogotá' });
    expect(en.timezone).toBe('America/Bogota');
    expect(es.timezone).toBe('America/Bogota');
  });

  it.each(['America/Bogota', 'UTC', 'America/Argentina/Buenos_Aires'])(
    'accepts the zone %s',
    async (zone) => {
      await update({ timezone: zone });
      expect((await read('en')).timezone).toBe(zone);
    }
  );

  it('accepts EST5EDT and stores zones in their canonical case', async () => {
    await update({ timezone: 'EST5EDT' });
    expect((await read('en')).timezone).toBe('EST5EDT');
    await update({ timezone: 'america/bogota' });
    expect((await read('en')).timezone).toBe('America/Bogota');
  });

  it('accepts clearing the timezone', async () => {
    await update({ timezone: null });
    expect((await read('en')).timezone).toBeNull();
  });

  it('rejects a well-shaped zone that does not exist', async () => {
    await update({ timezone: 'UTC' });
    await expect(update({ timezone: 'Mars/Olympus' })).rejects.toThrow(/not a known IANA timezone/);
    expect((await read('en')).timezone).toBe('UTC');
  });

  it.each(['not a zone', '/Bogota', 'America//Bogota', '12345', 'America/Bogota!'])(
    'rejects the malformed zone %p',
    async (zone) => {
      await expect(update({ timezone: zone })).rejects.toThrow();
      expect((await read('en')).timezone).toBe('UTC');
    }
  );
});
