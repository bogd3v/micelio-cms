import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type {
  LastRebuild,
  RebuildReason,
  RebuildReasonDetail,
  RebuildThemeRule,
} from '../types/rebuild-status'

/** Largest part of the status file that is read, in bytes. */
const STATUS_MAX_BYTES = 16 * 1024
/** Most reasons shown for a failed rebuild. */
const REASON_MAX_LINES = 5
/** Start of the line in which the builder says why a theme could not be used (micelio#315). */
const REASON_PREFIX = 'Static theme: '
/** Start of the line in which the builder says that the generation failed. */
const FAILED_PREFIX = 'micelio-builder: the generation failed; '
/** Part of that line that says the output volume still holds the site generated before. */
const KEPT_MARKER = 'keeps the site it held before'

const EXIT_LINE = /^exit=(\d{1,3})$/
const FINISHED_LINE = /^finished=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/
const SITE_BEFORE_LINE = /^site_before=([01])$/
const ANSI_SEQUENCE = /\x1b\[[0-9;]*[A-Za-z]/g

// The shapes of the builder's `Static theme:` lines (micelio `modules/theme/static-theme.ts`), each
// matched whole. A capture is a number, a rule of the closed list or a fixed phrase; the free text
// of a line (the switch's message) is matched, and only compared with the fixed messages below.
const SETTINGS_UNREADABLE =
  /^Static theme: the site settings could not be read from Strapi \((?:HTTP (\d{3})|[A-Z][A-Z0-9_]{0,39}|the request failed)\), so the theme they name is unknown$/
const SETTINGS_INVALID =
  /^Static theme: (?:Strapi did not answer with the site settings, so the theme they name is unknown|site-setting\.theme is not an object|site-setting\.theme\.(?:themeId|themeVersion|themeDigest) is not a string)$/
// What the builder calls the theme: a quoted id is matched with the id rule of micelio
// `modules/theme/constants.ts` (`THEME_ID`: 1 to 64 characters, lowercase letters and digits in
// groups split by single hyphens) but never captured, so no id reaches the admin. The two phrases
// that say the id is missing or not valid are captured, to tell `theme-id` from the rest of `pin`.
const THEME_NAMED =
  '(the default theme|a version or a digest with no theme id|a theme id that is not valid|"(?=[^"]{1,64}")[a-z0-9]+(?:-[a-z0-9]+)*")'
const THEME_REFUSED = new RegExp(
  `^Static theme: the theme the site settings name \\(${THEME_NAMED}\\) was not used \\((pin|unknown|code|off|tier|limit|registry|install|integrity)\\): (.*)$`
)
const THEME_NOT_READY = new RegExp(
  `^Static theme: the theme the site settings name \\(${THEME_NAMED}\\) was not ready after (\\d{1,6}) s$`
)
/** The phrases of `describe` that mean the id in the site settings is missing or not valid. */
const ID_NOT_VALID = ['a version or a digest with no theme id', 'a theme id that is not valid']
/** Start of the switch's message for an invalid pin; what follows it (the pin's problem) is dropped. */
const PIN_NOT_VALID = 'the pin in the site settings is not valid: '
/** The switch's `registry` messages for a version the registry does not list, or lists as not public. */
const REGISTRY_ANSWERED = new Map<string, RebuildReasonDetail>([
  ['the registry index does not list this version with this digest', 'not-listed'],
  ['only public themes are installed by a server', 'not-public'],
])

const NOTHING = { rule: null, detail: null, httpStatus: null, seconds: null }

function detailOf(
  rule: RebuildThemeRule,
  named: string,
  message: string
): RebuildReasonDetail | null {
  if (rule === 'pin') {
    return ID_NOT_VALID.includes(named) && message.startsWith(PIN_NOT_VALID) ? 'theme-id' : null
  }
  return rule === 'registry' ? (REGISTRY_ANSWERED.get(message) ?? null) : null
}

/**
 * Turns one `Static theme:` line into a reason of the closed list. The result holds only parsed
 * values, so nothing the builder printed reaches the admin as written; a line of another shape is
 * `unknown`.
 */
function parseReason(line: string): RebuildReason {
  const text = line.replace(ANSI_SEQUENCE, '').trim()
  const unreadable = SETTINGS_UNREADABLE.exec(text)
  if (unreadable) {
    const status = unreadable[1] === undefined ? null : Number(unreadable[1])
    return { ...NOTHING, code: 'settings-unreadable', httpStatus: status }
  }
  if (SETTINGS_INVALID.test(text)) return { ...NOTHING, code: 'settings-invalid' }
  const refused = THEME_REFUSED.exec(text)
  if (refused) {
    const rule = refused[2] as RebuildThemeRule
    return {
      ...NOTHING,
      code: 'theme-refused',
      rule,
      detail: detailOf(rule, refused[1], refused[3]),
    }
  }
  const notReady = THEME_NOT_READY.exec(text)
  if (notReady) {
    return { ...NOTHING, code: 'theme-not-ready', seconds: Number(notReady[2]) }
  }
  return { ...NOTHING, code: 'unknown' }
}

/**
 * Reads the status file the builder wrapper writes (`scripts/builder-last-run.sh`): `exit=` and
 * `finished=` lines, then the lines of the builder's stderr it kept.
 *
 * @remarks
 * Only two kinds of line are used. Those that start with `Static theme: ` become reasons, each
 * parsed into a code of a closed list with values that are numbers or members of a list (one of
 * the switch's rules, a detail of a fixed message): the text of the line, the theme id included, is
 * never passed on, and a line of
 * another shape is the `unknown` reason. The builder's "generation failed" line only decides
 * `previousSiteKept`, since it names the output path, and only together with `site_before=1`,
 * which the wrapper writes when the output held a site. Every other line is ignored. Returns
 * `null` when the text has no valid `exit=` line.
 */
export function parseRebuildStatus(text: string): LastRebuild | null {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''))
  const exit = lines.map((line) => EXIT_LINE.exec(line)).find((match) => match !== null)
  if (!exit) return null
  const failed = Number(exit[1]) !== 0
  const finishedAt =
    lines.map((line) => FINISHED_LINE.exec(line)).find((match) => match !== null)?.[1] ?? null

  const reasons: RebuildReason[] = []
  if (failed) {
    for (const line of lines) {
      if (!line.startsWith(REASON_PREFIX)) continue
      const reason = parseReason(line)
      if (!reasons.some((found) => JSON.stringify(found) === JSON.stringify(reason)))
        reasons.push(reason)
      if (reasons.length === REASON_MAX_LINES) break
    }
  }
  const siteBefore = lines.some((line) => SITE_BEFORE_LINE.exec(line)?.[1] === '1')
  const previousSiteKept =
    failed &&
    siteBefore &&
    lines.some((line) => line.startsWith(FAILED_PREFIX) && line.includes(KEPT_MARKER))
  return { status: failed ? 'failed' : 'succeeded', finishedAt, reasons, previousSiteKept }
}

/**
 * The builder's last run, from the file `REBUILD_STATUS_FILE` names; `null` when the builder has
 * not run yet (no file) or no file is configured.
 *
 * @param file - The path to read; defaults to `REBUILD_STATUS_FILE`.
 * @throws When the file exists but is not a regular status file or cannot be read (`ENOTFILE`,
 * `ENOTSTATUS` or the system's code), so the caller can log the cause and say it is unreadable.
 */
export async function readLastRebuild(
  file: string = process.env.REBUILD_STATUS_FILE ?? ''
): Promise<LastRebuild | null> {
  if (!file) return null
  let handle
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    if (!(await handle.stat()).isFile())
      throw Object.assign(new Error('not a regular file'), { code: 'ENOTFILE' })
    const buffer = Buffer.alloc(STATUS_MAX_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const parsed = parseRebuildStatus(buffer.toString('utf8', 0, bytesRead))
    if (!parsed) throw Object.assign(new Error('not a status file'), { code: 'ENOTSTATUS' })
    return parsed
  } finally {
    await handle.close()
  }
}
