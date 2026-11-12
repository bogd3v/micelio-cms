# Upgrade the CMS

**Kind:** how-to. Goal: move a running CMS from one release to a newer one without losing content, in the order that keeps the site working.

The rules come from [ADR 0010](https://github.com/bogd3v/micelio/blob/main/docs/adr/0010-semantic-versioning.md) and section 7 of the [engineering standard](../engineering-standard.md). Read the release notes of the version you move to before you start.

## The rules

- **One release line.** `micelio` (the frontend) and `micelio-cms` (this CMS) share MAJOR and MINOR; each has its own PATCH. "Micelio 1.4" is any `micelio 1.4.z` with any `micelio-cms 1.4.z`.
- **CMS first**, unless the release notes say otherwise. Upgrade the CMS, then the frontend. The CMS of a release line also serves the frontend of the previous MINOR, so the site keeps working between the two steps. The release that adds the subscriber token migration is the exception: the frontend goes first (see [Migrations that rewrite data](#migrations-that-rewrite-data)).
- **From 1.0.0, within a MAJOR, no manual step.** The new version runs its boot migrations when it starts. They are idempotent, so a restart that stops halfway is safe to repeat. Across a MAJOR the release notes give the order and any step you must do by hand.
- **Going back is not supported across a MINOR.** Restore the backup you took before the upgrade instead.
- **Only the latest release line gets fixes**, security fixes included.
- **Before 1.0.0 nothing is stable.** A breaking change raises the second number (`0.y.z`) and may remove or rename a contract (content types, the API, the theme contract, environment variables, image names) without a deprecation period. Read the notes of every `0.y` you cross, and pin `X.Y.Z` instead of `latest` or `X.Y`. The guarantees in the other rules (the CMS also serving the previous MINOR, migrations with no manual step, deprecation before removal) are the target from 1.0.0; before it, the release notes say what holds.

## Migrations that rewrite data

Some boot migrations rewrite stored data in place. They run on every boot, are idempotent (a second run changes nothing), and cannot be undone, so back up first (step 2). Three releases add one each: the reader token migration, the subscriber token migration and the encryption of the fediverse actor key.

**Exception: frontend first.** The usual order is CMS first, but the release that adds `hash-subscriber-tokens` reverses it. Upgrade the frontend to 0.2.0 or later, then back up (step 2), then upgrade the CMS (step 3). Frontend 0.1.x generates UUID tokens and stores them in the clear, so with this migration:

- every unsubscribe and confirmation link already emailed stops working for frontend 0.1.x, which looks tokens up in the clear;
- each restart also hashes the plain tokens that 0.1.x keeps writing, so links emailed after the upgrade break too.

Frontend 0.2.0 or later looks a token up by its hash first and falls back to the plain value, so it works with old and migrated data. The frontend may drop that fallback in a later release.

- **Reader tokens** (`src/migrations/hash-user-tokens.ts`) replace the email confirmation tokens and password reset codes in `up_users` with their SHA-256 hex. Links and reset codes sent before the upgrade keep working, because lookups hash what they receive. Going back to the previous image runs, but the older code looks tokens up in plain text, so only the links pending at that moment stop working and their owners ask for a new one; restore the backup to keep them.
- **Subscriber tokens** (`src/migrations/hash-subscriber-tokens.ts`) replace the confirmation and unsubscribe tokens in the subscriber table the same way. Going back to the previous CMS image runs fine, because the old CMS never reads token values, but the links of frontend 0.1.x stay broken.
- **Fediverse actor key** (`encryptStoredActorKeys`, now in the fediverse package, `server/src/services/keys.ts`), in the release that contains this change. With `FEDIVERSE_ENABLED=true`, the first boot encrypts the stored actor private key with `ENCRYPTION_KEY`. The key material, the key id and the actor id stay the same, so followers notice nothing, and there is nothing to do by hand. From then on keep `ENCRYPTION_KEY` unchanged ([Rotating `ENCRYPTION_KEY`](../security/keys.md#rotating-encryption_key)). The key is not rotated: backups taken before the upgrade, and the database's free pages, still hold it in plain text; destroy them or treat the key as exposed ([keys.md](../security/keys.md#the-actor-key-written-before-encryption)).

  **Rolling back.** The previous release cannot read the encrypted key. It fails closed as well: it serves the actor without a key and signs nothing, so the blog does not federate while it runs, but it never generates a new key pair, and the stored encrypted key stays intact. Starting this release again, with the same `ENCRYPTION_KEY`, restores federation as it was. To federate on the previous release you need the previous key material: restore the backup of step 2, which holds the plain key. Stop the old instances before you start the new ones, so no old instance runs against the encrypted key.

In a rolling deploy, stop the old CMS instances first: an old image keeps writing and looking up plain tokens until the new image has booted, and none of them should run next to a migrated database. The rewrites are irreversible; a rollback restores the code, not the plain values.

## Upgrading to 0.7: the site settings move to the Site and the fediverse plugin is a package

**Breaking for editors, for scripts that write the single type `api::site-setting`, for operators with federation on (`FEDIVERSE_ENABLED=true`) and for anything that read the plugin's code.** Two changes arrive together, and this section follows the order you follow them: back up, prepare the `0.6` instance, start `0.7`, check. The site settings live on the default **Site**, and the fediverse plugin is no longer code of this repository: the image installs [`@micelio/strapi-plugin-fediverse`](https://github.com/bogd3v/micelio-plugin-fediverse) `0.7.0` and the local plugin folder under `src/plugins/` is gone. The core plugin stays `@micelio/strapi-plugin-core` `0.2.0` (see [Known limitation](#known-limitation-the-core-reports-release-line-06)). Take a backup first ([Backup](backup.md)); the fediverse package's own notes are in its [`docs/operate/upgrade-0.7.md`](https://github.com/bogd3v/micelio-plugin-fediverse/blob/main/docs/operate/upgrade-0.7.md).

### Before you upgrade

In the `0.6` admin, move four variables into the site. A boot with one of them set stops with a message that names the setting that replaces it:

| Remove from the environment  | Set instead (Content Manager → Site → the default site → **Fediverse**; in `0.6` the profile is read from Site settings → **Fediverse profile**, and the first `0.7` boot copies it into the default site) |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEDIVERSE_ACTOR_USERNAME`   | **Username**                                                                                                                                                                                               |
| `FEDIVERSE_ACTOR_NAME`       | **Display name**                                                                                                                                                                                           |
| `FEDIVERSE_ACTOR_SUMMARY`    | **Summary**                                                                                                                                                                                                |
| `FEDIVERSE_ACTOR_SOURCE_URL` | **Source URL**                                                                                                                                                                                             |

Keep `FEDIVERSE_ACTOR_IDENTIFIER`: it is the actor's address, and a site that skips the **Username** would have the identifier as its handle. `FEDIVERSE_HANDLE_HOST` is read once: the first boot pins its host (or the host of `URL`) as the first of the site's **Hosts**, which decides the handle; remove the variable afterwards (details in the package's notes). `global.fediverseHeader` leaves Global: the first boot copies its image into **Header** of the profile when that field is empty, never over an image already there, then drops the old relation (`src/migrations/fediverse-header.ts`; the log says `[fediverse] copied global.fediverseHeader into the default site`). From `0.7` the actor reads the profile and **Object type** from the default site, not from Site settings: the boot copies the Site settings into the default site once, and an edit of the Site settings' profile afterwards no longer reaches the actor. The copy of the profile is written below the Document Service (`src/migrations/site-settings-to-site.ts`), so the package's username lock, which refuses a username going from empty to a value once the actor has a follower, does not stop it: an upgrade with followers keeps the handle of `0.6`. The log line `[sites] the default site refused en.fediverse` or `[sites] could not write en.fediverse` means the copy failed, and it is tried again on the next boot.

A script or an automation that writes `PUT /api/site-setting` (or the Content Manager's single type) must write the Site instead (the Content Manager's `collection-types/plugin::micelio.site/<documentId>`, as an admin API token). An admin API token or a role that could write the single type does not get the Site by itself: grant **Site** (`create`, `update`) under Settings → Administration Panel → Roles, and the boot takes the theme out of it for every role but Super Admin.

### What the first `0.7` boot does

What stays as it was in the fediverse plugin: the image and Compose service names, the volumes, the health endpoint, `FEDIVERSE_ENABLED` (off by default: no routes, content types, permission actions or publish hooks) and `FEDIVERSE_ACTOR_IDENTIFIER`. The followers, interactions, federated articles, the messages waiting in `fedify_message_v2` and the actor key stay in the database; the actor id, the note and article ids and the comment anchors (`fediverseUri`, `fediverseNoteUri`) do not change. On the first boot the package gives the default site every row that has no site and copies the stored key to it (it logs counts only, for example `[fediverse] gave the default site 120 follower(s), 340 interaction(s), 85 federated article(s) and 1 actor key(s)`); a second boot changes nothing. The old key stays in the store for one release line. `npm run test:upgrade` proves it from `0.6.0` with followers, an interaction, a federated article, a queued delivery and the key seeded: no count falls.

**The site settings are edited on the Site entry.** **Breaking for editors and for scripts that write the single type.** In `0.7` the identity, contacts, modules, theme and home page of the site (Content Manager → **Site settings** in `0.6`) are edited on the default **Site** (Content Manager → **Site** → the entry marked default), the same fields in the same languages. The single type `api::site-setting` stays in the database for this release, hidden from the Content Manager and the Content-Type Builder, and nothing writes it: a `PUT`, `POST` or `DELETE` on `/api/site-setting` answers `405`, and the Content Manager refuses a write to it. The first boot copies it into the default site once (`src/migrations/site-settings-to-site.ts`; the log says `[sites] copied the site settings into the default site: …`), never over a value the site already holds, and a new instance starts from a neutral default site (`[sites] gave the default site a neutral description in …`). The single type is removed in `0.8`.

What stays as it was: `GET /api/site-setting` still answers, from the default site, with the same fields, the same `populate`, `fields` and `locale`, and the same `403` for a caller without the token's `find`; the frontend of `0.6` reads it unchanged. A custom API token keeps the permission `api::site-setting.site-setting.find` it has: that action is now the alias route's, so a token created by hand needs no change. The same goes for what #394 narrowed: only the Super Admin changes the **Theme** of the Site (`src/migrations/theme-permissions.ts` narrows the roles and admin API tokens that can write the Site, `src/utils/theme-access.ts` checks every write), and the theme picker is the input of **Theme ID** on the Site.

### After you upgrade

Read the Site entry once and check the **Theme**, the **URL** and the **Fediverse** profile; `npm run test:upgrade` proves the copy from `0.6.0`.

**Who sees the profile.** The Content Manager shows the **Fediverse** profile of a site to any role that can read it, and lets any role that can update the site edit it (the username stays locked while the actor has followers, whoever edits it). The profile is public in the actor document. On an upgraded instance Editor and Author read the site on its scalar fields only (`src/migrations/admin-page-site.ts`), so they do not see the profile; a new instance gives them what Strapi gives its default roles, which includes it. Restrict the fields of a role in Settings → Administration Panel → Roles if it must not.

**Granted roles.** With federation on before and after the upgrade, the grants of `plugin::fediverse.read` (the Fediverse page) and `plugin::fediverse.manage` (block, unblock, retry) survive. A boot with federation **off** removes them from every role but the super admin, because the package registers no action while it is off: after turning federation on again, grant them again.

**The Fediverse page** is **Fediverse** under **Site** in the Micelio sub-navigation, no longer an entry of the main menu, and the article edit view has its panel as before. They come from the package's admin entry, which Strapi bundles because `config/plugins.ts` lists the plugin as always enabled: the admin bundle contains them whatever `FEDIVERSE_ENABLED` is at build time.

**Queued deliveries.** A message the `0.6` image left in `fedify_message_v2` stays in the table. Fedify refuses a private address outside `NODE_ENV=test`, so the check proves the row survives, not that it is delivered.

### Known limitation: the core reports release line `0.6`

`@micelio/strapi-plugin-core` `0.2.0` still reports release line `0.6` (the Status page and `npx micelio doctor`), so its optional check `frontend-release-line` reports `fail` for a frontend that answers `0.7.x` on `/_health`. The check never stops a boot (`docs/operate/host-check.md` of the core). A later `0.7.z` raises the core to a release that declares `0.7` (the exception recorded in [ADR-0001](../adr/0001-core-pin-in-a-patch.md)); until then, read that `fail` as expected.

**Rolling back** from `0.7` to `0.6` is not supported across a MINOR (see the rules): restore the backup. The rows keep their `site` column, which `0.6` ignores.

## Upgrading to 0.6: the core plugin

The CMS now installs `@micelio/strapi-plugin-core` (exact version in `package.json`) and no longer carries its own `micelio` plugin. Nothing is to be done by hand: the URLs, the response shapes, the UIDs (`plugin::micelio.category`, `plugin::micelio.tag`), the tables and rows of `categories`, `tags` and their link tables, and the permissions of roles and tokens on them stay as they are (ADR-0017, amendment of 2026-10-26). `npm run test:upgrade` proves it from `0.5.0`.

**Breaking for operators.** In production the plugin's host check refuses to boot when a required check fails: `node`, `database`, `security-middlewares`, `content-security-policy`, `html-sanitiser` or `upload-provider`. The image of this release passes all six. A node that runs its own `config/middlewares.ts`, another database or no upload provider does not, and stops with a message that names the check and its fix. Before you upgrade, run `docker compose exec strapi npx micelio doctor` after the first boot of a staging copy (or read [Install](install.md#the-host-check)); outside production a failed check is only a warning.

What you see after the first boot:

- **A Micelio menu in the admin**, with the Status page (the host check, **Run again**) and About.
- **A default site.** The plugin creates one site, `Micelio` (slug `default`, `isDefault`), when there is none, and gives it to every category and tag that has no site, so the rows of `0.5` belong to it. Its `url` is the frontend's origin, taken at boot from the site setting's `url`, else from `FRONTEND_URL`, only while it is empty. The site's name, host names, `url` and modules are edited in the admin; the frontend keeps answering from the default site when a request names none. Do not delete it: boot migrations of this CMS create categories and tags on it.
- **The `frontend` token gains `plugin::micelio.preview.draft`** on the first boot (`src/migrations/api-tokens.ts` resets the token to its list); the log says `[api-tokens] updated the frontend API token` once. The preview's exchange (`plugin::micelio.preview.exchange`) is not added unless the site turns the preview on: set `MICELIO_PREVIEW=true` (and the frontend's `NUXT_PREVIEW_ADMIN_ORIGIN`, see [Configure](configure.md#preview)) and the boot grants it and keeps it. Without the switch, a token created from `FRONTEND_API_TOKEN` loses an exchange added by hand under Settings → API Tokens on the next boot, so the preview stops with a 404 frame after the restart. The demo, `MICELIO_DEMO=true`, grants it itself. A `frontend` token created by hand needs the permission added under Settings → API Tokens → Plugin: Micelio; without it a publish that has to measure the page is refused (bogd3v/micelio-plugin-core#46).
- **New tables** for the sites and the preview credentials (`micelio_sites`, `micelio_preview_credentials` and their link and component tables) and a `site` link for each category and tag (`categories_site_lnk`, `tags_site_lnk`). The existing tables keep their rows.
- **Pages belong to a site.** The first boot gives the default site to every page that has none: every language, draft and published (`src/migrations/page-site.ts`; the log says `[pages] gave N rows the default site`). `updatedAt` stays as it was, so no draft shows as modified. `/api/pages` answers the `frontend` token as before, because the default site answers a request that names none; `?site=<slug>` is new and optional, and a slug that no site has answers `404` (`unknownSite`). A link table `pages_site_lnk` is added.
- **The admin roles Editor and Author can pick a site** when they create a page (`src/migrations/admin-page-site.ts`). On the first boot they gain read on the sites (every language, no write) and the `site` field of their page permissions, matched by role name; without them the Content Manager shows no site and refuses the page ("site is required"). A permission an admin emptied on purpose is left as it is, and so are roles with other names. **Preview drafts on the frontend** is not granted: give it under Settings → Roles → Plugins → Micelio.
- **Only a Super Admin can change the site's theme** (`src/migrations/theme-permissions.ts`).
  The theme decides what the frontend downloads and installs,
  so the first boot removes the `theme` fields from `create` and `update` on the site settings
  for every admin role but Super Admin, and from the permissions of admin API tokens.
  The log says `[roles] took the theme out of N admin role permissions`;
  N also counts the permissions of admin API tokens.
  A role that could edit the site settings keeps editing the rest of them.
  On a default install Editor and Author cannot edit them at all
  until an admin grants a locale (and, for Author, removes the creator condition);
  this upgrade does not change that.
  The step runs on every boot, so a role you give the theme in Settings → Roles loses it again
  at the next restart.
  Between boots a write guard holds the same line:
  an admin session that is not Super Admin saves the form without the `theme` it sent.
  A content API token that sends `theme` gets `403`,
  and so does an admin API token whose permission still lists it
  (one created or edited since the last boot).
  An admin API token the boot has narrowed gets `200`:
  the other fields are saved and the `theme` it sent is dropped,
  so a script reports success and the theme does not change.
  The `frontend` and `build` tokens only read the site settings and are not affected.
  What to do: a script that sends `theme` with any API token, even unchanged,
  no longer changes it and may be refused.
  Leave `theme` out of what it sends, and change the theme as a Super Admin in the admin panel.
  No token can.
  Nothing else is done by hand.
- **A theme picker and an exact pin** (optional, nothing to migrate).
  `theme.themeId` is now a picker that lists the themes of the registry,
  and writes `themeVersion` and `themeDigest` next to it,
  so the settings name one exact version;
  a frontend that cannot install it keeps its current theme.
  Documents you already have keep their `theme` as it is, with the two new fields empty.
  The picker reads the registry's index anonymously from `MICELIO_THEME_REGISTRY`
  (default `ghcr.io/bogd3v/micelio-themes`, the variable the frontend reads, see
  [Configure](configure.md#theme-registry)).
  When the registry cannot be reached the field is a text input and everything else works.
  Only a Super Admin gets the list; any other role sees the same text input.
  Typing an id by hand leaves `themeVersion` and `themeDigest` as they were.
  The picker does not verify the index's signature: the frontend does, before it installs a theme.
- **Roles** keep their permissions on categories and tags. The permissions of the new types are the plugin's to register; the preview needs **Preview drafts on the frontend** under Settings → Roles → Plugins → Micelio ([preview](https://github.com/bogd3v/micelio-plugin-core/blob/main/docs/operate/preview.md)).

Back up first (step 2), as for any upgrade: going back is not supported across a MINOR, so a rollback is the previous image and a restore.

## Upgrading to 0.5: category and tag move into the `micelio` plugin

Categories and tags became content types of a local plugin `micelio` in this release (from 0.6 the same plugin is the published `@micelio/strapi-plugin-core`, see above): their UIDs change from `api::category.category` and `api::tag.tag` to `plugin::micelio.category` and `plugin::micelio.tag`. The URLs do not change (`/api/categories`, `/api/tags`), the tables and their rows stay where they are, and the frontend needs no change.

The first boot moves what Strapi stored under the old UIDs, before any plugin bootstraps (`renameLegacyUids`, which `@micelio/strapi-plugin-core` carries since 0.6): the permissions of the public and authenticated roles, the permissions of API tokens, the subject of admin role permissions and the saved content manager layouts. Nothing to do by hand, and a restart that stops halfway is safe to repeat. The migration is needed because Strapi deletes the permissions of an action that no longer exists: without it the public role would lose read access to categories and tags.

- **Back up first** (step 2): the rewrite cannot be undone. Going back to the previous image runs, but its code looks for the old UIDs: roles, tokens and layouts would start from scratch there.
- **Custom API tokens** created outside the `frontend` and `build` ones keep their permissions; the migration renames them in place. A script or an MCP client that names `api::category.category.find` in a new token gets `Unknown permissions provided`: use `plugin::micelio.category.find`.
- **Code and webhooks** that name the UIDs (`strapi.documents('api::category.category')`, the `uid` of a rebuild hook payload) must use the new ones.

## Upgrading to 0.5: articles are sent as a Note by default

With the fediverse plugin on, an article is now federated as a `Note` (the title in bold, the excerpt and the link) unless the site settings say otherwise: Site settings → Fediverse profile → Object type. Before, a site that never set it sent an `Article`. Nothing is re-sent at the upgrade: the new type goes out with the next publish or update of an article, and remote servers keep the type they stored until then. To keep sending `Article`, set Object type to `Article` before the first publish after the upgrade. There is no migration and nothing else to do.

## Upgrading to 0.5: categories lose `key`, `bird` and `pillar`

The category no longer has the attributes `key`, `bird` and `pillar` (use `featured`, `order` and `color`). A request that names them in `fields`, `filters` or `sort` is answered with 400, so run frontend 0.4 or later against this CMS. On the first boot the CMS copies `pillar` to `featured` for every category that has it, before Strapi drops the column; nothing else is needed. It is a boot migration that cannot be undone, so back up first (step 2): going back means the previous image and a restore. The migration is a file in `database/migrations/` that Strapi runs only when `runMigrations` is on in the database settings (the default); do not turn it off for this upgrade, or the `pillar` values are lost.

## 1. Read the release notes

Each GitHub release starts with its **Upgrade notes**, written by hand. It states the breaking changes, the theme contract it implements, the frontend line it was tested with and the minimum Node and PostgreSQL versions. Check your PostgreSQL version against the last one before you pull the image.

## 2. Back up

Back up the database and the uploads, and keep the current environment values. See [Backup](backup.md).

## 3. Pull and start the new image

Use the same environment and volumes. Wait for `GET /_health` to answer `204`: the migrations run on this boot, and the health check does not pass until the server is listening. Then open `/admin` and check one article.

If it does not come up, read the logs, fix the missing variable or the database access, and start it again. Do not roll the image back across a MINOR: restore the backup of step 2 instead.

**Purge of unconfirmed accounts and subscriptions.** From the release that adds `UNCONFIRMED_RETENTION_DAYS`, a daily job (not at boot) deletes reader accounts and newsletter subscriptions that were never confirmed and are older than that many days (default 30). The first run after the upgrade deletes everything already past the limit, and it cannot be undone: take the backup of step 2 first. Set `UNCONFIRMED_RETENTION_DAYS=0` before starting the new image to keep them. Confirmed accounts and subscribers, admin-created users and blocked users are never touched. Accounts are skipped too while the `email_confirmation` setting of users-permissions is off.

**Media Library import from a URL.** From the release that adds `UPLOAD_FROM_URL_ENABLED`, the "From URL" tab of the Media Library is off by default, and the CMS answers `403` to that import. Who is affected: admins who import files from an address. What to do: set `UPLOAD_FROM_URL_ENABLED=true` in the environment before starting the new image to keep it working. Uploading from the computer is not affected ([uploads.md](../security/uploads.md#import-from-a-url)).

## 4. Upgrade the frontend

Then upgrade the frontend as its own [upgrade guide](https://github.com/bogd3v/micelio/blob/main/docs/operate/upgrade.md) says.

## Image tags

The image is `ghcr.io/bogd3v/micelio-cms`. Each release `vX.Y.Z` publishes these tags:

| Tag                          | Moves                       | Use it for                                                                                    |
| ---------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `X.Y.Z`, for example `0.1.0` | Never                       | An exact version. Pin production to this.                                                     |
| `X.Y`, for example `0.1`     | With each PATCH of the line | Following the patches of a line without a MINOR change.                                       |
| `latest`                     | With each release           | The newest release. It may be a new MINOR or MAJOR, and before 1.0.0 it may break your setup. |
| `edge`                       | With each merge to `main`   | Testing only. Not a release.                                                                  |
| A commit SHA                 | Never                       | A specific build of `main`.                                                                   |

A release candidate, `vX.Y.Z-rc.N`, moves neither `X.Y` nor `latest`. A published version never changes: a bad release is fixed by the next patch. [Verify an image](verify-image.md) before you run it if you want to check where it was built.
