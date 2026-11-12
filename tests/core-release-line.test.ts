import { describe, it, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// `micelio-cms` 0.8 installs the release of `@micelio/strapi-plugin-core` that declares release
// line 0.7 (docs/architecture/micelio-plugin.md), so the Status page and `npx micelio doctor`
// report the line the distribution ships.

const ROOT = path.join(__dirname, '..')
const PLUGIN = '@micelio/strapi-plugin-core'

/** Reads a `package.json` of this repository or of an installed package. */
function readPackage(...segments: string[]): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(ROOT, ...segments, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
}

describe('the core plugin the distribution installs', () => {
  const installed = readPackage('node_modules', PLUGIN)

  it('declares release line 0.7', () => {
    expect(installed.micelio).toBe('0.7')
  })

  it('is the exact version package.json pins', () => {
    const dependencies = readPackage().dependencies as Record<string, string>

    expect(dependencies[PLUGIN]).toBe(installed.version)
  })
})
