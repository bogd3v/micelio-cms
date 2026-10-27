# Agent Guidelines for micelio-cms

This is a **Strapi 5** CMS backend project. Below are conventions and commands for working with this codebase.

---

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md). This repository follows standard version 1.5 (`standard: 1.5`; `npm run lint:standard` checks the copy against the hashes bundled in `@micelio/eslint-config`). This file adds what is specific to this repository (stack, commands, folders, naming) and may tighten the standard, never relax it. When the two disagree, the standard wins.

## The factory

Work moves through the gates of the Micelio factory: [`docs/factory.md`](https://github.com/bogd3v/micelio-engineering/blob/main/docs/factory.md) in `micelio-engineering`. The worker proves each acceptance criterion and the verifier re-creates the run, on a clean copy of the worktree:

- `git init && git add -A` in the copy (`lint:ee` scans only the files git tracks, so untracked ones are not counted) and create `.env` from `.env.example`: the six values of `npm run generate:keys` (32 characters or more), `DATABASE_PASSWORD` (never `strapi`), `URL` and `FRONTEND_URL`, no `PORT`. Never print or commit it, and remove it before `npm run check`: a `.env` changes the fediverse tests.
- `docker compose up --build` (`docker-compose.yml`: the `production` image and PostgreSQL 18) is ready when `GET /_health` answers `204`; `docker compose down -v` removes it.
- `npm ci && npm run check` runs in the `node:22` image (`.nvmrc`), the copy mounted (`:z` on SELinux). A container that runs as root needs `git config --global --add safe.directory /app` (the mount point) first, or git refuses the copy, and it leaves root-owned `node_modules`, `dist` and `.tmp` in the mounted copy: run it with `--user "$(id -u):$(id -g)"` (and `-e HOME=/tmp`, the container's own writable directory, so no `.home/` is left in the mounted copy), or remove those folders from inside the container before it exits.
- `npm run test:upgrade` drives the host's Docker, so inside the `node:22` container it needs the socket and the CLI: `docker run --rm --network host --security-opt label=disable -v /var/run/docker.sock:/var/run/docker.sock -v /usr/bin/docker:/usr/bin/docker:ro -v /usr/libexec/docker/cli-plugins:/root/.docker/cli-plugins:ro -v <copy>:/app:z -w /app node:22 npm run test:upgrade` (the `Dockerfile` needs buildx, hence the plugins folder; `label=disable` lets SELinux allow the socket). Run it on a clean copy (it needs no `node_modules`); with `--network host` it reaches the ports it publishes on `127.0.0.1`, and it uses its own names and random ports, so it can run beside other stacks.
- A site with the frontend and no demo (the preview, `MICELIO_PREVIEW`) is `compose.demo.yml` copied outside the worktree and edited: `MICELIO_DEMO: 'true'` replaced by the variable under test (or removed), `MICELIO_CMS_IMAGE` the image built from the copy, `MICELIO_IMAGE` the frontend (`ghcr.io/bogd3v/micelio:edge` until 0.6), and a new `name:`, host ports, `PORT`, `URL`, `FRONTEND_URL`, `NUXT_PUBLIC_*` and `NUXT_PREVIEW_ADMIN_ORIGIN` when another stack runs. The `init` service writes the secrets (`scripts/demo-secrets.js`); `down -v` removes them.
- `docker compose up --build` always runs the `production` image, which refuses to boot without `FRONTEND_URL` (`FRONTEND_URL is required in production`). To observe the unset case, add a compose override that sets `NODE_ENV: development` and `FRONTEND_URL: ""` on the `strapi` service (an `environment` entry overrides `env_file`, which would otherwise supply the `.env` value; an empty value counts as unset), and bring the stack down with `down -v`.

`.claude/agents/{planner,master,worker,reviewer,verifier}.md`, the skills `ship-pr`, `blind-review` and `verify-pr` and `.github/pull_request_template.md` are copies of `micelio-engineering/template/`: fix them there.

## Build Commands

```bash
npm run build          # Build Strapi admin panel
npm run dev            # Start development server with hot reload
npm run develop        # Alias for dev
npm run start          # Start production server
npm run console        # Start Strapi CLI console
npm run seed:example   # Seed database with sample data
npm run strapi <cmd>   # Run Strapi CLI commands
```

## Quality & Test Commands

```bash
npm run check          # CI's fast steps in order: typecheck, lint (ESLint, placement, EE), format:check, test, lint:licenses, lint:standard
npm run typecheck      # Type-check the server, the fediverse plugin, the admin panel and the tests
npm run lint           # Run ESLint, the placement check and the EE check
npm run lint:licenses  # Production dependency licences against the AGPL-3.0 allowlist
npm run lint:standard  # The copy of the engineering standard matches the version pinned above
npm run lint:fix       # Run ESLint and auto-fix issues
npm run format         # Format files with Prettier
npm run format:check   # Check formatting without writing files
npm run test           # Run Jest test suite
npm run test:watch     # Run Jest in watch mode
npm run test:handles    # Serial run with --detectOpenHandles, to find leaked handles
npm run test:coverage  # Run Jest with coverage report
npm run test:upgrade   # Upgrade check from a released image on PostgreSQL (needs Docker; not in check)
```

### Node.js Requirements

- **Node**: `>=22.19.0 <=24.x.x` (production image and CI run Node 22; `.nvmrc` pins it for local dev)
- **npm**: `>=6.0.0`

---

## Project Structure

```
├── config/              # Application configuration
│   ├── admin.ts         # Admin panel settings
│   ├── api.ts           # API defaults (pagination, etc.)
│   ├── database.ts      # Database connections
│   ├── middlewares.ts   # Middleware stack
│   ├── plugins.ts       # Plugin configurations
│   └── server.ts        # Server settings
├── src/
│   ├── admin/           # Admin panel customization
│   ├── api/             # Content type definitions
│   │   └── <name>/
│   │       ├── controllers/<name>.ts
│   │       ├── routes/<name>.ts
│   │       └── services/<name>.ts
│   ├── components/      # Reusable components
│   ├── constants/       # Shared constants (content type UIDs, API prefixes)
│   ├── extensions/      # Plugin extensions
│   ├── middlewares/     # Global Koa middlewares
│   ├── migrations/      # One-off data migrations run from bootstrap
│   ├── plugins/         # Local plugin (fediverse: own constants/, types/, utils/)
│   ├── types/           # Shared TypeScript types
│   ├── utils/           # Shared helpers
│   └── index.ts         # Application lifecycle hooks
├── data/                # Seed data and uploads
├── scripts/             # Utility scripts
└── public/              # Static assets
```

### Where code goes

- **`constants/`, `types/`, `utils/`** hold what more than one file uses, or configuration-like values (content type UIDs, route prefixes, license tables). Import UIDs from `constants/uids.ts` instead of repeating `'api::article.article'`.
- Code specific to one domain stays next to it: `src/api/article/utils/` (citations, plain text), search limits in the article service.
- `npm run lint` runs `scripts/check-placement.mjs`: a type or constant imported by two or more files of `src/` must live in `src/types/`, `src/constants/` or the `types.ts` / `constants.ts` of its feature folder. It skips `src/migrations/` and the fediverse plugin.
- A type that is a service's contract (its inputs and outputs) goes in `types/`; row shapes private to one query stay in that file.
- `src/migrations/` is self-contained on purpose: each migration keeps its own constants so it keeps working after the code it migrated away from changes.
- The fediverse plugin mirrors this layout under `src/plugins/fediverse/server/src/` and **never imports from the root `src/`**: it is a separate TypeScript project bundled by esbuild. The `micelio` plugin (`category`, `tag`, sites, the host check; UIDs `plugin::micelio.*`) is the npm package `@micelio/strapi-plugin-core`, not code of this repository: `config/plugins.ts` enables it, `src/extensions/micelio/strapi-server.ts` adds the host's side of its types, and the host imports from `@micelio/strapi-plugin-core/strapi-server` (`docs/architecture/micelio-plugin.md`).

---

## Code Style Guidelines

### TypeScript Conventions

Exported functions declare their return type (`@typescript-eslint/explicit-module-boundary-types`). Every exported declaration has a TSDoc comment (standard, section 4, "Doc comments (TSDoc)"). `npm run lint` checks the syntax (`tsdoc/syntax`) and that the comment exists (`jsdoc/require-jsdoc`); both rules come from `@micelio/eslint-config` and cover every `.ts` file outside tests and declarations. Default exports that the framework discovers need none.

1. **Use `import type` for type-only imports**:

   ```typescript
   import type { Core } from '@strapi/strapi'
   ```

### Naming Conventions

| Item                 | Convention          | Example                  |
| -------------------- | ------------------- | ------------------------ |
| Content types        | kebab-case singular | `api::article.article`   |
| API routes           | kebab-case          | `/api/articles`          |
| Controllers/Services | kebab-case          | `controllers/article.ts` |
| Components           | PascalCase          | `SharedMedia`            |
| Config files         | camelCase           | `database.ts`            |

### Strapi API Patterns

**Creating documents** (Strapi 5 style):

```typescript
const draft = await strapi.documents('api::article.article').create({
  data: { title: 'Hello' },
})

await strapi.documents('api::article.article').publish({ documentId: draft.documentId })
```

### Environment Variables

- Access via `env('VAR_NAME', defaultValue)`
- Boolean: `env.bool('FLAG', true)`
- Integer: `env.int('PORT', 1337)`
- Array: `env.array('APP_KEYS')`

### Async code

`async`/`await` with `try`/`catch`. No `.then()`, `.catch()` or `.finally()` chains; `no-restricted-syntax` from `@micelio/eslint-config` fails `npm run lint` on them. `Promise.all`, `race`, `any` and `allSettled` are fine when awaited. `new Promise` only inside a small helper that adapts an event or callback API. A script's entry point wraps its `main()` in an async function with `try`/`catch` and exits non-zero on failure.

### Error Handling

Catch an error only where it can be handled or given context, log it with `strapi.log` (never `console` in `src/`) and never swallow it. Scripts use `async`/`await` with `try`/`catch`, not promise chains. See section 4 of the [engineering standard](docs/engineering-standard.md).

```typescript
// In services/queries - catch, add context and log the cause
try {
  await strapi.documents('api::model.model').create({ data })
} catch (error) {
  strapi.log.error(
    `Could not create model: ${error instanceof Error ? error.message : String(error)}`
  )
  throw error
}

// In standalone scripts - set the exit code
try {
  await main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
```

---

## Database Configuration

Supports two database clients configured via `DATABASE_CLIENT`:

```typescript
const connections = {
  postgres: {/* ... */},
  sqlite: {/* ... */},
}
```

- **Development default**: SQLite
- **Production**: PostgreSQL 18 (`DATABASE_URL`)

---

## Fediverse Federation

The plan for connecting this backend to the fediverse (ActivityPub/Mastodon) lives in `docs/FEDIVERSE.md`. Implementation is tracked via the `fediverse-federation` GitHub milestone (one issue per phase, 0–5). Read that document before touching `src/plugins/fediverse/`, the comments schema extension in `src/extensions/comments/`, or any fediverse-related env vars.

---

## Project Skills

Project-specific agent skills live in `.claude/skills/`. They are loaded automatically by Claude Code and cover the most common tasks for this headless CMS backend.

| Skill                 | Use when...                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| `strapi-content-type` | Adding or modifying content types, components, dynamic zones, slugs, i18n, or relations |
| `strapi-api-consumer` | Documenting or debugging how front-end/mobile apps consume the REST API                 |
| `strapi-media`        | Working with images, uploads, the upload provider, or image optimizer breakpoints       |
| `strapi-seeding`      | Seeding sample data, importing content, or setting public permissions programmatically  |
| `strapi-deployment`   | Docker image, env vars, health checks, backups                                          |
| `strapi-subscriber`   | Working with newsletter subscriptions, signup, or confirmation flows                    |
| `strapi-comments`     | Configuring or querying the comments plugin and moderation settings                     |
| `strapi-fediverse`    | Working on the ActivityPub plugin, Fedify, followers, replies, or `FEDIVERSE_*` vars    |

Each skill file is at `.claude/skills/<name>/SKILL.md`.

---

## Important Notes

1. **Jest + Supertest** configured for integration tests against an isolated SQLite database
2. **ESLint, Prettier and the base `tsconfig`** come from `@micelio/eslint-config`, `@micelio/prettier-config` and `@micelio/tsconfig`; `eslint.config.mjs` and the `tsconfig.json` files hold only what is this repository's own. Prettier has no semicolons. Run `npm run check` before committing
3. **Strict TypeScript** (`strict: true` in the root `tsconfig.json`, the fediverse plugin, `src/admin/` and `tests/`); `npm run typecheck` covers all four
4. **PostgreSQL 18** is the production database; backup and restore are in `docs/operate/backup.md`
5. **Comments plugin** (`strapi-plugin-comments`) enabled for articles
6. **GitHub Actions workflows** in `.github/workflows/` run CI on PRs/pushes and build the image on `main` (`docs/architecture/ci-pipeline.md`)
7. **MCP servers** are configured in `.mcp.json` (Claude Code asks for approval the first time). The `strapi` server authenticates with a Strapi **Admin API token** (content API tokens from Settings → API Tokens are rejected by `/mcp` with 401). No secret is in the repo: they are read from `~/.claude/secrets/` (`.claude/scripts/secret-header.sh` builds the auth header). GitHub and Playwright MCP servers are not configured here; Claude Code has its own plugins for both.
