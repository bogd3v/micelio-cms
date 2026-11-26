import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

// `section.testimonial` has optional `sourceUrl`, `logo` and `rating` (#451). A page has draft and
// publish: Strapi checks `min` and the `sourceUrl` format on publish only, and `max` on every save.

const PAGE_UID = 'api::page.page'

type Data = Record<string, unknown>

describe('the fields of section.testimonial added by #451', () => {
  const pages = () =>
    strapi.documents(PAGE_UID) as unknown as {
      create(params: Data): Promise<{ documentId: string }>
      findOne(params: Data): Promise<{ sections: Data[] } | null>
    }
  let count = 0
  const save = async (item: Data, status: 'draft' | 'published') => {
    count += 1
    const slug = `testimonial-fields-${count}`
    return pages().create({
      status,
      data: {
        title: slug,
        slug,
        site: await defaultSiteRelation(strapi),
        sections: [
          {
            __component: 'section.testimonials',
            variant: 'single',
            items: [{ quote: 'q', author: 'a', ...item }],
          },
        ],
      },
    })
  }

  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('publishes a testimonial with a source, a rating from 1 to 5 and without them', async () => {
    await expect(
      save({ sourceUrl: 'https://example.test/r', rating: 5 }, 'published')
    ).resolves.toBeTruthy()
    await expect(save({ rating: 1 }, 'published')).resolves.toBeTruthy()
    await expect(save({}, 'published')).resolves.toBeTruthy()
  })

  it.each([{ rating: 6 }, { rating: 0 }, { sourceUrl: 'javascript:alert(1)' }])(
    'refuses to publish a testimonial with %j',
    async (item) => {
      await expect(save(item, 'published')).rejects.toMatchObject({ name: 'ValidationError' })
    }
  )

  it('refuses a rating above 5 or below 1 in a draft too', async () => {
    await expect(save({ rating: 6 }, 'draft')).rejects.toMatchObject({ name: 'ValidationError' })
    await expect(save({ rating: 0 }, 'draft')).rejects.toMatchObject({ name: 'ValidationError' })
  })
})
