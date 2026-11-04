/** Why the builder refused a theme, as the switch names it (micelio `ThemeSwitchRule`). */
export type RebuildThemeRule =
  'pin' | 'unknown' | 'code' | 'off' | 'tier' | 'limit' | 'registry' | 'install' | 'integrity'

/**
 * What the switch's own message adds to a rule, when that message is on the fixed list the reader
 * knows: an id that is not valid or missing (`theme-id`, for `pin`), or a registry that does not
 * list the version with this digest (`not-listed`) or lists the theme as not public, which a server
 * does not install (`not-public`, both for `registry`).
 */
export type RebuildReasonDetail = 'theme-id' | 'not-listed' | 'not-public'

/**
 * Why a rebuild failed, as a code from a closed list. `unknown` is any line the reader could not
 * match, and the admin then sends the reader to the builder's log.
 */
type RebuildReasonCode =
  'settings-unreadable' | 'settings-invalid' | 'theme-refused' | 'theme-not-ready' | 'unknown'

/** One reason a rebuild failed: values the reader parsed, never text the builder printed. */
export interface RebuildReason {
  code: RebuildReasonCode
  /** The switch's rule, for `theme-refused`. */
  rule: RebuildThemeRule | null
  /** What the switch's message adds to the rule, for `theme-refused`, when it is a known one. */
  detail: RebuildReasonDetail | null
  /** The HTTP status Strapi answered, for `settings-unreadable`. */
  httpStatus: number | null
  /** The seconds waited, for `theme-not-ready`. */
  seconds: number | null
}

/** The last run of the static builder, as the admin reads it (#405). */
export interface LastRebuild {
  /** `failed` for any exit code but 0. */
  status: 'succeeded' | 'failed'
  /** When the run ended (ISO 8601, UTC), or `null` when the file gives no valid time. */
  finishedAt: string | null
  /** Why a failed run failed, at most five. Empty when the builder gave no `Static theme:` line. */
  reasons: RebuildReason[]
  /**
   * Whether the builder said that the output volume keeps the site generated before, and a site
   * was there before the run. Kept in the volume is not served: see `demo-instances.md`.
   */
  previousSiteKept: boolean
}

/** What `GET /theme-picker/last-rebuild` answers. */
export interface LastRebuildModel {
  /** False when `REBUILD_STATUS_FILE` is not set: the instance records no builder runs. */
  configured: boolean
  /** `null` when the builder has not run yet or the file cannot be read. */
  lastRebuild: LastRebuild | null
  /** True when the status file exists but cannot be read or is not a status file. */
  unreadable: boolean
}
