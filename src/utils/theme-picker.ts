import type {
  ThemeChoice,
  ThemeIndex,
  ThemeIndexVersion,
  ThemePickerModel,
  ThemePin,
  ThemeStatus,
} from '../types/theme-registry'

/** Splits an exact version into its numbers; `null` for a prerelease, which is never offered. */
function releaseNumbers(version: string): [number, number, number] | null {
  if (version.includes('-')) return null
  const [major, minor, patch] = version.split('.').map(Number)
  return [major!, minor!, patch!]
}

/** Orders two exact release versions; negative when `a` is older. */
function compareReleases(a: string, b: string): number {
  const left = releaseNumbers(a)
  const right = releaseNumbers(b)
  if (!left || !right) return 0
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

/** Whether the picker may offer the version: published, public and not a prerelease. */
const isOffered = (version: string, entry: ThemeIndexVersion): boolean =>
  entry.status === 'published' &&
  entry.distribution === 'public' &&
  releaseNumbers(version) !== null

/** Own-key lookup, so an id such as `constructor` is not found unless the index lists it. */
const has = (record: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const contractMajor = (contract: string): string => contract.split('.')[0]!

/**
 * Builds what the theme picker shows (micelio-cms#97, ADR 0009 section 4).
 *
 * @remarks
 * Each theme is listed at its highest published public version. With a `status` (micelio#403), a
 * code theme the running image was not built with is marked unavailable, with the reason; with no
 * status every theme is available and the status part is `null`. `update` is the highest newer
 * version of the pinned theme with the same contract major as the pinned version: moving to it is
 * the admin's choice, nothing is applied here. A `null` index (the registry could not be read)
 * gives `indexAvailable: false`, and the field falls back to free text.
 */
export function buildThemePicker(
  index: ThemeIndex | null,
  status: ThemeStatus | null,
  pin: ThemePin = {}
): ThemePickerModel {
  const model: ThemePickerModel = {
    indexAvailable: index !== null,
    themes: [],
    update: null,
    status: status ? { active: status.active ?? null, lastError: status.lastError ?? null } : null,
  }
  if (!index) return model

  for (const [id, theme] of Object.entries(index.themes)) {
    const offered = Object.entries(theme.versions)
      .filter(([version, entry]) => isOffered(version, entry))
      .sort(([a], [b]) => compareReleases(b, a))
    const top = offered[0]
    if (!top) continue
    const [version, entry] = top
    const missing = status !== null && entry.code && !status.builtInCodeThemes.includes(id)
    const choice: ThemeChoice = {
      id,
      version,
      digest: entry.digest,
      contract: entry.contract,
      tier: entry.tier,
      origin: entry.tier === 'official' ? 'official' : 'community',
      code: entry.code,
      report: entry.report ?? null,
      available: !missing,
      unavailableReason: missing ? 'not-in-image' : null,
    }
    model.themes.push(choice)
  }
  model.themes.sort((a, b) => a.id.localeCompare(b.id))

  const versions = pin.id && has(index.themes, pin.id) ? index.themes[pin.id]!.versions : undefined
  const pinned =
    versions && pin.version && has(versions, pin.version) ? versions[pin.version] : undefined
  if (versions && pin.version && pinned) {
    const newer = Object.entries(versions)
      .filter(
        ([version, entry]) =>
          isOffered(version, entry) &&
          contractMajor(entry.contract) === contractMajor(pinned.contract) &&
          compareReleases(version, pin.version!) > 0
      )
      .sort(([a], [b]) => compareReleases(b, a))[0]
    if (newer) model.update = { version: newer[0], digest: newer[1].digest }
  }
  return model
}

/**
 * The frontend's theme status, or `null` while it reports none.
 *
 * @remarks
 * Nothing reports a status yet: micelio#403 defines it and turns this on. Until then the picker
 * hides its status part.
 */
export function readThemeStatus(): ThemeStatus | null {
  return null
}
