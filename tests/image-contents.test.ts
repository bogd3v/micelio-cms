import { afterEach, describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '@strapi/utils'
import serverConfig from '../config/server'

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')

/** `server.transfer.remote.enabled` as Strapi reads it (`@strapi/admin` data-transfer middleware). */
const remoteTransferEnabled = (): unknown =>
  (
    serverConfig({ env } as unknown as Parameters<typeof serverConfig>[0]) as {
      transfer?: { remote?: { enabled?: unknown } }
    }
  ).transfer?.remote?.enabled

describe('Remote data transfer', () => {
  const saved = process.env.STRAPI_REMOTE_TRANSFER_ENABLED

  afterEach(() => {
    if (saved === undefined) delete process.env.STRAPI_REMOTE_TRANSFER_ENABLED
    else process.env.STRAPI_REMOTE_TRANSFER_ENABLED = saved
  })

  it('is off unless STRAPI_REMOTE_TRANSFER_ENABLED turns it on', () => {
    delete process.env.STRAPI_REMOTE_TRANSFER_ENABLED
    expect(remoteTransferEnabled()).toBe(false)
    process.env.STRAPI_REMOTE_TRANSFER_ENABLED = 'true'
    expect(remoteTransferEnabled()).toBe(true)
    process.env.STRAPI_REMOTE_TRANSFER_ENABLED = 'false'
    expect(remoteTransferEnabled()).toBe(false)
  })
})

describe('Scripts in the production image', () => {
  const dockerfile = read('Dockerfile')
  const production = dockerfile.slice(dockerfile.indexOf('AS production'))

  it('does not copy the whole scripts folder', () => {
    expect(production).not.toMatch(/COPY\s+--from=build\s+\/app\/scripts\s/)
  })

  it.each([
    'scripts/seed.js',
    'scripts/cleanup-broken-media.js',
    'scripts/regenerate-thumbnails.js',
    'scripts/backup-volumes.sh',
    'scripts/restore-volumes.sh',
  ])('leaves out %s', (script) => {
    expect(production).not.toContain(script)
  })

  it.each(['scripts/demo-secrets.js', 'scripts/generate-keys.js'])(
    'ships %s, which the demo Compose files and the install guide run from the image',
    (script) => {
      expect(production).toContain(script)
    }
  )

  it('ships every script a Compose file runs inside the image', () => {
    const used = ['compose.demo.yml', 'compose.static.yml', 'compose.landing.yml'].flatMap((file) =>
      [...read(file).matchAll(/scripts\/[\w.-]+\.js/g)].map((match) => match[0])
    )
    expect(used.length).toBeGreaterThan(0)
    for (const script of used) expect(production).toContain(script)
  })
})
