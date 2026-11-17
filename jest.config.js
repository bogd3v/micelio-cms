const ESM_PACKAGES = [
  'structured-field-values',
  'devalue',
  'htmlparser2',
  'domhandler',
  'domutils',
  'dom-serializer',
  'domelementtype',
  'entities',
]

/**
 * Reads a worker limit from the environment: a positive integer (`3`) or a
 * percentage (`50%`). Anything else (empty, `abc`, `0`, `-1`, `1.5`) is ignored.
 *
 * @param {string | undefined} value The raw value of the variable.
 * @returns {number | string | undefined} The limit as Jest takes it, or `undefined`.
 */
function parseWorkerLimit(value) {
  const text = (value ?? '').trim()
  if (/^[1-9]\d*$/.test(text)) return Number(text)
  if (/^[1-9]\d*%$/.test(text)) return text
  return undefined
}

// `JEST_MAX_WORKERS` wins, then `VITEST_MAX_WORKERS` (what `factory-slot.sh run`
// of micelio-engineering sets); a bad value falls through to the next, and with
// none Jest keeps its default (one worker per core but one).
const maxWorkers =
  parseWorkerLimit(process.env.JEST_MAX_WORKERS) ?? parseWorkerLimit(process.env.VITEST_MAX_WORKERS)

/** @type {import('jest').Config} */
module.exports = {
  ...(maxWorkers === undefined ? {} : { maxWorkers }),
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.[jt]s'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
    '/.tmp/',
    '/.cache/',
    '/.strapi/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/build/'],
  globalSetup: './tests/jest.global-setup.js',
  setupFilesAfterEnv: ['./tests/jest.setup.ts'],
  transform: {
    '^.+\\.[cm]?[jt]sx?$': '<rootDir>/tests/helpers/esbuild-transformer.js',
  },
  // Transform node_modules only for ESM-only packages that CJS code requires
  // (Node can `require()` ESM since v22, Jest cannot): structured-field-values
  // and devalue, which the fediverse package gets from Fedify, and htmlparser2
  // and its dom* deps from sanitize-html (comments plugin). Nested node_modules
  // count: the last segment decides.
  transformIgnorePatterns: [
    `node_modules/(?!(?:[^/]+/node_modules/)*(?:${ESM_PACKAGES.join('|')})/)`,
  ],
}
