import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'

// The theme of the site is the core's component `micelio-site.theme`, whose `themeId` is a plain
// string. The host gives it the picker as its input and the pin its own component had
// (`src/utils/site-theme-component.ts`); the pin itself is exercised in `tests/theme-pin.test.ts`.

describe('The theme component of the site', () => {
  type Attribute = Record<string, unknown>
  const attributes = () =>
    (strapi.components as unknown as Record<string, { attributes: Record<string, Attribute> }>)[
      'micelio-site.theme'
    ].attributes

  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('uses the theme picker as the input of themeId, and stays a string', () => {
    expect(attributes().themeId).toMatchObject({
      type: 'string',
      customField: 'global::theme-picker',
      regex: '^[a-z][a-z0-9-]*$',
    })
  })

  it('pins the version and the digest as the single type did', () => {
    expect(attributes().themeVersion).toMatchObject({ type: 'string', maxLength: 128 })
    expect(attributes().themeDigest).toMatchObject({ regex: '^sha256:[0-9a-f]{64}$' })
  })
})
