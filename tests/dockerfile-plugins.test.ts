import { describe, expect, it } from '@jest/globals'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')

// The server compile excludes src/plugins/**, so the image ships each local plugin as its
// `package.json` plus its esbuild bundle. A plugin missing here boots in tests and fails in the
// image with `Cannot find module '/app/src/plugins/<name>/package.json'`.
const plugins = readdirSync(join(root, 'src', 'plugins'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(root, 'src', 'plugins', name, 'package.json')))

describe('Dockerfile copies every local plugin', () => {
  it('finds the local plugins', () => {
    // `micelio` is the published `@micelio/strapi-plugin-core`, not a local plugin.
    expect(plugins).toEqual(['fediverse'])
  })

  it.each(plugins)('copies the package.json and the bundle of %s', (name) => {
    expect(dockerfile).toContain(
      `COPY --from=build /app/src/plugins/${name}/package.json ./src/plugins/${name}/package.json`
    )
    expect(dockerfile).toContain(
      `COPY --from=build /app/src/plugins/${name}/dist ./src/plugins/${name}/dist`
    )
  })
})
