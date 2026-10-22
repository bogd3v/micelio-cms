# The `micelio` plugin

**Kind:** explanation. Why `category` and `tag` live in a plugin and what that costs, so the next type that moves in does not repeat the spike (bogd3v/micelio-cms#316, ADR-0017 in micelio).

## What it owns

`src/plugins/micelio/` is a local Strapi plugin bundled by esbuild, like the fediverse plugin (`npm run build:micelio`, run by the `pre*` hooks). It owns the content types `plugin::micelio.category` and `plugin::micelio.tag` with their controllers, services and routers. Their `collectionName` stays `categories` and `tags`, so the tables did not change.

- **Routes.** A plugin's content-api routes are served under `/api/<plugin>/…`. Each router passes `prefix: ''` to `createCoreRouter`, which keeps `/api/categories` and `/api/tags`.
- **Types.** `strapi.documents('plugin::micelio.category')` only compiles once `types/generated/contentTypes.d.ts` knows the plugin. Regenerate it with `NODE_ENV=test npx strapi ts:generate-types` (without `NODE_ENV=test` the command stops on missing `APP_KEYS`).
- **i18n and the content manager** behave as for an `api::` type. `pluginOptions['content-manager'].visible: false` hides a type from the content manager.
- **Permissions.** Actions are `plugin::micelio.<type>.<action>`. The plugin exports `READ_ACTIONS` (`src/plugins/micelio/server/src/constants/actions.ts`) and `src/migrations/api-tokens.ts` spreads it into `FRONTEND_TOKEN_PERMISSIONS` and `BUILD_TOKEN_PERMISSIONS`: the host keeps one list per token (it must match micelio's `docs/security.md`), the plugin owns its UIDs.

## The rename migration

`renameLegacyUids` moves the permissions of roles and API tokens, the subject of admin role permissions and the content manager layouts from the old UIDs to the new ones. It runs on the `strapi::content-types.beforeSync` hook, registered in the plugin's `register`.

Why there: the order is plugin `register`, host `register`, database sync, plugin `bootstrap`, host `bootstrap`, and `users-permissions` bootstraps after the `micelio` plugin only by loading order. Its `syncPermissions()` deletes every permission whose action no longer exists, so the rename must come first whatever that order is. The hook runs after the models are loaded and before the schema sync, so `strapi.db.query` works and a fresh database (no tables yet) is skipped. `tests/plugin-uid-migration.test.ts` restarts Strapi on a database holding the old UIDs.

A row that already exists under the new UID wins over its old twin, which is deleted. A second run changes nothing.

## What a plugin cannot do

- Boot migrations that need roles or host types stay in the host's `bootstrap`: the `micelio` plugin bootstraps before `users-permissions`, so on a fresh database the `public` role does not exist yet.
- The middleware stack, CSP, CORS and the upload provider are host configuration (`config/`). A plugin's `register` can change them through `strapi.config.set`, but that is silent and order-dependent: declare what the plugin needs in the docs and let the host apply it.
