import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { setPublicPermissions } from './helpers/permissions';
import { hashSubscriberTokens } from '../src/migrations/hash-subscriber-tokens';
import { revokeSubscriberPermissions } from '../src/migrations/subscriber-permissions';
import { LOOKUP_MAX_LENGTH } from '../src/api/subscriber/constants';

// POST /api/subscribers/lookup finds a subscriber by a request body, so the
// email or token never travels in a URL (bogd3v/micelio#542, ASVS V14.2.1).

const FRONTEND_KEY = 'f'.repeat(48);
const BUILD_KEY = 'b'.repeat(48);
const SUBSCRIBER_UID = 'api::subscriber.subscriber';
const LOOKUP_PATH = '/api/subscribers/lookup';

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

describe('Subscriber lookup by request body', () => {
  const saved = { ...process.env };
  const frontend = { Authorization: `Bearer ${FRONTEND_KEY}` };
  const build = { Authorization: `Bearer ${BUILD_KEY}` };
  const http = () => request(strapi.server.httpServer);
  const lookup = (body: unknown, headers: Record<string, string> = frontend) =>
    http()
      .post(LOOKUP_PATH)
      .set(headers)
      .send(body as object);

  const confirmationHash = sha256('confirm-token');
  const unsubscribeHash = sha256('unsubscribe-token');

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY;
    process.env.BUILD_API_TOKEN = BUILD_KEY;
    await setupStrapi();
    await strapi.db.query(SUBSCRIBER_UID).create({
      data: {
        email: 'ana@example.com',
        confirmationToken: confirmationHash,
        unsubscribeToken: unsubscribeHash,
        language: 'es',
        publishedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    process.env = saved;
    await cleanupStrapi();
  });

  it.each([
    ['email', 'ana@example.com'],
    ['confirmationToken', confirmationHash],
    ['unsubscribeToken', unsubscribeHash],
  ])('finds a subscriber by %s', async (field, value) => {
    const res = await lookup({ field, value });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.data).toMatchObject({
      email: 'ana@example.com',
      confirmationToken: confirmationHash,
      unsubscribeToken: unsubscribeHash,
      confirmed: false,
      language: 'es',
    });
    expect(typeof res.body.data.documentId).toBe('string');
  });

  it('answers null, not an error, when nothing matches', async () => {
    for (const field of ['email', 'confirmationToken', 'unsubscribeToken']) {
      const res = await lookup({ field, value: 'nobody@example.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: null });
    }
  });

  it('compares the value exactly, with no filter syntax or partial match', async () => {
    for (const value of ['ANA@example.com', 'ana@example.co', 'ana@%', '%']) {
      expect((await lookup({ field: 'email', value })).body).toEqual({ data: null });
    }
    // A REST filter operator in place of the value is a type error, not a query.
    expect((await lookup({ field: 'email', value: { $contains: 'ana' } })).status).toBe(400);
  });

  it('answers 400 for a field outside the list, a bad value or a bad body', async () => {
    const bad: unknown[] = [
      { field: 'confirmed', value: 'false' },
      { field: 'password', value: 'x' },
      { field: 'id', value: '1' },
      { field: 'email' },
      { field: 'email', value: '' },
      { field: 'email', value: 42 },
      { field: 'email', value: 'a'.repeat(LOOKUP_MAX_LENGTH + 1) },
      { value: 'ana@example.com' },
      {},
      [],
    ];
    for (const body of bad) {
      expect((await lookup(body)).status).toBe(400);
    }
    expect((await http().post(LOOKUP_PATH).set(frontend)).status).toBe(400);
    // The longest accepted value is still a lookup, not an error.
    expect((await lookup({ field: 'email', value: 'a'.repeat(LOOKUP_MAX_LENGTH) })).status).toBe(
      200
    );
  });

  it('keeps finding a row that held a plain token, by the hash, after the migration', async () => {
    await strapi.db.query(SUBSCRIBER_UID).create({
      data: {
        email: 'legacy@example.com',
        confirmationToken: '0b0f2c1e-6b7a-4c1d-9a55-3d2f6c0a1e11',
        unsubscribeToken: 'q3Zt0kPz8mC1xVb5Yw2nLhGd7RfEoAsU4JiTuNcMyXk',
        publishedAt: new Date(),
      },
    });

    await hashSubscriberTokens(strapi);

    const byConfirmation = await lookup({
      field: 'confirmationToken',
      value: sha256('0b0f2c1e-6b7a-4c1d-9a55-3d2f6c0a1e11'),
    });
    expect(byConfirmation.body.data).toMatchObject({ email: 'legacy@example.com' });
    const byUnsubscribe = await lookup({
      field: 'unsubscribeToken',
      value: sha256('q3Zt0kPz8mC1xVb5Yw2nLhGd7RfEoAsU4JiTuNcMyXk'),
    });
    expect(byUnsubscribe.body.data).toMatchObject({ email: 'legacy@example.com' });
    // The plain token is no longer stored, so it finds nothing.
    const plain = await lookup({
      field: 'unsubscribeToken',
      value: 'q3Zt0kPz8mC1xVb5Yw2nLhGd7RfEoAsU4JiTuNcMyXk',
    });
    expect(plain.body).toEqual({ data: null });
  });

  describe('who may call it', () => {
    const body = { field: 'email', value: 'ana@example.com' };

    it('turns away a request with no token', async () => {
      const res = await lookup(body, {});
      expect([401, 403]).toContain(res.status);
      expect(res.body.error).toBeDefined();
      expect(res.text).not.toContain(body.value);
    });

    it('turns away the build token and an invalid token', async () => {
      for (const headers of [build, { Authorization: `Bearer ${'x'.repeat(48)}` }]) {
        const res = await lookup(body, headers);
        expect([401, 403]).toContain(res.status);
        expect(res.body.error).toBeDefined();
        expect(res.text).not.toContain(body.value);
      }
    });

    it('turns away the public role, even when someone grants it, once the boot revokes it', async () => {
      await setPublicPermissions('subscriber', ['lookup']);
      expect(await revokeSubscriberPermissions(strapi)).toBe(1);

      const res = await lookup(body, {});
      expect([401, 403]).toContain(res.status);
      expect(res.body.error).toBeDefined();
      expect(res.text).not.toContain(body.value);
    });

    it('serves the frontend token', async () => {
      expect((await lookup(body)).status).toBe(200);
    });
  });
});
