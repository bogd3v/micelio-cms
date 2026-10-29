import type { Core } from '@strapi/strapi'

const PERMISSION_UID = 'admin::permission'
const SITE_SETTING_UID = 'api::site-setting.site-setting'
const SUPER_ADMIN_CODE = 'strapi-super-admin'
const WRITE_ACTIONS = [
  'plugin::content-manager.explorer.create',
  'plugin::content-manager.explorer.update',
]
const THEME_FIELD = 'theme'

interface AdminPermission {
  id: number
  properties: { fields?: string[] | null } | null
}

const isThemePath = (path: string): boolean =>
  path === THEME_FIELD || path.startsWith(`${THEME_FIELD}.`)

/** The leaf field paths of the site settings other than the theme, as Strapi lists them in a role. */
function fieldsWithoutTheme(strapi: Core.Strapi): string[] {
  type Attributes = Record<string, { type: string; component?: string }>
  const components = strapi.components as unknown as Record<string, { attributes: unknown }>
  const walk = (attributes: Attributes, prefix: string, depth: number): string[] =>
    Object.entries(attributes).flatMap(([name, attribute]) => {
      const path = prefix ? `${prefix}.${name}` : name
      if (attribute.type !== 'component' || !attribute.component || depth === 0) return [path]
      const inner = walk(components[attribute.component]!.attributes as Attributes, path, depth - 1)
      return inner.length > 0 ? inner : [path]
    })
  const attributes = strapi.contentType(SITE_SETTING_UID).attributes as Attributes
  return walk(attributes, '', 15).filter((path) => !isThemePath(path))
}

/**
 * Takes the theme out of what every admin role but Super Admin may write on the site settings
 * (#97, micelio ADR 0009, "Who may change the theme").
 *
 * @remarks
 * Changing the theme decides what the server downloads and installs, so it is a privileged
 * permission. Strapi can restrict a field of a content type per role, so the roles keep editing
 * the rest of the site settings: for `create` and `update` on `api::site-setting.site-setting`, the
 * paths `theme` and `theme.*` are removed from the permission's `fields`. A permission with no
 * list of fields (every field) gets the explicit list of the others. Super Admin is untouched.
 * The permissions of an admin API token have no role and are narrowed the same way; the content API
 * tokens have `find` only (`src/migrations/api-tokens.ts`). `restrictThemeWrites` enforces it on every write.
 * Idempotent: runs on every boot, so a role an admin created and gave the theme loses it again.
 *
 * @returns How many permissions were changed.
 */
export async function restrictThemeToSuperAdmin(strapi: Core.Strapi): Promise<number> {
  const permissions = strapi.db.query(PERMISSION_UID)
  const rows = (await permissions.findMany({
    where: {
      subject: SITE_SETTING_UID,
      action: { $in: WRITE_ACTIONS },
    },
    populate: ['role'],
  })) as (AdminPermission & { role?: { code?: string } | null })[]

  let changed = 0
  for (const row of rows) {
    // A permission of an admin API token has no role; only a Super Admin role is left alone.
    if (row.role?.code === SUPER_ADMIN_CODE) continue
    const listed = row.properties?.fields
    const kept = Array.isArray(listed)
      ? listed.filter((path) => !isThemePath(path))
      : fieldsWithoutTheme(strapi)
    if (Array.isArray(listed) && kept.length === listed.length) continue
    await permissions.update({
      where: { id: row.id },
      data: { properties: { ...row.properties, fields: kept } },
    })
    changed += 1
  }
  return changed
}
