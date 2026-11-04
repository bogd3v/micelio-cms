import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The static and landing stacks (#405): the builder writes how its last run ended to a volume the
// CMS reads, and only the CMS gets it read-only.

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')
/** The text of one service block of a Compose file. */
const service = (compose: string, name: string): string => {
  const start = compose.search(new RegExp(`^  ${name}:$`, 'm'))
  const rest = compose.slice(start + 1)
  const end = rest.search(/^ {2}[a-z][\w-]*:$|^volumes:$/m)
  return end === -1 ? rest : rest.slice(0, end)
}

describe.each(['compose.static.yml', 'compose.landing.yml'])('%s and the last rebuild', (file) => {
  const compose = read(file)

  it('runs the builder through the wrapper, which is mounted read-only from the repository', () => {
    const build = service(compose, 'build')
    expect(build).toContain('exec sh /usr/local/bin/builder-last-run micelio-builder generate')
    expect(build).toMatch(
      /- \.\/scripts\/builder-last-run\.sh:\/usr\/local\/bin\/builder-last-run:ro/
    )
    expect(build).toContain('REBUILD_STATUS_FILE: /build-status/last-run')
    expect(build).toContain('- demo-build-status:/build-status\n')
  })

  it('lets the CMS read the same file, and read only', () => {
    const cms = service(compose, 'cms')
    expect(cms).toContain('REBUILD_STATUS_FILE: /build-status/last-run')
    expect(cms).toContain('- demo-build-status:/build-status:ro')
  })

  it('gives the builder user the volume before the build starts', () => {
    expect(service(compose, 'build-status')).toContain("chownSync('/build-status', 1000, 1000)")
    expect(service(compose, 'build')).toMatch(
      /build-status:\n\s+condition: service_completed_successfully/
    )
  })

  it('keeps the site service away from the status volume', () => {
    expect(service(compose, 'site')).not.toContain('build-status')
  })
})
