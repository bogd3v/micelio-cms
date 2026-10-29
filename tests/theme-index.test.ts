import { describe, it, expect, afterEach } from '@jest/globals'
import {
  createThemeIndexReader,
  fetchThemeIndex,
  parseRegistryAddress,
  parseThemeIndex,
} from '../src/utils/theme-index'
import { buildThemePicker } from '../src/utils/theme-picker'
import type { ThemeIndex, ThemeStatus } from '../src/types/theme-registry'
import { FIXTURE_INDEX, startFakeRegistry, type FakeRegistry } from './helpers/fake-registry'

// The picker's data (micelio-cms#97): the index is read from a local fake registry of the shape
// micelio's `registry-index.ts` defines; nothing here touches the network.

describe('Theme index', () => {
  let registry: FakeRegistry | undefined
  afterEach(async () => {
    await registry?.close()
    registry = undefined
  })
  const index = (): ThemeIndex => parseThemeIndex(JSON.stringify(FIXTURE_INDEX))

  describe('reading', () => {
    it('reads the signed-shape index from a registry, anonymously', async () => {
      registry = await startFakeRegistry()
      const read = await fetchThemeIndex(registry.address)
      expect(Object.keys(read.themes).sort()).toEqual(['alpha', 'beta', 'gamma'])
      expect(registry.requests).toEqual([
        'GET /v2/test/themes/index/manifests/v1',
        expect.stringMatching(/^GET \/v2\/test\/themes\/index\/blobs\/sha256:/),
      ])
    })

    it('asks for a pull token only when the registry challenges, and follows a blob redirect', async () => {
      registry = await startFakeRegistry({ challenge: true, redirectBlob: true })
      const read = await fetchThemeIndex(registry.address)
      expect(Object.keys(read.themes)).toContain('alpha')
      expect(registry.requests.some((request) => request.startsWith('GET /token'))).toBe(true)
      expect(registry.requests).toContain('GET /storage/index')
    })

    it('rejects text that is not version 1 of the index, or has an entry that is not valid', () => {
      expect(() => parseThemeIndex('not json')).toThrow()
      expect(() => parseThemeIndex(JSON.stringify({ version: 2, themes: {} }))).toThrow(/version 1/)
      const bad = structuredClone(FIXTURE_INDEX) as typeof FIXTURE_INDEX
      ;(bad.themes.alpha.versions as Record<string, unknown>)['^1.0.0'] =
        bad.themes.alpha.versions['1.0.0']
      expect(() => parseThemeIndex(JSON.stringify(bad))).toThrow(/version of alpha/)
      const unknownTier = structuredClone(FIXTURE_INDEX) as typeof FIXTURE_INDEX
      unknownTier.themes.alpha.versions['1.0.0'].tier = 'gold'
      expect(() => parseThemeIndex(JSON.stringify(unknownTier))).toThrow(/tier/)
    })

    it('ignores fields it does not know', () => {
      const grown = structuredClone(FIXTURE_INDEX) as Record<string, unknown>
      grown.generatedAt = 'later'
      expect(parseThemeIndex(JSON.stringify(grown)).themes.alpha).toBeDefined()
    })

    it('fails on a layer whose bytes do not match its digest, and on a registry that is down', async () => {
      registry = await startFakeRegistry()
      const tampered = async (...args: Parameters<typeof fetch>): Promise<Response> => {
        const response = await fetch(...args)
        return String(args[0]).includes('/blobs/')
          ? new Response('{"version":1,"themes":{}}')
          : response
      }
      await expect(fetchThemeIndex(registry.address, tampered)).rejects.toThrow(/digest/)
      await registry.close()
      await expect(fetchThemeIndex(registry.address)).rejects.toThrow()
      registry = undefined
    })

    it('accepts only https registries, or http on loopback', () => {
      expect(parseRegistryAddress('ghcr.io/bogd3v/micelio-themes')).toEqual({
        origin: 'https://ghcr.io',
        prefix: 'bogd3v/micelio-themes',
      })
      expect(parseRegistryAddress('127.0.0.1:5000/test/themes').origin).toBe(
        'http://127.0.0.1:5000'
      )
      expect(() => parseRegistryAddress('https://ghcr.io/x')).toThrow()
      expect(() => parseRegistryAddress('ghcr.io')).toThrow()
    })

    it('keeps the index for five minutes and tries again after a failure', async () => {
      registry = await startFakeRegistry()
      let clock = 0
      const reader = createThemeIndexReader({ registry: () => registry!.address, now: () => clock })
      await reader.read()
      clock = 4 * 60 * 1000
      await reader.read()
      expect(registry.requests.filter((request) => request.includes('/manifests/'))).toHaveLength(1)
      clock = 5 * 60 * 1000
      await reader.read()
      expect(registry.requests.filter((request) => request.includes('/manifests/'))).toHaveLength(2)

      const broken = createThemeIndexReader({
        registry: () => '127.0.0.1:1/test/themes',
        now: () => clock,
      })
      await expect(broken.read()).rejects.toThrow()
      await expect(broken.read()).rejects.toThrow()
    })
  })

  describe('picker model', () => {
    it('lists published public themes at their highest release, with tier, contract and report', () => {
      const model = buildThemePicker(index(), null)
      expect(model.indexAvailable).toBe(true)
      expect(
        model.themes.map((theme) => [theme.id, theme.version, theme.origin, theme.contract])
      ).toEqual([
        ['alpha', '2.0.0', 'official', '3.0'],
        ['beta', '0.3.0', 'community', '2.0'],
      ])
      expect(model.themes[1]!.report).toBe(`sha256:${'a'.repeat(64)}`)
      expect(model.themes[0]!.digest).toBe(`sha256:${'4'.repeat(64)}`)
    })

    it('lists the index and hides the status when no status is reported', () => {
      const model = buildThemePicker(index(), null)
      expect(model.status).toBeNull()
      expect(model.themes.every((theme) => theme.available)).toBe(true)
    })

    it('marks a code theme the image lacks as unavailable, with the reason, when a status exists', () => {
      const status: ThemeStatus = {
        active: { id: 'alpha', version: '1.0.0' },
        lastError: 'could not install beta',
        builtInCodeThemes: [],
      }
      const model = buildThemePicker(index(), status)
      const beta = model.themes.find((theme) => theme.id === 'beta')!
      expect(beta.available).toBe(false)
      expect(beta.unavailableReason).toBe('not-in-image')
      expect(model.themes.find((theme) => theme.id === 'alpha')!.available).toBe(true)
      expect(model.status).toEqual({
        active: { id: 'alpha', version: '1.0.0' },
        lastError: 'could not install beta',
      })

      const built = buildThemePicker(index(), { ...status, builtInCodeThemes: ['beta'] })
      expect(built.themes.find((theme) => theme.id === 'beta')!.available).toBe(true)
    })

    it('offers a newer version of the pinned theme within its contract major, never applying it', () => {
      const model = buildThemePicker(index(), null, { id: 'alpha', version: '1.0.0' })
      expect(model.update).toEqual({ version: '1.1.0', digest: `sha256:${'2'.repeat(64)}` })
      expect(buildThemePicker(index(), null, { id: 'alpha', version: '1.1.0' }).update).toBeNull()
      expect(buildThemePicker(index(), null, { id: 'alpha', version: '9.9.9' }).update).toBeNull()
      expect(
        buildThemePicker(index(), null, { id: 'constructor', version: '1.0.0' }).update
      ).toBeNull()
    })

    it('falls back when the registry could not be read', () => {
      expect(buildThemePicker(null, null)).toEqual({
        indexAvailable: false,
        themes: [],
        update: null,
        status: null,
      })
    })
  })
})
