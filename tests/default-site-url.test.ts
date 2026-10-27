import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { setupStrapi, cleanupStrapi } from './strapi'
import { ensureDefaultSiteUrl } from '../src/migrations/default-site-url'

// The core creates the default site with no url (ensureDefaultSite); the bootstrap gives it the
// frontend's origin, once, so the preview has a frontend to load (#372).

const SITE_SETTING_UID = 'api::site-setting.site-setting'

const saved = { ...process.env }

const siteUrl = async (): Promise<string | null> => {
  const site = await strapi.db.query(SITE_UID).findOne({ where: { isDefault: true } })
  return site.url
}

describe('Default site url at boot', () => {
  afterAll(async () => {
    await cleanupStrapi()
    process.env = { ...saved }
  })

  describe('on a fresh boot and a restart', () => {
    const sites = () => strapi.db.query(SITE_UID)
    const updatedAt = async (): Promise<unknown> =>
      (await sites().findOne({ where: { isDefault: true } })).updatedAt

    beforeAll(() => {
      process.env.FRONTEND_URL = 'https://www.example.com/blog'
    })

    it('stores the origin of FRONTEND_URL', async () => {
      await setupStrapi()

      expect(await siteUrl()).toBe('https://www.example.com')
    })

    it('writes nothing on a second boot', async () => {
      const before = await updatedAt()
      await cleanupStrapi({ keepDatabase: true })

      await setupStrapi({ keepDatabase: true })

      expect(await siteUrl()).toBe('https://www.example.com')
      expect(await updatedAt()).toEqual(before)
      expect(await ensureDefaultSiteUrl(strapi)).toBeNull()
    })

    it('leaves a url the admin set unchanged on a second boot', async () => {
      await sites().updateMany({
        where: { isDefault: true },
        data: { url: 'https://admin.example.com' },
      })
      await cleanupStrapi({ keepDatabase: true })

      await setupStrapi({ keepDatabase: true })

      expect(await siteUrl()).toBe('https://admin.example.com')
    })
  })

  describe('where the origin comes from', () => {
    const sites = () => strapi.db.query(SITE_UID)
    const settings = () => strapi.db.query(SITE_SETTING_UID)

    /** Puts the default site and the site setting in a known state. */
    async function arrange(state: {
      site?: string | null
      setting?: string | null
      frontendUrl?: string
    }): Promise<void> {
      await sites().updateMany({ where: {}, data: { url: state.site ?? null } })
      await settings().updateMany({ where: {}, data: { url: state.setting ?? null } })
      if (state.frontendUrl === undefined) delete process.env.FRONTEND_URL
      else process.env.FRONTEND_URL = state.frontendUrl
    }

    beforeAll(async () => {
      await cleanupStrapi()
      await setupStrapi()
    })

    it('uses FRONTEND_URL when the site setting has no url', async () => {
      await arrange({ frontendUrl: 'https://www.example.com' })

      expect(await ensureDefaultSiteUrl(strapi)).toBe('https://www.example.com')
      expect(await siteUrl()).toBe('https://www.example.com')
    })

    it('prefers the site setting url, as an origin', async () => {
      await arrange({
        setting: 'https://blog.example.com/en/',
        frontendUrl: 'https://www.example.com',
      })

      expect(await ensureDefaultSiteUrl(strapi)).toBe('https://blog.example.com')
      expect(await siteUrl()).toBe('https://blog.example.com')
    })

    it('keeps the port of the origin', async () => {
      await arrange({ setting: 'http://localhost:3000' })

      expect(await ensureDefaultSiteUrl(strapi)).toBe('http://localhost:3000')
    })

    it('never overwrites a site that has a url', async () => {
      await arrange({
        site: 'https://admin.example.com',
        setting: 'https://blog.example.com',
        frontendUrl: 'https://www.example.com',
      })

      expect(await ensureDefaultSiteUrl(strapi)).toBeNull()
      expect(await siteUrl()).toBe('https://admin.example.com')
    })

    it('sets nothing when there is neither, and does not fail', async () => {
      await arrange({})

      expect(await ensureDefaultSiteUrl(strapi)).toBeNull()
      expect(await siteUrl()).toBeNull()
    })

    it('ignores a value that is not an http(s) URL and falls back to the next', async () => {
      await arrange({ setting: 'ftp://files.example.com', frontendUrl: 'https://www.example.com' })
      expect(await ensureDefaultSiteUrl(strapi)).toBe('https://www.example.com')

      await arrange({ setting: 'not a url', frontendUrl: 'mailto:hello@example.com' })
      expect(await ensureDefaultSiteUrl(strapi)).toBeNull()
      expect(await siteUrl()).toBeNull()
    })

    it('does nothing when no site is the default', async () => {
      await arrange({ frontendUrl: 'https://www.example.com' })
      await sites().updateMany({ where: {}, data: { isDefault: false } })
      try {
        expect(await ensureDefaultSiteUrl(strapi)).toBeNull()
      } finally {
        await sites().updateMany({ where: {}, data: { isDefault: true } })
      }
    })
  })
})
