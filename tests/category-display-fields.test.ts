import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

// ADR 0016 (bogd3v/micelio): a category carries an optional stable `color` (one of the five
// category roles) and a `featured` flag, so the frontend needs no list of any one site's slugs.

const CATEGORY = 'plugin::micelio.category'

describe('Category color and featured', () => {
  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  const create = async (slug: string, data: Record<string, unknown> = {}) =>
    strapi.documents(CATEGORY).create({
      data: { name: slug, slug, site: await defaultSiteRelation(strapi), ...data },
    })

  it('is not featured and has no color unless the editor says so', async () => {
    const category = await create('display-defaults')
    expect(category.featured).toBe(false)
    expect(category.color).toBeNull()
  })

  it('stores a color from 1 to 5 and the featured flag', async () => {
    const category = await create('display-set', { color: 5, featured: true })
    expect(category.color).toBe(5)
    expect(category.featured).toBe(true)
  })

  it.each([0, 6])('refuses the color %i, which names no category role', async (color) => {
    await expect(create(`display-bad-${color}`, { color })).rejects.toThrow()
  })
})
