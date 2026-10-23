import {
  RESPONSE_SURFACES,
  SHARED_SHAPES,
  type FieldSpec,
  type ResponseRoute,
  type Shape,
} from '../../src/constants/response-fields'
import { ROOT, levelsOf, routeCounts, type Level } from './response-fields'

// Renders the tables of `docs/security/response-fields.md` from the constants,
// so the document cannot drift from what the tests check.

/** Marks the part of the document that is generated. */
export const BEGIN_MARKER = '<!-- BEGIN GENERATED: tests/helpers/response-fields-doc.ts -->'
/** Closes the generated part. */
export const END_MARKER = '<!-- END GENERATED -->'

const useOf = (spec: FieldSpec) => (typeof spec === 'string' ? spec : spec.use)

const keys = (shape: Shape, use: 'required' | 'surplus'): string =>
  Object.entries(shape)
    .filter(([, spec]) => useOf(spec) === use)
    .map(([key]) => `\`${key}\``)
    .join(', ') || 'none'

function row(level: Level): string {
  if (level.ref) {
    const target = level.ref === 'self' ? 'the enclosing object' : `shared \`${level.ref}\``
    return `| \`${level.path}\` | as ${target} | as ${target} |`
  }
  return `| \`${level.path}\` | ${keys(level.shape, 'required')} | ${keys(level.shape, 'surplus')} |`
}

const table = (levels: Level[]): string =>
  ['| Object | Required | Surplus |', '| --- | --- | --- |', ...levels.map(row)].join('\n')

const cell = (text: string) => text.split('|').join('\\|')

function summary(routes: readonly ResponseRoute[]): string {
  const rows = routes.map((route) => {
    const counts = routeCounts(route)
    const reader = route.reader || 'none found'
    return `| \`${route.id}\` | \`${route.method} ${route.path}\` | ${cell(route.auth)} | ${counts.required} | ${counts.surplus} | ${cell(reader)} | ${cell(route.note)} |`
  })
  return [
    '| Route | Method and path | Auth | Required | Surplus | Read by | Note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

function detail(route: ResponseRoute): string {
  const kind =
    route.kind === 'list'
      ? 'The body is a list; each item has the keys of `(body)`.'
      : route.kind === 'map'
        ? 'The body is a map from a document id; each value has the keys of `(body)`.'
        : ''
  return [
    `#### \`${route.id}\``,
    '',
    ...(kind ? [kind, ''] : []),
    table(levelsOf(route.body, false)),
  ].join('\n')
}

/** The generated Markdown: one summary table and one set of object tables per surface, then the shared objects. */
export function renderReference(): string {
  const parts: string[] = []
  for (const surface of RESPONSE_SURFACES) {
    parts.push(`### ${surface.title}`, '', summary(surface.routes), '')
    for (const route of surface.routes) parts.push(detail(route), '')
  }
  parts.push('### Shared objects', '')
  for (const [name, shape] of Object.entries(SHARED_SHAPES)) {
    parts.push(`#### \`${name}\``, '', table(levelsOf(shape, false, ROOT)), '')
  }
  return parts.join('\n').trimEnd()
}
