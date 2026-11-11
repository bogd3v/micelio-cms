import type { Core } from '@strapi/strapi'
import {
  THEME_DIGEST_PATTERN,
  THEME_PICKER_FIELD,
  THEME_VERSION_MAX_LENGTH,
  THEME_VERSION_PATTERN,
} from '../constants/theme-registry'

/** The core's component for the theme of a site (`@micelio/strapi-plugin-core` registers it, category `micelio-site`). */
const THEME_COMPONENT = 'micelio-site.theme'

type Attribute = Record<string, unknown>

interface ThemeComponent {
  attributes: Record<string, Attribute | undefined>
  __schema__?: { attributes?: Record<string, Attribute | undefined> }
}

/**
 * Gives the site's theme the rules the single type's theme had: the picker as the input of
 * `themeId` (`global::theme-picker`), and the exact pin (a version without a range, a
 * `sha256:` digest).
 *
 * @remarks
 * The theme of the single type `api::site-setting` came from the host's own `site.theme`
 * component. The site's theme is the core's `micelio-site.theme`, whose `themeId` is a plain
 * string and whose `themeVersion` and `themeDigest` accept any text, so the host sets the
 * attributes while it registers (the Document Service validates against them at run time).
 * `themeId` becomes a custom field: Strapi turns it into its underlying type once every `register`
 * has run. Does nothing for an attribute the core's component lacks (an older core), and must run
 * in `register`, before the admin reads the schemas.
 */
export function applyThemeRulesToSite(strapi: Core.Strapi): void {
  const component = (strapi.components as unknown as Record<string, ThemeComponent | undefined>)[
    THEME_COMPONENT
  ]
  if (!component) return
  const rules: Record<string, Attribute> = {
    themeId: { type: 'customField', customField: `global::${THEME_PICKER_FIELD}` },
    themeVersion: { maxLength: THEME_VERSION_MAX_LENGTH, regex: THEME_VERSION_PATTERN.source },
    themeDigest: { regex: THEME_DIGEST_PATTERN.source },
  }
  for (const [name, rule] of Object.entries(rules)) {
    const current = component.attributes[name]
    if (!current) continue
    component.attributes[name] = { ...current, ...rule }
    const declared = component.__schema__?.attributes?.[name]
    if (component.__schema__?.attributes && declared) {
      component.__schema__.attributes[name] = { ...declared, ...rule }
    }
  }
}
