import type { Core, Schema } from '@strapi/strapi'
import { withPageSettings } from '@micelio/strapi-plugin-core/strapi-server'

const ROLE_UID = 'admin::role'
const PERMISSION_UID = 'admin::permission'
const PAGE_UID = 'api::page.page'
const ACTION_PREFIX = 'plugin::content-manager.explorer.'
/** Strapi's own names for the roles it creates beside Super Admin. */
const ROLE_NAMES = ['Editor', 'Author']

interface AdminRole {
  id: number
}

interface AdminPermission {
  id: number
  properties: { fields?: unknown; locales?: string[] } | null
}

/** The part of Strapi's `admin::content-type` service that lists a type's fields in a role. */
interface ContentTypeService {
  getNestedFields(
    model: Schema.ContentType,
    options: { components: Core.Strapi['components'] }
  ): string[]
}

/** The attributes `withPageSettings` adds to a schema, whatever the core's version adds. */
function pageSettingsAttributes(): Set<string> {
  const empty = { kind: 'collectionType', info: {}, options: {}, attributes: {} }
  const { attributes } = withPageSettings(empty as Parameters<typeof withPageSettings>[0])
  return new Set(Object.keys(attributes))
}

/** The top-level attribute of a field path: `visibility` for `visibility.inMenu`. */
function attributeOf(field: string): string {
  return field.split('.')[0]
}

/**
 * Lets the admin roles Editor and Author save the page settings of `withPageSettings` on an
 * instance that upgrades (#517, follow-up of #414).
 *
 * @remarks
 * Strapi lists in a role the fields that exist when it creates the role, so on an instance whose
 * roles predate the page settings the Content Manager drops the `pageType` and `visibility` those
 * roles send. For each role, matched by name, this adds the page-settings fields to its permissions
 * on pages whose action is one of the Content Manager's and that list fields.
 *
 * The fields are the ones Strapi lists in a role it creates: its `getNestedFields` over the page's
 * schema (so `visibility` is its leaves, `visibility.inMenu`, `visibility.inSitemap` and
 * `visibility.noindex`), kept to the attributes `withPageSettings` adds. Strapi leaves out every
 * attribute that is not visible, so the template record (`templateId`, `templateVersion`) and the
 * private `templateSamples` and `templateFixed` are not granted, as a fresh role does not list them.
 *
 * Idempotent, and it never overrides an admin's choice: a permission that already lists any
 * page-settings field (one an admin narrowed on purpose included), one with an empty `fields` list
 * and one with no `fields` list are left as they are. Only field lists change: no action, condition,
 * role or subject is added. Does nothing when the roles do not exist.
 *
 * @returns How many permissions were changed.
 */
export async function grantEditorsPageSettings(strapi: Core.Strapi): Promise<number> {
  const roles = (await strapi.db.query(ROLE_UID).findMany({
    select: ['id'],
    where: { name: { $in: ROLE_NAMES } },
  })) as AdminRole[]
  if (roles.length === 0) return 0

  const settings = pageSettingsAttributes()
  const contentTypes = strapi.service('admin::content-type') as unknown as ContentTypeService
  const fields = contentTypes
    .getNestedFields(strapi.contentType(PAGE_UID) as Schema.ContentType, {
      components: strapi.components,
    })
    .filter((field) => settings.has(attributeOf(field)))
  if (fields.length === 0) return 0
  const granted = new Set(fields.map(attributeOf))

  const permissions = strapi.db.query(PERMISSION_UID)
  let changed = 0
  for (const role of roles) {
    const pagePermissions = (await permissions.findMany({
      where: { role: role.id, subject: PAGE_UID, action: { $startsWith: ACTION_PREFIX } },
    })) as AdminPermission[]
    for (const permission of pagePermissions) {
      const listed = permission.properties?.fields
      if (!Array.isArray(listed) || listed.length === 0) continue
      if (listed.some((field: string) => granted.has(attributeOf(field)))) continue
      await permissions.update({
        where: { id: permission.id },
        data: { properties: { ...permission.properties, fields: [...listed, ...fields] } },
      })
      changed += 1
    }
  }
  return changed
}
