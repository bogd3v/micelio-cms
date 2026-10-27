import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The demo shows the preview (#382): the frontend names the admin's origin, which is the CMS's
// own `URL`, and the CMS runs as the demo, which grants the frontend token the exchange.

const compose = readFileSync(join(__dirname, '..', 'compose.demo.yml'), 'utf8')
const setting = (name: string): string | undefined =>
  new RegExp(`^\\s+${name}: (\\S+)\\s*$`, 'm').exec(compose)?.[1]

describe('compose.demo.yml and the preview', () => {
  it('gives the frontend the origin of the admin, the one the CMS serves', () => {
    expect(setting('NUXT_PREVIEW_ADMIN_ORIGIN')).toBe('http://localhost:1337')
    expect(setting('NUXT_PREVIEW_ADMIN_ORIGIN')).toBe(setting('URL'))
  })

  it('runs the CMS as the demo that grants the exchange', () => {
    expect(setting('MICELIO_DEMO')).toBe("'true'")
  })
})
