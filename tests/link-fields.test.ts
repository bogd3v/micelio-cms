import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'

// `section.link` has an optional `icon` (the custom field `micelio.icon` of the core), `iconPosition`
// (`start`, `end`, `only`; default `start`), `external` and `download` (#462). No migration: a link
// stored before keeps `label` and `url`, and the new fields read as absent.

const PAGE_UID = 'api::page.page'

type Data = Record<string, unknown>

describe('the fields of section.link added by #462', () => {
  const pages = () =>
    strapi.documents(PAGE_UID) as unknown as {
      create(params: Data): Promise<{ documentId: string }>
      findOne(params: Data): Promise<{ sections: Data[] } | null>
    }
  let count = 0
  const save = async (link: Data, status: 'draft' | 'published' = 'published') => {
    count += 1
    const slug = `link-fields-${count}`
    return pages().create({
      status,
      data: {
        title: slug,
        slug,
        site: await defaultSiteRelation(strapi),
        sections: [
          {
            __component: 'section.cta',
            variant: 'banner',
            title: 'Title',
            primaryLink: { label: 'Read', url: '/read', ...link },
          },
        ],
      },
    })
  }
  const linkOf = async (documentId: string, status: 'draft' | 'published' = 'published') => {
    const page = await pages().findOne({
      documentId,
      status,
      populate: { sections: { on: { 'section.cta': { populate: ['primaryLink'] } } } },
    })
    return page?.sections[0]?.primaryLink as Data
  }

  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('stores an icon, its position, external and download, and returns them', async () => {
    const { documentId } = await save({
      icon: 'download',
      iconPosition: 'end',
      external: true,
      download: true,
    })
    expect(await linkOf(documentId)).toMatchObject({
      label: 'Read',
      url: '/read',
      icon: 'download',
      iconPosition: 'end',
      external: true,
      download: true,
    })
  })

  it('keeps the label with iconPosition only, as the accessible name', async () => {
    const { documentId } = await save({ icon: 'arrow-right', iconPosition: 'only' })
    expect(await linkOf(documentId)).toMatchObject({
      label: 'Read',
      icon: 'arrow-right',
      iconPosition: 'only',
    })
  })

  it('saves a link without the new fields: no icon, position start, neither external nor download', async () => {
    const { documentId } = await save({})
    const link = await linkOf(documentId)
    expect(link).toMatchObject({ label: 'Read', url: '/read', iconPosition: 'start' })
    expect(link.icon ?? null).toBeNull()
    expect(link.external ?? null).toBeNull()
    expect(link.download ?? null).toBeNull()
  })

  it('refuses an iconPosition outside start, end and only', async () => {
    await expect(save({ iconPosition: 'top' }, 'draft')).rejects.toMatchObject({
      name: 'ValidationError',
    })
  })

  it('refuses an icon that is not a name of the catalogue', async () => {
    await expect(save({ icon: 'not-an-icon-of-the-catalogue' }, 'draft')).rejects.toMatchObject({
      name: 'ValidationError',
      details: { code: 'iconInvalid', field: 'icon' },
    })
  })
})
