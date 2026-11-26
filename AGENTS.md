# Agent Guidelines for micelio-cms

This is a **Strapi 5** (TypeScript) headless CMS backend: the CMS of Micelio, a site engine, shipped as a Docker image (`docs/operate/install.md`). Below are conventions and commands for working with this codebase.

---

## Engineering standard

The rules shared by every Micelio repository live in [`docs/engineering-standard.md`](docs/engineering-standard.md). This repository follows standard version 2.4 (`standard: 2.4`; `npm run lint:standard` checks the copy against the hashes bundled in `@micelio/eslint-config`). This file adds what is specific to this repository (stack, commands, folders, naming) and may tighten the standard, never relax it. When the two disagree, the standard wins.

## The factory

The stack runs on the factory host on rootless Podman, behind the same `docker compose` and `docker` CLI (the agent's start command, `herdr/factory-agent.sh enter` of `micelio-engineering`, sets `DOCKER_HOST` to `podman.socket` and the agent's slice; `herdr/master.md` there, "The host's runtime"), and in CI on Docker (the `Contract Tests` jobs of `.github/workflows/contract.yml` build the `production` image in the `Build the CMS image` step on every pull request). The steps below are the same on both; where the engines differ, a note says so (ADR-0002 of `micelio-engineering`, Decision 4: no compose change for one engine).

Work moves through the gates of the Micelio factory: [`docs/factory.md`](https://github.com/bogd3v/micelio-engineering/blob/main/docs/factory.md) in `micelio-engineering`. The worker proves each acceptance criterion and the verifier re-creates the run, on a clean copy of the worktree:

- `git init && git add -A` in the copy (`lint:ee` scans only the files git tracks, so untracked ones
  are not counted) and create `.env` from `.env.example`: the six values of `npm run generate:keys`
  (32 characters or more), `DATABASE_PASSWORD` (never `strapi`), `DATABASE_CLIENT=postgres` (the
  `.env.example` value, `sqlite`, overrides the compose default and the `strapi` container restarts on
  `EACCES: permission denied, mkdir '/.tmp'`; seen on Podman), `URL` and `FRONTEND_URL`, no
  `PORT`. `docker-compose.yml` publishes `${PORT:-1337}:1337`, and `PORT` from `.env` also becomes
  the port the server listens on inside the container, so the health check never answers; to publish
  another host port, set `PORT` in the environment of the `docker compose` command, not in `.env`.
  Never print or commit it, and remove it before `npm run check`: a `.env` changes the fediverse
  tests.
- `docker compose up --build` (`docker-compose.yml`: the `production` image and PostgreSQL 18) is ready when `GET /_health` answers `204`; `docker compose down -v` removes it. It tags the image it builds `ghcr.io/${GITHUB_REPOSITORY:-bogd3v/micelio-cms}:0.9`, which moves that tag off an image another stack on the host may run: set `GITHUB_REPOSITORY` to a name of your own in the environment of the command (`GITHUB_REPOSITORY=<name>/micelio-cms docker compose up --build`) and remove that image after `down -v`.
- `npm ci && npm run check` runs in the `node:22` image (`.nvmrc`), the copy mounted (`:z` on SELinux, or `--security-opt label=disable`). The copy is a folder made with `git init && git add -A`, never the worktree itself: a worktree's `.git` is a file that points outside the mount, so `git ls-files` (`lint:ee`) fails in the container. On the factory host (rootless Podman) run the container as root, with no `--user`: root in the container is the host user, so `node_modules`, `dist` and `.tmp` in the copy are owned by the user (`find <copy> ! -user "$(id -u)" | wc -l` prints `0`), and git accepts the copy with no `safe.directory`. Pass `-e HOME=/tmp`, the container's own writable directory, so no `.home/` is left in the mounted copy: `docker run --rm --security-opt label=disable -e HOME=/tmp -v <copy>:/app:z -w /app node:22 sh -c 'npm ci && npm run check'`. (`podman run --userns=keep-id --user "$(id -u):$(id -g)"` also keeps the files owned by the user; `--user "$(id -u):$(id -g)"` alone cannot write to the mount, and the Docker CLI refuses `--userns=keep-id`.) On a Docker host (rootful), a container that runs as root needs `git config --global --add safe.directory /app` first, or git refuses the copy, and it leaves root-owned `node_modules`, `dist` and `.tmp` in the mounted copy: run it with `--user "$(id -u):$(id -g)"` (and `-e HOME=/tmp`), or remove those folders from inside the container before it exits; on a rootless Docker the host user is root inside the container, so run without `--user`. Jest takes every core and times out hooks (60 s) when other stacks load the host (`npm run check` then fails 57 suites): pass the worker limit into the container, `-e VITEST_MAX_WORKERS=<n>` (or `-e JEST_MAX_WORKERS=<n>`, which wins) or the value `factory-slot.sh run` sets, as the other repositories do: `jest.config.js` reads both, a positive integer or a percentage, and `npm run check` is then limited with no flag.
- `npm run test:upgrade` drives the host's engine, so inside the `node:22` container it needs the socket and the CLI. On the factory host (Podman) the socket is `podman.socket`, mounted where the CLI looks for Docker's: build the image of the copy first, then run the check on it, because the buildx builder of the host (`docker-container` driver) keeps the image in its cache and the script's own pull of it fails (`docker pull failed`, `denied`): `docker build --load --target production -t <tag> <copy>`, then `docker run --rm --network host --security-opt label=disable -e UPGRADE_TO_IMAGE=<tag> -v "$XDG_RUNTIME_DIR/podman/podman.sock":/var/run/docker.sock -v /usr/bin/docker:/usr/bin/docker:ro -v /usr/libexec/docker/cli-plugins:/root/.docker/cli-plugins:ro -v <copy>:/app:z -w /app node:22 npm run test:upgrade`. The script builds nothing then and leaves `<tag>` in place: remove it afterwards (`docker rmi <tag>`). It needs no change in `scripts/upgrade-check/` on Podman. On a Docker host mount `-v /var/run/docker.sock:/var/run/docker.sock` instead, and the build with `UPGRADE_TO_IMAGE` unset works unless the build is not found afterwards (the same `docker pull failed`), when the two steps above apply. The `Dockerfile` needs buildx, hence the plugins folder; `label=disable` lets SELinux allow the socket. Run it on a clean copy (it needs no `node_modules`); with `--network host` it reaches the ports it publishes on `127.0.0.1`, and it uses its own names and random ports, so it can run beside other stacks. When `DOCKER_HOST` names another daemon's socket, mount that socket at `/var/run/docker.sock`, or the container is refused (`permission denied while trying to connect to the docker API`).
- A site with the frontend and no demo (the preview, `MICELIO_PREVIEW`) is `compose.demo.yml` copied outside the worktree and edited: `MICELIO_DEMO: 'true'` replaced by the variable under test (or removed), `MICELIO_CMS_IMAGE` the image built from the copy, `MICELIO_IMAGE` the frontend (`ghcr.io/bogd3v/micelio:edge` until 0.6), and a new `name:`, host ports, `PORT`, `URL`, `FRONTEND_URL`, `NUXT_PUBLIC_*` and `NUXT_PREVIEW_ADMIN_ORIGIN` when another stack runs. The frontend shares the `cms` service's network, so its server calls Strapi at `NUXT_PUBLIC_STRAPI_URL` inside that network: set the `cms` service's `PORT` to the host port of `URL`, publish it as `<port>:<port>` and change the `1337` of the `cms` health check to it, or every page of the frontend that reads the CMS answers `502` (`upstream, no response` in its log). The `init` service writes the secrets (`scripts/demo-secrets.js`); `down -v` removes them. To upgrade the stack to another `MICELIO_CMS_IMAGE` on the same volumes (a boot migration on released content), run `docker compose down` without `-v`, then `up -d` with the new image: on Podman, `up -d` alone cannot recreate `cms` (`has dependent containers`), and `restart cms` leaves the frontend without a network.
- The static and landing stacks (`compose.static.yml`, `compose.landing.yml`) run from the copy.
  Set `MICELIO_CMS_IMAGE` to the image built from the copy (`docker build -t <tag> <copy>`)
  and `MICELIO_BUILDER_IMAGE` to micelio's builder built from its `main`, which has the theme
  resolution (`git -C ../micelio archive origin/main | docker build --target static -t <tag> -`).
  Export both in every `docker compose` call: they do not survive between shell calls.
  Start with `docker compose -f compose.static.yml up -d cms`, create the first admin with
  `POST /admin/register-admin` and sign in with `POST /admin/login`.
  Each rebuild is `docker compose -f compose.static.yml run --rm build`,
  the admin reads its result at `GET /theme-picker/last-rebuild`, and `down -v` removes the stack.
  `npm run test:demo-stacks -- --file <file> --rebuilds <n>` runs this whole bullet in one command, with `MICELIO_CMS_IMAGE` and `MICELIO_BUILDER_IMAGE` exported (`docs/architecture/testing.md`, "Demo stack check").
- `docker compose up --build` always runs the `production` image, which refuses to boot without `FRONTEND_URL` (`FRONTEND_URL is required in production`). To observe the unset case, add a compose override that sets `NODE_ENV: development` and `FRONTEND_URL: ""` on the `strapi` service (an `environment` entry overrides `env_file`, which would otherwise supply the `.env` value; an empty value counts as unset), and bring the stack down with `down -v`.

An `express` or `normal` issue does not run the steps above on the stack (the lane is set by the paths it touches: [Lanes](https://github.com/bogd3v/micelio-engineering/blob/main/docs/factory.md#lanes) of `docs/factory.md` in `micelio-engineering`, and `## Lanes` below); this section describes the run for `full`.

`.claude/agents/{planner,master,worker,reviewer,verifier}.md`, the skills `ship-pr`, `blind-review` and `verify-pr` and `.github/pull_request_template.md` are copies of `micelio-engineering/template/`: fix them there.

## Lanes

The globs `factory-tools lint-lane` reads to set an issue's lane (`docs/factory.md` of `micelio-engineering`, "Lanes"). A path that matches `stack:` or `contract:` is `full`; one that matches only `express:` is `express`, unless it is normative (`AGENTS.md`, `CLAUDE.md`, `.claude/`, the standard); every other path is `normal`. `stack:` is the images, the compose files, the entrypoint, the boot configuration, the Node version and the scripts an operator or the pipeline runs against the stack; `contract:` is where a contract of section 6 of the standard lives in this repository (the content types, components and routes, the response shapes and their catalogue, the API token, role and admin permissions, CORS, the boot migrations and their wiring, the operator interface and its documentation); `express:` is Markdown that instructs no agent and records no decision (`docs/adr/` is outside it). Anything that matches no glob is `normal`.

```text
stack: Dockerfile, .dockerignore, .nvmrc, docker-entrypoint.sh, docker-compose.yml, docker-compose.verify.yml, compose.demo.yml, compose.landing.yml, compose.static.yml, demo/, database/migrations/, config/, server.js, scripts/upgrade-check/, scripts/demo-stack-check/, scripts/release/, scripts/demo-secrets.js, scripts/backup-volumes.sh, scripts/restore-volumes.sh, scripts/builder-last-run.sh, .github/workflows/deploy.yml, .github/workflows/demo-stacks.yml, .github/workflows/release.yml
contract: src/api/*/content-types/, src/api/*/routes/, src/components/, src/migrations/, src/policies/, src/middlewares/, src/extensions/, src/index.ts, src/utils/admin-auth-routes.ts, src/utils/cors-origins.ts, src/utils/drafts-access.ts, src/utils/theme-access.ts, src/utils/theme-picker-route.ts, src/constants/response-fields/, src/constants/roles.ts, types/generated/, .env.example, .github/workflows/contract.yml, scripts/contract/, docs/security.md, docs/security/response-fields.md, docs/API_TOKENS.md, docs/operate/
express: README.md, CONTRIBUTING.md, THIRD-PARTY.md, docs/*.md, docs/architecture/, docs/security/, docs/assets/
```

## Build Commands

```bash
npm run build          # Build Strapi admin panel
npm run dev            # Start development server with hot reload
npm run develop        # Alias for dev
npm run start          # Start production server
npm run console        # Start Strapi CLI console
npm run seed:example   # Seed database with sample data (runs scripts/seed.js)
npm run generate:keys  # Print Strapi secrets to stdout; writes no file
npm run strapi <cmd>   # Run Strapi CLI commands
```

## Quality & Test Commands

```bash
npm run check          # CI's fast steps in order: typecheck, lint (ESLint, placement, EE), format:check, test, lint:licenses, lint:standard
npm run typecheck      # Type-check the server, the admin panel and the tests
npm run lint           # Run ESLint, the placement check and the EE check
npm run lint:licenses  # Production dependency licences against the AGPL-3.0 allowlist
npm run lint:standard  # The copy of the engineering standard matches the version pinned above
npm run lint:fix       # Run ESLint and auto-fix issues
npm run format         # Format files with Prettier
npm run format:check   # Check formatting without writing files
npm run test           # Run Jest (jest --forceExit, parallel workers); `npm test -- tests/<file>` runs one suite
npm run test:watch     # Run Jest in watch mode
npm run test:postgres  # Serial Jest run for TEST_DATABASE_URL (PostgreSQL); the parallel run exhausts its lock table
npm run test:handles    # Serial run with --detectOpenHandles, to find leaked handles
npm run test:coverage  # Run Jest with coverage report
npm run test:upgrade   # Upgrade check from a released image on PostgreSQL (needs Docker; not in check)
npm run test:demo-stacks  # Demo stack check (needs Docker or Podman and the image variables; not in check)
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
- `npm run lint` runs `scripts/check-placement.mjs`: a type or constant imported by two or more files of `src/` must live in `src/types/`, `src/constants/` or the `types.ts` / `constants.ts` of its feature folder. It skips `src/migrations/`.
- A type that is a service's contract (its inputs and outputs) goes in `types/`; row shapes private to one query stay in that file.
- `src/migrations/` is self-contained on purpose: each migration keeps its own constants so it keeps working after the code it migrated away from changes.
- The distribution has no plugin code of its own: `src/plugins/` does not exist. Both plugins are npm packages that `config/plugins.ts` enables. The fediverse plugin (ActivityPub; UIDs `plugin::fediverse.*`) is `@micelio/strapi-plugin-fediverse` (repository `bogd3v/micelio-plugin-fediverse`, with its own `docs/`, suites, skill and agent); the host keeps only its side (`docs/FEDIVERSE.md`). The `micelio` plugin (`category`, `tag`, sites, the host check; UIDs `plugin::micelio.*`) is the npm package `@micelio/strapi-plugin-core`, not code of this repository: `config/plugins.ts` enables it, `src/extensions/micelio/strapi-server.ts` adds the host's side of its types, and the host imports from `@micelio/strapi-plugin-core/strapi-server` (`docs/architecture/micelio-plugin.md`).

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

The plan for connecting this backend to the fediverse (ActivityPub/Mastodon) lives in `docs/FEDIVERSE.md`. Implementation is tracked via the `fediverse-federation` GitHub milestone (one issue per phase, 0–5). Read that document before touching the comments schema extension in `src/extensions/comments/`, or any fediverse-related env vars.

---

## Before you touch X, read Y

Pitfalls that apply to any change are in [`docs/architecture/pitfalls.md`](docs/architecture/pitfalls.md); read it before any change.

| Area                                               | Read                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Content types, controllers, services               | `docs/architecture/overview.md`, `AGENTS.md`, `docs/security/response-fields.md`    |
| Fediverse plugin, federation                       | `docs/FEDIVERSE.md`, then the package's `docs/`, skill `strapi-fediverse` and agent |
| Fediverse move to the plugin package (0.7)         | `docs/architecture/fediverse-cut-over.md`                                           |
| Comments                                           | `docs/architecture/comments.md`, skill `strapi-comments`                            |
| Drafts, editor role                                | `docs/architecture/drafts.md`                                                       |
| Accounts, users-permissions                        | `docs/ACCOUNTS.md`                                                                  |
| Security review, any requirement                   | `docs/security/asvs.md`, agent `security`                                           |
| Subscribers                                        | `docs/architecture/subscribers.md`, skill `strapi-subscriber`                       |
| Site settings, theme, modules                      | `docs/architecture/site-settings.md`                                                |
| Authors                                            | `docs/architecture/authors.md`                                                      |
| Categories                                         | `docs/architecture/categories.md`                                                   |
| The core plugin (category, tag, sites, host check) | `docs/architecture/micelio-plugin.md`                                               |
| Pages, sections, rebuild hook                      | `docs/architecture/pages.md`                                                        |
| Demo instance, new instances, API tokens           | `docs/architecture/demo-instances.md`, `docs/API_TOKENS.md`                         |
| Playground blocks                                  | `docs/architecture/playground-blocks.md`                                            |
| Analytics                                          | `docs/ANALYTICS.md`                                                                 |
| Rate limiting, client IP                           | `docs/RATE_LIMITING.md`                                                             |
| Keys, personal data, outbound calls, uploads, logs | `docs/security/` (`keys.md`, `data.md`, `outbound.md`, `uploads.md`, `logging.md`)  |
| Tests                                              | `docs/architecture/testing.md`                                                      |
| Install, configure, upgrade, back up               | `docs/operate/`, skill `strapi-deployment`                                          |
| CI and the image pipeline                          | `docs/architecture/ci-pipeline.md`                                                  |
| Where each document lives                          | `docs/README.md`                                                                    |

Subsystem knowledge lives in these files, not here (standard, section 1). Add a new subsystem's notes to `docs/architecture/` and a row to this table.

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

Each skill file is at `.claude/skills/<name>/SKILL.md`.

---

## Important Notes

1. **Jest + Supertest** configured for integration tests against an isolated SQLite database
2. **ESLint, Prettier and the base `tsconfig`** come from `@micelio/eslint-config`, `@micelio/prettier-config` and `@micelio/tsconfig`; `eslint.config.mjs` and the `tsconfig.json` files hold only what is this repository's own. Prettier has no semicolons. Run `npm run check` before committing
3. **Strict TypeScript** (`strict: true` in the root `tsconfig.json`, `src/admin/` and `tests/`); `npm run typecheck` covers all three
4. **PostgreSQL 18** is the production database; backup and restore are in `docs/operate/backup.md`
5. **Comments plugin** (`strapi-plugin-comments`) enabled for articles
6. **GitHub Actions workflows** in `.github/workflows/` run CI on PRs/pushes and build the image on `main` (`docs/architecture/ci-pipeline.md`)
7. **MCP servers** are configured in `.mcp.json` (Claude Code asks for approval the first time). The `strapi` server authenticates with a Strapi **Admin API token** (content API tokens from Settings → API Tokens are rejected by `/mcp` with 401). No secret is in the repo: they are read from `~/.claude/secrets/` (`.claude/scripts/secret-header.sh` builds the auth header). GitHub and Playwright MCP servers are not configured here; Claude Code has its own plugins for both.
