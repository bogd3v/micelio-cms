import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import {
  ensureEnvToken,
  ensureFrontendToken,
  FRONTEND_TOKEN,
  FRONTEND_TOKEN_PERMISSIONS,
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
