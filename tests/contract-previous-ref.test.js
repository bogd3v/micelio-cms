import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyPreviousRun } from '../scripts/contract/previous-ref.mjs'

// Bogd3v/micelio-cms#496: `Contract Tests (previous)` passes a run of the frontend's contract suite whose only failure is
// stale known differences, and fails on anything else. tests/fixtures/contract/stale-only.json is the Playwright JSON
// report of a real run of the frontend v0.7.0 against this CMS, trimmed to what the classifier reads; the other reports
// are edits of it, made below.

const SCRIPT = join(__dirname, '..', 'scripts', 'contract', 'previous-ref.mjs')
const STALE_ONLY = join(__dirname, 'fixtures', 'contract', 'stale-only.json')
const MOCK_SHAPE = 'the mock Strapi answers with the shapes of the real CMS'
const REDIRECTS = '/api/micelio/redirects status: the mock answers 200, the CMS 404'

/** The real report, parsed, so a case can edit it. */
function staleOnly() {
  return JSON.parse(readFileSync(STALE_ONLY, 'utf8'))
}

/** Every test of a report, through nested suites, with the title of its spec. */
function testsOf(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({ title: spec.title, test }))
    ),
    ...testsOf(suite.suites ?? []),
  ])
}

/** The test of a report whose spec has this title. */
function testNamed(report, title) {
  const found = testsOf(report.suites).find((entry) => entry.title === title)
  if (!found) throw new Error(`no test "${title}" in the report`)
  return found.test
}

/** The report of a run where every test passed: the mock-shape test of the real report, passed. */
function passedReport() {
  const report = staleOnly()
  const test = testNamed(report, MOCK_SHAPE)
  test.status = 'expected'
  test.results = [{ errors: [] }]
  return report
}

describe('classifyPreviousRun', () => {
  it('passes a run where every test passed', () => {
    expect(classifyPreviousRun({ status: 0, report: JSON.stringify(passedReport()) })).toEqual({
      outcome: 'passed',
      stale: [],
      reason: '',
    })
  })

  it('tolerates a run whose only failure is stale known differences and lists them', () => {
    const report = readFileSync(STALE_ONLY, 'utf8')
    expect(testsOf(JSON.parse(report).suites)).toHaveLength(18)
    expect(classifyPreviousRun({ status: 1, report })).toEqual({
      outcome: 'tolerated',
      stale: [REDIRECTS],
      reason: '',
    })
  })

  it('fails when the mock-shape test fails on another check', () => {
    const report = staleOnly()
    const error = testNamed(report, MOCK_SHAPE).results[0].errors[0]
    // The first check of the test (`unexpected`) fails: Playwright stops there and the stale check never runs.
    error.message = error.message
      .replace(
        'Error: known differences that no longer show (delete them from KNOWN_DIFFERENCES)',
        'Error: what the mock answers that the CMS does not (fix the mock, or list it in KNOWN_DIFFERENCES with its reason)'
      )
      .replace(REDIRECTS, '/api/articles $.data[].slug: the mock has number, the CMS has string')

    const result = classifyPreviousRun({ status: 1, report: JSON.stringify(report) })
    expect(result.outcome).toBe('failed')
    expect(result.stale).toEqual([])
    expect(result.reason).toContain('what the mock answers that the CMS does not')

    // A stale check whose message lists no entry is not one the classifier understands.
    const empty = staleOnly()
    const emptyError = testNamed(empty, MOCK_SHAPE).results[0].errors[0]
    emptyError.message = emptyError.message.replace(`"${REDIRECTS}",`, '')
    const unlisted = classifyPreviousRun({ status: 1, report: JSON.stringify(empty) })
    expect(unlisted.outcome).toBe('failed')
    expect(unlisted.reason).toContain('lists no entry')
  })

  it('fails when another test fails beside the stale known differences', () => {
    const report = staleOnly()
    const other = 'a guest comment is stored, shown back and never carries the email'
    const test = testNamed(report, other)
    test.status = 'unexpected'
    test.results = [{ errors: [{ message: 'Test timeout of 30000ms exceeded.' }] }]

    const result = classifyPreviousRun({ status: 1, report: JSON.stringify(report) })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain(`"${other}"`)
    expect(result.reason).toContain(`"${MOCK_SHAPE}"`)

    // Whichever of the two the report lists first.
    const reversed = JSON.parse(JSON.stringify(report))
    reversed.suites.reverse()
    expect(classifyPreviousRun({ status: 1, report: JSON.stringify(reversed) }).outcome).toBe(
      'failed'
    )

    // The same when the second failure is a second error of the mock-shape test itself.
    const twice = staleOnly()
    const errors = testNamed(twice, MOCK_SHAPE).results[0].errors
    errors.push({ message: 'Error: page.goto: net::ERR_CONNECTION_REFUSED' })
    expect(classifyPreviousRun({ status: 1, report: JSON.stringify(twice) }).outcome).toBe('failed')

    // And when the one failed test is another test whose message reads like the stale check.
    const alone = passedReport()
    const lookalike = testNamed(alone, other)
    lookalike.status = 'unexpected'
    lookalike.results = testNamed(staleOnly(), MOCK_SHAPE).results
    const lookalikeResult = classifyPreviousRun({ status: 1, report: JSON.stringify(alone) })
    expect(lookalikeResult.outcome).toBe('failed')
    expect(lookalikeResult.reason).toContain(`"${other}"`)
  })

  it('fails when the report has a global error, is missing or cannot be read', () => {
    const report = staleOnly()
    report.errors = [{ message: 'Error: Timed out waiting 30000ms from config.webServer.' }]
    const global = classifyPreviousRun({ status: 1, report: JSON.stringify(report) })
    expect(global.outcome).toBe('failed')
    expect(global.reason).toContain('Timed out waiting 30000ms from config.webServer.')

    for (const missing of [null, undefined, '']) {
      const result = classifyPreviousRun({ status: 1, report: missing })
      expect(result.outcome).toBe('failed')
      expect(result.reason).toContain('missing or cannot be read')
    }

    const truncated = readFileSync(STALE_ONLY, 'utf8').slice(0, 200)
    const unreadable = classifyPreviousRun({ status: 1, report: truncated })
    expect(unreadable.outcome).toBe('failed')
    expect(unreadable.reason).toContain('not valid JSON')

    const notReport = classifyPreviousRun({ status: 1, report: '{"stats":{}}' })
    expect(notReport.outcome).toBe('failed')
    expect(notReport.reason).toContain('no `suites`')

    const badErrors = staleOnly()
    badErrors.errors = 'Error: not a list'
    const notList = classifyPreviousRun({ status: 1, report: JSON.stringify(badErrors) })
    expect(notList.outcome).toBe('failed')
    expect(notList.reason).toContain('not a list')
  })

  it('fails when the status is not zero and no test failed', () => {
    const result = classifyPreviousRun({ status: 1, report: JSON.stringify(passedReport()) })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('no test failed')

    // And the other way round: a zero status with a failed test is not a pass.
    expect(
      classifyPreviousRun({ status: 0, report: readFileSync(STALE_ONLY, 'utf8') }).outcome
    ).toBe('failed')
  })
})

describe('previous-ref.mjs', () => {
  let folder = ''

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'contract-previous-ref-'))
  })

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  /** Runs the entry point and answers its exit status and output. */
  function run(name, args) {
    const summary = join(folder, `${name}.md`)
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
      })
      return { status: 0, stdout, stderr: '', summary }
    } catch (error) {
      return {
        status: error.status,
        stdout: String(error.stdout),
        stderr: String(error.stderr),
        summary,
      }
    }
  }

  it('writes the stale entries to the step summary and as warnings', () => {
    const tolerated = run('tolerated', ['--status', '1', '--report', STALE_ONLY])
    expect(tolerated.status).toBe(0)
    const summary = readFileSync(tolerated.summary, 'utf8')
    expect(summary).toContain(
      'Stale known differences of the previous MINOR (reported, not failed)'
    )
    expect(summary).toContain(`- \`${REDIRECTS}\``)
    expect(summary).toContain("removed only in the frontend's next release")
    expect(tolerated.stdout.split('\n')).toContain(
      `::warning title=Stale known difference::${REDIRECTS}`
    )

    const missing = run('missing', ['--status', '1', '--report', join(folder, 'missing.json')])
    expect(missing.status).toBe(1)
    expect(readFileSync(missing.summary, 'utf8')).toContain('missing or cannot be read')
    expect(missing.stdout).not.toContain('::warning')

    const passedFile = join(folder, 'passed.json')
    writeFileSync(passedFile, JSON.stringify(passedReport()))
    const passed = run('passed', ['--status', '0', '--report', passedFile])
    expect(passed.status).toBe(0)
    expect(existsSync(passed.summary)).toBe(false)

    expect(run('bad-status', ['--status', 'one', '--report', STALE_ONLY]).status).toBe(1)
    const noStatus = run('no-status', ['--report', STALE_ONLY])
    expect(noStatus.status).toBe(1)
    expect(noStatus.stderr).toContain('usage: previous-ref.mjs --status')

    // A workflow command ends at a line break and reads `%` as an escape, so an entry escapes them.
    const odd = staleOnly()
    const oddError = testNamed(odd, MOCK_SHAPE).results[0].errors[0]
    oddError.message = oddError.message.replace(REDIRECTS, '/api/x 100% off\\nnext')
    const oddFile = join(folder, 'odd.json')
    writeFileSync(oddFile, JSON.stringify(odd))
    const escaped = run('odd', ['--status', '1', '--report', oddFile])
    expect(escaped.status).toBe(0)
    expect(escaped.stdout.split('\n')).toContain(
      '::warning title=Stale known difference::/api/x 100%25 off%0Anext'
    )
  })
})
