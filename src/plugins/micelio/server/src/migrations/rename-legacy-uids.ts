import type { Core } from '@strapi/strapi';

// Self-contained on purpose (standard, section 6): this migration keeps its own constants so it
// keeps working after the rest of the plugin changes.
const LEGACY_TO_PLUGIN: Record<string, string> = {
  'api::category.category': 'plugin::micelio.category',
  'api::tag.tag': 'plugin::micelio.tag',
};
const CONFIGURATION_KEY_PREFIX = 'plugin_content_manager_configuration_content_types::';

/** Rows of a content type whose `action` names a content API action, and the relation that owns them. */
const ACTION_TABLES = [
  { uid: 'plugin::users-permissions.permission', owner: 'role' },
  { uid: 'admin::api-token-permission', owner: 'token' },
] as const;

/** How many rows each place changed. */
export interface RenameReport {
  /** Role and API token permissions (`api::category.category.find` to `plugin::micelio.category.find`). */
  actions: number;
  /** Admin role permissions whose subject is the content type. */
  subjects: number;
  /** Content manager layouts stored under the old UID. */
  layouts: number;
}

interface Row {
  id: number;
  [key: string]: unknown;
}

/**
 * Moves what Strapi stored under the UIDs `api::category.category` and `api::tag.tag` to the
 * UIDs of the plugin: permissions of roles and API tokens, admin role subjects and content
 * manager layouts. Idempotent: a second run finds nothing, and a row that already exists under
 * the new UID wins over its old twin, which is deleted.
 *
 * @remarks
 * Must run before `users-permissions` bootstraps: its `syncPermissions()` deletes every
 * permission whose action no longer exists, which would silently take category and tag read
 * access away from the public role. It is registered on `strapi::content-types.beforeSync`,
 * which runs before every plugin's `bootstrap`, whatever the plugin order. A table that does not
 * exist yet (a fresh database) has nothing to migrate.
 */
export async function renameLegacyUids(strapi: Core.Strapi): Promise<RenameReport> {
  const report: RenameReport = { actions: 0, subjects: 0, layouts: 0 };
  for (const [legacy, current] of Object.entries(LEGACY_TO_PLUGIN)) {
    for (const { uid, owner } of ACTION_TABLES) {
      report.actions += await renameActions(strapi, uid, owner, legacy, current);
    }
    report.subjects += await renameSubjects(strapi, legacy, current);
    report.layouts += await renameLayouts(strapi, legacy, current);
  }
  return report;
}

/** Whether the table of a content type exists: a fresh database has none before the first sync. */
async function hasTable(strapi: Core.Strapi, uid: string): Promise<boolean> {
  const tableName = strapi.db.metadata.get(uid)?.tableName as string | undefined;
  return (
    Boolean(tableName) && (await strapi.db.getSchemaConnection().hasTable(tableName as string))
  );
}

async function renameActions(
  strapi: Core.Strapi,
  uid: string,
  owner: string,
  legacy: string,
  current: string
): Promise<number> {
  if (!(await hasTable(strapi, uid))) return 0;
  const rows = (await strapi.db.query(uid).findMany({
    where: { action: { $startsWith: `${legacy}.` } },
    populate: { [owner]: { select: ['id'] } },
  })) as (Row & { action: string })[];

  for (const row of rows) {
    const action = `${current}${row.action.slice(legacy.length)}`;
    const ownerRow = row[owner] as Row | null;
    const twin = ownerRow
      ? await strapi.db.query(uid).findOne({ where: { action, [owner]: ownerRow.id } })
      : null;
    if (twin) {
      await strapi.db.query(uid).delete({ where: { id: row.id } });
    } else {
      await strapi.db.query(uid).update({ where: { id: row.id }, data: { action } });
    }
  }
  return rows.length;
}

async function renameSubjects(
  strapi: Core.Strapi,
  legacy: string,
  current: string
): Promise<number> {
  const uid = 'admin::permission';
  if (!(await hasTable(strapi, uid))) return 0;
  const rows = (await strapi.db.query(uid).findMany({
    where: { subject: legacy },
    populate: { role: { select: ['id'] } },
  })) as (Row & { action: string; role: Row | null })[];

  for (const row of rows) {
    const twin = row.role
      ? await strapi.db
          .query(uid)
          .findOne({ where: { action: row.action, subject: current, role: row.role.id } })
      : null;
    if (twin) {
      await strapi.db.query(uid).delete({ where: { id: row.id } });
    } else {
      await strapi.db.query(uid).update({ where: { id: row.id }, data: { subject: current } });
    }
  }
  return rows.length;
}

/**
 * Rewrites the UID inside every stored content manager layout (the layout of an article also
 * names the category and tag it relates to) and renames the key of the layouts of the types.
 */
async function renameLayouts(
  strapi: Core.Strapi,
  legacy: string,
  current: string
): Promise<number> {
  const uid = 'strapi::core-store';
  if (!(await hasTable(strapi, uid))) return 0;
  const rows = (await strapi.db.query(uid).findMany({
    where: { key: { $startsWith: CONFIGURATION_KEY_PREFIX } },
  })) as (Row & { key: string; value: string | null })[];

  let changed = 0;
  for (const row of rows) {
    const key = row.key.split(legacy).join(current);
    const value = row.value?.split(legacy).join(current) ?? row.value;
    if (key === row.key && value === row.value) continue;
    changed += 1;
    if (key !== row.key && (await strapi.db.query(uid).findOne({ where: { key } }))) {
      await strapi.db.query(uid).delete({ where: { id: row.id } });
    } else {
      await strapi.db.query(uid).update({ where: { id: row.id }, data: { key, value } });
    }
  }
  return changed;
}
