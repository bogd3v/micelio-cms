// The site settings and the default site, before and after an upgrade (bogd3v/micelio-cms#415).
// The boot step `src/migrations/site-settings-to-site.ts` copies `api::site-setting` into the
// default site of the core; the check reads the name, the theme pin and the fediverse username from
// both tables and fails when they differ. Pure functions: tested in tests/upgrade-check-site-copy.test.js.

/** The pin and the username the check gives the single type of the released image, which has none. */
export const SEEDED_PROFILE = {
  themeId: 'upgrade-check',
  themeVersion: '1.2.3',
  themeDigest: `sha256:${'b'.repeat(64)}`,
  username: 'upgradecheck',
};

/**
 * SQL that gives every row of the single type a theme and a fediverse profile, as the admin panel
 * stores them (`components_site_*` rows linked by `site_settings_cmps`). Run on the stopped
 * database of a released image, before the image to test starts. Idempotent: a row that has the
 * component is left alone.
 */
export const SEED_PROFILE_SQL = `
DO $$
DECLARE setting RECORD; component_id integer;
BEGIN
  FOR setting IN SELECT id FROM site_settings ORDER BY id LOOP
    IF NOT EXISTS (SELECT 1 FROM site_settings_cmps WHERE entity_id = setting.id AND field = 'theme') THEN
      INSERT INTO components_site_themes (theme_id, theme_version, theme_digest)
        VALUES ('${SEEDED_PROFILE.themeId}', '${SEEDED_PROFILE.themeVersion}', '${SEEDED_PROFILE.themeDigest}')
        RETURNING id INTO component_id;
      INSERT INTO site_settings_cmps (entity_id, cmp_id, component_type, field, "order")
        VALUES (setting.id, component_id, 'site.theme', 'theme', NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM site_settings_cmps WHERE entity_id = setting.id AND field = 'fediverse') THEN
      INSERT INTO components_site_fediverses (username, discoverable, object_type)
        VALUES ('${SEEDED_PROFILE.username}', true, 'note')
        RETURNING id INTO component_id;
      INSERT INTO site_settings_cmps (entity_id, cmp_id, component_type, field, "order")
        VALUES (setting.id, component_id, 'site.fediverse', 'fediverse', NULL);
    END IF;
  END LOOP;
END $$;
`;

/** One SELECT of the identity of a table: `source|locale|name|theme_id|theme_version|theme_digest|username`. */
function identitySql(source, table, componentPrefix, where) {
  return `SELECT '${source}', s.locale, s.name, t.theme_id, t.theme_version, t.theme_digest, f.username
  FROM ${table} s
  LEFT JOIN ${table}_cmps ct ON ct.entity_id = s.id AND ct.field = 'theme'
  LEFT JOIN ${componentPrefix}_themes t ON t.id = ct.cmp_id
  LEFT JOIN ${table}_cmps cf ON cf.entity_id = s.id AND cf.field = 'fediverse'
  LEFT JOIN ${componentPrefix}_fediverses f ON f.id = cf.cmp_id
  ${where}`;
}

/** SQL that lists the identity of the single type and of the default site, one row per locale. */
export const SITE_IDENTITY_SQL = `${identitySql('single', 'site_settings', 'components_site', '')}
UNION ALL
${identitySql('site', 'micelio_sites', 'components_micelio_site', 'WHERE s.is_default')}
ORDER BY 1, 2;
`;

const FIELDS = ['name', 'themeId', 'themeVersion', 'themeDigest', 'username'];

/** Parses the `psql -At -F '|'` output of `SITE_IDENTITY_SQL` into `{ source, locale, ... }` rows. */
export function parseIdentity(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [source, locale, ...values] = line.split('|');
      return { source, locale, ...Object.fromEntries(FIELDS.map((field, index) => [field, values[index] ?? ''])) };
    });
}

/**
 * Compares the single type with the default site, locale by locale. A row of the single type with
 * no row of the site in its locale, or with another value in any field, is a difference; a single
 * type with no row at all proves nothing and is one too.
 */
export function compareIdentity(rows) {
  const single = rows.filter((row) => row.source === 'single');
  const site = rows.filter((row) => row.source === 'site');
  if (single.length === 0) return [{ locale: '-', field: 'rows', single: '0', site: String(site.length) }];
  const differences = [];
  for (const row of single) {
    const copy = site.find((candidate) => candidate.locale === row.locale);
    if (!copy) {
      differences.push({ locale: row.locale, field: 'row', single: 'present', site: 'missing' });
      continue;
    }
    for (const field of FIELDS) {
      if (row[field] !== copy[field]) differences.push({ locale: row.locale, field, single: row[field], site: copy[field] });
    }
  }
  return differences;
}

/** The report: one line per locale and field, `same` or `DIFFERENT`. */
export function formatIdentity(rows) {
  const single = rows.filter((row) => row.source === 'single');
  const lines = [];
  for (const row of single) {
    const copy = rows.find((candidate) => candidate.source === 'site' && candidate.locale === row.locale);
    for (const field of FIELDS) {
      const value = copy ? copy[field] : '(no row)';
      lines.push(`${row.locale}  ${field.padEnd(12)} single=${row[field] || '(empty)'}  site=${value || '(empty)'}  ${value === row[field] ? 'same' : 'DIFFERENT'}`);
    }
  }
  return lines.join('\n');
}

/**
 * Whether the check compares the single type with the default site: yes for a released image
 * older than `0.7` (the boot copies the single type into the default site, and a single type with
 * no row there fails the check), no from `0.7` (the settings live on the default site and the
 * single type has no rows, so only the counts are compared). A version that cannot be read is
 * compared, so the guard is never dropped by mistake.
 * @param {string} releasedVersion - The `version` of the released image's `package.json`.
 * @returns {boolean} `true` when the comparison runs.
 */
export function comparesSingleType(releasedVersion) {
  const match = /^(\d+)\.(\d+)\./.exec(String(releasedVersion).trim());
  if (!match) return true;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major === 0 && minor < 7;
}
