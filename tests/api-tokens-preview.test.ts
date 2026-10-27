import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import {
  ensureEnvToken,
  ensureFrontendToken,
  FRONTEND_TOKEN,
  FRONTEND_TOKEN_PERMISSIONS,
  PREVIEW_FRONTEND_TOKEN_PERMISSIONS,
} from '../src/migrations/api-tokens'

// The frontend token carries the preview's draft action (micelio ADR 0019, amendment of
// 2026-10-25): the CMS measures a draft at publish through the frontend, which reads it with this
// token. `@micelio/strapi-plugin-core` registers the action, so the boot creates the token with it.

const TOKEN_UID = 'admin::api-token'
const DRAFT = 'plugin::micelio.preview.draft'
const EXCHANGE = 'plugin::micelio.preview.exchange'
const ACCESS_KEY = 'preview-frontend-token-0123456789abcdef0123456789'

describe('Frontend token and the preview draft action', () => {
  const saved = { ...process.env }
  let warn: jest.SpiedFunction<typeof console.warn>

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = ACCESS_KEY
    // A boot that is neither the demo nor an opt-in: the exchange is the grant of those two alone.
    delete process.env.MICELIO_DEMO
    delete process.env.MICELIO_PREVIEW
    await setupStrapi()
    warn = jest.spyOn(strapi.log, 'warn') as unknown as typeof warn
  })

  afterAll(async () => {
    jest.restoreAllMocks()
    await cleanupStrapi()
    process.env = { ...saved }
  })

  const actionsOfToken = async (): Promise<string[]> => {
    const token = await strapi.db.query(TOKEN_UID).findOne({
      where: { name: 'frontend' },
      populate: ['permissions'],
    })
    return token.permissions.map(({ action }: { action: string }) => action).sort()
  }

  it('registers the draft action in the content API, and the exchange too', () => {
    const registered = [...strapi.contentAPI.permissions.providers.action.keys()]
    expect(registered).toContain(DRAFT)
    expect(registered).toContain(EXCHANGE)
  })

  it('lists the draft action and never the exchange', () => {
    expect(FRONTEND_TOKEN_PERMISSIONS).toContain(DRAFT)
    expect(FRONTEND_TOKEN_PERMISSIONS).not.toContain(EXCHANGE)
  })

  it('gives the token created from FRONTEND_API_TOKEN every listed action, with no warning', async () => {
    const actions = await actionsOfToken()
    expect(actions).toContain(DRAFT)
    expect(actions).not.toContain(EXCHANGE)
    expect(actions).toEqual([...FRONTEND_TOKEN_PERMISSIONS].sort())
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[api-tokens]'))
  })

  it('creates the token again with the draft action, then reports unchanged', async () => {
    await strapi.db.query(TOKEN_UID).deleteMany({ where: { name: 'frontend' } })

    expect(await ensureFrontendToken(strapi)).toBe('created')
    expect(await actionsOfToken()).toContain(DRAFT)
    expect(await ensureFrontendToken(strapi)).toBe('unchanged')
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[api-tokens]'))
  })

  it('grants the exchange to the demo, not to the static or landing profiles', async () => {
    try {
      for (const profile of ['static', 'landing', 'false', '']) {
        process.env.MICELIO_DEMO = profile
        await ensureFrontendToken(strapi)
        expect(await actionsOfToken()).not.toContain(EXCHANGE)
      }

      process.env.MICELIO_DEMO = 'true'
      expect(await ensureFrontendToken(strapi)).toBe('updated')
      expect(await actionsOfToken()).toContain(EXCHANGE)

      delete process.env.MICELIO_DEMO
      expect(await ensureFrontendToken(strapi)).toBe('updated')
      expect(await actionsOfToken()).toEqual([...FRONTEND_TOKEN_PERMISSIONS].sort())
    } finally {
      delete process.env.MICELIO_DEMO
    }
  })

  it('grants the exchange to a site that sets MICELIO_PREVIEW=true, and keeps it on a second boot', async () => {
    try {
      process.env.MICELIO_PREVIEW = 'true'
      expect(await ensureFrontendToken(strapi)).toBe('updated')
      expect(await actionsOfToken()).toEqual([...PREVIEW_FRONTEND_TOKEN_PERMISSIONS].sort())
      expect(await actionsOfToken()).toContain(EXCHANGE)
      expect(await ensureFrontendToken(strapi)).toBe('unchanged')
      expect(await actionsOfToken()).toContain(EXCHANGE)
    } finally {
      delete process.env.MICELIO_PREVIEW
    }
  })

  it('creates the token with the exchange when the switch is on from the first boot', async () => {
    try {
      await strapi.db.query(TOKEN_UID).deleteMany({ where: { name: 'frontend' } })
      process.env.MICELIO_PREVIEW = 'true'
      expect(await ensureFrontendToken(strapi)).toBe('created')
      expect(await actionsOfToken()).toContain(EXCHANGE)
    } finally {
      delete process.env.MICELIO_PREVIEW
    }
  })

  it('removes the exchange when the switch is off or unset, as it resets any widened token', async () => {
    process.env.MICELIO_PREVIEW = 'true'
    await ensureFrontendToken(strapi)
    expect(await actionsOfToken()).toContain(EXCHANGE)

    delete process.env.MICELIO_PREVIEW
    expect(await ensureFrontendToken(strapi)).toBe('updated')
    expect(await actionsOfToken()).toEqual([...FRONTEND_TOKEN_PERMISSIONS].sort())

    // An operator adds the exchange by hand under Settings → API Tokens: the next boot removes it.
    const tokens = strapi.service(TOKEN_UID) as unknown as {
      getByName(name: string): Promise<{ id: number }>
      update(id: number, attributes: Record<string, unknown>): Promise<unknown>
    }
    const { id } = await tokens.getByName('frontend')
    await tokens.update(id, { permissions: [...FRONTEND_TOKEN_PERMISSIONS, EXCHANGE] })
    expect(await actionsOfToken()).toContain(EXCHANGE)

    expect(await ensureFrontendToken(strapi)).toBe('updated')
    expect(await actionsOfToken()).not.toContain(EXCHANGE)
  })

  it('treats any MICELIO_PREVIEW value but "true" as off', async () => {
    try {
      for (const value of ['false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', '']) {
        // Each value starts from a token that has the exchange, so it also proves it removes it.
        process.env.MICELIO_PREVIEW = 'true'
        await ensureFrontendToken(strapi)
        expect(await actionsOfToken()).toContain(EXCHANGE)

        process.env.MICELIO_PREVIEW = value
        await ensureFrontendToken(strapi)
        expect([value, await actionsOfToken()]).toEqual([
          value,
          [...FRONTEND_TOKEN_PERMISSIONS].sort(),
        ])
      }
    } finally {
      delete process.env.MICELIO_PREVIEW
    }
  })

  it('grants the exchange with both switches on, and to a static or landing demo that opts in', async () => {
    try {
      for (const demo of ['true', 'static', 'landing']) {
        process.env.MICELIO_DEMO = demo
        process.env.MICELIO_PREVIEW = 'true'
        await ensureFrontendToken(strapi)
        expect([demo, await actionsOfToken()]).toEqual([
          demo,
          [...PREVIEW_FRONTEND_TOKEN_PERMISSIONS].sort(),
        ])
      }
    } finally {
      delete process.env.MICELIO_DEMO
      delete process.env.MICELIO_PREVIEW
    }
  })

  it('does not widen the token with the switch beyond the exchange', () => {
    expect(
      PREVIEW_FRONTEND_TOKEN_PERMISSIONS.filter(
        (action) => !FRONTEND_TOKEN_PERMISSIONS.includes(action)
      )
    ).toEqual([EXCHANGE])
  })

  it('stops on an action no plugin registers, as on every other one', async () => {
    const unregistered = 'plugin::comments.client.unregistered'

    await expect(
      ensureEnvToken(strapi, {
        ...FRONTEND_TOKEN,
        permissions: [...FRONTEND_TOKEN_PERMISSIONS, unregistered],
      })
    ).rejects.toThrow('Unknown permissions provided')
  })
})
