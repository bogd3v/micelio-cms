# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A more detailed `AGENTS.md` already exists in this repo with naming conventions and Strapi API patterns — read it for anything not covered here. Project skills live in `.claude/skills/` (content types, API consumers, media, seeding, deployment, subscribers, comments, fediverse) and MCP servers are declared in `.mcp.json`; their secrets are read from `~/.claude/secrets/`, never from the repo.

## Project

Strapi 5 (TypeScript) headless CMS of Micelio, a site engine, shipped as a Docker image (see `docs/operate/install.md`). The production database is PostgreSQL 18, reached through `DATABASE_URL`; local dev defaults to SQLite.

## Commands

```bash
npm run develop         # dev server with hot reload (alias: dev)
npm run start           # production server, no reload
npm run build           # build the admin panel
npm run check           # typecheck, lint, format:check and test, in the order CI runs them
npm run typecheck       # tsc --noEmit for root, the fediverse plugin, the admin panel and tests/ (four separate projects)
npm run lint / lint:fix
npm run format / format:check
npm run test             # jest --forceExit (parallel workers)
npm run test:handles     # same, serial, with --detectOpenHandles to find leaks
npm run test:watch
npm run generate:keys    # print Strapi secrets to stdout; writes no file
npm run seed:example     # run scripts/seed.js
```

Run a single test file: `npx jest tests/fediverse.test.ts` (matches `**/tests/**/*.test.[jt]s`).

**`build:fediverse` runs automatically** as a `pre*` hook (`predev`, `predevelop`, `prebuild`, `pretest`) — it esbuild-bundles `src/plugins/fediverse/server/src/index.ts` into `src/plugins/fediverse/dist/strapi-server.js`. This is necessary because the fediverse plugin is its own TypeScript project (`src/plugins/fediverse/tsconfig.json`), excluded from the root `tsconfig.json` compilation, and depends on ESM-only packages (`@fedify/*`) that Strapi's own CJS build pipeline can't handle directly. If you edit plugin source and don't see changes, check that this bundle step ran.

## Pitfalls to know before any change

- Publish and unpublish are only observable through `strapi.eventHub` (`entry.publish` / `entry.unpublish`, async after commit); Strapi 5 emits no `afterPublish` through `strapi.db.lifecycles`. See `docs/FEDIVERSE.md`.
- Outgoing activities are queued (`@fedify/postgres` on PostgreSQL, in memory on SQLite): publishing returns once they are enqueued, a test must `waitUntil` the fake inbox, and the queued message holds the actor key, which `utils/observed-queue.ts` encrypts. Fedify has no delivery-success callback, so nothing may say "delivered". See `docs/FEDIVERSE.md`.
- `unique: true` is Document Service validation only: there is no database index, so race-prone `db.query` inserts can duplicate. See `docs/FEDIVERSE.md`.
- Drafts are served to any `find` caller with `?status=draft`, populated relations included; `src/utils/drafts-access.ts` closes it. See `docs/architecture/drafts.md`.
- `strapi-plugin-comments` responses pass through a fixed zod schema that drops unknown attributes; add fields through `src/extensions/comments/strapi-server.ts` (never a `schema.json`) and re-attach them in a middleware like `src/middlewares/fediverse-comment-fields.ts`; its public endpoints also return pending comments (`hide-unapproved-comments.ts`). See `docs/architecture/comments.md`.
- `populate=*` does not reach nested components (`site.theme.accentOverrides`) and a fragment populate (`blocks.on`) drops components it does not name. See `docs/architecture/site-settings.md` and `docs/architecture/playground-blocks.md`.
- Strapi's telemetry (`analytics.strapi.io`) and the admin survey are off by default (`strapi.telemetryDisabled` in `package.json`, `FLAG_NPS=false`); turning them on is the operator's choice. See `docs/security/outbound.md`.

## Before you touch X, read Y

| Area                                               | Read                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Content types, controllers, services               | `docs/architecture/overview.md`, `AGENTS.md`, `docs/security/response-fields.md`   |
| Fediverse plugin, federation                       | `docs/FEDIVERSE.md`, skill `strapi-fediverse`                                      |
| Comments                                           | `docs/architecture/comments.md`, skill `strapi-comments`                           |
| Drafts, editor role                                | `docs/architecture/drafts.md`                                                      |
| Accounts, users-permissions                        | `docs/ACCOUNTS.md`                                                                 |
| Security review, any requirement                   | `docs/security/asvs.md`, agent `security`                                          |
| Subscribers                                        | `docs/architecture/subscribers.md`, skill `strapi-subscriber`                      |
| Site settings, theme, modules                      | `docs/architecture/site-settings.md`                                               |
| Authors                                            | `docs/architecture/authors.md`                                                     |
| Categories                                         | `docs/architecture/categories.md`                                                  |
| The `micelio` plugin (category, tag)               | `docs/architecture/micelio-plugin.md`                                              |
| Pages, sections, rebuild hook                      | `docs/architecture/pages.md`                                                       |
| Demo instance, new instances, API tokens           | `docs/architecture/demo-instances.md`, `docs/API_TOKENS.md`                        |
| Playground blocks                                  | `docs/architecture/playground-blocks.md`                                           |
| Analytics                                          | `docs/ANALYTICS.md`                                                                |
| Rate limiting, client IP                           | `docs/RATE_LIMITING.md`                                                            |
| Keys, personal data, outbound calls, uploads, logs | `docs/security/` (`keys.md`, `data.md`, `outbound.md`, `uploads.md`, `logging.md`) |
| Tests                                              | `docs/architecture/testing.md`                                                     |
| Install, configure, upgrade, back up               | `docs/operate/`, skill `strapi-deployment`                                         |
| CI and the image pipeline                          | `docs/architecture/ci-pipeline.md`                                                 |
| Where each document lives                          | `docs/README.md`                                                                   |

Subsystem knowledge lives in these files, not here (standard, section 1). Add a new subsystem's notes to `docs/architecture/` and a row to this table.

## Agent team

Subagents live in `.claude/agents/`; how the main session orchestrates them, with each one's model and the hard limits, is in `.claude/TEAM.md`.

@docs/engineering-standard.md

@.claude/TEAM.md
