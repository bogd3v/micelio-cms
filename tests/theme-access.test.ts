import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { restrictThemeToSuperAdmin } from '../src/migrations/theme-permissions'
import { resetThemePickerCache } from '../src/utils/theme-picker-route'
import {
  BUILD_TOKEN_PERMISSIONS,
  FRONTEND_TOKEN_PERMISSIONS,
  PREVIEW_FRONTEND_TOKEN_PERMISSIONS,
} from '../src/migrations/api-tokens'
import { SITE_SETTING_UID } from '../src/constants/uids'
import { startFakeRegistry, type FakeRegistry } from './helpers/fake-registry'

// Who may change the theme and read the registry's picker (micelio-cms#97, micelio ADR 0009,
// "Who may change the theme"): the Super Admin only. Editor, Author and every API token cannot.

const PASSWORD = 'Theme-access-1'
const UPDATE = 'plugin::content-manager.explorer.update'
const CREATE = 'plugin::content-manager.explorer.create'
const PIN = { themeId: 'alpha', themeVersion: '1.0.0', themeDigest: `sha256:${'1'.repeat(64)}` }
const FRONTEND_KEY = 'theme-access-frontend-0123456789abcdef0123456789'
const BUILD_KEY = 'theme-access-build-0123456789abcdef0123456789abcd'
/** The required fields of the site settings, which a clone must carry to pass validation. */
const REQUIRED = {
  defaultLocale: 'en',
  author: { name: 'Clone Author' },
  modules: {
    newsletter: false,
    comments: false,
    accounts: false,
    drafts: false,
    fediverse: false,
    search: false,
    support: false,
  },
}
const REQUIRED_FIELDS = [
  'defaultLocale',
  'author.name',
  ...Object.keys(REQUIRED.modules).map((key) => `modules.${key}`),
]
const OTHER = { themeId: 'beta', themeVersion: '0.3.0', themeDigest: `sha256:${'6'.repeat(64)}` }

describe('Who may change the theme', () => {
  const http = () => request(strapi.server.httpServer)
  const permissions = () => strapi.db.query('admin::permission')
  const as = (token: string) => ({ Authorization: `Bearer ${token}` })
  let counter = 0
  let registry: FakeRegistry
  const saved = process.env.MICELIO_THEME_REGISTRY

  async function signInAs(code: string): Promise<string> {
    counter += 1
    const role = await strapi.db.query('admin::role').findOne({ where: { code } })
    const email = `theme-${counter}@example.test`
    await strapi.service('admin::user').create({
      email,
      password: PASSWORD,
      firstname: 'Theme',
      lastname: 'Tester',
      isActive: true,
      roles: [role.id],
    })
    const res = await http().post('/admin/login').send({ email, password: PASSWORD }).expect(200)
    return res.body.data.token ?? res.body.data.accessToken
  }
  /** A user with a role the test creates now, after boot, with every field of the site settings. */
  async function signInWithNewRole(): Promise<string> {
    counter += 1
    const role = await strapi.service('admin::role').create({
      name: `Late role ${counter}`,
      description: 'Created after boot',
    })
    const everyField = [
      'name',
      ...REQUIRED_FIELDS,
      'theme.themeId',
      'theme.themeVersion',
      'theme.themeDigest',
      'theme.defaultMode',
      'theme.displayFont',
    ]
    await strapi.service('admin::role').assignPermissions(
      role.id,
      [CREATE, UPDATE].map((action) => ({
        action,
        subject: SITE_SETTING_UID,
        properties: { fields: everyField, locales: ['en'] },
        conditions: [],
      }))
    )
    const email = `theme-late-${counter}@example.test`
    await strapi.service('admin::user').create({
      email,
      password: PASSWORD,
      firstname: 'Late',
      lastname: 'Role',
      isActive: true,
      roles: [role.id],
    })
    const res = await http().post('/admin/login').send({ email, password: PASSWORD }).expect(200)
    return res.body.data.token ?? res.body.data.accessToken
  }
  /** An admin API token owned by the Super Admin, allowed to update the whole site settings. */
  async function adminTokenWithUpdate(actions = [UPDATE]): Promise<string> {
    counter += 1
    const role = await strapi.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } })
    const owner = await strapi.service('admin::user').create({
      email: `theme-owner-${counter}@example.test`,
      password: PASSWORD,
      firstname: 'Token',
      lastname: 'Owner',
      isActive: true,
      roles: [role.id],
    })
    const created = await strapi.service('admin::api-token-admin').create(
      {
        kind: 'admin',
        name: `theme-admin-token-${counter}`,
        description: 'Updates the site settings',
        lifespan: null,
        adminUserOwner: owner.id,
        adminPermissions: actions.map((action) => ({
          action,
          subject: SITE_SETTING_UID,
          properties: {
            fields: [
              'name',
              ...REQUIRED_FIELDS,
              'theme.themeId',
              'theme.themeVersion',
              'theme.themeDigest',
            ],
            locales: ['en'],
          },
          conditions: [],
        })),
      },
      owner
    )
    return created.accessKey
  }

  const documentId = async () =>
    (
      (await strapi.db.query(SITE_SETTING_UID).findOne({ where: { locale: 'en' } })) as {
        documentId: string
      }
    ).documentId
  /** Deletes the site settings a clone left behind, so the other tests keep a single document. */
  const dropClones = async (keep: string) => {
    await strapi.db.query(SITE_SETTING_UID).deleteMany({ where: { documentId: { $ne: keep } } })
  }
  const settings = () =>
    strapi.db
      .query(SITE_SETTING_UID)
      .findOne({ where: { locale: 'en' }, populate: ['theme'] }) as Promise<{
      name: string
      theme: Record<string, unknown> | null
    }>
  const saveAs = async (code: string, data: Record<string, unknown>) => {
    const token = await signInAs(code)
    return http()
      .put(`/content-manager/single-types/${SITE_SETTING_UID}?locale=en`)
      .set(as(token))
      .send(data)
  }
  const siteWrites = (code: string) =>
    permissions().findMany({
      where: { subject: SITE_SETTING_UID, action: { $in: [CREATE, UPDATE] }, role: { code } },
    }) as Promise<{ properties: { fields?: string[] } }[]>

  beforeAll(async () => {
    registry = await startFakeRegistry()
    process.env.MICELIO_THEME_REGISTRY = registry.address
    process.env.FRONTEND_API_TOKEN = FRONTEND_KEY
    process.env.BUILD_API_TOKEN = BUILD_KEY
    await setupStrapi()
  })
  afterAll(async () => {
    await cleanupStrapi()
    await registry.close()
    delete process.env.FRONTEND_API_TOKEN
    delete process.env.BUILD_API_TOKEN
    if (saved === undefined) delete process.env.MICELIO_THEME_REGISTRY
    else process.env.MICELIO_THEME_REGISTRY = saved
  })
  beforeEach(async () => {
    resetThemePickerCache()
    await strapi.documents(SITE_SETTING_UID).update({
      documentId: (await strapi.db.query(SITE_SETTING_UID).findOne({ where: { locale: 'en' } }))
        .documentId,
      locale: 'en',
      data: { theme: PIN } as never,
    })
  })

  describe('the content', () => {
    it('lets the Super Admin change the theme', async () => {
      const res = await saveAs('strapi-super-admin', { theme: OTHER })
      expect(res.status).toBe(200)
      expect((await settings()).theme).toMatchObject(OTHER)
    })

    it.each(['strapi-editor', 'strapi-author'])(
      'keeps the theme as it was when %s saves it',
      async (code) => {
        // Strapi gives a role no locale of a localised type until an admin does, and Author the
        // condition `admin::is-creator`, which no single type satisfies: give the role `en`, no
        // condition and the theme fields, the way an instance had them before this migration. The
        // write-time guard holds on its own, then the migration takes the fields out of the role.
        const rows = (await siteWrites(code)) as { id: number; properties: { fields: string[] } }[]
        const restricted = rows.map((row) => row.properties.fields)
        for (const row of rows) {
          await permissions().update({
            where: { id: row.id },
            data: {
              conditions: [],
              properties: {
                locales: ['en'],
                fields: [
                  ...row.properties.fields,
                  'theme.themeId',
                  'theme.themeVersion',
                  'theme.themeDigest',
                ],
              },
            },
          })
        }
        const guarded = await saveAs(code, { name: `Guarded ${code}`, theme: OTHER })
        expect(guarded.status).toBe(200)
        expect((await settings()).theme).toMatchObject(PIN)

        await restrictThemeToSuperAdmin(strapi)
        const res = await saveAs(code, { name: `Edited by ${code}`, theme: OTHER })
        expect(res.status).toBe(200)
        const after = await settings()
        expect(after.name).toBe(`Edited by ${code}`)
        expect(after.theme).toMatchObject(PIN)
        expect((await siteWrites(code)).map((row) => row.properties.fields)).toEqual(restricted)
      }
    )

    it('keeps the theme as it was when a role created after boot, with the theme fields, saves it', async () => {
      const token = await signInWithNewRole()
      const res = await http()
        .put(`/content-manager/single-types/${SITE_SETTING_UID}?locale=en`)
        .set(as(token))
        .send({ name: 'Edited by a late role', theme: OTHER })
      expect(res.status).toBe(200)
      const after = await settings()
      expect(after.name).toBe('Edited by a late role')
      expect(after.theme).toMatchObject(PIN)
    })

    it('does not let a role created after boot clone the site settings with another theme', async () => {
      const token = await signInWithNewRole()
      const source = await documentId()
      const before = await strapi.db.query(SITE_SETTING_UID).count({})
      const res = await http()
        .post(`/content-manager/collection-types/${SITE_SETTING_UID}/clone/${source}?locale=en`)
        .set(as(token))
        .send({ name: 'Cloned by a late role', ...REQUIRED, theme: OTHER })
      expect(res.status).toBe(200)
      const rows = (await strapi.db.query(SITE_SETTING_UID).findMany({ populate: ['theme'] })) as {
        theme: { themeId: string | null } | null
      }[]
      await dropClones(source)
      expect(rows.some((row) => row.theme?.themeId === OTHER.themeId)).toBe(false)
      expect(rows.length).toBe(before + 1)
    })

    it('takes the theme, and only the theme, out of the fields Editor and Author write', async () => {
      for (const code of ['strapi-editor', 'strapi-author']) {
        const rows = await siteWrites(code)
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
          const fields = row.properties.fields ?? []
          expect(fields.some((field) => field === 'theme' || field.startsWith('theme.'))).toBe(
            false
          )
          expect(fields).toContain('name')
          expect(fields).toContain('author.name')
        }
      }
      const admin = await siteWrites('strapi-super-admin')
      expect(admin.some((row) => (row.properties.fields ?? []).includes('theme.themeId'))).toBe(
        true
      )
    })
  })

  describe('the migration', () => {
    it('is idempotent: once every role is restricted, a run changes nothing', async () => {
      // Roles the earlier tests created with the theme fields are restricted by this first run.
      await restrictThemeToSuperAdmin(strapi)
      expect(await restrictThemeToSuperAdmin(strapi)).toBe(0)
      expect(await restrictThemeToSuperAdmin(strapi)).toBe(0)
    })

    it('restores a role that was given the theme, once, and then leaves it alone', async () => {
      const [row] = (await permissions().findMany({
        where: { subject: SITE_SETTING_UID, action: UPDATE, role: { code: 'strapi-editor' } },
      })) as { id: number; properties: { fields: string[] } }[]
      await permissions().update({
        where: { id: row!.id },
        data: {
          properties: {
            fields: [...row!.properties.fields, 'theme.themeId', 'theme.themeVersion'],
          },
        },
      })
      expect(await restrictThemeToSuperAdmin(strapi)).toBe(1)
      expect(await restrictThemeToSuperAdmin(strapi)).toBe(0)
      const fields = (await siteWrites('strapi-editor')).flatMap(
        (write) => write.properties.fields ?? []
      )
      expect(fields.some((field) => field.startsWith('theme'))).toBe(false)
    })

    it('gives a permission that lists no fields the list of the others', async () => {
      const [row] = (await permissions().findMany({
        where: { subject: SITE_SETTING_UID, action: UPDATE, role: { code: 'strapi-author' } },
      })) as { id: number }[]
      await permissions().update({ where: { id: row!.id }, data: { properties: {} } })
      expect(await restrictThemeToSuperAdmin(strapi)).toBe(1)
      const [after] = await permissions().findMany({ where: { id: row!.id } })
      const fields = (after as { properties: { fields: string[] } }).properties.fields
      expect(fields).toContain('name')
      expect(fields.some((field) => field.startsWith('theme'))).toBe(false)
    })
  })

  describe('API tokens', () => {
    it.each([
      ['frontend', FRONTEND_TOKEN_PERMISSIONS],
      ['frontend with the preview', PREVIEW_FRONTEND_TOKEN_PERMISSIONS],
      ['build', BUILD_TOKEN_PERMISSIONS],
    ])('the %s token has find only on the site settings', (_name, actions) => {
      const siteActions = actions.filter((action) => action.startsWith(`${SITE_SETTING_UID}.`))
      expect(siteActions).toEqual([`${SITE_SETTING_UID}.find`])
    })

    it('cannot update the site settings with the content API without a role that grants it', async () => {
      const res = await http()
        .put('/api/site-setting')
        .send({ data: { theme: OTHER } })
      expect([401, 403]).toContain(res.status)
      expect((await settings()).theme).toMatchObject(PIN)
    })

    it.each([
      ['frontend', FRONTEND_KEY],
      ['build', BUILD_KEY],
    ])(
      'the real %s token gets 403 on PUT /api/site-setting and 401 on the picker',
      async (_name, key) => {
        const put = await http()
          .put('/api/site-setting')
          .set(as(key))
          .send({ data: { theme: OTHER } })
        expect(put.status).toBe(403)
        expect((await settings()).theme).toMatchObject(PIN)
        const picker = await http().get('/theme-picker/themes').set(as(key))
        expect(picker.status).toBe(401)
      }
    )

    it('keeps the theme as it was when an admin token that may update the site settings saves it', async () => {
      const key = await adminTokenWithUpdate()
      const res = await http()
        .put(`/content-manager/single-types/${SITE_SETTING_UID}?locale=en`)
        .set(as(key))
        .send({ name: 'Edited by an admin token', theme: OTHER })
      expect(res.status).toBe(403)
      expect((await settings()).theme).toMatchObject(PIN)

      const nameOnly = await http()
        .put(`/content-manager/single-types/${SITE_SETTING_UID}?locale=en`)
        .set(as(key))
        .send({ name: 'Edited by an admin token' })
      expect(nameOnly.status).toBe(200)
      expect((await settings()).name).toBe('Edited by an admin token')
    })

    it('refuses an admin token that may create the site settings when it clones them with another theme', async () => {
      const key = await adminTokenWithUpdate([UPDATE, CREATE])
      const before = await strapi.db.query(SITE_SETTING_UID).count({})
      const res = await http()
        .post(
          `/content-manager/collection-types/${SITE_SETTING_UID}/clone/${await documentId()}?locale=en`
        )
        .set(as(key))
        .send({ name: 'Cloned by an admin token', ...REQUIRED, theme: OTHER })
      expect(res.status).toBe(403)
      expect(await strapi.db.query(SITE_SETTING_UID).count({})).toBe(before)
    })

    it('takes the theme out of the stored permissions of an admin token', async () => {
      await restrictThemeToSuperAdmin(strapi) // tokens of the earlier tests
      await adminTokenWithUpdate()
      const rows = (await permissions().findMany({
        where: { subject: SITE_SETTING_UID, action: UPDATE, apiToken: { $notNull: true } },
      })) as { id: number; properties: { fields: string[] } }[]
      const open = rows.filter((row) => row.properties.fields.some((f) => f.startsWith('theme')))
      expect(open).toHaveLength(1)
      expect(await restrictThemeToSuperAdmin(strapi)).toBe(1)
      const after = (await permissions().findMany({
        where: { id: { $in: rows.map((row) => row.id) } },
      })) as { properties: { fields: string[] } }[]
      for (const row of after) {
        expect(row.properties.fields).toContain('name')
        expect(row.properties.fields.some((field) => field.startsWith('theme'))).toBe(false)
      }
      expect(await restrictThemeToSuperAdmin(strapi)).toBe(0)
    })
  })

  describe('the picker route', () => {
    const route = '/theme-picker/themes?id=alpha&version=1.0.0'

    it('answers the Super Admin with the registry themes and the update on offer', async () => {
      const token = await signInAs('strapi-super-admin')
      const res = await http().get(route).set(as(token))
      expect(res.status).toBe(200)
      expect(res.body.data.indexAvailable).toBe(true)
      expect(res.body.data.themes.map((theme: { id: string }) => theme.id)).toEqual([
        'alpha',
        'beta',
      ])
      expect(res.body.data.update.version).toBe('1.1.0')
      expect(res.body.data.status).toBeNull()
    })

    it.each(['strapi-editor', 'strapi-author'])('refuses %s', async (code) => {
      const token = await signInAs(code)
      const res = await http().get(route).set(as(token))
      expect(res.status).toBe(403)
    })

    it('refuses a visitor and an API token', async () => {
      expect((await http().get(route)).status).toBe(401)
      const res = await http().get(route).set(as('not-a-session'))
      expect(res.status).toBe(401)
    })

    it('answers with no themes, and logs, when the registry cannot be read', async () => {
      const token = await signInAs('strapi-super-admin')
      process.env.MICELIO_THEME_REGISTRY = '127.0.0.1:1/test/themes'
      try {
        const res = await http().get(route).set(as(token))
        expect(res.status).toBe(200)
        expect(res.body.data).toEqual({
          indexAvailable: false,
          themes: [],
          update: null,
          status: null,
        })
      } finally {
        process.env.MICELIO_THEME_REGISTRY = registry.address
      }
    })
  })
})
