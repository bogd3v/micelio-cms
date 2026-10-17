import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { isUploadFromUrlEnabled, isUploadFromUrlRequest } from '../src/utils/upload-from-url';

const ROUTE = '/upload/actions/upload-from-urls';

describe('isUploadFromUrlEnabled', () => {
  it('is on only for exactly "true"', () => {
    expect(isUploadFromUrlEnabled('true')).toBe(true);
  });

  it.each([undefined, '', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true'])(
    'is off for %p',
    (value) => {
      expect(isUploadFromUrlEnabled(value)).toBe(false);
    }
  );
});

describe('isUploadFromUrlRequest', () => {
  it('matches the POST route, with a trailing slash and in any case', () => {
    expect(isUploadFromUrlRequest('POST', ROUTE)).toBe(true);
    expect(isUploadFromUrlRequest('POST', `${ROUTE}/`)).toBe(true);
    expect(isUploadFromUrlRequest('post', '/Upload/Actions/Upload-From-Urls')).toBe(true);
  });

  it.each([
    ['GET', ROUTE],
    ['POST', '/upload'],
    ['POST', '/upload/files'],
    ['POST', '/api/upload'],
    ['POST', `${ROUTE}/extra`],
  ])('does not match %s %s', (method, path) => {
    expect(isUploadFromUrlRequest(method, path)).toBe(false);
  });
});

describe('Media Library import from a URL is an operator opt-in', () => {
  const http = () => request(strapi.server.httpServer);
  const original = process.env.UPLOAD_FROM_URL_ENABLED;
  let jwt = '';

  // An empty list: when the request gets past the middleware Strapi rejects it
  // before any fetch, so no test reaches the network.
  const importCall = (path = ROUTE) =>
    http().post(path).set('Authorization', `Bearer ${jwt}`).send({ urls: [] });

  beforeAll(async () => {
    await setupStrapi();
    const superAdmin = await strapi.service('admin::role').getSuperAdmin();
    await strapi.service('admin::user').create({
      email: 'admin@example.test',
      firstname: 'Admin',
      password: 'Password123!',
      isActive: true,
      registrationToken: null,
      roles: [superAdmin.id],
    });
    const login = await http()
      .post('/admin/login')
      .send({ email: 'admin@example.test', password: 'Password123!' })
      .expect(200);
    jwt = login.body.data.token;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.UPLOAD_FROM_URL_ENABLED;
    else process.env.UPLOAD_FROM_URL_ENABLED = original;
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('answers 403 to an admin when the variable is unset', async () => {
    delete process.env.UPLOAD_FROM_URL_ENABLED;
    const res = await importCall();
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ status: 403, name: 'ForbiddenError' });
  });

  it('answers 403 with a trailing slash', async () => {
    delete process.env.UPLOAD_FROM_URL_ENABLED;
    expect((await importCall(`${ROUTE}/`)).status).toBe(403);
  });

  it.each(['false', 'TRUE', '1', 'yes'])('stays off for %p', async (value) => {
    process.env.UPLOAD_FROM_URL_ENABLED = value;
    expect((await importCall()).status).toBe(403);
  });

  it('lets the request through when enabled: Strapi validates the body itself', async () => {
    process.env.UPLOAD_FROM_URL_ENABLED = 'true';
    const res = await importCall();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('URLs are required');
  });

  it('leaves the other upload routes alone when off', async () => {
    delete process.env.UPLOAD_FROM_URL_ENABLED;
    const list = await http().get('/upload/files').set('Authorization', `Bearer ${jwt}`);
    expect(list.status).toBe(200);
    const upload = await http().post('/upload').set('Authorization', `Bearer ${jwt}`);
    expect(upload.status).not.toBe(403);
  });
});
