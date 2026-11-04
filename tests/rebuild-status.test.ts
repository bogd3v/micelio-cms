import { afterEach, describe, expect, it } from '@jest/globals'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRebuildStatus, readLastRebuild } from '../src/utils/rebuild-status'

// The builder's last run (#405): scripts/builder-last-run.sh writes the file, the CMS parses it.
// The wrapper is run for real, around a fake builder that prints what the real one prints.

const SCRIPT = join(__dirname, '..', 'scripts', 'builder-last-run.sh')
const SECRET = 'sk-live-0123456789abcdef-never-in-the-admin'
// The probes of the review of round 2: values that are part of `[redacted]`, and a short one
const PROBES = { A_TOKEN: 'redacted', API_KEY: 'cted', REGISTRY_CREDENTIAL: 'ABC1234' }

const REASON =
  'Static theme: the theme the site settings name ("does-not-exist") was not used (unknown): the registry does not list it'
const FAILED =
  'micelio-builder: the generation failed; /out keeps the site it held before. The reason is the first error above ("Static theme: ..." when the theme the site settings name cannot be used).'

/** What the reader makes of `REASON`. */
const REFUSED = {
  code: 'theme-refused',
  rule: 'unknown',
  detail: null,
  httpStatus: null,
  seconds: null,
}
const UNKNOWN = { code: 'unknown', rule: null, detail: null, httpStatus: null, seconds: null }
const NAMED = 'Static theme: the theme the site settings name'

/** What the fake builder prints on stderr, after a line of Nuxt's own and a log prefix. */
const FAILING_STDERR = ['WARN  something Nuxt says first', ` ERROR  ${REASON}`, FAILED]

interface Run {
  code: number | null
  stdout: string
  stderr: string
}

describe('The builder wrapper and the last rebuild', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })
  async function workspace(): Promise<{ dir: string; status: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'rebuild-status-'))
    dirs.push(dir)
    return { dir, status: join(dir, 'last-run') }
  }
  /** Runs the wrapper around a shell snippet that stands for `micelio-builder generate`. */
  function wrap(builder: string, env: Record<string, string>, cwd: string): { done: Promise<Run> } {
    const child = spawn('sh', [SCRIPT, 'sh', '-c', builder], {
      cwd,
      env: { PATH: process.env.PATH ?? '', OUT_DIR: join(cwd, 'out'), ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const done = new Promise<Run>((resolve) =>
      child.once('close', (code) => resolve({ code, stdout, stderr }))
    )
    return { done }
  }
  /** Puts a site in the output directory the wrapper looks at, as a previous build left it. */
  async function publishedSite(dir: string): Promise<void> {
    await mkdir(join(dir, 'out'), { recursive: true })
    await writeFile(join(dir, 'out', 'index.html'), '<h1>site</h1>')
  }
  const printing = (lines: string[], code: number, extra = ''): string =>
    `${lines.map((line) => `echo ${JSON.stringify(line)} >&2`).join('\n')}\n${extra}\nexit ${code}`

  describe('the wrapper', () => {
    it('records a refused theme: the exit code, the time and the two kinds of line', async () => {
      const { dir, status } = await workspace()
      await publishedSite(dir)
      const run = await wrap(
        printing(FAILING_STDERR, 1, 'echo "stdout is not kept"'),
        { REBUILD_STATUS_FILE: status },
        dir
      ).done
      expect(run.code).toBe(1)
      expect(run.stderr).toContain(FAILED)
      expect(run.stdout).toContain('stdout is not kept')
      const text = await readFile(status, 'utf8')
      expect(text.split('\n')).toEqual([
        'exit=1',
        expect.stringMatching(/^finished=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
        'site_before=1',
        REASON,
        FAILED,
        '',
      ])
      expect(parseRebuildStatus(text)).toMatchObject({
        status: 'failed',
        reasons: [REFUSED],
        previousSiteKept: true,
      })
    })

    it('does not say a site is kept on a first build, when the output held none', async () => {
      const { dir, status } = await workspace()
      await mkdir(join(dir, 'out'))
      await wrap(printing(FAILING_STDERR, 1), { REBUILD_STATUS_FILE: status }, dir).done
      const text = await readFile(status, 'utf8')
      expect(text).toContain('site_before=0')
      expect(parseRebuildStatus(text)).toMatchObject({
        status: 'failed',
        reasons: [REFUSED],
        previousSiteKept: false,
      })
    })

    it('replaces a failure with the next good run', async () => {
      const { dir, status } = await workspace()
      await wrap(printing(FAILING_STDERR, 1), { REBUILD_STATUS_FILE: status }, dir).done
      expect(parseRebuildStatus(await readFile(status, 'utf8'))?.status).toBe('failed')

      const good = await wrap(
        'echo "micelio-builder: site written to /out"',
        { REBUILD_STATUS_FILE: status },
        dir
      ).done
      expect(good.code).toBe(0)
      expect(parseRebuildStatus(await readFile(status, 'utf8'))).toEqual({
        status: 'succeeded',
        finishedAt: expect.stringMatching(/Z$/),
        reasons: [],
        previousSiteKept: false,
      })
    })

    it('ends, keeps the exit code and shows nothing of a secret that is part of "[redacted]"', async () => {
      const { dir, status } = await workspace()
      const leaking = [
        `Static theme: the site settings could not be read from Strapi (${SECRET}), expected redacted`,
        `Static theme: the theme the site settings name ("does-not-exist") was not used (tier): ABC1234 ${SECRET}`,
        FAILED,
      ]
      const run = await Promise.race([
        wrap(
          printing(leaking, 1),
          { REBUILD_STATUS_FILE: status, NUXT_STRAPI_API_TOKEN: SECRET, ...PROBES },
          dir
        ).done,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('the wrapper hung')), 10_000)
        ),
      ])
      expect(run.code).toBe(1)
      const parsed = parseRebuildStatus(await readFile(status, 'utf8'))
      expect(parsed?.status).toBe('failed')
      expect(parsed?.reasons).toEqual([UNKNOWN, { ...REFUSED, rule: 'tier' }])
      for (const value of [SECRET, ...Object.values(PROBES)])
        expect(JSON.stringify(parsed)).not.toContain(value)
    }, 15_000)

    it('keeps the exit code of the builder when it cannot make a scratch directory', async () => {
      const { dir, status } = await workspace()
      const run = await wrap(
        'echo fine',
        { REBUILD_STATUS_FILE: status, TMPDIR: join(dir, 'does', 'not', 'exist') },
        dir
      ).done
      expect(run.code).toBe(0)
      expect(run.stdout).toContain('fine')
      await expect(readFile(status, 'utf8')).rejects.toThrow()
    })

    it('keeps the exit code of the builder and records it when it is not a refused theme', async () => {
      const { dir, status } = await workspace()
      const run = await wrap(
        printing(['micelio-builder: NUXT_PUBLIC_STRAPI_URL is required.'], 2),
        { REBUILD_STATUS_FILE: status },
        dir
      ).done
      expect(run.code).toBe(2)
      expect(parseRebuildStatus(await readFile(status, 'utf8'))).toMatchObject({
        status: 'failed',
        reasons: [],
        previousSiteKept: false,
      })
    })

    it('leaves the previous record in place while the builder is still running', async () => {
      const { dir, status } = await workspace()
      await wrap(printing(FAILING_STDERR, 1), { REBUILD_STATUS_FILE: status }, dir).done
      const release = join(dir, 'release')
      const started = join(dir, 'started')
      const running = wrap(
        `touch ${started}; while [ ! -f ${release} ]; do sleep 0.05; done`,
        { REBUILD_STATUS_FILE: status },
        dir
      )
      try {
        while (!existsSync(started)) await new Promise((resolve) => setTimeout(resolve, 20))
        expect(parseRebuildStatus(await readFile(status, 'utf8'))?.status).toBe('failed')
      } finally {
        await writeFile(release, '')
        await running.done
      }
      expect(parseRebuildStatus(await readFile(status, 'utf8'))?.status).toBe('succeeded')
    })

    it('just runs the builder when no status file is set', async () => {
      const { dir } = await workspace()
      const run = await wrap(printing(FAILING_STDERR, 1), {}, dir).done
      expect(run.code).toBe(1)
      expect(run.stderr).toContain(REASON)
    })
  })

  describe('the reader', () => {
    const file = (...lines: string[]): string => `${lines.join('\n')}\n`

    it('reads a failed run: the reasons, once each and cleaned, and that the site is kept', () => {
      const parsed = parseRebuildStatus(
        file('exit=1', 'finished=2026-11-03T10:00:00Z', 'site_before=1', REASON, REASON, FAILED)
      )
      expect(parsed).toEqual({
        status: 'failed',
        finishedAt: '2026-11-03T10:00:00Z',
        reasons: [REFUSED],
        previousSiteKept: true,
      })
    })

    it('does not say the site is kept unless the builder said so', () => {
      const parsed = parseRebuildStatus(file('exit=1', 'site_before=1', REASON))
      expect(parsed).toMatchObject({ reasons: [REFUSED], previousSiteKept: false })
    })

    it('does not say the site is kept when the output held none, whatever the builder said', () => {
      const parsed = parseRebuildStatus(file('exit=1', 'site_before=0', REASON, FAILED))
      expect(parsed).toMatchObject({ reasons: [REFUSED], previousSiteKept: false })
      expect(parseRebuildStatus(file('exit=1', REASON, FAILED))?.previousSiteKept).toBe(false)
    })

    it('reads a success without reasons, even if the file carries some', () => {
      expect(parseRebuildStatus(file('exit=0', 'finished=2026-11-03T10:00:00Z', REASON))).toEqual({
        status: 'succeeded',
        finishedAt: '2026-11-03T10:00:00Z',
        reasons: [],
        previousSiteKept: false,
      })
    })

    it('turns each known line into a code and a few checked values', () => {
      const lines = [
        `${NAMED} ("bogota") was not used (tier): the tier "community" of this theme is not installed here; this instance installs: official (MICELIO_THEME_TIERS)`,
        `${NAMED} (the default theme) was not used (limit): the install rate was reached`,
        'Static theme: the site settings could not be read from Strapi (HTTP 403), so the theme they name is unknown',
        'Static theme: the site settings could not be read from Strapi (ECONNREFUSED), so the theme they name is unknown',
        `${NAMED} ("starter") was not ready after 30 s`,
        'Static theme: site-setting.theme.themeId is not a string',
      ]
      const base = { rule: null, detail: null, httpStatus: null, seconds: null }
      const expected = [
        { ...base, code: 'theme-refused', rule: 'tier' },
        { ...base, code: 'theme-refused', rule: 'limit' },
        { ...base, code: 'settings-unreadable', httpStatus: 403 },
        { ...base, code: 'settings-unreadable' },
        { ...base, code: 'theme-not-ready', seconds: 30 },
        { ...base, code: 'settings-invalid' },
      ]
      // One line per run: a run shows five reasons at most
      expect(lines.map((line) => parseRebuildStatus(file('exit=1', line))?.reasons)).toEqual(
        expected.map((reason) => [reason])
      )
    })

    // Each reason of the switch's `pin` and `registry` rules that needs its own sentence (micelio
    // `server/lib/themeSwitch/switch.ts`): an id that is not valid, a pin that fails, a registry that
    // answered and refused (two fixed messages) and a registry that could not be read or refused
    // for another reason, whose text is free and so is not read
    it.each([
      [
        'an id that is not valid',
        `${NAMED} (a theme id that is not valid) was not used (pin): the pin in the site settings is not valid: the id has capitals`,
        'pin',
        'theme-id',
      ],
      [
        'a version or a digest with no id',
        `${NAMED} (a version or a digest with no theme id) was not used (pin): the pin in the site settings is not valid: themeVersion and themeDigest need a themeId`,
        'pin',
        'theme-id',
      ],
      [
        'a pin that fails for a valid id',
        `${NAMED} ("starter") was not used (pin): the pin in the site settings is not valid: the digest is not sha256`,
        'pin',
        null,
      ],
      [
        'an id that is not valid, in words of another message',
        `${NAMED} (a theme id that is not valid) was not used (pin): something else`,
        'pin',
        null,
      ],
      [
        'a registry that answered: not listed',
        `${NAMED} ("starter") was not used (registry): the registry index does not list this version with this digest`,
        'registry',
        'not-listed',
      ],
      [
        'a registry that answered: public themes only',
        `${NAMED} ("starter") was not used (registry): only public themes are installed by a server`,
        'registry',
        'not-public',
      ],
      [
        'a registry that could not be reached',
        `${NAMED} ("starter") was not used (registry): ghcr.io/x/starter/manifests/1: fetch failed ${SECRET}`,
        'registry',
        null,
      ],
      [
        'a registry message that is a property of every object',
        `${NAMED} ("starter") was not used (registry): constructor`,
        'registry',
        null,
      ],
    ])('tells %s', (_name, line, rule, detail) => {
      const parsed = parseRebuildStatus(file('exit=1', line))
      expect(parsed?.reasons).toEqual([{ ...REFUSED, rule, detail }])
      expect(JSON.stringify(parsed)).not.toContain(SECRET)
    })

    it('passes on nothing the builder printed: a line that does not parse is "unknown"', () => {
      const parsed = parseRebuildStatus(
        file(
          'exit=1',
          `NUXT_STRAPI_API_TOKEN=${SECRET}`,
          `Static theme: could not read /app/themes.lock.json with token=${SECRET} and Bearer xyz`,
          'Static theme: file:///app/.nuxt/x.mjs at https://u:pw123@registry.test/themes\u0007',
          `Static theme: the site settings could not be read from Strapi (${SECRET}), so the theme they name is unknown`,
          'Static theme: the theme the site settings name ("ABC1234") was not used (tier): x',
          'Static theme: the theme the site settings name ("a b") was not ready after 3 s',
          'Static theme: the theme the site settings name ("x") was not used (bogus): x',
          `Static theme: the theme the site settings name ("${'a'.repeat(65)}") was not used (pin): x`,
          'site_before=1',
          FAILED
        )
      )
      // A quoted id that is not a valid id (capitals, a space, 65 characters) is not a line it knows
      expect(parsed?.reasons).toEqual([UNKNOWN])
      expect(JSON.stringify(parsed)).not.toMatch(
        /sk-live|app|xyz|pw123|ABC1234|\/out|registry\.test/
      )
    })

    it('shows no theme id, whatever the quoted slot holds, and the probes do not reach it', async () => {
      const { dir, status } = await workspace()
      const lines = [
        `${NAMED} ("redacted") was not used (unknown): x`,
        `${NAMED} ("cted") was not ready after 30 s`,
        `${NAMED} ("${'f'.repeat(64)}") was not used (tier): x`,
        FAILED,
      ]
      const run = await Promise.race([
        wrap(printing(lines, 1), { REBUILD_STATUS_FILE: status, ...PROBES }, dir).done,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('the wrapper hung')), 10_000)
        ),
      ])
      expect(run.code).toBe(1)
      const parsed = parseRebuildStatus(await readFile(status, 'utf8'))
      expect(parsed?.reasons).toEqual([
        REFUSED,
        { ...UNKNOWN, code: 'theme-not-ready', seconds: 30 },
        { ...REFUSED, rule: 'tier' },
      ])
      expect(parsed?.reasons.every((reason) => !('theme' in reason))).toBe(true)
      for (const value of ['redacted', 'cted', 'f'.repeat(64)])
        expect(JSON.stringify(parsed)).not.toContain(value)
    }, 15_000)

    it('shows a real refusal without the text the switch wrote after the rule', () => {
      const parsed = parseRebuildStatus(
        file(
          'exit=1',
          `${REASON.replace('the registry does not list it', `${SECRET} ABC1234 /app/x`)}`
        )
      )
      expect(parsed?.reasons).toEqual([REFUSED])
      expect(JSON.stringify(parsed)).not.toMatch(/sk-live|ABC1234|\/app/)
    })

    it('strips colour sequences before matching, and answers a very long line at once', () => {
      const coloured =
        'Static theme: the theme the site settings name ("starter") was not ready after 30 s\u001b[39m'
      expect(parseRebuildStatus(file('exit=1', coloured))?.reasons).toEqual([
        { ...UNKNOWN, code: 'theme-not-ready', seconds: 30 },
      ])
      const started = Date.now()
      const long = parseRebuildStatus(file('exit=1', `Static theme: ${'(" '.repeat(5000)}`))
      expect(long?.reasons).toEqual([UNKNOWN])
      expect(Date.now() - started).toBeLessThan(1000)
    })

    it('caps the number of reasons and shows a repeated one once', () => {
      const many = Array.from(
        { length: 9 },
        (_, i) =>
          `Static theme: the theme the site settings name ("starter") was not ready after ${i + 1} s`
      )
      expect(parseRebuildStatus(file('exit=1', ...many))?.reasons).toHaveLength(5)
      expect(parseRebuildStatus(file('exit=1', many[0], many[0]))?.reasons).toHaveLength(1)
    })

    it('answers null for text that is not a status file, and null time for a bad time', () => {
      expect(parseRebuildStatus('')).toBeNull()
      expect(parseRebuildStatus('Static theme: no exit line')).toBeNull()
      expect(parseRebuildStatus('exit=abc')).toBeNull()
      expect(parseRebuildStatus(file('exit=0', 'finished=yesterday'))?.finishedAt).toBeNull()
    })

    it('reads the file, answers null when there is none, and reads only the first 16 KiB', async () => {
      const { dir, status } = await workspace()
      await expect(readLastRebuild(status)).resolves.toBeNull()
      await expect(readLastRebuild('')).resolves.toBeNull()
      await writeFile(
        status,
        `exit=1\nfinished=2026-11-03T10:00:00Z\n${'#'.repeat(40_000)}\n${REASON}\n`
      )
      await expect(readLastRebuild(status)).resolves.toMatchObject({
        status: 'failed',
        reasons: [],
      })
      await expect(readLastRebuild(dir)).rejects.toThrow()
    })

    it('refuses a file that is not a status file, a link and a pipe instead of waiting on them', async () => {
      const { dir, status } = await workspace()
      await writeFile(status, 'something else\n')
      await expect(readLastRebuild(status)).rejects.toMatchObject({ code: 'ENOTSTATUS' })

      const real = join(dir, 'real')
      await writeFile(real, 'exit=0\n')
      const link = join(dir, 'link')
      await symlink(real, link)
      await expect(readLastRebuild(link)).rejects.toMatchObject({ code: 'ELOOP' })

      const pipe = join(dir, 'pipe')
      execFileSync('mkfifo', [pipe])
      await expect(readLastRebuild(pipe)).rejects.toMatchObject({ code: 'ENOTFILE' })
    })
  })

  // Every sentence the admin builds (`LastRebuild.tsx`) is in both locales, with no key in one only
  it('has the same last-rebuild sentences in both locales, one for each rule and detail', async () => {
    const keys = async (locale: string): Promise<string[]> => {
      const messages = JSON.parse(
        await readFile(
          join(__dirname, '..', 'src', 'admin', 'translations', `${locale}.json`),
          'utf8'
        )
      ) as Record<string, string>
      return Object.keys(messages)
        .filter((key) => key.startsWith('micelio.lastRebuild.'))
        .sort()
    }
    const wanted = [
      ...['pin', 'unknown', 'code', 'off', 'tier', 'limit', 'registry', 'install', 'integrity'],
      'pin.theme-id',
      'registry.not-listed',
      'registry.not-public',
    ].map((rule) => `micelio.lastRebuild.rule.${rule}`)
    const en = await keys('en')
    expect(await keys('es')).toEqual(en)
    for (const key of wanted) expect(en).toContain(key)
    expect(en).not.toContain('micelio.lastRebuild.reason.refusedTheme')
  })
})
