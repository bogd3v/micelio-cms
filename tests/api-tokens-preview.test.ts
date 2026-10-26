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
// token. The plugin that registers the action is not installed in this repository yet, so the
// suite stands in for it where the action must exist.

const TOKEN_UID = 'admin::api-token'
const DRAFT = 'plugin::micelio.preview.draft'
const EXCHANGE = 'plugin::micelio.preview.exchange'
const ACCESS_KEY = 'preview-frontend-token-0123456789abcdef0123456789'

describe('Frontend token and the preview draft action', () => {
  const saved = { ...process.env }

  beforeAll(async () => {
    process.env.FRONTEND_API_TOKEN = ACCESS_KEY
    await setupStrapi()
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

  it('lists the draft action and never the exchange', () => {
    expect(FRONTEND_TOKEN_PERMISSIONS).toContain(DRAFT)
    expect(FRONTEND_TOKEN_PERMISSIONS).not.toContain(EXCHANGE)
  })

  it('boots without the action when no plugin registers it, and says so', async () => {
    const warn = jest.spyOn(strapi.log, 'warn')
    await strapi.db.query(TOKEN_UID).deleteMany({ where: { name: 'frontend' } })

    expect(await ensureFrontendToken(strapi)).toBe('created')
    expect(await actionsOfToken()).not.toContain(DRAFT)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(DRAFT))

    expect(await ensureFrontendToken(strapi)).toBe('unchanged')
  })

  it('adds the action to a token that lacks it once a plugin registers it, then reports unchanged', async () => {
    const provider = strapi.contentAPI.permissions.providers.action
    const keys = provider.keys()
    jest.spyOn(provider, 'keys').mockReturnValue([...keys, DRAFT])

    expect(await actionsOfToken()).not.toContain(DRAFT)
    expect(await ensureFrontendToken(strapi)).toBe('updated')

    const actions = await actionsOfToken()
    expect(actions).toContain(DRAFT)
    expect(actions).not.toContain(EXCHANGE)
    expect(actions).toEqual([...FRONTEND_TOKEN_PERMISSIONS].sort())

    expect(await ensureFrontendToken(strapi)).toBe('unchanged')
  })

  it('still stops on an unregistered action that is not optional, and does not warn about it', async () => {
    const unregistered = 'plugin::comments.client.unregistered'
    const warn = jest.spyOn(strapi.log, 'warn')
    warn.mockClear()

    await expect(
      ensureEnvToken(strapi, {
        ...FRONTEND_TOKEN,
        permissions: [...FRONTEND_TOKEN_PERMISSIONS, unregistered],
      })
    ).rejects.toThrow('Unknown permissions provided')

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(unregistered))
  })
})
