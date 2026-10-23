import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals'
import type { Core } from '@strapi/strapi'
import { setupStrapi, cleanupStrapi } from './strapi'
import {
  parseRetentionDays,
  purgeCutoff,
  purgeUnconfirmed,
  scheduleUnconfirmedPurge,
} from '../src/utils/unconfirmed-purge'

const USER_UID = 'plugin::users-permissions.user'
const SUBSCRIBER_UID = 'api::subscriber.subscriber'
const COMMENT_UID = 'plugin::comments.comment'
const DAY_MS = 24 * 60 * 60 * 1000

describe('parseRetentionDays', () => {
  it('defaults to 30 and accepts 0 and whole numbers', () => {
    expect(parseRetentionDays(undefined)).toBe(30)
    expect(parseRetentionDays('  ')).toBe(30)
    expect(parseRetentionDays('0')).toBe(0)
    expect(parseRetentionDays('90')).toBe(90)
    expect(parseRetentionDays('36500')).toBe(36500)
  })

  it.each(['36501', '99999999999'])('refuses %s, above 100 years', (value) => {
    expect(() => parseRetentionDays(value)).toThrow(/UNCONFIRMED_RETENTION_DAYS/)
  })

  it.each(['-1', '1.5', 'abc', 'NaN', '1e3', '0x10', 'Infinity'])(
    'refuses %s and names the variable',
    (value) => {
      expect(() => parseRetentionDays(value)).toThrow(/UNCONFIRMED_RETENTION_DAYS/)
    }
  )

  it('computes the cutoff from the injected clock', () => {
    const now = new Date('2026-03-31T00:00:00.000Z')
    expect(purgeCutoff(now, 30).toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })
})

describe('purgeUnconfirmed', () => {
  let roleId: number
  let counter = 0

  async function createUser(data: Record<string, unknown>, ageDays = 0): Promise<{ id: number }> {
    counter += 1
    const user = (await strapi.db.query(USER_UID).create({
      data: {
        username: `reader${counter}`,
        email: `reader${counter}@example.com`,
        provider: 'local',
        role: roleId,
        ...data,
      },
    })) as { id: number }
    await setAge(USER_UID, user.id, ageDays)
    return user
  }

  async function createSubscriber(confirmed: boolean, ageDays = 0): Promise<{ id: number }> {
    counter += 1
    const row = (await strapi.db.query(SUBSCRIBER_UID).create({
      data: {
        email: `sub${counter}@example.com`,
        confirmed,
        confirmationToken: confirmed ? null : `token-${counter}`,
        unsubscribeToken: `unsub-${counter}`,
      },
    })) as { id: number }
    await setAge(SUBSCRIBER_UID, row.id, ageDays)
    return row
  }

  /** Moves createdAt back; the query layer fills it on create, so it is set after. */
  async function setAge(uid: string, id: number, ageDays: number): Promise<void> {
    const createdAt = new Date(Date.now() - ageDays * DAY_MS).toISOString()
    await strapi.db.query(uid).update({ where: { id }, data: { createdAt } })
  }

  async function exists(uid: string, id: number): Promise<boolean> {
    return (await strapi.db.query(uid).findOne({ where: { id } })) !== null
  }

  beforeAll(async () => {
    await setupStrapi()
    const role = (await strapi.db
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } })) as { id: number }
    roleId = role.id
  })

  async function setEmailConfirmation(value: boolean): Promise<void> {
    const store = strapi.store({ type: 'plugin', name: 'users-permissions', key: 'advanced' })
    const current = ((await store.get({})) ?? {}) as Record<string, unknown>
    await store.set({ value: { ...current, email_confirmation: value } })
  }

  beforeEach(async () => {
    await setEmailConfirmation(true)
    await strapi.db.query(USER_UID).deleteMany({ where: {} })
    await strapi.db.query(SUBSCRIBER_UID).deleteMany({ where: {} })
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('deletes old unconfirmed users and subscribers and keeps recent ones', async () => {
    const oldUser = await createUser({ confirmed: false, confirmationToken: 'abc' }, 31)
    const recentUser = await createUser({ confirmed: false, confirmationToken: 'def' }, 29)
    const oldSub = await createSubscriber(false, 31)
    const recentSub = await createSubscriber(false, 29)

    const report = await purgeUnconfirmed(strapi, 30)

    expect(report).toMatchObject({ users: 1, subscribers: 1 })
    expect(await exists(USER_UID, oldUser.id)).toBe(false)
    expect(await exists(USER_UID, recentUser.id)).toBe(true)
    expect(await exists(SUBSCRIBER_UID, oldSub.id)).toBe(false)
    expect(await exists(SUBSCRIBER_UID, recentSub.id)).toBe(true)
  })

  it('keeps confirmed users and subscribers of any age', async () => {
    const user = await createUser({ confirmed: true, confirmationToken: null }, 900)
    const sub = await createSubscriber(true, 900)

    expect(await purgeUnconfirmed(strapi, 30)).toMatchObject({ users: 0, subscribers: 0 })
    expect(await exists(USER_UID, user.id)).toBe(true)
    expect(await exists(SUBSCRIBER_UID, sub.id)).toBe(true)
  })

  it('keeps unconfirmed users with no token (admin-created) and blocked users', async () => {
    const admin = await createUser({ confirmed: false, confirmationToken: null }, 900)
    const blocked = await createUser(
      { confirmed: false, confirmationToken: 'abc', blocked: true },
      900
    )

    expect(await purgeUnconfirmed(strapi, 30)).toMatchObject({ users: 0, subscribers: 0 })
    expect(await exists(USER_UID, admin.id)).toBe(true)
    expect(await exists(USER_UID, blocked.id)).toBe(true)
  })

  it('does nothing when retention is 0', async () => {
    const user = await createUser({ confirmed: false, confirmationToken: 'abc' }, 900)
    const sub = await createSubscriber(false, 900)

    expect(await purgeUnconfirmed(strapi, 0)).toMatchObject({ users: 0, subscribers: 0 })
    expect(await exists(USER_UID, user.id)).toBe(true)
    expect(await exists(SUBSCRIBER_UID, sub.id)).toBe(true)
  })

  it('uses the injected clock instead of waiting', async () => {
    const user = await createUser({ confirmed: false, confirmationToken: 'abc' })
    const now = new Date(Date.now() + 31 * DAY_MS)

    expect(await purgeUnconfirmed(strapi, 30, new Date())).toMatchObject({
      users: 0,
      subscribers: 0,
    })
    expect((await purgeUnconfirmed(strapi, 30, now)).users).toBe(1)
    expect(await exists(USER_UID, user.id)).toBe(false)
  })

  it('is idempotent and works through more than one batch', async () => {
    for (let i = 0; i < 105; i += 1) await createSubscriber(false, 40)

    expect((await purgeUnconfirmed(strapi, 30)).subscribers).toBe(105)
    expect(await purgeUnconfirmed(strapi, 30)).toMatchObject({ users: 0, subscribers: 0 })
  })

  it('removes the account and leaves its comments as anonymous', async () => {
    const user = await createUser({ confirmed: false, confirmationToken: 'abc' }, 40)
    const comment = (await strapi.db.query(COMMENT_UID).create({
      data: {
        content: 'Hello',
        related: 'api::article.article:none',
        authorUser: user.id,
        authorId: String(user.id),
        authorName: 'Reader',
        authorEmail: 'reader@example.com',
      },
    })) as { id: number }

    expect((await purgeUnconfirmed(strapi, 30)).users).toBe(1)

    const left = (await strapi.db.query(COMMENT_UID).findOne({
      where: { id: comment.id },
      populate: ['authorUser'],
    })) as { authorId: string; authorEmail: string | null; authorUser: unknown } | null
    expect(left).toMatchObject({ authorId: 'anonymous', authorEmail: null, authorUser: null })
  })

  it('skips accounts, not subscriptions, when email confirmation is off', async () => {
    await setEmailConfirmation(false)
    const user = await createUser({ confirmed: false, confirmationToken: 'abc' }, 40)
    const sub = await createSubscriber(false, 40)

    const report = await purgeUnconfirmed(strapi, 30)

    expect(report).toMatchObject({ users: 0, subscribers: 1, usersSkipped: true })
    expect(await exists(USER_UID, user.id)).toBe(true)
    expect(await exists(SUBSCRIBER_UID, sub.id)).toBe(false)
  })

  it('reports accounts as not skipped when email confirmation is on', async () => {
    expect((await purgeUnconfirmed(strapi, 30)).usersSkipped).toBe(false)
  })

  it('counts a failing deletion and still purges the other rows', async () => {
    const bad = await createUser({ confirmed: false, confirmationToken: 'abc' }, 40)
    const good = await createUser({ confirmed: false, confirmationToken: 'def' }, 40)
    const sub = await createSubscriber(false, 40)
    const service = strapi.plugin('users-permissions').service('user')
    const remove = service.remove.bind(service)
    const spy = jest.spyOn(service, 'remove').mockImplementation(async (params: unknown) => {
      if ((params as { id: number }).id === bad.id) throw new Error('boom')
      return remove(params)
    })

    try {
      const report = await purgeUnconfirmed(strapi, 30)
      expect(report).toMatchObject({ users: 1, usersFailed: 1, subscribers: 1 })
    } finally {
      spy.mockRestore()
    }
    expect(await exists(USER_UID, bad.id)).toBe(true)
    expect(await exists(USER_UID, good.id)).toBe(false)
    expect(await exists(SUBSCRIBER_UID, sub.id)).toBe(false)
  })
})

describe('scheduleUnconfirmedPurge', () => {
  function stub(cronEnabled: boolean): { strapi: Core.Strapi; add: jest.Mock } {
    const add = jest.fn()
    const strapi = {
      config: { get: () => cronEnabled },
      cron: { add },
      log: { info: jest.fn(), warn: jest.fn() },
    } as unknown as Core.Strapi
    return { strapi, add }
  }

  it('registers nothing when cron is disabled', () => {
    const { strapi, add } = stub(false)
    scheduleUnconfirmedPurge(strapi, 30)
    expect(add).not.toHaveBeenCalled()
  })

  it('registers nothing when retention is 0', () => {
    const { strapi, add } = stub(true)
    scheduleUnconfirmedPurge(strapi, 0)
    expect(add).not.toHaveBeenCalled()
  })

  it('registers one daily task when enabled', () => {
    const { strapi, add } = stub(true)
    scheduleUnconfirmedPurge(strapi, 30)
    expect(add).toHaveBeenCalledTimes(1)
    const tasks = add.mock.calls[0][0] as Record<string, { options: { rule: string } }>
    expect(Object.keys(tasks)).toEqual(['unconfirmedPurge'])
    expect(tasks.unconfirmedPurge.options.rule).toBe('17 3 * * *')
  })
})
