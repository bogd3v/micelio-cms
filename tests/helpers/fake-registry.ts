import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** An index of the shape micelio's `registry-index.ts` defines, with neutral themes. */
export const FIXTURE_INDEX = {
  version: 1,
  themes: {
    alpha: {
      versions: {
        '1.0.0': entry('1', 'official', false, '2.0'),
        '1.1.0': entry('2', 'official', false, '2.0'),
        '1.2.0-rc.1': entry('3', 'official', false, '2.0'),
        '2.0.0': entry('4', 'official', false, '3.0'),
        '0.9.0': { ...entry('5', 'official', false, '2.0'), status: 'yanked' },
      },
    },
    beta: { versions: { '0.3.0': entry('6', 'community', true, '2.0', 'a') } },
    gamma: {
      versions: { '1.0.0': { ...entry('7', 'official', false, '2.0'), distribution: 'licensed' } },
    },
  },
}

function entry(seed: string, tier: string, code: boolean, contract: string, report?: string) {
  return {
    digest: `sha256:${seed.repeat(64)}`,
    contract,
    license: 'AGPL-3.0-only',
    tier,
    distribution: 'public',
    status: 'published',
    code,
    ...(report ? { report: `sha256:${report.repeat(64)}` } : {}),
  }
}

/** Options of the fake registry. */
export interface FakeRegistryOptions {
  /** Answers 401 with a bearer challenge until the request carries the token the server issues. */
  challenge?: boolean
  /** Serves the layer from `/storage/…` through a 307. */
  redirectBlob?: boolean
  /** The text served as the index layer; the digest in the manifest is of this text. */
  body?: string
}

/** A local OCI registry that holds only `index:v1` under `<host>/test/themes`. */
export interface FakeRegistry {
  /** `127.0.0.1:port/test/themes`, for `MICELIO_THEME_REGISTRY`. */
  address: string
  /** Requests served, as `METHOD path`. */
  requests: string[]
  close(): Promise<void>
}

/** Starts the fake registry on a loopback port. */
export async function startFakeRegistry(options: FakeRegistryOptions = {}): Promise<FakeRegistry> {
  const body = Buffer.from(options.body ?? JSON.stringify(FIXTURE_INDEX))
  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`
  const manifest = JSON.stringify({
    schemaVersion: 2,
    layers: [
      { mediaType: 'application/vnd.micelio.theme.index.v1+json', digest, size: body.length },
    ],
  })
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    const url = req.url ?? ''
    requests.push(`${req.method} ${url.split('?')[0]}`)
    if (url.startsWith('/token')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ token: 'issued' }))
      return
    }
    if (
      options.challenge &&
      req.headers.authorization !== 'Bearer issued' &&
      !url.startsWith('/storage/')
    ) {
      const { port } = server.address() as AddressInfo
      res.statusCode = 401
      res.setHeader(
        'www-authenticate',
        `Bearer realm="http://127.0.0.1:${port}/token",service="fake"`
      )
      res.end()
      return
    }
    if (url === '/v2/test/themes/index/manifests/v1') {
      res.setHeader('content-type', 'application/vnd.oci.image.manifest.v1+json')
      res.end(manifest)
    } else if (url === `/v2/test/themes/index/blobs/${digest}`) {
      if (options.redirectBlob) {
        res.statusCode = 307
        res.setHeader('location', '/storage/index')
        res.end()
      } else res.end(body)
    } else if (url === '/storage/index') {
      res.end(body)
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    address: `127.0.0.1:${port}/test/themes`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
