import { describe, it, expect } from '@jest/globals'
import fs from 'node:fs'
import path from 'node:path'
import { RESPONSE_ROUTES, RESPONSE_SURFACES, SHARED_SHAPES } from '../src/constants/response-fields'
import { DOC_COMMAND } from './helpers/response-fields'
import { BEGIN_MARKER, END_MARKER, renderReference } from './helpers/response-fields-doc'

// `docs/security/response-fields.md` renders `src/constants/response-fields`
// between two markers, so the document lists exactly the routes and fields the
// suites check. After changing the constants, regenerate it with
// `UPDATE_RESPONSE_FIELDS_DOC=1 npx jest tests/response-fields-docs.test.ts` (`npm run docs:response-fields`).

const DOC = path.join(process.cwd(), 'docs', 'security', 'response-fields.md')

function split(text: string): { before: string; generated: string; after: string } {
  const start = text.indexOf(BEGIN_MARKER)
  const end = text.indexOf(END_MARKER)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${DOC} must hold ${BEGIN_MARKER} and ${END_MARKER}`)
  }
  return {
    before: text.slice(0, start + BEGIN_MARKER.length),
    generated: text.slice(start + BEGIN_MARKER.length, end),
    after: text.slice(end),
  }
}

describe('docs/security/response-fields.md', () => {
  const rendered = `\n${renderReference()}\n`

  if (process.env.UPDATE_RESPONSE_FIELDS_DOC) {
    it('is regenerated', () => {
      const { before, after } = split(fs.readFileSync(DOC, 'utf8'))
      fs.writeFileSync(DOC, `${before}${rendered}${after}`)
    })
  }

  it('renders exactly the routes and fields of src/constants/response-fields', () => {
    const { generated } = split(fs.readFileSync(DOC, 'utf8'))
    if (generated !== rendered) {
      throw new Error(
        `docs/security/response-fields.md differs from src/constants/response-fields. Regenerate it with ${DOC_COMMAND}`
      )
    }
  })

  it('has a section for every route and none for a route that does not exist', () => {
    const { generated } = split(fs.readFileSync(DOC, 'utf8'))
    const sections = [...generated.matchAll(/^#### `([^`]+)`$/gm)].map((match) => match[1])
    expect(sections).toEqual([
      ...RESPONSE_ROUTES.map((route) => route.id),
      ...Object.keys(SHARED_SHAPES),
    ])
  })

  it('puts every route in a surface table', () => {
    const { generated } = split(fs.readFileSync(DOC, 'utf8'))
    for (const surface of RESPONSE_SURFACES) {
      expect(generated).toContain(`### ${surface.title}`)
      for (const route of surface.routes) expect(generated).toContain(`| \`${route.id}\` |`)
    }
    expect(RESPONSE_SURFACES.flatMap((surface) => surface.routes)).toEqual(RESPONSE_ROUTES)
  })

  it('is linked from the documentation index', () => {
    const index = fs.readFileSync(path.join(process.cwd(), 'docs', 'README.md'), 'utf8')
    expect(index).toContain('security/response-fields.md')
  })
})
