import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Bogd3v/micelio-cms#535: demo-stacks.yml runs the demo stacks on Docker.

const root = join(__dirname, '..')
const workflow = readFileSync(join(root, '.github', 'workflows', 'demo-stacks.yml'), 'utf8')

/** The text of a top-level section of the workflow (`on:`, `jobs:`), up to the next one. */
function section(text: string, key: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line === `${key}:`)
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^\S/.test(line))
  return rest.slice(0, end < 0 ? rest.length : end).join('\n')
}

/** The text of `value` with every regular-expression metacharacter escaped, so a pattern built from it matches it literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The text of the job whose `name:` is `name`. */
function job(name: string): string {
  const jobs = section(workflow, 'jobs')
  const blocks = jobs.split(/^ {2}(?=\S[^\n]*:$)/m).filter(Boolean)
  const found = blocks.find((block) =>
    new RegExp(`^ {4}name: ${escapeRegExp(name)}$`, 'm').test(block)
  )
  return found ?? ''
}

/** The default of a `${VAR:-default}` reference in a compose file. */
function composeDefault(file: string, variable: string): string | undefined {
  const text = readFileSync(join(root, file), 'utf8')
  return new RegExp(`\\$\\{${variable}:-([^}]+)\\}`).exec(text)?.[1]
}

const STATIC_JOB = 'Demo stacks (${{ matrix.file }})'
const DYNAMIC_JOB = 'Demo stack (compose.demo.yml)'

const PATHS = [
  'compose.static.yml',
  'compose.landing.yml',
  'compose.demo.yml',
  'demo/**',
  'scripts/demo-secrets.js',
  'scripts/builder-last-run.sh',
  'scripts/demo-stack-check/**',
  'Dockerfile',
  'docker-entrypoint.sh',
  'package.json',
  'package-lock.json',
  '.github/workflows/demo-stacks.yml',
]

describe('demo-stacks.yml', () => {
  it('matches a job name with a regular-expression character literally', () => {
    const name = 'Demo [a+b] \\ (x|y)* ^$ ?'
    expect(new RegExp(`^${escapeRegExp(name)}$`).test(name)).toBe(true)
    expect(new RegExp(`^${escapeRegExp('a+b')}$`).test('aab')).toBe(false)
    expect(new RegExp(`^${escapeRegExp('[a]')}$`).test('a')).toBe(false)
  })

  it('runs on pull requests that touch a demo stack, by hand, and weekly', () => {
    const on = section(workflow, 'on')
    const pullRequest = /^ {2}pull_request:\n((?: {4}.*\n)+)/m.exec(on)?.[1] ?? ''
    expect(pullRequest).toMatch(/^ {4}branches: \[main, develop\]$/m)
    const paths = [...pullRequest.matchAll(/^ {6}- (.+)$/gm)].map((match) => match[1])
    expect(paths).toEqual(PATHS)
    expect(on).toMatch(/^ {2}workflow_dispatch:$/m)
    const crons = [...on.matchAll(/^ {4}- cron: '([^']+)'$/gm)].map((match) => match[1])
    expect(crons).toHaveLength(1)
    const [minute, hour, dayOfMonth, month, dayOfWeek] = crons[0].split(' ')
    expect(dayOfMonth).toBe('*')
    expect(month).toBe('*')
    expect(dayOfWeek).toMatch(/^[0-7]$/)
    expect(minute).toMatch(/^\d+$/)
    expect(minute).not.toBe('0')
    expect(hour).toMatch(/^\d+$/)
    // The schedule has no paths filter: it sits beside pull_request, not under it.
    expect(on.match(/^ {2}schedule:\n {4}- cron: .*$/m)).not.toBeNull()
  })

  it('runs each stack in its own job with a timeout', () => {
    const text = job(STATIC_JOB)
    expect(text).not.toBe('')
    expect(text).toMatch(/^ {6}fail-fast: false$/m)
    expect(text).toMatch(/- file: compose\.static\.yml\n {12}rebuilds: 2\n/)
    expect(text).toMatch(/- file: compose\.landing\.yml\n {12}rebuilds: 1\n/)
    expect([...text.matchAll(/- file: /g)]).toHaveLength(2)
    const timeout = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(text)?.[1])
    expect(timeout).toBeGreaterThan(0)
    expect(timeout).toBeLessThanOrEqual(30)
    expect(text).toMatch(/^ {4}runs-on: ubuntu-latest$/m)
  })

  it('runs the dynamic demo in a job of its own', () => {
    const text = job(DYNAMIC_JOB)
    expect(text).not.toBe('')
    const timeout = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(text)?.[1])
    expect(timeout).toBeGreaterThan(0)
    expect(timeout).toBeLessThanOrEqual(30)
    expect(text).toMatch(/^ {10}target: production$/m)
    expect(text).toMatch(/^ {10}load: true$/m)
    const tag = composeDefault('compose.demo.yml', 'MICELIO_IMAGE')
    expect(tag).toMatch(/^ghcr\.io\/bogd3v\/micelio:/)
    expect(text).toContain(`FRONTEND_TAG: ${tag}`)
    expect(text).toMatch(/run: npm run test:demo-stacks -- --file compose\.demo\.yml$/m)
    expect(text).not.toMatch(/--rebuilds|MICELIO_BUILDER_IMAGE/)
  })

  it('pins every action by commit SHA', () => {
    const uses = [...workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((match) => match[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const reference of uses) expect(reference).toMatch(/@[0-9a-f]{40}$/)
  })

  it('reads no secret and asks only to read the contents', () => {
    expect(workflow).not.toMatch(/\$\{\{[^}]*\bsecrets\./)
    const blocks = [...workflow.matchAll(/^( *)permissions:\n((?:\1 {2}.*\n)+)/gm)]
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    for (const block of blocks) expect(block[2].trim()).toBe('contents: read')
    const checkouts = [
      ...workflow.matchAll(/uses: actions\/checkout@[^\n]*\n(?: {8}with:\n(?: {10}.*\n)+)?/g),
    ]
    expect(checkouts.length).toBeGreaterThan(0)
    for (const checkout of checkouts)
      expect(checkout[0]).toMatch(/^ {10}persist-credentials: false$/m)
  })

  it('tests the CMS of the pull request against the builder the compose files name', () => {
    const text = job(STATIC_JOB)
    expect(text).toMatch(/^ {10}target: production$/m)
    expect(text).toMatch(/^ {10}load: true$/m)
    const builders = ['compose.static.yml', 'compose.landing.yml'].map((file) =>
      composeDefault(file, 'MICELIO_BUILDER_IMAGE')
    )
    expect(builders[0]).toMatch(/^ghcr\.io\/bogd3v\/micelio-builder:/)
    expect(builders[1]).toBe(builders[0])
    expect(text).toContain(`BUILDER_TAG: ${builders[0]}`)
    expect(text).toMatch(
      /run: npm run test:demo-stacks -- --file "\$FILE" --rebuilds "\$REBUILDS"$/m
    )
    expect(text).toMatch(/MICELIO_BUILDER_IMAGE: \$\{\{ steps\.builder\.outputs\.image \}\}/)
  })
})
