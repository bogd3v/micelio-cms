import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Bogd3v/micelio-cms#496: on the previous MINOR only, a run whose only failure is stale known differences of the frontend
// passes and shows them; latest and override keep the suite's own exit status.

const workflow = readFileSync(join(__dirname, '..', '.github', 'workflows', 'contract.yml'), 'utf8')

/** The text of each step of the workflow, keyed by its name. */
function steps(text: string): Map<string, string> {
  const found = new Map<string, string>()
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    const name = /^ {6}- name: (.+)$/.exec(line)?.[1]
    if (!name) return
    // A step is its `- name:` line and the lines indented under it; a blank line, a comment or the next job ends it.
    const body: string[] = []
    for (const next of lines.slice(index + 1)) {
      if (!next.startsWith(' '.repeat(8))) break
      body.push(next)
    }
    found.set(name.trim(), [line, ...body].join('\n'))
  })
  return found
}

const byName = steps(workflow)

describe('contract.yml', () => {
  it("runs latest and override with the suite's own exit status", () => {
    const step = byName.get('Run the contract suite')
    expect(step).toBeDefined()
    expect(step).toMatch(/^ {8}if: matrix\.label != 'previous'$/m)
    expect(step).toMatch(
      /^ {8}run: CONTRACT_CMS_IMAGE="\$\{CMS_IMAGE\}" CONTRACT_POSTGRES_IMAGE="\$\{POSTGRES_IMAGE\}" npm run test:contract$/m
    )
    expect(step).not.toMatch(/--reporter/)
    expect(step).not.toMatch(/previous-ref/)
  })

  it("hands only the previous ref's report to the classifier", () => {
    const step = byName.get('Run the contract suite (previous MINOR)')
    expect(step).toBeDefined()
    expect(step).toMatch(/^ {8}if: matrix\.label == 'previous'$/m)
    expect(step).toMatch(/^ {8}working-directory: frontend$/m)
    expect(step).toMatch(/POSTGRES_IMAGE: \$\{\{ steps\.postgres\.outputs\.image \}\}/)
    expect(step).toContain(
      'if CONTRACT_CMS_IMAGE="${CMS_IMAGE}" CONTRACT_POSTGRES_IMAGE="${POSTGRES_IMAGE}" PLAYWRIGHT_JSON_OUTPUT_FILE="${REPORT}" npm run test:contract -- --reporter=github,json; then status=0; else status=$?; fi'
    )
    expect(step).toContain(
      'node ../cms/scripts/contract/previous-ref.mjs --status "$status" --report "${REPORT}"'
    )

    const readers = [...byName].filter(([, text]) =>
      /previous-ref\.mjs|PLAYWRIGHT_JSON_OUTPUT_FILE/.test(text)
    )
    expect(readers.map(([name]) => name)).toEqual(['Run the contract suite (previous MINOR)'])
    expect(workflow).not.toMatch(/continue-on-error/)
  })
})
