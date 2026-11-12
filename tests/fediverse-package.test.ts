import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'
import { env } from '@strapi/utils'
import request from 'supertest'
import pluginsConfig from '../config/plugins'
import { setupStrapi, cleanupStrapi, serverHost } from './strapi'
import { grantEditorsPageSite } from '../src/migrations/admin-page-site'
import { waitUntil } from './helpers/wait-until'
import { copySiteSettingsToSite } from '../src/migrations/site-settings-to-site'
import {
  COPY_MARKER,
  SITE_SETTING_UID,
  readSite,
  resetDefaultSite,
  seedSingleType,
} from './helpers/site-settings-seed'

// The distribution installs `@micelio/strapi-plugin-fediverse` and holds no federation code of its
// own (bogd3v/micelio-cms#391). The package carries its suites; these pin what only the
// distribution can break: how it lists the plugin, that a boot with the package federates, and who
// sees the profile after an upgrade (docs/operate/upgrade.md, "Upgrading to 0.7").

const ACTIVITY_JSON = 'application/activity+json'
const ARTICLE_UID = 'api::article.article'
const READ = 'plugin::content-manager.explorer.read'

/** The package's own `package.json`, as `node_modules` holds it. */
function installedPackage(): { version: string } {
  const path = require.resolve('@micelio/strapi-plugin-fediverse/package.json')
  return JSON.parse(readFileSync(path, 'utf8')) as { version: string }
}

/** A JRD link of a WebFinger answer. */
type JrdLink = { rel: string; type?: string; href: string }

/** A fake remote inbox: records what is POSTed to it, as a follower's server would. */
async function createFakeInbox() {
  const received: { type?: string; object?: { id?: string; name?: string } }[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/inbox') {
        try {
          received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          // A body that is not JSON is not a delivery.
        }
        res.writeHead(202)
      } else {
        res.writeHead(404)
      }
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    received,
    actorUrl: `http://127.0.0.1:${port}/actor`,
    inboxUrl: `http://127.0.0.1:${port}/inbox`,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    },
  }
}

describe('The distribution with @micelio/strapi-plugin-fediverse (FEDIVERSE_ENABLED=true)', () => {
  const saved = { ...process.env }
  let host: string

  beforeAll(async () => {
    process.env.FEDIVERSE_ENABLED = 'true'
    process.env.FEDIVERSE_ACTOR_IDENTIFIER = 'devbog'
    process.env.FRONTEND_URL = 'https://blog.example.test'
    process.env.FRONTEND_ARTICLE_PATH = '/blog/{slug}'
    await setupStrapi()
    host = serverHost()
  })

  afterAll(async () => {
    // Let the fan-out that follows a publish finish before the database goes.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await cleanupStrapi()
    process.env = { ...saved }
  })

  it('lists the fediverse plugin from the package, always enabled', () => {
    expect(installedPackage().version).toBe('0.7.1')

    // Always enabled and never resolved from a path: the package reads FEDIVERSE_ENABLED itself.
    const listed = pluginsConfig({ env } as never) as Record<string, Record<string, unknown>>
    expect(listed.fediverse).toEqual({ enabled: true })

    const previous = process.env.FEDIVERSE_ENABLED
    delete process.env.FEDIVERSE_ENABLED
    try {
      const unset = pluginsConfig({ env } as never) as Record<string, Record<string, unknown>>
      expect(unset.fediverse).toEqual({ enabled: true })
    } finally {
      process.env.FEDIVERSE_ENABLED = previous
    }

    // Loaded, with the switch on: its content types and services exist.
    expect(strapi.plugin('fediverse').contentTypes).toHaveProperty('follower')
    expect(typeof strapi.plugin('fediverse').service('followers').recordFollower).toBe('function')
  })

  it('answers WebFinger and the actor of the default site through the package', async () => {
    const webfinger = await request(strapi.server.httpServer)
      .get('/.well-known/webfinger')
      .query({ resource: `acct:devbog@${host}` })
      .expect(200)
      .expect('Content-Type', /json/)
    expect(webfinger.body.subject).toBe(`acct:devbog@${host}`)
    const self = (webfinger.body.links as JrdLink[]).find((link) => link.rel === 'self')
    expect(self?.type).toBe(ACTIVITY_JSON)
    expect(self?.href).toBe(`http://${host}/fediverse/user/devbog`)

    const actor = await request(strapi.server.httpServer)
      .get('/fediverse/user/devbog')
      .set('Accept', ACTIVITY_JSON)
      .expect(200)
    expect(actor.body.type).toBe('Person')
    expect(actor.body.id).toBe(`http://${host}/fediverse/user/devbog`)
    expect(actor.body.preferredUsername).toBe('devbog')
  })

  it('delivers a published article to a seeded follower through the package', async () => {
    const inbox = await createFakeInbox()
    try {
      await strapi
        .plugin('fediverse')
        .service('followers')
        .recordFollower(strapi, { actorId: inbox.actorUrl, inbox: inbox.inboxUrl })

      const draft = await strapi.documents(ARTICLE_UID).create({
        data: { title: 'Through the package', slug: 'through-the-package', description: 'Hello.' },
      })
      await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId })

      // Waited for, never a fixed sleep: the delivery runs after the publish commits.
      const create = await waitUntil(
        () =>
          inbox.received.find(
            (activity) =>
              activity.type === 'Create' && activity.object?.id?.endsWith(draft.documentId)
          ),
        { timeoutMs: 15000 }
      )
      expect(create.object?.name ?? create.object?.id).toBeTruthy()
    } finally {
      await inbox.close()
    }
  })

  it('leaves no half-copied fediverse profile when the copy of one row fails', async () => {
    await seedSingleType()
    await resetDefaultSite()
    const profiles = () => strapi.db.query('micelio-site.fediverse').count()
    const before = await profiles()
    const original = strapi.db.query.bind(strapi.db)
    let created = 0
    // The second component row fails: the first must not stay.
    const spy = jest.spyOn(strapi.db, 'query').mockImplementation(((uid: string) => {
      const repository = original(uid as never)
      if (uid !== 'micelio-site.fediverse') return repository
      return new Proxy(repository, {
        get(target, name, receiver) {
          if (name === 'create') {
            return async (params: never) => {
              created += 1
              if (created === 2) throw new Error('component table unavailable')
              return target.create(params)
            }
          }
          return Reflect.get(target, name, receiver)
        },
      })
    }) as never)
    const error = jest.spyOn(strapi.log, 'error').mockImplementation(() => strapi.log)
    try {
      const report = await copySiteSettingsToSite(strapi)
      expect(report?.failed).toContain('en.fediverse')
    } finally {
      spy.mockRestore()
      error.mockRestore()
    }
    expect(await profiles()).toBe(before)
    expect(await strapi.store.get(COPY_MARKER)).toBeNull()
  })

  it('copies the fediverse profile of the site settings into a default site that already has a follower', async () => {
    await seedSingleType()
    await resetDefaultSite()
    const inbox = await createFakeInbox()
    try {
      await strapi
        .plugin('fediverse')
        .service('followers')
        .recordFollower(strapi, { actorId: inbox.actorUrl, inbox: inbox.inboxUrl })
      const site = (await strapi.db
        .query(SITE_UID)
        .findOne({ where: { isDefault: true }, select: ['documentId'] })) as { documentId: string }
      const followers = (await strapi.db
        .query('plugin::fediverse.follower')
        .count({ where: { site: { documentId: site.documentId } } })) as number
      expect(followers).toBeGreaterThan(0)

      const report = await copySiteSettingsToSite(strapi)
      expect(report?.failed).toEqual([])

      type Profile = Record<string, unknown> & { header?: { id: number } | null }
      const settings = (await strapi.documents(SITE_SETTING_UID as never).findFirst({
        locale: 'en',
        populate: { fediverse: { populate: '*' } },
      } as never)) as unknown as { fediverse: Profile }
      const copied = ((await readSite('en')) as unknown as { fediverse: Profile }).fediverse
      const fields = [
        'username',
        'displayName',
        'summary',
        'discoverable',
        'objectType',
        'sourceUrl',
      ]
      expect(copied.username).toBe('acme')
      const link = await strapi.db
        .connection('micelio_sites_cmps')
        .where({ field: 'fediverse', component_type: 'micelio-site.fediverse' })
      expect(link.length).toBeGreaterThan(0)
      for (const field of fields) expect(copied[field]).toEqual(settings.fediverse[field])
      expect(copied.header?.id).toBeDefined()
      expect(copied.header?.id).toBe(settings.fediverse.header?.id)
    } finally {
      await inbox.close()
    }
  })

  it('gives Editor and Author the fediverse profile of Site as the upgrade notes say', async () => {
    // Strapi lists a component's fields as `fediverse.username`, `fediverse.summary`, ...
    const profileFields = (fields: string[]) =>
      fields.filter((field) => field === 'fediverse' || field.startsWith('fediverse.'))
    const siteReads = async (code: string) =>
      (await strapi.db
        .query('admin::permission')
        .findMany({ where: { action: READ, subject: SITE_UID, role: { code } } })) as {
        id: number
        properties: { fields?: string[] }
      }[]

    for (const code of ['strapi-editor', 'strapi-author']) {
      // A fresh instance has what Strapi gives its default roles: the profile is in the fields.
      const fresh = await siteReads(code)
      expect(fresh.length).toBeGreaterThan(0)
      expect(profileFields(fresh.flatMap((read) => read.properties.fields ?? []))).not.toEqual([])

      // An upgraded instance has no read on Site until the migration gives one, with the scalar
      // fields only: the profile (a component) is not among them.
      await strapi.db
        .query('admin::permission')
        .deleteMany({ where: { id: { $in: fresh.map((read) => read.id) } } })
    }
    expect(await grantEditorsPageSite(strapi)).toBeGreaterThan(0)
    for (const code of ['strapi-editor', 'strapi-author']) {
      const upgraded = await siteReads(code)
      expect(upgraded).toHaveLength(1)
      const fields = upgraded[0].properties.fields ?? []
      expect(fields).toContain('name')
      expect(profileFields(fields)).toEqual([])
    }
  })
})

describe('A boot that the package refuses', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('stops a boot with FEDIVERSE_ACTOR_USERNAME set, naming it', async () => {
    process.env.FEDIVERSE_ENABLED = 'true'
    process.env.FEDIVERSE_ACTOR_IDENTIFIER = 'devbog'
    process.env.FEDIVERSE_ACTOR_USERNAME = 'bogdev'
    process.env.FRONTEND_URL = 'https://blog.example.test'

    try {
      await expect(setupStrapi()).rejects.toThrow(
        `FEDIVERSE_ACTOR_USERNAME is no longer read: set "Username" under the default site's Fediverse profile`
      )
    } finally {
      await cleanupStrapi()
    }
  })

  it('stops a boot with federation on and no FEDIVERSE_ACTOR_IDENTIFIER, naming it', async () => {
    process.env.FEDIVERSE_ENABLED = 'true'
    delete process.env.FEDIVERSE_ACTOR_IDENTIFIER
    process.env.FRONTEND_URL = 'https://blog.example.test'
    // The package reads the identifier when its module loads, and an earlier boot of this file
    // already loaded it with one.
    jest.resetModules()

    try {
      await expect(setupStrapi()).rejects.toThrow(
        'FEDIVERSE_ACTOR_IDENTIFIER must be set while FEDIVERSE_ENABLED=true'
      )
    } finally {
      await cleanupStrapi()
    }
  })
})
