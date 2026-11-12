// What the upgrade check seeds and counts for the fediverse plugin (bogd3v/micelio-cms#391): the
// released image ships it as local code, the image to test installs it as a package, and a
// follower, an interaction, a federated article, a queued delivery, the actor key and the roles'
// grants must come through. Pure data: tested in tests/upgrade-check-fediverse.test.js.

/** The actor identifier both images run with (`FEDIVERSE_ACTOR_IDENTIFIER`, the path of the actor URI). */
export const ACTOR_IDENTIFIER = 'blog'

/** Environment that turns federation on in both images, as `-e` arguments for `docker run`. */
export const FEDIVERSE_ENV = [
  '-e',
  'FEDIVERSE_ENABLED=true',
  '-e',
  `FEDIVERSE_ACTOR_IDENTIFIER=${ACTOR_IDENTIFIER}`,
]

/** Where a fetch of the actor makes the released image store its key pair (the plugin store, `keyPairs`). */
export const ACTOR_PATH = `/fediverse/user/${ACTOR_IDENTIFIER}`

/** Tables the seed fills in the released image; one that is empty before the upgrade proves nothing. */
export const SEEDED_FEDIVERSE = [
  'fediverse_followers',
  'fediverse_interactions',
  'fediverse_federated_articles',
  'fedify_message_v2',
]

/** Names of the rows the check adds to the count (they are not tables). */
export const KEY_ROW = 'core_store:plugin_fediverse_keyPairs'
export const GRANT_ROWS = [
  'admin_permissions_action:plugin::fediverse.manage',
  'admin_permissions_action:plugin::fediverse.read',
]

/**
 * SQL that seeds the stopped database of the released image: a follower, an interaction, a
 * federated article, a delivery waiting in Fedify's queue (its `delay` is a year, so no worker of
 * either image sends it) and the two grants of the plugin on the Editor role. Idempotent.
 */
export const SEED_FEDIVERSE_SQL = `
DO $$
DECLARE editor_id integer; permission_id integer; action_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fediverse_followers WHERE actor_id = 'https://remote.example/users/ana') THEN
    INSERT INTO fediverse_followers (document_id, actor_id, handle, name, inbox, blocked, created_at, updated_at, published_at)
      VALUES (md5(random()::text), 'https://remote.example/users/ana', '@ana@remote.example', 'Ana', 'https://remote.example/users/ana/inbox', false, now(), now(), now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fediverse_interactions WHERE interaction_key = 'upgrade-check-like') THEN
    INSERT INTO fediverse_interactions (document_id, type, actor_id, handle, article_document_id, interaction_key, created_at, updated_at, published_at)
      VALUES (md5(random()::text), 'like', 'https://remote.example/users/ana', '@ana@remote.example', 'upgrade-check-article', 'upgrade-check-like', now(), now(), now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fediverse_federated_articles WHERE article_document_id = 'upgrade-check-article') THEN
    INSERT INTO fediverse_federated_articles (document_id, article_document_id, status, create_sent_at, last_activity_at, last_activity_type, attempts, created_at, updated_at, published_at)
      VALUES (md5(random()::text), 'upgrade-check-article', 'created', now(), now(), 'Create', 1, now(), now(), now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fedify_message_v2) THEN
    INSERT INTO fedify_message_v2 (message, delay)
      VALUES ('{"type":"upgrade-check"}'::jsonb, interval '365 days');
  END IF;
  SELECT id INTO editor_id FROM admin_roles WHERE code = 'strapi-editor';
  IF editor_id IS NOT NULL THEN
    FOREACH action_name IN ARRAY ARRAY['plugin::fediverse.read', 'plugin::fediverse.manage'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM admin_permissions p JOIN admin_permissions_role_lnk l ON l.permission_id = p.id
        WHERE l.role_id = editor_id AND p.action = action_name
      ) THEN
        INSERT INTO admin_permissions (document_id, action, properties, conditions, created_at, updated_at)
          VALUES (md5(random()::text), action_name, '{}'::jsonb, '[]'::jsonb, now(), now())
          RETURNING id INTO permission_id;
        INSERT INTO admin_permissions_role_lnk (permission_id, role_id, permission_ord)
          VALUES (permission_id, editor_id, 1000);
      END IF;
    END LOOP;
  END IF;
END $$;
`

/**
 * SQL that prints `name|count` lines for the key and the plugin's grants (the key's value is never read).
 * The key is `keyPairs` up to `0.6` and `keyPairs:<site documentId>` from the package `0.7` (one per site), so both count.
 */
export const FEDIVERSE_COUNTS_SQL = `
select 'core_store:plugin_fediverse_keyPairs', count(*) from strapi_core_store_settings where key = 'plugin_fediverse_keyPairs' or starts_with(key, 'plugin_fediverse_keyPairs:')
union all
select 'admin_permissions_action:' || action, count(*) from admin_permissions where starts_with(action, 'plugin::fediverse.') group by action
order by 1`
