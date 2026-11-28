import { describe, it, expect } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'
import pageSchema from '../src/api/page/content-types/page/schema'

// `tone` and `align` are names of the options vocabulary of micelio's ADR-0018 section 1. Every
// block of `page.sections` offers both as enumerations whose default is the vocabulary's, so
// existing content renders as before and needs no migration (#442).

const SECTIONS = [
  'hero',
  'feature-grid',
  'media-showcase',
  'stats',
  'logo-cloud',
  'testimonials',
  'pricing',
  'faq',
  'cta',
  'post-list',
  'newsletter',
  'rich-text',
  'gallery',
  'scene',
]

interface Attribute {
  type: string
  enum?: string[]
  default?: string
  required?: boolean
}

function attributes(name: string): Record<string, Attribute> {
  const file = path.join(process.cwd(), 'src', 'components', 'section', `${name}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')).attributes
}

// `eyebrow` and `anchor` (#441): optional strings on the twelve sections whose renderer uses
// `SectionHead`, and on no other.
const SECTION_HEAD = [
  'cta',
  'faq',
  'feature-grid',
  'gallery',
  'hero',
  'logo-cloud',
  'newsletter',
  'post-list',
  'pricing',
  'scene',
  'stats',
  'testimonials',
]
const WITHOUT_HEAD = SECTIONS.filter((name) => !SECTION_HEAD.includes(name))

describe('section components offer tone and align', () => {
  it.each(SECTIONS)('section.%s has tone and align with the vocabulary defaults', (name) => {
    const { tone, align } = attributes(name)
    expect(tone).toEqual({
      type: 'enumeration',
      enum: ['default', 'raised', 'accent'],
      default: 'default',
    })
    expect(align).toEqual({ type: 'enumeration', enum: ['start', 'center'], default: 'start' })
  })

  it('lists every component of the sections dynamic zone of a page', () => {
    const zone = (pageSchema.attributes as unknown as Record<string, { components: string[] }>)
      .sections.components
    // `shared.rich-text` is allowed next to `section.rich-text` (#445): the zone is no longer all `section.*`.
    // `section.reusable` (#527) is a reference to a reusable block, not a section with options.
    expect([...zone].sort()).toEqual(
      [
        ...SECTIONS.map((name) => `section.${name}`),
        'shared.rich-text',
        'shared.code',
        'shared.table',
        'section.reusable',
      ].sort()
    )
  })
})

// `iconStyle` (ADR-0021 of micelio, section 1): offered by every block whose schema holds an icon
// field and by no other. The four below hold one through the icon of their `section.link` (#559).
const WITH_ICON = ['hero', 'media-showcase', 'cta', 'pricing']

describe('sections with an icon field offer iconStyle', () => {
  it.each(WITH_ICON)('section.%s has iconStyle outline or filled, default outline', (name) => {
    expect(attributes(name).iconStyle).toEqual({
      type: 'enumeration',
      enum: ['outline', 'filled'],
      default: 'outline',
    })
  })

  it('leaves iconStyle off the sections without an icon field', () => {
    const zone = (pageSchema.attributes as unknown as Record<string, { components: string[] }>)
      .sections.components
    const others = zone.filter((uid) => !WITH_ICON.map((name) => `section.${name}`).includes(uid))
    expect(others).toHaveLength(zone.length - WITH_ICON.length)
    for (const uid of others) {
      const [category, name] = uid.split('.')
      const file = path.join(process.cwd(), 'src', 'components', category, `${name}.json`)
      const attrs = JSON.parse(fs.readFileSync(file, 'utf8')).attributes
      expect([uid, 'iconStyle' in attrs]).toEqual([uid, false])
    }
  })
})

describe('sections with a SectionHead offer eyebrow and anchor', () => {
  it.each(SECTION_HEAD)('section.%s has optional string eyebrow and anchor', (name) => {
    const { eyebrow, anchor } = attributes(name)
    expect(eyebrow).toEqual({ type: 'string' })
    expect(anchor).toEqual({ type: 'string' })
  })

  it.each(WITHOUT_HEAD)('section.%s has neither eyebrow nor anchor', (name) => {
    const attrs = attributes(name)
    expect(attrs).not.toHaveProperty('eyebrow')
    expect(attrs).not.toHaveProperty('anchor')
  })
})

describe('faq items can open by default', () => {
  it('section.faq-item has a boolean defaultOpen that is false unless set (#447)', () => {
    const file = path.join(process.cwd(), 'src', 'components', 'section', 'faq-item.json')
    const { defaultOpen } = JSON.parse(fs.readFileSync(file, 'utf8')).attributes
    expect(defaultOpen).toEqual({ type: 'boolean', default: false })
  })
})

describe('testimonials can name their source, logo and rating', () => {
  it('section.testimonial has an optional sourceUrl, logo and rating of 1 to 5 (#451)', () => {
    const file = path.join(process.cwd(), 'src', 'components', 'section', 'testimonial.json')
    const attrs = JSON.parse(fs.readFileSync(file, 'utf8')).attributes
    expect(attrs.sourceUrl).toEqual({ type: 'string', regex: '^https?://\\S+$' })
    expect(attrs.logo).toEqual({ type: 'media', multiple: false, allowedTypes: ['images'] })
    expect(attrs.rating).toEqual({ type: 'integer', min: 1, max: 5 })
    // The existing fields stay: an existing testimonial renders as before.
    expect(attrs.quote.required).toBe(true)
    expect(attrs.author.required).toBe(true)
    expect(attrs).toHaveProperty('avatar')
  })
})

describe('post lists can feature, sort and hide the excerpt', () => {
  it('section.post-list has showExcerpt, sort and the featured variant, defaults unchanged (#444)', () => {
    const { variant, showExcerpt, sort } = attributes('post-list')
    expect(variant).toMatchObject({
      enum: ['cards', 'list', 'featured'],
      default: 'cards',
      required: true,
    })
    expect(showExcerpt).toEqual({ type: 'boolean', default: true })
    expect(sort).toEqual({
      type: 'enumeration',
      enum: ['newest', 'oldest', 'alphabetical'],
      default: 'newest',
    })
  })
})

describe('links can carry an icon and say they leave the site or download a file', () => {
  it('section.link has an optional icon, iconPosition (default start), external and download (#462)', () => {
    const attrs = attributes('link')
    expect(attrs.icon).toEqual({ type: 'customField', customField: 'plugin::micelio.icon' })
    expect(attrs.iconPosition).toEqual({
      type: 'enumeration',
      enum: ['start', 'end', 'only'],
      default: 'start',
    })
    expect(attrs.external).toEqual({ type: 'boolean' })
    expect(attrs.download).toEqual({ type: 'boolean' })
    // The existing fields stay: an existing link renders as before.
    expect(attrs.label).toMatchObject({ type: 'string', required: true })
    expect(attrs.url).toMatchObject({ type: 'string', required: true })
  })
})

// The group key of ADR-0022 (micelio), section 2, and the `reusable` block of its section 1 (#527),
// stored as the catalogue of the installed core describes them (`contract/blocks.schema.json`).
describe('page sections can share a group, and a page can reference a reusable block', () => {
  interface StrapiShape {
    type?: string
    component?: string
    repeatable?: boolean
    relation?: string
    target?: string
  }
  interface Property {
    anyOf?: Property[]
    enum?: string[]
    required?: string[]
    properties?: Record<string, Property>
    'x-strapi'?: StrapiShape
  }
  interface Definition {
    properties: Record<string, Property>
    'x-strapi': { component: string }
  }

  const catalogue = (
    JSON.parse(
      fs.readFileSync(require.resolve('@micelio/strapi-plugin-core/blocks.schema.json'), 'utf8')
    ) as { $defs: Record<string, Definition> }
  ).$defs
  // A nullable property of the catalogue is `anyOf: [<shape>, { type: 'null' }]`.
  const shapeOf = (property: Property): Property => property.anyOf?.[0] ?? property
  const componentAttributes = (uid: string): Record<string, Attribute & StrapiShape> => {
    const [category, name] = uid.split('.')
    const file = path.join(process.cwd(), 'src', 'components', category, `${name}.json`)
    return JSON.parse(fs.readFileSync(file, 'utf8')).attributes
  }
  const GROUP = { type: 'component', repeatable: false, component: 'section.group' }
  const grouped = Object.values(catalogue)
    .filter((definition) => 'group' in definition.properties)
    .map((definition) => definition['x-strapi'].component)

  it('gives the group attribute to the thirteen sections and the reusable block, as the catalogue does', () => {
    expect([...grouped].sort()).toEqual(
      [...SECTIONS.filter((name) => name !== 'rich-text'), 'reusable']
        .map((name) => `section.${name}`)
        .sort()
    )
    for (const uid of grouped) {
      expect([uid, componentAttributes(uid).group]).toEqual([uid, GROUP])
    }
  })

  it('leaves the group off the blocks the catalogue gives none', () => {
    for (const uid of ['section.rich-text', 'shared.rich-text', 'shared.code', 'shared.table']) {
      expect([uid, 'group' in componentAttributes(uid)]).toEqual([uid, false])
    }
  })

  it('stores section.group with a required groupId and a required tone of the catalogue', () => {
    const group = shapeOf(catalogue.hero.properties.group)
    expect(group['x-strapi']).toMatchObject(GROUP)
    expect(group.required).toEqual(['groupId', 'tone'])
    expect(componentAttributes('section.group')).toEqual({
      groupId: { type: 'string', required: true },
      tone: { type: 'enumeration', enum: group.properties!.tone.enum, required: true },
    })
    expect(group.properties!.tone.enum).toEqual(['default', 'raised', 'accent'])
  })

  it('stores section.reusable with blockId, its reusableBlock relation and group', () => {
    const { properties } = catalogue.reusable
    expect(catalogue.reusable['x-strapi'].component).toBe('section.reusable')
    expect(Object.keys(properties)).toEqual(['blockId', 'reusableBlock', 'group'])
    expect(shapeOf(properties.reusableBlock)['x-strapi']).toEqual({
      type: 'relation',
      relation: 'oneToOne',
      target: 'plugin::micelio.reusable-block',
    })
    expect(componentAttributes('section.reusable')).toEqual({
      blockId: { type: 'string' },
      reusableBlock: {
        type: 'relation',
        relation: 'oneToOne',
        target: 'plugin::micelio.reusable-block',
      },
      group: GROUP,
    })
  })
})
