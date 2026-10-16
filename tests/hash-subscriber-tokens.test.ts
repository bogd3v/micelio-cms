import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { hashSubscriberTokens } from '../src/migrations/hash-subscriber-tokens';

const SUBSCRIBER_UID = 'api::subscriber.subscriber';

/** What the frontend stores and looks up: the SHA-256 hex of the token in the email. */
const frontendHash = (token: string) => createHash('sha256').update(token).digest('hex');
const HASH = /^[0-9a-f]{64}$/;

describe('Hashing of legacy subscriber tokens', () => {
  let auth: { Authorization: string };

  const http = () => request(strapi.server.httpServer);
  const insert = (data: Record<string, unknown>) =>
    strapi.db.query(SUBSCRIBER_UID).create({ data: { publishedAt: new Date(), ...data } });
  const stored = (id: number) =>
    strapi.db.query(SUBSCRIBER_UID).findOne({
      where: { id },
      select: ['confirmationToken', 'unsubscribeToken'],
    }) as Promise<{ confirmationToken: string | null; unsubscribeToken: string | null }>;
  const find = async (field: string, value: string): Promise<{ documentId: string }[]> => {
    const res = await http()
      .get('/api/subscribers')
      .query({ filters: { [field]: { $eq: value } } })
      .set(auth);
    expect(res.status).toBe(200);
    return res.body.data;
  };

  const uuid = '0b0f2c1e-6b7a-4c1d-9a55-3d2f6c0a1e11';
  const base64url = 'q3Zt0kPz8mC1xVb5Yw2nLhGd7RfEoAsU4JiTuNcMyXk';

  beforeAll(async () => {
    await setupStrapi();
    const { accessKey } = await strapi
      .service('admin::api-token')
      .create({ name: 'frontend', type: 'full-access', lifespan: null });
    auth = { Authorization: `Bearer ${accessKey}` };
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('hashes plain tokens so the frontend lookup finds them, and a stored value is no token', async () => {
    const legacy = await insert({
      email: 'legacy@example.com',
      confirmationToken: uuid,
      unsubscribeToken: base64url,
    });

    expect(await hashSubscriberTokens(strapi)).toBeGreaterThanOrEqual(2);

    const row = await stored(legacy.id);
    expect(row.confirmationToken).toBe(frontendHash(uuid));
    expect(row.unsubscribeToken).toBe(frontendHash(base64url));

    expect(await find('confirmationToken', frontendHash(uuid))).toHaveLength(1);
    expect(await find('unsubscribeToken', frontendHash(base64url))).toHaveLength(1);
    // The plain token no longer matches, and the stored hash is not a token: its own hash matches nothing.
    expect(await find('unsubscribeToken', base64url)).toEqual([]);
    expect(await find('unsubscribeToken', frontendHash(frontendHash(base64url)))).toEqual([]);
  });

  it('leaves hashes and empty tokens untouched, and a second run changes nothing', async () => {
    const hash = frontendHash('already-hashed');
    const done = await insert({
      email: 'done@example.com',
      confirmationToken: null,
      unsubscribeToken: hash,
      confirmed: true,
    });
    const mixed = await insert({
      email: 'mixed@example.com',
      confirmationToken: uuid.replace('0b', '1c'),
      unsubscribeToken: frontendHash('mixed'),
    });

    expect(await hashSubscriberTokens(strapi)).toBe(1);
    expect(await hashSubscriberTokens(strapi)).toBe(0);

    expect(await stored(done.id)).toEqual({ confirmationToken: null, unsubscribeToken: hash });
    const row = await stored(mixed.id);
    expect(row.confirmationToken).toBe(frontendHash(uuid.replace('0b', '1c')));
    expect(row.unsubscribeToken).toBe(frontendHash('mixed'));
  });

  it('hashes a plain token written after the first run, as frontend 0.1.x keeps writing them', async () => {
    expect(await hashSubscriberTokens(strapi)).toBe(0);
    const token = '5d1f0c52-8a0e-4c7e-b0a1-2f6f7f9d3c44';
    const late = await insert({ email: 'late@example.com', unsubscribeToken: token });

    expect(await hashSubscriberTokens(strapi)).toBe(1);

    expect((await stored(late.id)).unsubscribeToken).toBe(frontendHash(token));
    // The link that 0.1.x emailed no longer matches: documented in docs/operate/upgrade.md.
    expect(await find('unsubscribeToken', token)).toEqual([]);
  });

  it('does not overwrite a token changed between the read and the update', async () => {
    const original = '8e2a6b34-1c5d-4f08-9d17-aa0b6c3e5f21';
    const replaced = frontendHash('written-by-the-frontend');
    const row = await insert({ email: 'race@example.com', unsubscribeToken: original });

    const realQuery = strapi.db.query.bind(strapi.db);
    let interfered = false;
    const spy = jest.spyOn(strapi.db, 'query').mockImplementation(((uid: string) => {
      const query = realQuery(uid);
      const findMany = query.findMany.bind(query);
      query.findMany = (async (params: Parameters<typeof findMany>[0]) => {
        const rows = await findMany(params);
        // A concurrent writer lands after the first read and before the update.
        if (interfered) return rows;
        interfered = true;
        await realQuery(uid).update({
          where: { id: row.id },
          data: { unsubscribeToken: replaced },
        });
        return rows;
      }) as typeof query.findMany;
      return query;
    }) as typeof strapi.db.query);
    try {
      await hashSubscriberTokens(strapi);
    } finally {
      spy.mockRestore();
    }

    expect((await stored(row.id)).unsubscribeToken).toBe(replaced);
  });

  it('creates no token of its own: a subscriber stored without tokens keeps none', async () => {
    const created = await http()
      .post('/api/subscribers')
      .set(auth)
      .send({ data: { email: 'bare@example.com' } });
    expect(created.status).toBe(201);
    expect(created.body.data.confirmationToken ?? null).toBeNull();
    expect(created.body.data.unsubscribeToken ?? null).toBeNull();

    await hashSubscriberTokens(strapi);
    const rows = (await strapi.db
      .query(SUBSCRIBER_UID)
      .findMany({ select: ['confirmationToken', 'unsubscribeToken'] })) as {
      confirmationToken: string | null;
      unsubscribeToken: string | null;
    }[];
    for (const row of rows) {
      for (const value of [row.confirmationToken, row.unsubscribeToken]) {
        if (value !== null) expect(value).toMatch(HASH);
      }
    }
  });
});
