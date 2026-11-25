import { describe, expect, it } from '@jest/globals'
import {
  builderFailureLines,
  lastRebuildSucceeded,
  missingVariables,
  portsOverride,
  spawnOptions,
} from '../scripts/demo-stack-check/checks.mjs'

// Bogd3v/micelio-cms#535: the pure parts of `npm run test:demo-stacks`; the Docker run itself is not in Jest.

describe('demo stack check', () => {
  it('finds the lines of a builder that could not read build.env or write demo-site', () => {
    const log = [
      'micelio-builder: starting',
      'NUXT_STRAPI_API_TOKEN (the CMS build token) are required',
      'generating',
      'micelio-builder: /out is not writable',
      'mkdir: cannot create directory: Permission denied',
    ].join('\n')
    expect(builderFailureLines(log)).toEqual([
      'NUXT_STRAPI_API_TOKEN (the CMS build token) are required',
      'micelio-builder: /out is not writable',
      'mkdir: cannot create directory: Permission denied',
    ])
    expect(builderFailureLines('micelio-builder: starting\ngenerated 12 routes\n')).toEqual([])
  })

  it('accepts only a last rebuild that succeeded', () => {
    const body = (lastRebuild) =>
      JSON.stringify({ data: { configured: true, lastRebuild, unreadable: false } })
    expect(lastRebuildSucceeded(body({ status: 'succeeded' }))).toBe(true)
    expect(lastRebuildSucceeded(body({ status: 'failed' }))).toBe(false)
    expect(lastRebuildSucceeded(body(null))).toBe(false)
    expect(lastRebuildSucceeded(JSON.stringify({ data: { configured: false } }))).toBe(false)
    expect(lastRebuildSucceeded('<html>502</html>')).toBe(false)
  })

  it('writes an override that changes only the ports of cms and site', () => {
    const text = portsOverride({ cms: [[41000, 1337]], site: [[41001, 8080]] })
    expect(text).toBe(
      [
        'services:',
        '  cms:',
        '    ports: !override',
        "      - '127.0.0.1:41000:1337'",
        '  site:',
        '    ports: !override',
        "      - '127.0.0.1:41001:8080'",
        '',
      ].join('\n')
    )
    // The dynamic demo publishes the frontend's port through cms and has no site.
    const demo = portsOverride({
      cms: [
        [42000, 1337],
        [42001, 8080],
      ],
    })
    expect(demo).not.toMatch(/site/)
    expect(demo.match(/127\.0\.0\.1:\d+:\d+/g)).toEqual([
      '127.0.0.1:42000:1337',
      '127.0.0.1:42001:8080',
    ])
  })

  it('names the variables each compose file needs', () => {
    for (const file of ['compose.static.yml', 'compose.landing.yml']) {
      expect(missingVariables(file, {})).toEqual([
        'MICELIO_CMS_IMAGE is not set',
        'MICELIO_BUILDER_IMAGE is not set',
      ])
      expect(missingVariables(file, { MICELIO_CMS_IMAGE: 'cms:1' })).toEqual([
        'MICELIO_BUILDER_IMAGE is not set',
      ])
      expect(
        missingVariables(file, { MICELIO_CMS_IMAGE: 'cms:1', MICELIO_BUILDER_IMAGE: 'b:1' })
      ).toEqual([])
      // The frontend image is not needed by the static stacks.
      expect(missingVariables(file, { MICELIO_BUILDER_IMAGE: 'b:1' })).toEqual([
        'MICELIO_CMS_IMAGE is not set',
      ])
    }
    expect(missingVariables('compose.demo.yml', { MICELIO_CMS_IMAGE: 'cms:1' })).toEqual([
      'MICELIO_IMAGE is not set',
    ])
    expect(
      missingVariables('compose.demo.yml', { MICELIO_CMS_IMAGE: 'cms:1', MICELIO_IMAGE: 'f:1' })
    ).toEqual([])
    expect(
      missingVariables('compose.demo.yml', { MICELIO_CMS_IMAGE: '', MICELIO_IMAGE: 'f:1' })
    ).toEqual(['MICELIO_CMS_IMAGE is not set'])
  })

  it('spawns the cleanup of docker detached, so a second Ctrl-C cannot interrupt it', () => {
    expect(spawnOptions({ cleanup: true }).detached).toBe(true)
    expect(spawnOptions({ cleanup: false }).detached).toBe(false)
  })
})
