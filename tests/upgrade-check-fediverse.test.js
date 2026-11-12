import { describe, expect, it } from '@jest/globals'
import {
  ACTOR_IDENTIFIER,
  ACTOR_PATH,
  FEDIVERSE_COUNTS_SQL,
  FEDIVERSE_ENV,
  GRANT_ROWS,
  KEY_ROW,
  SEED_FEDIVERSE_SQL,
  SEEDED_FEDIVERSE,
} from '../scripts/upgrade-check/fediverse.mjs'

// What the upgrade check seeds and counts for the fediverse plugin (#391). The Docker run is not
// in Jest; these keep the seed and the counts consistent with each other.

describe('upgrade check: the fediverse seed', () => {
  it('turns federation on in both images with an identifier', () => {
    expect(FEDIVERSE_ENV).toEqual([
      '-e',
      'FEDIVERSE_ENABLED=true',
      '-e',
      `FEDIVERSE_ACTOR_IDENTIFIER=${ACTOR_IDENTIFIER}`,
    ])
    expect(ACTOR_PATH).toBe(`/fediverse/user/${ACTOR_IDENTIFIER}`)
  })

  it('seeds every table whose count must not fall', () => {
    for (const table of SEEDED_FEDIVERSE) {
      expect(SEED_FEDIVERSE_SQL).toContain(`INSERT INTO ${table} `)
    }
  })

  it('delays the queued message so no worker sends it', () => {
    expect(SEED_FEDIVERSE_SQL).toMatch(/INSERT INTO fedify_message_v2 \(message, delay\)/)
    expect(SEED_FEDIVERSE_SQL).toContain("interval '365 days'")
  })

  it('seeds the two grants the check counts, and only counts them by action', () => {
    expect(GRANT_ROWS).toEqual([
      'admin_permissions_action:plugin::fediverse.manage',
      'admin_permissions_action:plugin::fediverse.read',
    ])
    for (const row of GRANT_ROWS) {
      expect(SEED_FEDIVERSE_SQL).toContain(row.replace('admin_permissions_action:', ''))
    }
    expect(FEDIVERSE_COUNTS_SQL).toContain("'admin_permissions_action:' || action")
  })

  it('counts the stored key by its row, never its value', () => {
    expect(KEY_ROW).toBe('core_store:plugin_fediverse_keyPairs')
    expect(FEDIVERSE_COUNTS_SQL).toContain("key = 'plugin_fediverse_keyPairs'")
    expect(FEDIVERSE_COUNTS_SQL).not.toMatch(/select\s+value/i)
  })

  it('counts the key of a package 0.7 image, one row per site', () => {
    expect(FEDIVERSE_COUNTS_SQL).toContain("starts_with(key, 'plugin_fediverse_keyPairs:')")
  })
})
