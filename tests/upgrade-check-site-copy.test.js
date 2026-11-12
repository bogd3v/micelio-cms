import { describe, expect, it } from '@jest/globals'
import {
  compareIdentity,
  comparesSingleType,
  formatIdentity,
  parseIdentity,
} from '../scripts/upgrade-check/site-copy.mjs'

// The part of the upgrade check that compares the single type with the default site (#415).

const OUTPUT = [
  'single|en|Field Notes|upgrade-check|1.2.3|sha256:aa|bob',
  'single|es|Notas|upgrade-check|1.2.3|sha256:aa|bob',
  'site|en|Field Notes|upgrade-check|1.2.3|sha256:aa|bob',
  'site|es|Notas|upgrade-check|1.2.3|sha256:aa|bob',
].join('\n')

describe('upgrade check: the default site against the single type', () => {
  it('parses the rows of psql', () => {
    expect(parseIdentity(OUTPUT)[0]).toEqual({
      source: 'single',
      locale: 'en',
      name: 'Field Notes',
      themeId: 'upgrade-check',
      themeVersion: '1.2.3',
      themeDigest: 'sha256:aa',
      username: 'bob',
    })
  })

  it('finds no difference when the site carries the same values in every locale', () => {
    expect(compareIdentity(parseIdentity(OUTPUT))).toEqual([])
  })

  it('reports a field that differs, a locale the site lacks and an empty single type', () => {
    const changed = OUTPUT.replace('site|en|Field Notes', 'site|en|Micelio')
    expect(compareIdentity(parseIdentity(changed))).toEqual([
      { locale: 'en', field: 'name', single: 'Field Notes', site: 'Micelio' },
    ])
    const lacking = OUTPUT.split('\n').slice(0, 3).join('\n')
    expect(compareIdentity(parseIdentity(lacking))).toEqual([
      { locale: 'es', field: 'row', single: 'present', site: 'missing' },
    ])
    expect(compareIdentity(parseIdentity('site|en|Micelio||||'))).toHaveLength(1)
  })

  it('prints one line per locale and field, marking the differences', () => {
    const lines = formatIdentity(
      parseIdentity(OUTPUT.replace('site|es|Notas', 'site|es|Otro'))
    ).split('\n')
    expect(lines).toHaveLength(10)
    expect(lines.filter((line) => line.endsWith('DIFFERENT'))).toHaveLength(1)
  })

  it('compares the single type before 0.7 and the counts only from 0.7', () => {
    expect(comparesSingleType('0.6.0')).toBe(true)
    expect(comparesSingleType('0.6.12\n')).toBe(true)
    expect(comparesSingleType('0.7.0')).toBe(false)
    expect(comparesSingleType('0.8.1')).toBe(false)
    expect(comparesSingleType('1.0.0')).toBe(false)
  })

  it('keeps the guard when the version cannot be read, and an empty single type still fails', () => {
    expect(comparesSingleType('')).toBe(true)
    expect(comparesSingleType('latest')).toBe(true)
    expect(compareIdentity([])).toHaveLength(1)
  })
})
