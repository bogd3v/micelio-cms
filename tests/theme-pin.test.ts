import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { SITE_SETTING_UID } from '../src/constants/uids'

// `site.theme` pins an exact version and digest (micelio-cms#97, ADR 0009): no range, no latest.

const DIGEST = `sha256:${'a'.repeat(64)}`

describe('The pin of the theme', () => {
  let documentId: string
  const update = (data: Record<string, unknown>) =>
    strapi.documents(SITE_SETTING_UID).update({ documentId, locale: 'en', data: data as never })
  const stored = () =>
    strapi.db
      .query(SITE_SETTING_UID)
      .findOne({ where: { locale: 'en' }, populate: ['theme'] }) as Promise<{
      theme: Record<string, unknown> | null
    }>

  beforeAll(async () => {
    await setupStrapi()
    documentId = (await strapi.db.query(SITE_SETTING_UID).findOne({ where: { locale: 'en' } }))
      .documentId
  })
  afterAll(async () => {
    await cleanupStrapi()
  })

  it('starts empty on an instance that never chose a theme', async () => {
    const { theme } = await stored()
    expect(theme?.themeId ?? null).toBeNull()
    expect(theme?.themeVersion ?? null).toBeNull()
    expect(theme?.themeDigest ?? null).toBeNull()
  })

  it.each(['^1.2.0', '1.x', '>=1', '1.2.3.4', 'latest', '1.2', 'v1.2.3', '01.2.3', '~1.2.3'])(
    'rejects %p as a version',
    async (version) => {
      await expect(
        update({ theme: { themeId: 'alpha', themeVersion: version, themeDigest: DIGEST } })
      ).rejects.toThrow()
    }
  )

  it.each(['sha256:abc', 'sha1:' + 'a'.repeat(40), `sha256:${'A'.repeat(64)}`, DIGEST + 'a'])(
    'rejects %p as a digest',
    async (digest) => {
      await expect(
        update({ theme: { themeId: 'alpha', themeVersion: '1.2.0', themeDigest: digest } })
      ).rejects.toThrow()
    }
  )

  it.each(['1.2.0', '0.0.1', '10.20.30', '1.2.0-rc.1'])('accepts %s', async (version) => {
    await update({ theme: { themeId: 'alpha', themeVersion: version, themeDigest: DIGEST } })
    expect((await stored()).theme).toMatchObject({
      themeId: 'alpha',
      themeVersion: version,
      themeDigest: DIGEST,
    })
  })

  it('keeps the slug check on the theme id', async () => {
    await expect(
      update({ theme: { themeId: 'Not A Slug', themeVersion: '1.0.0', themeDigest: DIGEST } })
    ).rejects.toThrow()
  })

  it('leaves the pin as it was when the settings are saved without touching the theme', async () => {
    await update({ theme: { themeId: 'alpha', themeVersion: '1.2.0', themeDigest: DIGEST } })
    await update({ tagline: 'Saved again' })
    expect((await stored()).theme).toMatchObject({
      themeId: 'alpha',
      themeVersion: '1.2.0',
      themeDigest: DIGEST,
    })
    await update({
      theme: { themeId: 'alpha', themeVersion: '1.2.0', themeDigest: DIGEST, defaultMode: 'dark' },
    })
    expect((await stored()).theme).toMatchObject({ themeVersion: '1.2.0', themeDigest: DIGEST })
  })
})
