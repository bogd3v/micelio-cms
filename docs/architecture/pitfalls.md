# Pitfalls

**Explanation** for contributors, human or agent: what surprises people before they change this repository. Each item points to the document that holds the detail. `AGENTS.md` links this page; it moved here from `CLAUDE.md`, which is a synced file.

- Publish and unpublish are only observable through `strapi.eventHub` (`entry.publish` / `entry.unpublish`, async after commit); Strapi 5 emits no `afterPublish` through `strapi.db.lifecycles`. The fediverse plugin lives in the package `@micelio/strapi-plugin-fediverse`; see `docs/FEDIVERSE.md`.
- Outgoing activities are queued (`@fedify/postgres` on PostgreSQL, in memory on SQLite): publishing returns once they are enqueued, a test must `waitUntil` the fake inbox, and the queued message holds the actor key, which the package encrypts. Fedify has no delivery-success callback, so nothing may say "delivered". See `docs/FEDIVERSE.md`.
- `unique: true` is Document Service validation only: there is no database index, so race-prone `db.query` inserts can duplicate. See `docs/FEDIVERSE.md`.
- Drafts are served to any `find` caller with `?status=draft`, populated relations included; `src/utils/drafts-access.ts` closes it, except on the core's two grant-checked preview routes. See `docs/architecture/drafts.md`.
- `strapi-plugin-comments` responses pass through a fixed zod schema that drops unknown attributes; add fields through `src/extensions/comments/strapi-server.ts` (never a `schema.json`) and re-attach them in a middleware like `src/middlewares/fediverse-comment-fields.ts`; its public endpoints also return pending comments (`hide-unapproved-comments.ts`). See `docs/architecture/comments.md`.
- `populate=*` does not reach nested components (`site.theme.accentOverrides`) and a fragment populate (`blocks.on`) drops components it does not name. See `docs/architecture/site-settings.md` and `docs/architecture/playground-blocks.md`.
- Strapi's telemetry (`analytics.strapi.io`) and the admin survey are off by default (`strapi.telemetryDisabled` in `package.json`, `FLAG_NPS=false`); turning them on is the operator's choice. See `docs/security/outbound.md`.
