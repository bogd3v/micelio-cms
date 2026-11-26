import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { defaultSiteRelation } from '../src/utils/default-site'
import { migrateRichTextToProse } from '../src/migrations/prose'
import {
  plantRetiredRichText,
  retiredLinkCount,
  type RetiredValues,
} from './helpers/retired-rich-text'

// The boot migration of #445, fourth pull request: every `section.rich-text` of a page becomes a
// `shared.rich-text` (`prose`) in place, drafts and published, and the boot log names what the move
// cannot keep (`tone`, `align`) or what the core will refuse on the next save (the headings).

const PAGE_UID = 'api::page.page'
const PLACEHOLDER = { __component: 'shared.rich-text', body: 'placeholder' }

type Data = Record<string, unknown>

const pages = () =>
  strapi.documents(PAGE_UID) as unknown as {
    create(params: Data): Promise<{ documentId: string }>
    findOne(params: Data): Promise<{ sections: Data[] } | null>
  }

/** A published page (a draft and a published version) whose section `position` is a retired rich text. */
async function pageWithRetired(
  slug: string,
  values: RetiredValues,
  sections: Data[] = [PLACEHOLDER],
  position = 0
): Promise<string> {
  const { documentId } = await pages().create({
    status: 'published',
    data: { title: slug, slug, sections, site: await defaultSiteRelation(strapi) },
  })
  await plantRetiredRichText(documentId, position, values)
  return documentId
}

const sectionsOf = async (documentId: string, status: 'draft' | 'published') =>
  (await pages().findOne({ documentId, status, populate: { sections: { populate: '*' } } }))
    ?.sections ?? []

/** The warnings the boot log got that name the page `slug`. */
const warningsFor = (warn: jest.SpiedFunction<typeof strapi.log.warn>, slug: string): string[] =>
  warn.mock.calls.map(([message]) => String(message)).filter((m) => m.includes(`"${slug}"`))

describe('the prose boot migration', () => {
  let warn: jest.SpiedFunction<typeof strapi.log.warn>

  beforeAll(async () => {
    await setupStrapi()
  })

  afterEach(() => {
    warn?.mockRestore()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  const run = async () => {
    warn = jest.spyOn(strapi.log, 'warn')
    return migrateRichTextToProse(strapi)
  }

  it('turns every section.rich-text into shared.rich-text at the same position with the same body and blockId', async () => {
    const documentId = await pageWithRetired(
      'prose-moved',
      { body: '## Kept\n\nThe **same** text.', blockId: 'block-moved' },
      [
        { __component: 'shared.rich-text', body: 'Before' },
        PLACEHOLDER,
        { __component: 'shared.code', code: 'a\nb', language: 'bash' },
      ],
      1
    )
    expect(await retiredLinkCount()).toBe(2)

    const report = await run()

    expect(report.migrated).toBe(2)
    expect(await retiredLinkCount()).toBe(0)
    expect(await strapi.db.query('section.rich-text').count({})).toBe(0)
    for (const status of ['draft', 'published'] as const) {
      expect(await sectionsOf(documentId, status)).toMatchObject([
        { __component: 'shared.rich-text', body: 'Before' },
        {
          __component: 'shared.rich-text',
          body: '## Kept\n\nThe **same** text.',
          blockId: 'block-moved',
        },
        { __component: 'shared.code', code: 'a\nb' },
      ])
    }
  })

  it('reports a body whose heading levels fail and leaves it as it was', async () => {
    const body = '## Start\n\n#### Too deep\n\nText.'
    const documentId = await pageWithRetired('prose-skips', { body })

    await run()

    const warnings = warningsFor(warn, 'prose-skips')
    expect(warnings).toHaveLength(2)
    for (const status of ['draft', 'published']) {
      expect(warnings).toContainEqual(
        expect.stringContaining(
          `(${documentId}, en, ${status}) sections.0 has the h4 "Too deep" on line 3, which skips from h2`
        )
      )
    }
    expect((await sectionsOf(documentId, 'published'))[0]).toMatchObject({
      __component: 'shared.rich-text',
      body,
    })
  })

  it('reports a body that opens with h1 and leaves it as it was', async () => {
    const body = '# Title\n\n## Then'
    const documentId = await pageWithRetired('prose-h1-first', { body })

    await run()

    expect(warningsFor(warn, 'prose-h1-first')).toContainEqual(
      expect.stringContaining('sections.0 opens with the h1 "Title" on line 1; a block opens at h2')
    )
    expect((await sectionsOf(documentId, 'draft'))[0]).toMatchObject({ body })
  })

  it('reports a body with an h1 after its opening heading and leaves it as it was', async () => {
    const body = '## Opening\n\nText.\n\n# Later'
    const documentId = await pageWithRetired('prose-h1-later', { body })

    await run()

    expect(warningsFor(warn, 'prose-h1-later')).toContainEqual(
      expect.stringContaining('sections.0 has the h1 "Later" on line 5; a block has no h1')
    )
    expect((await sectionsOf(documentId, 'draft'))[0]).toMatchObject({ body })
  })

  it('names in the boot log each entry that set tone or align and does not carry them', async () => {
    const documentId = await pageWithRetired(
      'prose-styled',
      { body: 'Styled', tone: 'accent', align: 'center' },
      [{ __component: 'shared.rich-text', body: 'First' }, PLACEHOLDER],
      1
    )
    const toneOnly = await pageWithRetired('prose-tone-only', { body: 'Raised', tone: 'raised' })

    const report = await run()

    const styled = warningsFor(warn, 'prose-styled')
    expect(styled).toEqual(
      expect.arrayContaining(
        ['draft', 'published'].map((status) =>
          expect.stringContaining(
            `page "prose-styled" (${documentId}, en, ${status}) sections.1 set tone "accent" and align "center", which prose does not carry`
          )
        )
      )
    )
    expect(warningsFor(warn, 'prose-tone-only')).toContainEqual(
      expect.stringContaining(`(${toneOnly}, en, draft) sections.0 set tone "raised", which prose`)
    )
    expect(report.droppedStyles.filter((entry) => entry.slug === 'prose-styled')).toHaveLength(2)
    const [section] = (await sectionsOf(documentId, 'published')).slice(1)
    expect(section).toMatchObject({ __component: 'shared.rich-text', body: 'Styled' })
    expect(section).not.toHaveProperty('tone')
    expect(section).not.toHaveProperty('align')
  })

  it('does not name an entry whose tone and align are empty or the defaults', async () => {
    await pageWithRetired('prose-empty-style', { body: 'Plain', tone: null, align: null })
    await pageWithRetired('prose-default-style', {
      body: 'Plain',
      tone: 'default',
      align: 'start',
    })

    const report = await run()

    expect(report.migrated).toBe(4)
    expect(warningsFor(warn, 'prose-empty-style')).toEqual([])
    expect(warningsFor(warn, 'prose-default-style')).toEqual([])
    expect(report.droppedStyles).toEqual([])
  })

  it('a second run changes nothing', async () => {
    const documentId = await pageWithRetired('prose-twice', {
      body: '# Heading\n\nText',
      blockId: 'block-twice',
      tone: 'accent',
    })
    await run()
    warn.mockRestore()
    const before = {
      draft: await sectionsOf(documentId, 'draft'),
      published: await sectionsOf(documentId, 'published'),
      rows: await strapi.db.query('shared.rich-text').findMany({ orderBy: { id: 'asc' } }),
    }

    const report = await run()

    expect(report).toEqual({ migrated: 0, headingFaults: [], droppedStyles: [] })
    expect(warn).not.toHaveBeenCalled()
    expect({
      draft: await sectionsOf(documentId, 'draft'),
      published: await sectionsOf(documentId, 'published'),
      rows: await strapi.db.query('shared.rich-text').findMany({ orderBy: { id: 'asc' } }),
    }).toEqual(before)
  })
})
