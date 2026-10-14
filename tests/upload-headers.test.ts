import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { uploadResponseHeaders } from '../src/utils/upload-headers';

describe('uploadResponseHeaders', () => {
  it.each(['image/png', 'image/jpeg', 'video/mp4', 'audio/mpeg', 'application/pdf'])(
    'leaves %s inline',
    (type) => {
      expect(uploadResponseHeaders(type)).toEqual({ 'X-Content-Type-Options': 'nosniff' });
    }
  );

  it.each(['image/svg+xml', 'text/html; charset=utf-8', 'application/xhtml+xml', undefined])(
    'sandboxes and downloads %s',
    (type) => {
      const headers = uploadResponseHeaders(type);
      expect(headers['Content-Security-Policy']).toContain('sandbox');
      expect(headers['Content-Security-Policy']).not.toContain('script-src');
      expect(headers['Content-Disposition']).toBe('attachment');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    }
  );
});

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

describe('Uploads served from the admin origin', () => {
  const http = () => request(strapi.server.httpServer);

  let token = '';

  /** Uploads through the content API route, where the type rules are applied. */
  const upload = (name: string, content: string | Buffer, mimetype: string) =>
    http()
      .post('/api/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', Buffer.from(content), { filename: name, contentType: mimetype });

  beforeAll(async () => {
    await setupStrapi();
    token = (
      await strapi.service('admin::api-token').create({
        name: 'uploader',
        type: 'full-access',
        lifespan: null,
      })
    ).accessKey;
  });

  afterAll(async () => {
    const files = await strapi.db.query('plugin::upload.file').findMany();
    for (const file of files) await strapi.plugin('upload').service('upload').remove(file);
    await cleanupStrapi();
  });

  it('refuses an HTML upload', async () => {
    const res = await upload('page.html', '<script>alert(1)</script>', 'text/html');
    expect(res.status).toBe(400);
  });

  it('serves a scripted SVG sandboxed and as a download', async () => {
    const sent = await upload(
      'logo.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'image/svg+xml'
    );
    expect(sent.status).toBe(201);
    const res = await http().get(sent.body[0].url);
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.headers['content-security-policy']).not.toMatch(/unsafe-inline'.*script|script-src/);
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves a text file sandboxed too', async () => {
    const sent = await upload('notes.txt', 'plain notes', 'text/plain');
    const res = await http().get(sent.body[0].url);
    expect(res.headers['content-disposition']).toBe('attachment');
  });

  it('serves a raster image inline, with nosniff', async () => {
    const sent = await upload('dot.png', PNG, 'image/png');
    const res = await http().get(sent.body[0].url);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('leaves the rest of the app with its own headers', async () => {
    const res = await http().get('/_health');
    expect(res.headers['content-disposition']).toBeUndefined();
  });
});
