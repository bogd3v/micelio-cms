import type { Core } from '@strapi/strapi'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'

const ROLE_UID = 'admin::role'
const PERMISSION_UID = 'admin::permission'
const PAGE_UID = 'api::page.page'
const ACTION_PREFIX = 'plugin::content-manager.explorer.'
const READ_ACTION = `${ACTION_PREFIX}read`
/** Strapi's own names for the roles it creates beside Super Admin. */
const ROLE_NAMES = ['Editor', 'Author']
/** Attribute types that hold another entry or a file, not a value to show in a picker. */
const NESTED_TYPES = new Set(['relation', 'component', 'dynamiczone', 'media'])
/** Strapi gives Author this condition on every type; no site has a creator, so it hides them all. */
const CREATOR_CONDITION = 'admin::is-creator'

interface AdminRole {
  id: number
}

interface AdminPermission {
  id: number
  action: string
  properties: { fields?: string[]; locales?: string[] } | null
  conditions: string[] | null
}

/**
 * Lets the admin roles Editor and Author pick the site of the pages they create (#373, decision
 * D9 of #360).
 *
 * @remarks
 * Strapi lists in a role the content types and fields that exist when it creates the role, so on an
 * instance that upgrades the Content Manager gives Editor and Author no site to choose and drops
 * the `site` of the page they send ("site is required"). For each role, matched by name, this:
 *
 * - gives it `plugin::content-manager.explorer.read` on `plugin::micelio.site`, on the scalar
 *   fields of the site and on every locale (the site is localised, and a permission with no
 *   `locales` lists no entry of a localised type), and mends one that has no `locales` or that
 *   Strapi gave Author with the condition `admin::is-creator`, which no site satisfies;
 * - adds `site` to the fields of its permissions on pages that list fields.
 *
 * Only reading sites is granted, and "Preview drafts on the frontend" stays with the Super Admin.
 * Idempotent: a permission that already has what it needs is left as it is, including one whose
 * `locales` an admin emptied on purpose. Does nothing when the roles do not exist. A locale added
 * later is the admin's to give, as Strapi does for every role but Super Admin.
 *
 * @returns How many permissions were created or changed.
 */
export async function grantEditorsPageSite(strapi: Core.Strapi): Promise<number> {
  const roles = (await strapi.db.query(ROLE_UID).findMany({
    select: ['id'],
    where: { name: { $in: ROLE_NAMES } },
  })) as AdminRole[]
  if (roles.length === 0) return 0

  const attributes = strapi.contentType(SITE_UID).attributes as Record<string, { type: string }>
  const fields = Object.entries(attributes)
    .filter(([, attribute]) => !NESTED_TYPES.has(attribute.type))
    .map(([name]) => name)
  const locales = (
    (await strapi.plugin('i18n').service('locales').find()) as { code: string }[]
  ).map((locale) => locale.code)

  const permissions = strapi.db.query(PERMISSION_UID)
  let changed = 0
  for (const role of roles) {
    const reads = (await permissions.findMany({
      where: { role: role.id, action: READ_ACTION, subject: SITE_UID },
    })) as AdminPermission[]
    if (reads.length === 0) {
      await strapi.service('admin::role').addPermissions(role.id, [
        {
          action: READ_ACTION,
          subject: SITE_UID,
          properties: { fields, locales },
          conditions: [],
        },
      ])
      changed += 1
    }
    for (const read of reads) {
      const isCreatorOnly = read.conditions?.includes(CREATOR_CONDITION) ?? false
      if (read.properties?.locales != null && !isCreatorOnly) continue
      await permissions.update({
        where: { id: read.id },
        data: {
          properties: { ...read.properties, locales: read.properties?.locales ?? locales },
          conditions: (read.conditions ?? []).filter((name) => name !== CREATOR_CONDITION),
        },
      })
      changed += 1
    }

    const pagePermissions = (await permissions.findMany({
      where: { role: role.id, subject: PAGE_UID, action: { $startsWith: ACTION_PREFIX } },
    })) as AdminPermission[]
    for (const permission of pagePermissions) {
      const listed = permission.properties?.fields
      if (!Array.isArray(listed) || listed.includes('site')) continue
      await permissions.update({
        where: { id: permission.id },
        data: { properties: { ...permission.properties, fields: [...listed, 'site'] } },
      })
      changed += 1
    }
  }
  return changed
}
