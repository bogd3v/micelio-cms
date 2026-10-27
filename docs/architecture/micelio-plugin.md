# The core plugin in this distribution

**Kind:** explanation. What `micelio-cms` configures of `@micelio/strapi-plugin-core`, what the package owns, and where its own documents are (ADR-0017 in `bogd3v/micelio`, sections 1 and 3 and the amendments of 2026-10-23 and 2026-10-26).

## What the distribution does

`@micelio/strapi-plugin-core` is a dependency of `package.json`, at an exact version (it is `0.x`, standard section 10), and `config/plugins.ts` turns it on with `micelio: { enabled: true }` and no `resolve`. Strapi finds it in `node_modules`. The plugin name is `micelio`, so its content types are `plugin::micelio.<type>` and its permission actions `plugin::micelio.<type>.<action>`.

The distribution keeps what a plugin cannot own (ADR-0017, section 3): the middlewares and the CSP (`config/middlewares.ts`), the uploads provider, the database, `.env.example`, the image and the API token lists. The plugin checks these at boot (the host check, below) and never changes them.

## What the package owns

| What                                                         | Where it is documented (in `bogd3v/micelio-plugin-core`)                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| The `site` type, the default site and the site scope         | `docs/api.md` ("Which site a request is for", "Sites")                                |
| `category` and `tag`, their routes and the legacy-UID rename | `docs/api.md` ("Category and tag"); the routes keep `/api/categories` and `/api/tags` |
| The host check, `npx micelio doctor` and the status page     | `docs/operate/host-check.md`, `docs/operate/status-page.md`                           |
| The preview and its permissions                              | `docs/operate/preview.md`                                                             |
| The blocks, the hooks and the extension points               | `docs/blocks.md`, `docs/hooks.md`, `docs/plugins/extension-points.md`                 |
| The site export                                              | `docs/export-format.md`, `docs/operate/export.md`                                     |

The package's documents are the reference; this page does not copy them.

## What the distribution adds to a core type

A plugin's type cannot target a type of the host, so the core cannot declare the inverse of `article.category` and `article.tags`. `src/extensions/micelio/strapi-server.ts` adds `articles` to the core's `category` (`oneToMany`, `mappedBy: 'category'`) and `tag` (`manyToMany`, `mappedBy: 'tags'`), the way `src/extensions/comments/strapi-server.ts` extends `strapi-plugin-comments` (ADR-0017, amendment of 2026-10-26, D5). `article.category` and `article.tags` keep `inversedBy: 'articles'`, so `populate=articles` on `/api/categories` and `/api/tags` answers as before (`tests/taxonomy-api.test.ts`). It is an extension and not a `schema.json` for the reason `comments` gives: Strapi merges schema files shallowly. The attribute moves into the core together with the type it targets; until then a site export of the core does not carry it.

## Sites

Category and tag belong to a site (ADR-0017, section 4), and the core refuses to create one without it. In a content API request the site comes from the request (the host, or `?site=`; without either, the default site answers, so the frontend needs no change). Outside a request, a boot migration, a script or a test names it: `defaultSiteRelation` (`src/utils/default-site.ts`) is the relation to the site with `isDefault`, which the core creates in its own `bootstrap`, before the host's. It names the site row by `id`, not by `documentId`: the `site` type is localised, and a `documentId` is looked up in the locale of the new entry, which fails when the default site has no row in that locale. `consolidate-categories`, `demo-seed`, `scripts/seed.js` and the suites that create categories or tags use it. The core gives the default site to the categories and tags that predate it (the rows of `micelio-cms` 0.5 have none).

## Permissions and tokens

The core exports `READ_ACTIONS` (`@micelio/strapi-plugin-core/strapi-server`) and `src/migrations/api-tokens.ts` spreads it into `FRONTEND_TOKEN_PERMISSIONS` and `BUILD_TOKEN_PERMISSIONS`: the host keeps one list per token (it must match micelio's `docs/security.md`), the plugin owns its UIDs. `plugin::micelio.preview.draft` is in the `frontend` list and the core registers it, so an action no plugin registers stops the boot, as every other one does. Role grants (the public `tag` read, the editor role) stay in the host's `bootstrap` (`src/migrations/public-tag-permissions.ts`, `editor-role.ts`): a plugin's `bootstrap` has no order relative to `users-permissions`, and on a fresh database the `public` role does not exist yet when it runs.

## The host check

In production (`NODE_ENV=production`) the core's `bootstrap` refuses to boot when a required check fails: `node`, `database`, `security-middlewares`, `content-security-policy`, `html-sanitiser` and `upload-provider`. Elsewhere it logs a warning per failure. The image passes all six (`sanitize-html` is a dependency; `config/middlewares.ts` keeps `strapi::errors`, `strapi::security` and `strapi::cors`). `docker compose exec cms npx micelio doctor` runs the same checks on demand with the container's production variables. How an operator reads it is in [Install](../operate/install.md) and [Upgrade](../operate/upgrade.md).

## Types

`strapi.documents('plugin::micelio.category')` compiles only once `types/generated/contentTypes.d.ts` knows the plugin's types, with the plugin loaded (ADR-0017, amendment of 2026-10-23, "generated types"). Regenerate it with `NODE_ENV=test npx strapi ts:generate-types` (without `NODE_ENV=test` the command stops on missing `APP_KEYS`); the file changes with every change to a core type, so a core upgrade that touches one regenerates it in the same pull request.

## What a plugin cannot do

- Boot migrations that need roles or host types stay in the host's `bootstrap`.
- The middleware stack, CSP, CORS and the upload provider are host configuration (`config/`). A plugin's `register` can change them through `strapi.config.set`, but that is silent and order-dependent: the core declares what it needs in its documents and the host applies it.
