/** The registry index and the picker model built from it (micelio ADR 0008 section 4, ADR 0009). */

/** Who stands behind a version. */
export type ThemeTier = 'official' | 'verified' | 'community'

/** One version of a theme in the index. */
export interface ThemeIndexVersion {
  /** The `sha256:` digest of the package; the pin the site stores. */
  digest: string
  /** The theme contract the version declares, as `major.minor`. */
  contract: string
  tier: ThemeTier
  distribution: 'public' | 'licensed'
  status: 'published' | 'yanked' | 'incompatible'
  /** Whether the package ships `slots/` or `templates/`, which only an image built with it can run. */
  code: boolean
  /** The digest of the admission report attached to the package. */
  report?: string
}

/** The index of the registry: `themes[id].versions[version]`. */
export interface ThemeIndex {
  themes: Record<string, { versions: Record<string, ThemeIndexVersion> }>
}

/**
 * What the frontend reports about the themes it can run (micelio#403, not shipped yet).
 * The picker shows the status part only when this exists.
 */
export interface ThemeStatus {
  /** The theme the frontend renders now. */
  active?: { id: string; version: string }
  /** The last error the frontend had activating a theme, without paths. */
  lastError?: string
  /** Ids of the code themes the running image was built with. */
  builtInCodeThemes: string[]
}

/** The version a site has pinned, as the form holds it. */
export interface ThemePin {
  id?: string | null
  version?: string | null
}

/** A theme offered by the picker, at its highest version this site can take. */
export interface ThemeChoice {
  id: string
  version: string
  digest: string
  contract: string
  tier: ThemeTier
  /** `official` or `community` for the admin; `verified` counts as community. */
  origin: 'official' | 'community'
  code: boolean
  /** The admission report digest, when the index has one. */
  report: string | null
  available: boolean
  /** Why it cannot be activated, only when `available` is false. */
  unavailableReason: 'not-in-image' | null
}

/** What the admin route answers. */
export interface ThemePickerModel {
  /** False when the registry could not be read: the field is a free text. */
  indexAvailable: boolean
  themes: ThemeChoice[]
  /** The newer compatible version of the pinned theme, when there is one. */
  update: { version: string; digest: string } | null
  /** Present only when the frontend reports a status. */
  status: { active: ThemeStatus['active'] | null; lastError: string | null } | null
}
