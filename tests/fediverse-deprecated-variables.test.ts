import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import winston from 'winston'
import { setupStrapi, cleanupStrapi } from './strapi'
import { warnDeprecatedActorVariables } from '../src/plugins/fediverse/server/src/utils/deprecated-variables'

const DEPRECATED = [
  ['FEDIVERSE_ACTOR_USERNAME', 'Username'],
  ['FEDIVERSE_ACTOR_NAME', 'Display name'],
  ['FEDIVERSE_ACTOR_SUMMARY', 'Summary'],
  ['FEDIVERSE_ACTOR_SOURCE_URL', 'Source URL'],
]

describe('Deprecated FEDIVERSE_ACTOR_* variables (#303)', () => {
  const lines: string[] = []

  beforeAll(async () => {
    process.env.FEDIVERSE_ENABLED = 'true'
    process.env.FEDIVERSE_ACTOR_IDENTIFIER = 'devbog'
    process.env.FEDIVERSE_ACTOR_USERNAME = 'bogdev'
    process.env.FEDIVERSE_ACTOR_NAME = 'Variable name'
    process.env.FEDIVERSE_ACTOR_SUMMARY = 'Variable bio.'
    process.env.FEDIVERSE_ACTOR_SOURCE_URL = 'https://code.example.test/variable'
    process.env.FRONTEND_URL = 'https://blog.example.test'

    // Each Strapi log call ends in `write(info)` on its winston logger, whatever the level or where
    // the transport writes (the console or stdout, which differs with several workers).
    const write = winston.Logger.prototype.write
    jest.spyOn(winston.Logger.prototype, 'write').mockImplementation(function (
      this: winston.Logger,
      info: unknown
    ) {
      lines.push(String((info as { message?: unknown }).message))
      return (write as (chunk: unknown) => boolean).call(this, info)
    } as never)
    await setupStrapi()
  })

  afterAll(async () => {
    jest.restoreAllMocks()
    await cleanupStrapi()
    for (const [name] of DEPRECATED) delete process.env[name]
  })

  it('logs one deprecation line per variable that is set at boot, naming its setting', () => {
    const deprecations = lines.filter(
      (line) => line.includes('[fediverse]') && line.includes('is deprecated')
    )

    expect(deprecations).toHaveLength(DEPRECATED.length)
    for (const [name, field] of DEPRECATED) {
      const own = deprecations.filter((line) => line.includes(name))
      expect(own).toHaveLength(1)
      expect(own[0]).toContain(`"${field}" under Site settings > Fediverse profile`)
    }
  })

  it('warns about nothing for a variable that is unset or blank', () => {
    const warned: string[] = []
    const names = warnDeprecatedActorVariables(
      { warn: (message) => warned.push(message) },
      { FEDIVERSE_ACTOR_NAME: '  ', FEDIVERSE_ACTOR_IDENTIFIER: 'blog' }
    )

    expect(names).toEqual([])
    expect(warned).toEqual([])
  })
})
