import { describe, it, expect } from '@jest/globals'
import { assertUpstreamsUseTls, isPrivateHost } from '../src/utils/plain-http'

const production = { NODE_ENV: 'production' }

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'umami',
    'strapi.internal',
    'umami.local',
    'app.localhost',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.9',
    '192.168.1.5',
    '169.254.1.1',
    '[::1]',
    '[fd00::1]',
    '[::ffff:10.0.0.1]',
  ])('%s is private', (host) => {
    expect(isPrivateHost(host)).toBe(true)
  })

  it.each(['example.com', 'hooks.example.org', '8.8.8.8', '172.32.0.1', '[2001:db8::1]'])(
    '%s is public',
    (host) => {
      expect(isPrivateHost(host)).toBe(false)
    }
  )
})

describe('assertUpstreamsUseTls', () => {
  it('refuses a public http UMAMI_URL in production and names the variable', () => {
    expect(() =>
      assertUpstreamsUseTls({ ...production, UMAMI_URL: 'http://umami.example.com' })
    ).toThrow('UMAMI_URL')
  })

  it('refuses a public http REBUILD_HOOK_URL in production and names the variable', () => {
    expect(() =>
      assertUpstreamsUseTls({ ...production, REBUILD_HOOK_URL: 'http://hooks.example.com/x' })
    ).toThrow('REBUILD_HOOK_URL')
  })

  it('names both variables when both are wrong', () => {
    expect(() =>
      assertUpstreamsUseTls({
        ...production,
        UMAMI_URL: 'http://8.8.8.8:3000',
        REBUILD_HOOK_URL: 'http://hooks.example.com',
      })
    ).toThrow(/UMAMI_URL.*REBUILD_HOOK_URL/s)
  })

  it('accepts https and private http in production', () => {
    expect(() =>
      assertUpstreamsUseTls({
        ...production,
        UMAMI_URL: 'http://umami:3000',
        REBUILD_HOOK_URL: 'https://api.github.com/repos/o/r/dispatches',
      })
    ).not.toThrow()
    expect(() =>
      assertUpstreamsUseTls({ ...production, UMAMI_URL: 'http://10.0.0.4:3000' })
    ).not.toThrow()
  })

  it('accepts unset or empty values', () => {
    expect(() => assertUpstreamsUseTls({ ...production, UMAMI_URL: ' ' })).not.toThrow()
    expect(() => assertUpstreamsUseTls(production)).not.toThrow()
  })

  it('does not check outside production', () => {
    expect(() =>
      assertUpstreamsUseTls({ NODE_ENV: 'development', UMAMI_URL: 'http://umami.example.com' })
    ).not.toThrow()
  })

  it('never prints the URL, which may carry credentials or a path', () => {
    let message = ''
    try {
      assertUpstreamsUseTls({
        ...production,
        REBUILD_HOOK_URL: 'http://user:secret@hooks.example.com/token-in-path',
      })
    } catch (error) {
      message = String(error)
    }
    expect(message).toContain('REBUILD_HOOK_URL')
    expect(message).not.toContain('secret')
    expect(message).not.toContain('token-in-path')
  })

  it('leaves a malformed URL alone: the consumers report it', () => {
    expect(() => assertUpstreamsUseTls({ ...production, UMAMI_URL: 'not a url' })).not.toThrow()
  })
})
