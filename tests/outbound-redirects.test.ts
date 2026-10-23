import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Core } from '@strapi/strapi'
import { isRefusedRedirect } from '../src/utils/refused-redirect'
import { createRebuildHook } from '../src/utils/rebuild-hook'
import { fetchPathVisitors, fetchWebsiteTotals } from '../src/api/article-stat/utils/umami-client'

// V15.3.2 (#179): outbound calls refuse redirects. undici forwards custom
// headers and resends POST bodies on 307/308, so the target must never be hit.

const SECRET_QUERY = 'secret=do-not-log'

async function listen(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: (server.address() as AddressInfo).port }
}

describe('Outbound calls refuse redirects', () => {
  let target: Server
  let origin: Server
  let targetUrl: string
  let originUrl: string
  let targetHits = 0
  let originHits = 0
  let redirectStatus = 307

  beforeAll(async () => {
    const t = await listen((_req, res) => {
      targetHits += 1
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end('{}')
    })
    target = t.server
    targetUrl = `http://127.0.0.1:${t.port}/landed`
    const o = await listen((_req, res) => {
      originHits += 1
      res.statusCode = redirectStatus
      res.setHeader('location', targetUrl)
      res.end()
    })
    origin = o.server
    originUrl = `http://127.0.0.1:${o.port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => target.close(resolve))
    await new Promise((resolve) => origin.close(resolve))
  })

  beforeEach(() => {
    redirectStatus = 307
    targetHits = 0
    originHits = 0
  })

  it.each([301, 307, 308])(
    'the rebuild hook gives up after one warning on a %i and never reaches the target',
    async (status) => {
      redirectStatus = status
      const logs: { level: string; message: string }[] = []
      const log = (level: string) => (message: string) => logs.push({ level, message })
      const strapi = {
        log: { info: log('info'), warn: log('warn'), error: log('error') },
      } as unknown as Core.Strapi
      const hook = createRebuildHook(strapi, {
        url: `${originUrl}/dispatch?${SECRET_QUERY}`,
        token: 'gh-token',
        debounceMs: 10_000,
        retries: 3,
        retryDelayMs: 5,
      })
      hook.schedule({ uid: 'api::page.page', event: 'entry.publish' })
      await hook.flush()
      hook.stop()

      expect(originHits).toBe(1)
      expect(targetHits).toBe(0)
      const warnings = logs.filter((entry) => entry.level === 'warn')
      expect(warnings).toHaveLength(1)
      expect(warnings[0].message).toMatch(/redirect/i)
      expect(logs.filter((entry) => entry.level === 'error')).toHaveLength(0)
      const everything = logs.map((entry) => entry.message).join('\n')
      expect(everything).not.toContain('do-not-log')
      expect(everything).not.toContain('gh-token')
      expect(everything).not.toContain(originUrl)
    }
  )

  it('retries a connection failure and logs neither the URL nor the query', async () => {
    const closed = await listen((_req, res) => res.end())
    const { port } = closed
    await new Promise((resolve) => closed.server.close(resolve))
    const logs: { level: string; message: string }[] = []
    const log = (level: string) => (message: string) => logs.push({ level, message })
    const strapi = {
      log: { info: log('info'), warn: log('warn'), error: log('error') },
    } as unknown as Core.Strapi
    const hook = createRebuildHook(strapi, {
      url: `http://127.0.0.1:${port}/dispatch?${SECRET_QUERY}`,
      debounceMs: 10_000,
      retries: 2,
      retryDelayMs: 5,
    })
    hook.schedule({ uid: 'api::page.page', event: 'entry.publish' })
    await hook.flush()
    hook.stop()

    expect(logs.filter((entry) => entry.level === 'warn')).toHaveLength(3)
    expect(logs.filter((entry) => entry.level === 'error')).toHaveLength(1)
    const everything = logs.map((entry) => entry.message).join('\n')
    expect(everything).toContain('ECONNREFUSED')
    expect(everything).not.toContain('do-not-log')
    expect(everything).not.toContain(`127.0.0.1:${port}`)
  })

  it('does not take a lookup error that mentions "redirect" for a refused redirect', () => {
    const lookup = new TypeError('fetch failed')
    Object.assign(lookup, {
      cause: new Error('getaddrinfo ENOTFOUND redirect.example.com'),
    })
    expect(isRefusedRedirect(lookup)).toBe(false)
    const refused = new TypeError('fetch failed')
    Object.assign(refused, { cause: new Error('unexpected redirect') })
    expect(isRefusedRedirect(refused)).toBe(true)
    expect(isRefusedRedirect('unexpected redirect')).toBe(false)
  })

  const umami = () => ({
    url: originUrl,
    websiteId: 'site-id',
    apiKey: 'umami_secret',
    syncCron: '',
    publicUrl: '',
  })

  it('the Umami client rejects with a clear error and never reaches the target', async () => {
    let message = ''
    try {
      await fetchPathVisitors(umami(), { startAt: 0, endAt: 1 })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/redirect/i)
    expect(message).not.toContain('umami_secret')
    expect(originHits).toBe(1)
    expect(targetHits).toBe(0)
  })

  it('the Umami totals reject too', async () => {
    await expect(fetchWebsiteTotals(umami(), { startAt: 0, endAt: 1 })).rejects.toThrow(/redirect/i)
    expect(targetHits).toBe(0)
  })
})
