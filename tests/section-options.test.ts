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
    expect(zone.map((uid) => uid.replace(/^section\./, '')).sort()).toEqual([...SECTIONS].sort())
  })
})
