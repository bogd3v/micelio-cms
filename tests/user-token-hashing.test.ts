import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { getRole } from './helpers/permissions'
import { restoreRateLimitEnv, setRateLimitEnv } from './helpers/rate-limit-env'
import { handleEmailConfirmation } from '../src/extensions/users-permissions/email-confirmation'
import { hashUserTokens } from '../src/migrations/hash-user-tokens'

const USER_UID = 'plugin::users-permissions.user'
const PASSWORD = 'Sup3r-secret'
const CONFIRM_PATH = '/api/auth/email-confirmation'
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

interface SentEmail {
  to: string
  html?: string
  text?: string
}

type Stored = { confirmationToken: string | null; resetPasswordToken: string | null }

describe('Reader tokens are stored as SHA-256', () => {
  const sent: SentEmail[] = []
  const http = () => request(strapi.server.httpServer)
  const param = (name: string): string => {
    const link = /href="([^"]+)"/.exec(sent[0].html ?? sent[0].text ?? '')?.[1]
    const value = link ? new URL(link).searchParams.get(name) : null
    if (!value) throw new Error(`The email has no ${name}`)
    return value
  }
  const stored = async (username: string): Promise<Stored> => {
    const row = await strapi.db
      .query(USER_UID)
      .findOne({ select: ['confirmationToken', 'resetPasswordToken'], where: { username } })
    return { confirmationToken: row.confirmationToken, resetPasswordToken: row.resetPasswordToken }
  }
  const signUp = async (username: string): Promise<string> => {
    sent.length = 0
    await http()
      .post('/api/auth/local/register')
      .send({ username, email: `${username}@example.com`, password: PASSWORD })
      .expect(200)
    return param('confirmation')
  }
  const requestCode = async (username: string): Promise<string> => {
    sent.length = 0
    await http()
      .post('/api/auth/forgot-password')
      .send({ email: `${username}@example.com` })
      .expect(200)
    return param('code')
  }
  const reset = (code: string, password: string) =>
    http().post('/api/auth/reset-password').send({ code, password, passwordConfirmation: password })

  beforeAll(async () => {
    setRateLimitEnv({
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_AUTH: '1000/60',
      RATE_LIMIT_AUTH_EMAIL: '1000/60',
      RATE_LIMIT_AUTH_IDENTIFIER: '1000/60',
      RATE_LIMIT_API: '1000/60',
    })
    process.env.FRONTEND_URL = 'https://frontend.example.com'
    await setupStrapi()
    strapi.plugin('email').service('email').send = async (options: SentEmail) => {
      sent.push(options)
    }
    await strapi.service('plugin::users-permissions.users-permissions').initialize()
  })

  afterAll(async () => {
    await cleanupStrapi()
    restoreRateLimitEnv()
    delete process.env.FRONTEND_URL
  })

  describe('confirmation token', () => {
    it('stores the SHA-256 of the emailed token, which confirms the account', async () => {
      const token = await signUp('hash-confirm')
      expect((await stored('hash-confirm')).confirmationToken).toBe(sha256(token))

      await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(204)
      const user = await stored('hash-confirm')
      expect(user.confirmationToken).toBeNull()
      await http()
        .post('/api/auth/local')
        .send({ identifier: 'hash-confirm@example.com', password: PASSWORD })
        .expect(200)
    })

    it('refuses the stored hash used as a token', async () => {
      const token = await signUp('hash-replay')
      const hash = sha256(token)

      await http().post(CONFIRM_PATH).send({ confirmation: hash }).expect(400)
      expect((await stored('hash-replay')).confirmationToken).toBe(hash)
      await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(204)
    })

    it('refuses a token that was already used', async () => {
      const token = await signUp('hash-reused')
      await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(204)
      await http().post(CONFIRM_PATH).send({ confirmation: token }).expect(400)
    })

    it('stores the hash when the confirmation email is sent again', async () => {
      await signUp('hash-resend')
      sent.length = 0
      await http()
        .post('/api/auth/send-email-confirmation')
        .send({ email: 'hash-resend@example.com' })
        .expect(200)
      const token = param('confirmation')
      expect((await stored('hash-resend')).confirmationToken).toBe(sha256(token))
    })
  })

  describe('reset code', () => {
    const createUser = async (username: string): Promise<void> => {
      const role = await getRole('authenticated')
      await strapi
        .plugin('users-permissions')
        .service('user')
        .add({
          username,
          email: `${username}@example.com`,
          password: PASSWORD,
          provider: 'local',
          confirmed: true,
          role: role.id,
        })
    }

    it('stores the SHA-256 of the emailed code, which resets the password once', async () => {
      await createUser('hash-reset')
      const code = await requestCode('hash-reset')
      expect((await stored('hash-reset')).resetPasswordToken).toBe(sha256(code))

      await reset(code, 'N3w-secret-one').expect(200)
      expect((await stored('hash-reset')).resetPasswordToken).toBeNull()
      await reset(code, 'N3w-secret-two').expect(400)
    })

    it('refuses the stored hash used as a code', async () => {
      await createUser('hash-reset-replay')
      const code = await requestCode('hash-reset-replay')
      const hash = sha256(code)

      await reset(hash, 'N3w-secret-one').expect(400)
      await reset(code, 'N3w-secret-one').expect(200)
    })

    it('refuses an expired code and burns it', async () => {
      await createUser('hash-reset-old')
      const code = await requestCode('hash-reset-old')
      await strapi.db.query(USER_UID).update({
        where: { email: 'hash-reset-old@example.com' },
        data: { resetPasswordIssuedAt: new Date(Date.now() - 61 * 60 * 1000).toISOString() },
      })

      const res = await reset(code, 'N3w-secret-one').expect(400)
      expect(res.body.error.message).toBe('Incorrect code provided')
      expect((await stored('hash-reset-old')).resetPasswordToken).toBeNull()
    })
  })

  describe('migration', () => {
    it('hashes legacy tokens and leaves hashes alone, twice', async () => {
      const role = await getRole('authenticated')
      const make = (username: string, data: Partial<Stored>) =>
        strapi.db.query(USER_UID).create({
          data: {
            username,
            email: `${username}@example.com`,
            provider: 'local',
            role: role.id,
            ...data,
          },
        })
      const confirmation = 'c'.repeat(40)
      const code = 'd'.repeat(128)
      const already = sha256('something')
      await make('legacy-both', { confirmationToken: confirmation, resetPasswordToken: code })
      await make('legacy-hashed', { confirmationToken: already })
      await make('legacy-none', {})

      const first = await hashUserTokens(strapi)
      expect(first).toBeGreaterThanOrEqual(2)
      expect(await stored('legacy-both')).toEqual({
        confirmationToken: sha256(confirmation),
        resetPasswordToken: sha256(code),
      })
      expect((await stored('legacy-hashed')).confirmationToken).toBe(already)
      expect(await stored('legacy-none')).toEqual({
        confirmationToken: null,
        resetPasswordToken: null,
      })

      expect(await hashUserTokens(strapi)).toBe(0)
      expect((await stored('legacy-both')).confirmationToken).toBe(sha256(confirmation))

      // The legacy emailed token still confirms: the lookup hashes it.
      await http().post(CONFIRM_PATH).send({ confirmation }).expect(204)
    })

    it('leaves a row that changed between the read and the update', async () => {
      const role = await getRole('authenticated')
      const old = 'e'.repeat(40)
      const fresh = 'f'.repeat(40)
      await strapi.db.query(USER_UID).create({
        data: {
          username: 'legacy-race',
          email: 'legacy-race@example.com',
          provider: 'local',
          role: role.id,
          confirmationToken: old,
        },
      })

      // The smallest seam: a concurrent write lands right after the migration's read.
      const realQuery = strapi.db.query.bind(strapi.db)
      const spy = jest.spyOn(strapi.db, 'query').mockImplementation(((uid: string) => {
        const query = realQuery(uid as never)
        return new Proxy(query, {
          get: (target, prop, receiver) => {
            if (prop !== 'findMany') return Reflect.get(target, prop, receiver)
            return async (params: never) => {
              const rows = await target.findMany(params)
              await target.update({
                where: { confirmationToken: old },
                data: { confirmationToken: fresh },
              })
              return rows
            }
          },
        })
      }) as never)
      try {
        await hashUserTokens(strapi)
      } finally {
        spy.mockRestore()
      }

      expect((await stored('legacy-race')).confirmationToken).toBe(fresh)
    })
  })

  describe('email confirmation handler', () => {
    it('answers 405 to any other method, never reaching the plugin lookup', async () => {
      const methodNotAllowed = jest.fn()
      await handleEmailConfirmation({ method: 'PUT', methodNotAllowed } as never)
      expect(methodNotAllowed).toHaveBeenCalledTimes(1)
    })
  })
})
