/** Where the theme registry is read from and how its index is checked (micelio ADR 0008, section 4). */

/** The registry used when `MICELIO_THEME_REGISTRY` is not set. */
export const DEFAULT_THEME_REGISTRY = 'ghcr.io/bogd3v/micelio-themes'

/** The repository, under the registry, that holds the index. */
export const THEME_INDEX_REPOSITORY = 'index'

/** The tag of the index artifact: the version of its format. */
export const THEME_INDEX_TAG = 'v1'

/** Media type of the single layer of the index artifact. */
export const THEME_INDEX_MEDIA_TYPE = 'application/vnd.micelio.theme.index.v1+json'

/** Largest index read, in bytes, while streaming. */
export const THEME_INDEX_MAX_BYTES = 1024 * 1024

/** How long the index is kept before the registry is asked again. */
export const THEME_INDEX_TTL_MS = 5 * 60 * 1000

/** Milliseconds one request to the registry may take, body included. */
export const THEME_INDEX_TIMEOUT_MS = 10_000

/** The custom field (`global::theme-picker`) that `site.theme.themeId` uses. */
export const THEME_PICKER_FIELD = 'theme-picker'

/** The format of a theme id, as in micelio's `THEME_ID`. */
export const THEME_ID_PATTERN = /^(?=.{1,64}$)[a-z0-9]+(-[a-z0-9]+)*$/

/** The format of an exact theme version, as in micelio's `THEME_VERSION`: no range, no `latest`. */
export const THEME_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/

/** The format of a package digest: `sha256:` and 64 lowercase hex digits. */
export const THEME_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/

/** Longest version string accepted. */
export const THEME_VERSION_MAX_LENGTH = 128

/** Code of the admin role that may change the theme and read the picker (ADR 0009, "Who may change the theme"). */
export const SUPER_ADMIN_ROLE_CODE = 'strapi-super-admin'
