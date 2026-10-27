import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import { grantEditorsPageSite } from '../src/migrations/admin-page-site'

// The admin roles Editor and Author pick the site of the pages they create (#373, decision D9 of
// #360). "Preview drafts on the frontend" stays with the Super Admin.

const PAGE_UID = 'api::page.page'
const READ = 'plugin::content-manager.explorer.read'
const PASSWORD = 'Site-read-1'
const CODES = ['strapi-editor', 'strapi-author']

describe('Admin roles and the site of a page', () => {
  const permissions = () => strapi.db.query('admin::permission')
  const http = () => request(strapi.server.httpServer)
  let counter = 0

  /** Signs in a new admin user with the role of `code` and returns its token. */
  async function signInAs(code: string): Promise<string> {
    counter += 1
    const role = await strapi.db.query('admin::role').findOne({ where: { code } })
    const email = `site-read-${counter}@example.test`
    await strapi.service('admin::user').create({
      email,
      password: PASSWORD,
      firstname: 'Site',
      lastname: 'Reader',
      isActive: true,
      roles: [role.id],
    })
    const res = await http().post('/admin/login').send({ email, password: PASSWORD }).expect(200)
    return res.body.data.token ?? res.body.data.accessToken
  }
  const as = (token: string) => ({ Authorization: `Bearer ${token}` })
  const siteReads = (code: string) =>
    permissions().findMany({ where: { action: READ, subject: SITE_UID, role: { code } } })
  const pagePermissions = (code: string) =>
    permissions().findMany({
      where: {
        subject: PAGE_UID,
        action: { $startsWith: 'plugin::content-manager.explorer.' },
        role: { code },
      },
    })
  const listSites = async (code: string) => {
    const token = await signInAs(code)
    return http().get(`/content-manager/collection-types/${SITE_UID}`).set(as(token))
  }
  const createPage = async (code: string, withSite: boolean) => {
    const token = await signInAs(code)
    const site = await strapi.db.query(SITE_UID).findOne({ where: { isDefault: true } })
    return http()
      .post(`/content-manager/collection-types/${PAGE_UID}`)
      .set(as(token))
      .send({
        title: 'From the admin',
        slug: `from-the-admin-${++counter}`,
        ...(withSite ? { site: { connect: [{ id: site.id }] } } : {}),
      })
  }

  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  describe.each(CODES)('as %s on a database Strapi just created', (code) => {
    it('lists the sites and creates a page with the default site', async () => {
      const list = await listSites(code)
      expect(list.status).toBe(200)
      expect(list.body.results.map((site: { isDefault: boolean }) => site.isDefault)).toEqual([
        true,
      ])

      const created = await createPage(code, true)
      expect(created.status).toBe(201)
      const row = await strapi.db.query(PAGE_UID).findOne({
        where: { documentId: created.body.data.documentId },
        populate: { site: true },
      })
      expect(row.site.isDefault).toBe(true)
    })

    it('refuses a page with no site', async () => {
      expect((await createPage(code, false)).status).toBe(400)
    })
  })

  describe('on an instance upgraded from a release before pages had a site', () => {
    beforeAll(async () => {
      // The roles of that instance were made when no page listed `site` and the site type was not
      // an entry of the Content Manager's roles.
      for (const code of CODES) {
        await permissions().deleteMany({ where: { subject: SITE_UID, role: { code } } })
        for (const permission of await pagePermissions(code)) {
          await permissions().update({
            where: { id: permission.id },
            data: {
              properties: {
                ...permission.properties,
                fields: (permission.properties.fields ?? []).filter((f: string) => f !== 'site'),
              },
            },
          })
        }
      }
    })

    it('fails before the migration: the Editor sees no site and loses the one it sends', async () => {
      expect((await listSites('strapi-editor')).status).toBe(403)
      expect((await createPage('strapi-editor', true)).status).toBe(400)
    })

    it('gives the Editor and the Author what they need to pick a site', async () => {
      expect(await grantEditorsPageSite(strapi)).toBeGreaterThan(0)

      for (const code of CODES) {
        const list = await listSites(code)
        expect(list.body.results).toHaveLength(1)
        expect((await createPage(code, true)).status).toBe(201)
      }
    })

    it.each(CODES)(
      'grants %s reading and no more: no condition, no write, no preview',
      async (code) => {
        const actions = (
          await permissions().findMany({ where: { subject: SITE_UID, role: { code } } })
        ).map((permission) => permission.action)
        const [read] = await siteReads(code)

        expect(actions).toEqual([READ])
        expect(read.conditions).toEqual([])
        expect(read.properties.locales).toContain('en')
        expect(read.properties.fields).toEqual(
          expect.arrayContaining(['name', 'slug', 'isDefault'])
        )
        expect(
          await permissions().count({
            where: { action: { $startsWith: 'plugin::micelio.preview' }, role: { code } },
          })
        ).toBe(0)
      }
    )

    it('is idempotent and restores a permission that is missing', async () => {
      expect(await grantEditorsPageSite(strapi)).toBe(0)

      const [permission] = await siteReads('strapi-author')
      await permissions().delete({ where: { id: permission.id } })

      expect(await grantEditorsPageSite(strapi)).toBe(1)
      expect(await grantEditorsPageSite(strapi)).toBe(0)
    })

    it('leaves alone a permission whose locales an admin emptied', async () => {
      const [permission] = await siteReads('strapi-author')
      await permissions().update({
        where: { id: permission.id },
        data: { properties: { ...permission.properties, locales: [] } },
      })

      expect(await grantEditorsPageSite(strapi)).toBe(0)
      expect((await siteReads('strapi-author'))[0].properties.locales).toEqual([])
    })
  })
})
