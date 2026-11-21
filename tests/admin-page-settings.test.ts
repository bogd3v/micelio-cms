import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals'
import request from 'supertest'
import { SITE_UID, withPageSettings } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import { grantEditorsPageSettings } from '../src/migrations/admin-page-settings'

// The admin roles Editor and Author save the page settings of `withPageSettings` on an instance
// that upgrades (#517, follow-up of #414): Strapi lists in a role only the fields that exist when
// it creates the role.

const PAGE_UID = 'api::page.page'
const ARTICLE_UID = 'api::article.article'
const ACTION_PREFIX = 'plugin::content-manager.explorer.'
const PASSWORD = 'Page-settings-1'
const CODES = ['strapi-editor', 'strapi-author']
/** What a role Strapi creates lists for the page settings, as read from one. */
const SETTINGS_FIELDS = [
  'pageType',
  'visibility.inMenu',
  'visibility.inSitemap',
  'visibility.noindex',
]

interface Permission {
  id: number
  action: string
  subject: string | null
  properties: { fields?: string[]; locales?: string[] } | null
  conditions: string[] | null
  role: { id: number; code: string } | null
}

/** The attributes `withPageSettings` adds. */
const settingsAttributes = new Set(
  Object.keys(
    withPageSettings({
      kind: 'collectionType',
      info: {},
      options: {},
      attributes: {},
    } as unknown as Parameters<typeof withPageSettings>[0]).attributes
  )
)
const isSettingsField = (field: string) => settingsAttributes.has(field.split('.')[0])

describe('Admin roles and the page settings', () => {
  const permissions = () => strapi.db.query('admin::permission')
  const http = () => request(strapi.server.httpServer)
  let counter = 0
  /** The page permissions of Editor and Author as the database Strapi just created holds them. */
  const fresh: Permission[] = []

  const pagePermissions = async (code: string): Promise<Permission[]> =>
    (await permissions().findMany({
      where: { subject: PAGE_UID, action: { $startsWith: ACTION_PREFIX }, role: { code } },
      populate: { role: true },
      orderBy: { id: 'asc' },
    })) as Permission[]
  /** Every permission of the instance, in a shape two snapshots compare by. */
  const snapshot = async () =>
    (
      (await permissions().findMany({
        populate: { role: true },
        orderBy: { id: 'asc' },
      })) as Permission[]
    ).map(({ id, action, subject, properties, conditions, role }) => ({
      id,
      action,
      subject,
      properties,
      conditions,
      role: role?.code ?? null,
    }))

  /**
   * Brings Editor and Author back to what an instance from before the page settings holds: no
   * page-settings field, and the language of the pages, which a role Strapi creates in this
   * database does not list and without which it updates no page (an admin of a working instance
   * has given it).
   */
  async function upgradeFromBeforeThePageSettings(): Promise<void> {
    for (const permission of fresh) {
      const fields = permission.properties?.fields
      await permissions().update({
        where: { id: permission.id },
        data: {
          properties: {
            ...permission.properties,
            locales: ['en'],
            ...(Array.isArray(fields) ? { fields: fields.filter((f) => !isSettingsField(f)) } : {}),
          },
        },
      })
    }
  }

  /** Signs in a new admin user with the role of `code` and returns its token. */
  async function signInAs(code: string): Promise<string> {
    counter += 1
    const role = await strapi.db.query('admin::role').findOne({ where: { code } })
    const email = `page-settings-${counter}@example.test`
    await strapi.service('admin::user').create({
      email,
      password: PASSWORD,
      firstname: 'Page',
      lastname: 'Settings',
      isActive: true,
      roles: [role.id],
    })
    const res = await http().post('/admin/login').send({ email, password: PASSWORD }).expect(200)
    return res.body.data.token ?? res.body.data.accessToken
  }
  const as = (token: string) => ({ Authorization: `Bearer ${token}` })

  /**
   * Creates a page as the role of `code` in the Content Manager, saves `pageType` and `visibility`
   * on it with a `PUT`, and returns the stored draft.
   */
  async function saveSettingsAs(code: string): Promise<{
    status: number
    pageType: string | null
    visibility: Record<string, unknown> | null
  }> {
    const token = await signInAs(code)
    const site = await strapi.db.query(SITE_UID).findOne({ where: { isDefault: true } })
    const created = await http()
      .post(`/content-manager/collection-types/${PAGE_UID}`)
      .set(as(token))
      .send({
        title: 'Settings from the admin',
        slug: `settings-from-the-admin-${++counter}`,
        site: { connect: [{ id: site.id }] },
      })
    expect(created.status).toBe(201)
    const { documentId } = created.body.data
    const updated = await http()
      .put(`/content-manager/collection-types/${PAGE_UID}/${documentId}?locale=en`)
      .set(as(token))
      .send({
        title: 'Settings from the admin',
        pageType: 'landing',
        visibility: { inMenu: false, inSitemap: false, noindex: true },
      })
    const row = await strapi.db.query(PAGE_UID).findOne({
      where: { documentId, publishedAt: null },
      populate: { visibility: true },
    })
    return { status: updated.status, pageType: row.pageType, visibility: row.visibility }
  }

  beforeAll(async () => {
    await setupStrapi()
    for (const code of CODES) fresh.push(...(await pagePermissions(code)))
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('reads the fields from a role Strapi creates', () => {
    const listing = fresh.filter((permission) => Array.isArray(permission.properties?.fields))
    expect(listing.length).toBeGreaterThan(0)
    for (const permission of listing) {
      expect(permission.properties?.fields?.filter(isSettingsField)).toEqual(SETTINGS_FIELDS)
    }
  })

  it('changes nothing on a database Strapi just created', async () => {
    const before = await snapshot()
    expect(await grantEditorsPageSettings(strapi)).toBe(0)
    expect(await snapshot()).toEqual(before)
  })

  describe('on an instance upgraded from a release before the page settings', () => {
    beforeEach(async () => {
      await upgradeFromBeforeThePageSettings()
    })

    it('gives Editor and Author the page-settings fields on an upgraded instance', async () => {
      const listing = fresh.filter((permission) => Array.isArray(permission.properties?.fields))
      expect(await grantEditorsPageSettings(strapi)).toBe(listing.length)

      for (const code of CODES) {
        const listed = (await pagePermissions(code)).filter((permission) =>
          Array.isArray(permission.properties?.fields)
        )
        expect(listed).toHaveLength(3)
        for (const permission of listed) {
          expect(permission.properties?.fields).toEqual(expect.arrayContaining(SETTINGS_FIELDS))
        }
      }
    })

    it('grants the same fields a role Strapi creates after the change lists', async () => {
      const before = new Map(
        (await Promise.all(CODES.map(pagePermissions))).flat().map((p) => [p.id, p])
      )
      await grantEditorsPageSettings(strapi)

      for (const permission of fresh) {
        const after = (await permissions().findOne({ where: { id: permission.id } })) as Permission
        const had = before.get(permission.id)?.properties?.fields ?? []
        const added = (after.properties?.fields ?? []).filter((f) => !had.includes(f))
        expect(added.sort()).toEqual(
          (permission.properties?.fields ?? []).filter(isSettingsField).sort()
        )
        expect([...(after.properties?.fields ?? [])].sort()).toEqual(
          [...(permission.properties?.fields ?? [])].sort()
        )
        expect(after.conditions).toEqual(permission.conditions)
      }
    })

    it.each(CODES)(
      'lets Editor and Author save the page settings through the Content Manager (%s)',
      async (code) => {
        const dropped = await saveSettingsAs(code)
        expect(dropped.status).toBe(200)
        expect(dropped.pageType).not.toBe('landing')
        expect(dropped.visibility).toBeNull()

        await grantEditorsPageSettings(strapi)

        const kept = await saveSettingsAs(code)
        expect(kept.status).toBe(200)
        expect(kept.pageType).toBe('landing')
        expect(kept.visibility).toEqual(
          expect.objectContaining({ inMenu: false, inSitemap: false, noindex: true })
        )
      }
    )

    it('is idempotent', async () => {
      expect(await grantEditorsPageSettings(strapi)).toBeGreaterThan(0)
      const before = await snapshot()
      expect(await grantEditorsPageSettings(strapi)).toBe(0)
      expect(await snapshot()).toEqual(before)
    })

    it('leaves a permission an admin narrowed or emptied as it is', async () => {
      const editor = await pagePermissions('strapi-editor')
      const byAction = (name: string) =>
        editor.find((permission) => permission.action === `${ACTION_PREFIX}${name}`) as Permission
      const [create, read, update] = ['create', 'read', 'update'].map(byAction)
      const fields = update.properties?.fields ?? []
      await permissions().update({
        where: { id: update.id },
        data: { properties: { ...update.properties, fields: [...fields, 'pageType'] } },
      })
      await permissions().update({
        where: { id: read.id },
        data: { properties: { ...read.properties, fields: [] } },
      })
      await permissions().update({
        where: { id: create.id },
        data: { properties: {} },
      })
      const narrowed = (await snapshot()).filter((p) =>
        [create.id, read.id, update.id].includes(p.id)
      )

      expect(await grantEditorsPageSettings(strapi)).toBe(3)

      expect(
        (await snapshot()).filter((p) => [create.id, read.id, update.id].includes(p.id))
      ).toEqual(narrowed)
      for (const permission of await pagePermissions('strapi-author')) {
        expect(permission.properties?.fields).toEqual(expect.arrayContaining(SETTINGS_FIELDS))
      }
    })

    it('touches no role but Editor and Author and no other subject', async () => {
      const reviewer = await strapi.service('admin::role').create({
        name: 'Reviewer',
        description: 'A role an admin made',
      })
      await strapi.service('admin::role').addPermissions(reviewer.id, [
        {
          action: `${ACTION_PREFIX}update`,
          subject: PAGE_UID,
          properties: { fields: ['title', 'slug'], locales: ['en'] },
          conditions: [],
        },
      ])
      // An article permission of Editor that lists fields, none of them the page settings.
      const article = (await permissions().findOne({
        where: {
          subject: ARTICLE_UID,
          action: { $startsWith: ACTION_PREFIX },
          role: { code: 'strapi-editor' },
        },
      })) as Permission | null
      expect(article?.properties?.fields?.length).toBeGreaterThan(0)

      const pageIds = new Set(fresh.map((permission) => permission.id))
      const others = (await snapshot()).filter((p) => !pageIds.has(p.id))
      await grantEditorsPageSettings(strapi)
      const after = await snapshot()

      expect(after.filter((p) => !pageIds.has(p.id))).toEqual(others)
      expect(after).toHaveLength(others.length + pageIds.size)
      for (const permission of after) {
        expect(permission.properties?.fields ?? []).not.toEqual(
          expect.arrayContaining(['templateSamples'])
        )
        expect(permission.properties?.fields ?? []).not.toEqual(
          expect.arrayContaining(['templateFixed'])
        )
      }
    })
  })
})
