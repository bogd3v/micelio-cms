// Decides the outcome of `Contract Tests (previous)` in `.github/workflows/contract.yml` from the exit status of the frontend's
// `npm run test:contract` and its Playwright JSON report. A run whose only failure is the frontend's check of stale known
// differences (`e2e/contract/mock-shape.spec.ts`: entries of `KNOWN_DIFFERENCES` that no longer show) passes and shows them,
// because the previous MINOR is a released tag that cannot change; any other failure fails. Docs: docs/architecture/ci-pipeline.md,
// "Contract tests: `contract.yml`". Node built-ins only: the job installs nothing in the CMS checkout.
//
//   node ../cms/scripts/contract/previous-ref.mjs --status "$status" --report <Playwright JSON report>
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

/** The title of the frontend's test that compares its mock Strapi with the CMS. */
const MOCK_SHAPE_TEST = 'the mock Strapi answers with the shapes of the real CMS'

/** How the message of the frontend's stale check starts, ANSI codes removed. */
const STALE_MESSAGE = 'Error: known differences that no longer show'

/** The heading of the step summary on a tolerated run. */
const TOLERATED_HEADING = 'Stale known differences of the previous MINOR (reported, not failed)'

// The colour and style codes Playwright puts in an error message (CSI sequences).
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

// A `Received` line of Jest's array diff: `+   "<entry>",`.
const RECEIVED_ENTRY = /^\+\s+("(?:[^"\\]|\\.)*"),?$/

/**
 * Classifies a run of the frontend's contract suite on the previous MINOR.
 *
 * `passed`: status `0`, no global error and no unexpected test. `tolerated`: a non-zero status whose only cause is the
 * mock-shape test failing on its stale check; `stale` lists the entries. `failed`: anything else, a missing or unreadable
 * report included; `reason` says what was found.
 *
 * @param {{ status: number, report: string | null | undefined }} run the exit status of `npm run test:contract`, and the
 *   text of its Playwright JSON report (`null` or `undefined` when there is none or it cannot be read)
 * @returns {{ outcome: 'passed' | 'tolerated' | 'failed', stale: string[], reason: string }} the outcome of the job
 */
export function classifyPreviousRun({ status, report }) {
  if (!Number.isInteger(status)) return failed(`the exit status is not a number: ${String(status)}`)
  if (report === null || report === undefined || report === '') {
    return failed(
      `the Playwright JSON report is missing or cannot be read (exit status ${status}): the suite did not run, for example because the CMS did not start or the build broke`
    )
  }
  let parsed
  try {
    parsed = JSON.parse(report)
  } catch (error) {
    return failed(`the Playwright JSON report is not valid JSON: ${messageOf(error)}`)
  }
  if (!isObject(parsed) || !Array.isArray(parsed.suites)) {
    return failed('the Playwright JSON report has no `suites`: it is not a Playwright JSON report')
  }
  const globalErrors = parsed.errors ?? []
  if (!Array.isArray(globalErrors)) {
    return failed('the Playwright JSON report has an `errors` that is not a list')
  }
  if (globalErrors.length > 0) {
    return failed(
      `the report has ${globalErrors.length} global error(s): ${globalErrors.map(firstLineOf).join('; ')}`
    )
  }

  const unexpected = testsOf(parsed.suites).filter((test) => test.status === 'unexpected')
  if (status === 0) {
    if (unexpected.length === 0) return { outcome: 'passed', stale: [], reason: '' }
    return failed(
      `the exit status is 0 but ${unexpected.length} test(s) failed: ${titles(unexpected)}`
    )
  }
  if (unexpected.length === 0) {
    return failed(`the exit status is ${status} and no test failed`)
  }
  if (unexpected.length > 1) {
    return failed(`${unexpected.length} tests failed: ${titles(unexpected)}`)
  }
  const [test] = unexpected
  if (test.title !== MOCK_SHAPE_TEST) return failed(`a test failed: ${titles(unexpected)}`)
  const errors = test.errors
  if (errors.length !== 1) {
    return failed(`the test "${MOCK_SHAPE_TEST}" failed with ${errors.length} errors`)
  }
  const message = stripAnsi(errors[0])
  if (!message.startsWith(STALE_MESSAGE)) {
    return failed(`the test "${MOCK_SHAPE_TEST}" failed on another check: ${firstLineOf(message)}`)
  }
  const stale = receivedEntries(message)
  if (stale.length === 0) {
    return failed(`the stale check of "${MOCK_SHAPE_TEST}" failed but lists no entry`)
  }
  return { outcome: 'tolerated', stale, reason: '' }
}

/**
 * The step summary of an outcome, in Markdown; empty on `passed`.
 *
 * @param {{ outcome: 'passed' | 'tolerated' | 'failed', stale: string[], reason: string }} result the result of `classifyPreviousRun`
 * @returns {string} the text to append to `$GITHUB_STEP_SUMMARY`
 */
function stepSummary(result) {
  if (result.outcome === 'tolerated') {
    return [
      `### ${TOLERATED_HEADING}`,
      '',
      "These entries of the frontend's `KNOWN_DIFFERENCES` no longer show against this CMS: it now answers better than that frontend expected, which does not break the contract.",
      "The previous MINOR is a released tag and never changes, so each entry is removed only in the frontend's next release. Any other failure of the suite still fails this job.",
      '',
      ...result.stale.map((entry) => `- \`${entry}\``),
      '',
    ].join('\n')
  }
  if (result.outcome === 'failed') {
    return ['### Contract suite of the previous MINOR failed', '', result.reason, ''].join('\n')
  }
  return ''
}

/**
 * The `::warning` workflow command of each stale entry, one per line.
 *
 * @param {string[]} stale the stale entries of a tolerated run
 * @returns {string[]} the lines to print
 */
function staleWarnings(stale) {
  return stale.map((entry) => `::warning title=Stale known difference::${escapeData(entry)}`)
}

/**
 * Runs the classifier from the command line: reads `--status` and `--report`, writes the step summary when
 * `$GITHUB_STEP_SUMMARY` is set, prints the warnings, and answers the exit code.
 *
 * @param {string[]} args the command-line arguments after the script
 * @param {Record<string, string | undefined>} environment the process environment
 * @returns {number} `0` on `passed` and `tolerated`, `1` on `failed`
 */
function main(args, environment) {
  let values
  try {
    ;({ values } = parseArgs({
      args,
      options: { status: { type: 'string' }, report: { type: 'string' } },
      strict: true,
    }))
  } catch (error) {
    console.error(`previous-ref: ${messageOf(error)}`)
    return 1
  }
  if (values.status === undefined || values.report === undefined) {
    console.error(
      'previous-ref: usage: previous-ref.mjs --status <exit status> --report <Playwright JSON report>'
    )
    return 1
  }
  const status = /^\d+$/.test(values.status) ? Number(values.status) : Number.NaN
  const result = classifyPreviousRun({ status, report: readReport(values.report) })

  const summary = stepSummary(result)
  if (summary && environment.GITHUB_STEP_SUMMARY) {
    appendFileSync(environment.GITHUB_STEP_SUMMARY, summary)
  }
  if (result.outcome === 'tolerated') {
    console.log(`previous-ref: tolerated, ${result.stale.length} stale known difference(s)`)
    for (const line of staleWarnings(result.stale)) console.log(line)
    return 0
  }
  if (result.outcome === 'passed') {
    console.log('previous-ref: passed')
    return 0
  }
  console.error(`previous-ref: failed: ${result.reason}`)
  return 1
}

// The text of the report, or `null` when the file is missing or cannot be read: either way the suite gave no answer.
function readReport(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

// Every test of the report, with its title, status and error messages, through nested suites.
function testsOf(suites) {
  const found = []
  for (const suite of suites) {
    if (!isObject(suite)) continue
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      if (!isObject(spec)) continue
      for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
        if (!isObject(test)) continue
        const results = Array.isArray(test.results) ? test.results : []
        const errors = results.flatMap((result) =>
          isObject(result) && Array.isArray(result.errors)
            ? result.errors.map(messageOfReportError)
            : []
        )
        found.push({ title: String(spec.title), status: test.status, errors })
      }
    }
    if (Array.isArray(suite.suites)) found.push(...testsOf(suite.suites))
  }
  return found
}

// The entries of the `Received` lines of a Jest array diff.
function receivedEntries(message) {
  const entries = []
  for (const line of message.split('\n')) {
    const match = RECEIVED_ENTRY.exec(line.trim())
    if (!match) continue
    try {
      entries.push(JSON.parse(match[1]))
    } catch {
      // Not a JSON string literal, so not an entry of the list: the line is skipped, and an empty list fails the run.
    }
  }
  return entries
}

function failed(reason) {
  return { outcome: 'failed', stale: [], reason }
}

function titles(tests) {
  return tests.map((test) => `"${test.title}"`).join(', ')
}

function messageOfReportError(error) {
  return isObject(error) && typeof error.message === 'string' ? error.message : ''
}

function firstLineOf(error) {
  const text = typeof error === 'string' ? error : messageOfReportError(error)
  return stripAnsi(text).split('\n')[0].trim() || '(no message)'
}

function stripAnsi(text) {
  return text.replace(ANSI, '')
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// A workflow command's data escapes `%`, CR and LF.
function escapeData(text) {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2), process.env)
}
