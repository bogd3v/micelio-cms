// What the upgrade check counts and how it compares two counts (bogd3v/micelio-cms#369).
// Pure functions: the SQL it builds and the table it prints are tested in tests/upgrade-check.test.js.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Folders whose content types declare a content table: `<dir>/<name>/content-types/<type>/schema.json`.
const SCHEMA_ROOTS = [{ dir: 'src/api', nested: 'content-types' }];

// Content tables of the core plugin (`@micelio/strapi-plugin-core`) that this tree does not declare:
// category and tag, which the released image stores in the same tables.
const CORE_COLLECTIONS = ['categories', 'tags'];

/** Prefix of the core-store keys that hold the content manager configuration of each content type. */
const CONTENT_MANAGER_KEY_PREFIX = 'plugin_content_manager_configuration_content_types::';

/** Reads the `collectionName` of every content type the repository declares, and the core plugin's, sorted. */
export function readCollectionNames(root) {
  const names = [...CORE_COLLECTIONS];
  for (const { dir, nested } of SCHEMA_ROOTS) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const typesDir = nested ? join(base, entry.name, nested) : join(base, entry.name);
      const schemas = nested
        ? readdirSync(typesDir, { withFileTypes: true })
            .filter((type) => type.isDirectory())
            .map((type) => join(typesDir, type.name, 'schema.json'))
        : [join(typesDir, 'schema.json')];
      for (const file of schemas) {
        if (!existsSync(file)) continue;
        const { collectionName } = JSON.parse(readFileSync(file, 'utf8'));
        if (typeof collectionName === 'string') names.push(collectionName);
      }
    }
  }
  return [...new Set(names)].sort();
}

/** Tables Strapi keeps for itself, or counts elsewhere in this check; they change on every boot and are not content. */
const BOOKKEEPING_TABLE = /^(strapi_(migrations|migrations_internal|database_schema|core_store_settings)|(up|admin)_permissions.*|strapi_api_token_permissions.*)$/;

/** Regular expression (PostgreSQL syntax) for a content table's link (`_lnk`) and component (`_cmps`) tables. */
export function joinTablePattern(collections) {
  return `^(${collections.join('|')})(_.+_lnk|_cmps)$`;
}

/** Tables to track from the names the database had before the upgrade: all of them but Strapi's bookkeeping. */
export function trackedTables(present) {
  return present.filter((name) => !BOOKKEEPING_TABLE.test(name)).sort();
}

/** SQL that lists the tables of the `public` schema, one name per line. */
export const LIST_TABLES_SQL = "select table_name from information_schema.tables where table_schema = 'public' order by 1";

/**
 * SQL that prints `name|count` lines for each tracked table (the tables the database had before the
 * upgrade, so a content type the new code retired is still counted) and for every table of
 * `collections` found now with its link (`_lnk`) and component (`_cmps`) tables.
 */
export function contentTablesSql(tracked, collections) {
  const names = [...tracked, ...collections].map((name) => `'${name}'`).join(', ');
  return `
select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public'
  and (table_name in (${names}) or table_name ~ '${joinTablePattern(collections)}')
order by table_name`;
}

/** SQL that prints `name|count` lines for permissions (by action prefix and their role or token links) and the content manager keys. */
export const PERMISSIONS_SQL = `
select 'up_permissions:' || regexp_replace(action, '\\.[^.]+$', ''), count(*) from up_permissions group by 1
union all
select 'api_token_permissions:' || regexp_replace(action, '\\.[^.]+$', ''), count(*) from strapi_api_token_permissions group by 1
union all
select 'admin_permissions:' || coalesce(subject, '(none)'), count(*) from admin_permissions group by 1
union all
select 'up_permissions_role_lnk', count(*) from up_permissions_role_lnk
union all
select 'admin_permissions_role_lnk', count(*) from admin_permissions_role_lnk
union all
select 'strapi_api_token_permissions_token_lnk', count(*) from strapi_api_token_permissions_token_lnk
union all
select 'core_store:' || key, 1 from strapi_core_store_settings where starts_with(key, '${CONTENT_MANAGER_KEY_PREFIX}')
order by 1`;

/** Parses the `name|count` output of `psql -At -F '|'` into a map. */
export function parseCounts(output) {
  const counts = new Map();
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue;
    const cut = line.lastIndexOf('|');
    const count = Number(line.slice(cut + 1));
    if (cut < 1 || !Number.isInteger(count)) throw new Error(`Unexpected psql output line: ${line}`);
    counts.set(line.slice(0, cut), count);
  }
  return counts;
}

/**
 * Joins two counts into rows. A name missing on one side counts 0 there; `dropped` is true when
 * the count fell and the name is not in `allowed`.
 */
export function compareCounts(before, after, allowed = []) {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  return names.map((name) => {
    const was = before.get(name) ?? 0;
    const now = after.get(name) ?? 0;
    const decreased = now < was;
    return { name, before: was, after: now, decreased, dropped: decreased && !allowed.includes(name) };
  });
}

/** Renders the rows as a text table, the last column marking a drop (`DROP`) or an allowed one (`allowed`). */
export function formatTable(rows) {
  const head = ['name', 'before', 'after', ''];
  const body = rows.map((row) => [
    row.name,
    String(row.before),
    String(row.after),
    row.dropped ? 'DROP' : row.decreased ? 'allowed' : '',
  ]);
  const widths = head.map((_, i) => Math.max(...[head, ...body].map((line) => line[i].length)));
  const line = (cells) =>
    cells.map((cell, i) => (i === 0 || i === 3 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ').trimEnd();
  return [line(head), line(widths.map((width) => '-'.repeat(width))), ...body.map(line)].join('\n');
}
