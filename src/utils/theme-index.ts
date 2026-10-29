import { createHash } from 'node:crypto'
import {
  DEFAULT_THEME_REGISTRY,
  THEME_DIGEST_PATTERN,
  THEME_ID_PATTERN,
  THEME_INDEX_MAX_BYTES,
  THEME_INDEX_MEDIA_TYPE,
  THEME_INDEX_REPOSITORY,
  THEME_INDEX_TAG,
  THEME_INDEX_TIMEOUT_MS,
  THEME_INDEX_TTL_MS,
  THEME_VERSION_MAX_LENGTH,
  THEME_VERSION_PATTERN,
} from '../constants/theme-registry'
import type { ThemeIndex, ThemeIndexVersion } from '../types/theme-registry'

/**
 * Reads the theme registry's index for the admin's theme picker (micelio ADR 0008, section 4).
 *
 * @remarks
 * The picker only lists: it does not verify the index signature. The frontend does, with the
 * Sigstore trust root of its release, before it installs anything, and it refuses a pin whose
 * digest the signed index does not list (ADR 0009, section 3). A tampered index read here can
 * offer a wrong choice, never install one.
 */

const MAX_REDIRECTS = 3
const MAX_SMALL_BYTES = 64 * 1024
const MAX_THEMES = 10_000
const MAX_VERSIONS = 1000
const MANIFEST_TYPE = 'application/vnd.oci.image.manifest.v1+json'
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/
const COMPONENT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const TIERS = new Set(['official', 'verified', 'community'])
const STATUSES = new Set(['published', 'yanked', 'incompatible'])

/** `fetch` as the reader calls it; tests pass their own. */
export type FetchLike = typeof fetch

/** Whether a host name is one that only means something inside a network, or an IP literal. */
const isInternalName = (host: string): boolean =>
  !host.includes('.') ||
  /\.(local|localhost|internal|lan|home|corp)$/.test(host) ||
  host.startsWith('[') ||
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)

const isLoopback = (host: string): boolean =>
  host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)

/**
 * Splits `host[:port]/path` into the origin to call and the repository prefix.
 * The scheme is `https`, or `http` only for a loopback host (a local registry in development and tests).
 *
 * @throws `Error` when the setting is not an address of that shape.
 */
export function parseRegistryAddress(registry: string): { origin: string; prefix: string } {
  const match = /^([^/:]+|\[::1\])(?::(\d{1,5}))?((?:\/[^/]+)+)$/.exec(registry)
  const host = match?.[1]
  const port = match?.[2]
  const parts = match?.[3]?.slice(1).split('/') ?? []
  const valid =
    match !== null &&
    host !== undefined &&
    registry.length <= 256 &&
    (host === '[::1]' || HOST.test(host)) &&
    (port === undefined || (Number(port) >= 1 && Number(port) <= 65535)) &&
    parts.every((part) => COMPONENT.test(part))
  if (!valid || host === undefined) {
    throw new Error('MICELIO_THEME_REGISTRY must be host[:port]/path in lowercase')
  }
  const scheme = isLoopback(host) ? 'http' : 'https'
  return {
    origin: `${scheme}://${host}${port === undefined ? '' : `:${port}`}`,
    prefix: parts.join('/'),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseVersion(value: unknown): ThemeIndexVersion {
  if (!isRecord(value)) throw new Error('a version is not an object')
  const { digest, contract, tier, distribution, status, code, report } = value
  if (typeof digest !== 'string' || !THEME_DIGEST_PATTERN.test(digest))
    throw new Error('a digest is not valid')
  if (typeof contract !== 'string' || !/^\d+\.\d+$/.test(contract))
    throw new Error('a contract is not major.minor')
  if (typeof tier !== 'string' || !TIERS.has(tier)) throw new Error('a tier is not valid')
  if (distribution !== 'public' && distribution !== 'licensed')
    throw new Error('a distribution is not valid')
  if (typeof status !== 'string' || !STATUSES.has(status)) throw new Error('a status is not valid')
  if (typeof code !== 'boolean') throw new Error('code is not a boolean')
  if (report !== undefined && (typeof report !== 'string' || !THEME_DIGEST_PATTERN.test(report))) {
    throw new Error('a report digest is not valid')
  }
  return {
    digest,
    contract,
    tier: tier as ThemeIndexVersion['tier'],
    distribution,
    status: status as ThemeIndexVersion['status'],
    code,
    ...(report === undefined ? {} : { report }),
  }
}

/**
 * Reads and validates the text of the index, in the shape micelio's `registry-index.ts` defines.
 * Fields it does not know are ignored; one entry that is not valid fails the whole index.
 *
 * @throws `Error` when the text is not an index.
 */
export function parseThemeIndex(text: string): ThemeIndex {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.themes)) {
    throw new Error('the index is not version 1')
  }
  const themes = Object.entries(value.themes)
  if (themes.length > MAX_THEMES) throw new Error('the index lists too many themes')
  const result: ThemeIndex['themes'] = Object.create(null)
  for (const [id, theme] of themes) {
    if (!THEME_ID_PATTERN.test(id) || !isRecord(theme) || !isRecord(theme.versions)) {
      throw new Error('the index has a theme that is not valid')
    }
    const versions = Object.entries(theme.versions)
    if (versions.length > MAX_VERSIONS)
      throw new Error(`the index lists too many versions of ${id}`)
    const parsed: Record<string, ThemeIndexVersion> = Object.create(null)
    for (const [version, entry] of versions) {
      if (version.length > THEME_VERSION_MAX_LENGTH || !THEME_VERSION_PATTERN.test(version)) {
        throw new Error(`the index has a version of ${id} that is not valid`)
      }
      parsed[version] = parseVersion(entry)
    }
    result[id] = { versions: parsed }
  }
  return { themes: result }
}

/** Reads at most `limit` bytes of a response body; throws when it is longer. */
async function readCapped(response: Response, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new Error(`the registry sent more than ${limit} bytes`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function bearerParams(header: string | null): Record<string, string> | null {
  if (!header || !/^bearer\s/i.test(header)) return null
  const params: Record<string, string> = {}
  for (const match of header.matchAll(/([a-z]+)="([^"]*)"/gi))
    params[match[1]!.toLowerCase()] = match[2]!
  return params
}

/**
 * Downloads the index: the manifest of `index:v1`, then its one layer, checked against its digest.
 * Requests are anonymous; a bearer token is asked for only when the registry challenges, for the
 * `pull` scope of the index repository. A redirect is followed only for a blob, only over https
 * (or loopback), and never carries the token to another origin.
 *
 * @throws `Error` when the registry cannot be reached, answers badly or sends something that is not the index.
 */
export async function fetchThemeIndex(
  registry: string = DEFAULT_THEME_REGISTRY,
  doFetch: FetchLike = fetch
): Promise<ThemeIndex> {
  const { origin, prefix } = parseRegistryAddress(registry)
  const name = `${prefix}/${THEME_INDEX_REPOSITORY}`
  const signal = AbortSignal.timeout(THEME_INDEX_TIMEOUT_MS)
  let token: string | null = null

  async function get(url: URL, accept: string, redirects: boolean): Promise<Response> {
    let current = url
    let bearer = token
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const headers = new Headers({ accept })
      if (bearer) headers.set('authorization', `Bearer ${bearer}`)
      const response = await doFetch(current, { headers, redirect: 'manual', signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!redirects || !location) throw new Error(`the registry answered ${response.status}`)
      const next = new URL(location, current)
      const local = isLoopback(next.hostname) && isLoopback(new URL(origin).hostname)
      if (next.protocol !== 'https:' && !(local && next.protocol === 'http:')) {
        throw new Error('a redirect is not https')
      }
      if (
        !local &&
        next.host !== new URL(origin).host &&
        (isInternalName(next.hostname) || next.port !== '')
      ) {
        throw new Error('a redirect goes to a host that is not public')
      }
      if (next.origin !== current.origin) bearer = null
      current = next
    }
    throw new Error('too many redirects')
  }

  async function authorised(url: URL, accept: string, redirects = false): Promise<Response> {
    let response = await get(url, accept, redirects)
    if (response.status !== 401 || token) return response
    const challenge = bearerParams(response.headers.get('www-authenticate'))
    await response.body?.cancel()
    if (!challenge?.realm) return response
    const realm = new URL(challenge.realm)
    const local = isLoopback(realm.hostname) && isLoopback(new URL(origin).hostname)
    if (realm.protocol !== 'https:' && !local) throw new Error('the token realm is not https')
    if (
      !local &&
      realm.host !== new URL(origin).host &&
      (isInternalName(realm.hostname) || realm.port !== '')
    ) {
      throw new Error('the token realm is a host that is not public')
    }
    if (challenge.service) realm.searchParams.set('service', challenge.service)
    realm.searchParams.set('scope', `repository:${name}:pull`)
    const answer = await doFetch(realm, { redirect: 'manual', signal })
    if (!answer.ok) throw new Error(`the token service answered ${answer.status}`)
    const body: unknown = JSON.parse((await readCapped(answer, MAX_SMALL_BYTES)).toString('utf8'))
    const issued = isRecord(body) ? (body.token ?? body.access_token) : undefined
    if (typeof issued !== 'string' || issued.length > 8 * 1024)
      throw new Error('the token service sent no token')
    token = issued
    response = await get(url, accept, redirects)
    return response
  }

  const manifestResponse = await authorised(
    new URL(`/v2/${name}/manifests/${THEME_INDEX_TAG}`, origin),
    MANIFEST_TYPE
  )
  if (!manifestResponse.ok)
    throw new Error(`the registry answered ${manifestResponse.status} for the index`)
  const manifest: unknown = JSON.parse(
    (await readCapped(manifestResponse, MAX_SMALL_BYTES)).toString('utf8')
  )
  const layers = isRecord(manifest) && Array.isArray(manifest.layers) ? manifest.layers : []
  const layer: unknown = layers[0]
  if (
    layers.length !== 1 ||
    !isRecord(layer) ||
    layer.mediaType !== THEME_INDEX_MEDIA_TYPE ||
    typeof layer.digest !== 'string' ||
    !THEME_DIGEST_PATTERN.test(layer.digest) ||
    typeof layer.size !== 'number' ||
    layer.size > THEME_INDEX_MAX_BYTES
  ) {
    throw new Error('the index manifest must hold one layer of the index media type')
  }

  const blobResponse = await authorised(
    new URL(`/v2/${name}/blobs/${layer.digest}`, origin),
    '*/*',
    true
  )
  if (!blobResponse.ok)
    throw new Error(`the registry answered ${blobResponse.status} for the index layer`)
  const body = await readCapped(blobResponse, THEME_INDEX_MAX_BYTES)
  if (`sha256:${createHash('sha256').update(body).digest('hex')}` !== layer.digest) {
    throw new Error('the index does not match its digest')
  }
  return parseThemeIndex(body.toString('utf8'))
}

/** A reader that keeps the index for `ttlMs` and asks the registry again after that. */
export interface ThemeIndexReader {
  /** The index, from the cache when it is fresh. A failed read is not kept: the next call tries again. */
  read: () => Promise<ThemeIndex>
}

/** Options of `createThemeIndexReader`. */
export interface ThemeIndexReaderOptions {
  /** `host[:port]/path`, read on every call so a changed variable takes effect. */
  registry?: () => string
  fetch?: FetchLike
  /** The clock, in milliseconds. */
  now?: () => number
  ttlMs?: number
}

/**
 * Creates the cached reader of the index (5 minutes by default).
 * The cache is per registry address; concurrent reads share one request.
 */
export function createThemeIndexReader(options: ThemeIndexReaderOptions = {}): ThemeIndexReader {
  const registryOf =
    options.registry ?? (() => process.env.MICELIO_THEME_REGISTRY?.trim() || DEFAULT_THEME_REGISTRY)
  const now = options.now ?? Date.now
  const ttl = options.ttlMs ?? THEME_INDEX_TTL_MS
  let cached: { registry: string; at: number; index: Promise<ThemeIndex> } | null = null

  return {
    async read() {
      const registry = registryOf()
      if (!cached || cached.registry !== registry || now() - cached.at >= ttl) {
        cached = { registry, at: now(), index: fetchThemeIndex(registry, options.fetch) }
      }
      const current = cached
      try {
        return await current.index
      } catch (error) {
        if (cached === current) cached = null
        throw error
      }
    },
  }
}
