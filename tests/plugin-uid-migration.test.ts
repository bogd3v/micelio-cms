import { describe, it, expect, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { renameLegacyUids } from '../src/plugins/micelio/server/src/migrations/rename-legacy-uids';

const PERMISSION_UID = 'plugin::users-permissions.permission';
const ROLE_UID = 'plugin::users-permissions.role';
const TOKEN_PERMISSION_UID = 'admin::api-token-permission';
const ADMIN_PERMISSION_UID = 'admin::permission';
const ADMIN_ROLE_UID = 'admin::role';
const STORE_UID = 'strapi::core-store';
const LAYOUT_PREFIX = 'plugin_content_manager_configuration_content_types::';

const LEGACY_CATEGORY = 'api::category.category';
const LEGACY_TAG = 'api::tag.tag';
const CATEGORY = 'plugin::micelio.category';
const TAG = 'plugin::micelio.tag';

type Action = { action: string };

describe('Moving category and tag to the micelio plugin (upgrade)', () => {
  afterAll(async () => {
    await cleanupStrapi();
  });

  const query = (uid: string) => strapi.db.query(uid);

  async function roleActions(type: string): Promise<string[]> {
    const role = (await query(ROLE_UID).findOne({ where: { type } })) as { id: number };
    const rows = (await query(PERMISSION_UID).findMany({ where: { role: role.id } })) as Action[];
    return rows.map((row) => row.action).sort();
  }

  async function tokenActions(name: string): Promise<string[]> {
    const rows = (await query(TOKEN_PERMISSION_UID).findMany({
      where: { token: { name } },
    })) as Action[];
    return rows.map((row) => row.action).sort();
  }

  it('keeps permissions, tokens, admin subjects and layouts through a restart on the old UIDs', async () => {
    // A site of the previous release: everything stored under the api:: UIDs.
    await setupStrapi();
    const publicRole = (await query(ROLE_UID).findOne({ where: { type: 'public' } })) as {
      id: number;
    };
    const authenticated = (await query(ROLE_UID).findOne({
      where: { type: 'authenticated' },
    })) as { id: number };
    await query(PERMISSION_UID).deleteMany({
      where: { action: { $startsWith: 'plugin::micelio.' } },
    });
    for (const [role, action] of [
      [publicRole.id, `${LEGACY_CATEGORY}.find`],
      [publicRole.id, `${LEGACY_CATEGORY}.findOne`],
      [publicRole.id, `${LEGACY_TAG}.find`],
      [authenticated.id, `${LEGACY_CATEGORY}.find`],
    ] as const) {
      await query(PERMISSION_UID).create({ data: { action, role } });
    }

    const token = await strapi.service('admin::api-token').create({
      name: 'legacy-reader',
      type: 'custom',
      lifespan: null,
      permissions: [`${CATEGORY}.find`, `${TAG}.find`, 'api::article.article.find'],
    });
    await query(TOKEN_PERMISSION_UID).update({
      where: { token: token.id, action: `${CATEGORY}.find` },
      data: { action: `${LEGACY_CATEGORY}.find` },
    });
    await query(TOKEN_PERMISSION_UID).update({
      where: { token: token.id, action: `${TAG}.find` },
      data: { action: `${LEGACY_TAG}.find` },
    });

    const superAdmin = (await query(ADMIN_ROLE_UID).findOne({
      where: { code: 'strapi-super-admin' },
    })) as { id: number };
    await query(ADMIN_PERMISSION_UID).create({
      data: {
        action: 'plugin::content-manager.explorer.read',
        subject: LEGACY_CATEGORY,
        role: superAdmin.id,
        properties: {},
        conditions: [],
      },
    });

    await query(STORE_UID).deleteMany({
      where: { key: { $startsWith: `${LAYOUT_PREFIX}plugin::micelio.` } },
    });
    await query(STORE_UID).create({
      data: {
        key: `${LAYOUT_PREFIX}${LEGACY_CATEGORY}`,
        type: 'object',
        value: JSON.stringify({ uid: LEGACY_CATEGORY }),
      },
    });
    await query(STORE_UID).deleteMany({ where: { key: `${LAYOUT_PREFIX}api::article.article` } });
    await query(STORE_UID).create({
      data: {
        key: `${LAYOUT_PREFIX}api::article.article`,
        type: 'object',
        value: JSON.stringify({ relations: { category: { targetModel: LEGACY_CATEGORY } } }),
      },
    });

    // The restart: same database, new code.
    await cleanupStrapi({ keepDatabase: true });
    await setupStrapi({ keepDatabase: true });

    // users-permissions bootstrapped after the rename: it did not delete the public read access.
    expect(await roleActions('public')).toEqual(
      expect.arrayContaining([`${CATEGORY}.find`, `${CATEGORY}.findOne`, `${TAG}.find`])
    );
    expect(await roleActions('authenticated')).toContain(`${CATEGORY}.find`);
    for (const type of ['public', 'authenticated']) {
      expect((await roleActions(type)).filter((a) => a.startsWith('api::category'))).toEqual([]);
      expect((await roleActions(type)).filter((a) => a.startsWith('api::tag'))).toEqual([]);
    }

    expect(await tokenActions('legacy-reader')).toEqual([
      'api::article.article.find',
      `${CATEGORY}.find`,
      `${TAG}.find`,
    ]);

    const subjects = (await query(ADMIN_PERMISSION_UID).findMany({
      where: { subject: { $in: [LEGACY_CATEGORY, CATEGORY] } },
    })) as { subject: string }[];
    expect(subjects.length).toBeGreaterThan(0);
    expect(subjects.every((row) => row.subject === CATEGORY)).toBe(true);

    const categoryLayout = await query(STORE_UID).findOne({
      where: { key: `${LAYOUT_PREFIX}${CATEGORY}` },
    });
    // The content manager fills the moved layout with its defaults afterwards.
    expect(JSON.parse((categoryLayout as { value: string }).value)).toMatchObject({
      uid: CATEGORY,
    });
    expect(
      await query(STORE_UID).findOne({ where: { key: `${LAYOUT_PREFIX}${LEGACY_CATEGORY}` } })
    ).toBeNull();
    const articleLayout = (await query(STORE_UID).findOne({
      where: { key: `${LAYOUT_PREFIX}api::article.article` },
    })) as { value: string };
    expect(articleLayout.value).toContain(CATEGORY);
    expect(articleLayout.value).not.toContain(LEGACY_CATEGORY);

    // The content API still answers at the old path for the public role.
    const res = await request(strapi.server.httpServer).get('/api/categories');
    expect(res.status).toBe(200);
  });

  it('is idempotent: a second run changes nothing', async () => {
    expect(await renameLegacyUids(strapi)).toEqual({ actions: 0, subjects: 0, layouts: 0 });
  });

  it('keeps the row under the new UID when the old one has a twin, and deletes the old one', async () => {
    const publicRole = (await query(ROLE_UID).findOne({ where: { type: 'public' } })) as {
      id: number;
    };
    await query(PERMISSION_UID).create({
      data: { action: `${LEGACY_CATEGORY}.find`, role: publicRole.id },
    });
    const before = (await roleActions('public')).filter((a) => a === `${CATEGORY}.find`);

    expect(await renameLegacyUids(strapi)).toMatchObject({ actions: 1 });

    const after = await roleActions('public');
    expect(after.filter((a) => a === `${CATEGORY}.find`)).toEqual(before);
    expect(after).not.toContain(`${LEGACY_CATEGORY}.find`);
  });
});
