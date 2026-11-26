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
    expect([...zone].sort()).toEqual(
      [
        ...SECTIONS.map((name) => `section.${name}`),
        'shared.rich-text',
        'shared.code',
        'shared.table',
      ].sort()
    )
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
