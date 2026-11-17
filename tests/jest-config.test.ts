import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { join } from 'node:path'

const configPath = join(__dirname, '..', 'jest.config.js')
const KEYS = ['JEST_MAX_WORKERS', 'VITEST_MAX_WORKERS'] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

/** Loads `jest.config.js` with exactly the given worker variables set. */
function loadConfig(env: Partial<Record<(typeof KEYS)[number], string>>): Record<string, unknown> {
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, env)
  let config: Record<string, unknown> = {}
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules reloads a CommonJS file only through require
    config = require(configPath) as Record<string, unknown>
  })
  return config
}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('jest.config.js worker limit', () => {
  it('takes maxWorkers from JEST_MAX_WORKERS, then VITEST_MAX_WORKERS', () => {
    expect(loadConfig({ JEST_MAX_WORKERS: '3' }).maxWorkers).toBe(3)
    expect(loadConfig({ VITEST_MAX_WORKERS: '2' }).maxWorkers).toBe(2)
    expect(loadConfig({ JEST_MAX_WORKERS: '3', VITEST_MAX_WORKERS: '2' }).maxWorkers).toBe(3)
  })

  it('accepts a percentage', () => {
    expect(loadConfig({ VITEST_MAX_WORKERS: '50%' }).maxWorkers).toBe('50%')
  })

  it('ignores a bad worker limit', () => {
    for (const bad of ['abc', '', '0', '-1', '1.5', '%', '0%']) {
      expect(loadConfig({ VITEST_MAX_WORKERS: bad })).not.toHaveProperty('maxWorkers')
    }
    expect(loadConfig({ JEST_MAX_WORKERS: 'abc', VITEST_MAX_WORKERS: '2' }).maxWorkers).toBe(2)
  })

  it('leaves maxWorkers unset when neither variable is set', () => {
    expect(loadConfig({})).not.toHaveProperty('maxWorkers')
  })
})
