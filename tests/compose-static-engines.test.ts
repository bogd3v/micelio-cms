import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The static and landing stacks run unchanged on Docker and on rootless Podman (#534): the builder
// gets build.env from a volume of its own, and the services that share demo-site disable the label.

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')
/** The text of one service block of a Compose file. */
const service = (compose: string, name: string): string => {
  const start = compose.search(new RegExp(`^  ${name}:$`, 'm'))
  const rest = compose.slice(start + 1)
  const end = rest.search(/^ {2}[a-z][\w-]*:$|^volumes:$/m)
  return end === -1 ? rest : rest.slice(0, end)
}

describe.each(['compose.static.yml', 'compose.landing.yml'])('%s on both engines', (file) => {
  const compose = read(file)

  it('mounts no volume subpath', () => {
    expect(compose).not.toContain('subpath')
  })

  it('gives the builder build.env through its own volume, which init fills', () => {
    const build = service(compose, 'build')
    expect(build).toContain('- demo-build-env:/run/secrets-build:ro')
    expect(build).not.toContain('demo-secrets')
    expect(build).toContain('. /run/secrets-build/build.env')

    const init = service(compose, 'init')
    expect(init).toContain('- demo-build-env:/build-env')
    expect(init).toContain(
      'node scripts/demo-secrets.js /secrets && cp /secrets/build.env /build-env/build.env'
    )

    expect(compose).toMatch(/^volumes:\n(?:  .*\n)*?  demo-build-env:$/m)
  })

  it('disables the SELinux label of the services that share demo-site', () => {
    for (const name of ['build', 'site']) {
      expect(service(compose, name)).toMatch(/security_opt: \[label=disable\]/)
    }
  })
})
