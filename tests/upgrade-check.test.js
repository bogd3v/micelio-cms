import { describe, expect, it } from '@jest/globals'
import {
  compareCounts,
  contentTablesSql,
  formatTable,
  joinTablePattern,
  parseCounts,
  readCollectionNames,
  trackedTables,
} from '../scripts/upgrade-check/counts.mjs'

describe('upgrade check', () => {
  it('reads the collection names from the schemas, plugin content types included', () => {
    const names = readCollectionNames(process.cwd())
    expect(names).toEqual(expect.arrayContaining(['articles', 'pages', 'authors', 'site_settings']))
    expect(names).toEqual(expect.arrayContaining(['categories', 'tags']))
    expect(names).toEqual([...names].sort())
  })

  it('matches the link and component tables Strapi 5 names, and nothing else', () => {
    const pattern = new RegExp(joinTablePattern(['articles', 'site_settings']))
    for (const name of [
      'articles_cmps',
      'articles_category_lnk',
      'site_settings_home_page_lnk',
      'site_settings_cmps',
    ]) {
      expect(pattern.test(name)).toBe(true)
    }
    for (const name of ['articles', 'articles_x', 'pages_cmps', 'articles_cmps_extra']) {
      expect(pattern.test(name)).toBe(false)
    }
  })

  it('tracks every table the database had except Strapi bookkeeping', () => {
    const tracked = trackedTables([
      'strapi_migrations',
      'strapi_core_store_settings',
      'strapi_database_schema',
      'up_permissions',
      'up_permissions_role_lnk',
      'admin_permissions',
      'strapi_api_token_permissions_token_lnk',
      'site_settings',
      'components_shared_seos',
      'retired_things',
    ])
    expect(tracked).toEqual(['components_shared_seos', 'retired_things', 'site_settings'])
  })

  it('counts a tracked table the tree no longer declares, next to the ones it declares', () => {
    const sql = contentTablesSql(['retired_things'], ['articles', 'tags'])
    expect(sql).toContain("table_name in ('retired_things', 'articles', 'tags')")
    expect(sql).toContain(joinTablePattern(['articles', 'tags']))
  })

  it('parses name|count lines and rejects anything else', () => {
    const counts = parseCounts('articles|12\ncore_store:plugin_x::api::a.a|1\n\n')
    expect(counts.get('articles')).toBe(12)
    expect(counts.get('core_store:plugin_x::api::a.a')).toBe(1)
    expect(() => parseCounts('articles|many')).toThrow('Unexpected psql output')
  })

  it('flags a decrease, and only an allowed name may drop', () => {
    const before = new Map([
      ['categories', 5],
      ['tags', 3],
      ['gone', 2],
    ])
    const after = new Map([
      ['categories', 4],
      ['tags', 4],
      ['new', 1],
    ])
    const rows = compareCounts(before, after, ['gone'])
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]))
    expect(byName.categories).toMatchObject({ before: 5, after: 4, dropped: true })
    expect(byName.tags.dropped).toBe(false)
    expect(byName.new).toMatchObject({ before: 0, after: 1, dropped: false })
    expect(byName.gone).toMatchObject({ before: 2, after: 0, decreased: true, dropped: false })
  })

  it('prints a table that marks a drop and an allowed drop', () => {
    const table = formatTable(
      compareCounts(
        new Map([
          ['a', 2],
          ['b', 2],
          ['c', 1],
        ]),
        new Map([
          ['a', 1],
          ['b', 1],
          ['c', 1],
        ]),
        ['b']
      )
    )
    const lines = table.split('\n')
    expect(lines[0]).toMatch(/^name\s+before\s+after$/)
    expect(lines.find((line) => line.startsWith('a '))).toMatch(/DROP$/)
    expect(lines.find((line) => line.startsWith('b '))).toMatch(/allowed$/)
    expect(lines.find((line) => line.startsWith('c '))).toMatch(/1\s+1$/)
  })
})
