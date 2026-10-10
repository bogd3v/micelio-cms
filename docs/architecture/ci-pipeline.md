# The CI and image pipeline

**Kind:** explanation. What runs on every push and pull request, and how the image is produced. For contributors; operators run the published image ([Install](../operate/install.md)).

## Checks: `ci.yml`

`.github/workflows/ci.yml` is a reusable workflow, also run on every pull request to `main` or `develop`. It runs these jobs in parallel:

- `checks`: `npm audit --audit-level=critical`, typecheck, lint and format.
- `reuse`: `reuse lint`, the licence headers and `REUSE.toml`.
- `test`: the Jest suites, in two shards.
- `build`: `npm run build`.

A final job named `ci` passes only when all of them do. That name is the check the ruleset of `main` requires, so keep it when you add a job, and add the new job to its `needs`. `codeql.yml`, `scorecard.yml` and `dco.yml` run beside it.

A finding of `npm audit` that cannot be fixed yet goes in `docs/DEPENDENCY_RISKS.md` with its reason, never silenced without one.

## The image: `deploy.yml`

On a push to `main` or `develop`, `deploy.yml` calls `ci.yml` first; nothing is built or published unless it passes. Then:

1. `build-image` builds the image while `ci` runs and fills the GitHub Actions layer cache (`type=gha`). Nothing is pushed.
2. `build-and-push` waits for both, builds from that cache (almost all hits; if the cache was evicted it builds in full, only slower), pushes the image to GHCR and attests it.
3. A last `deploy` job calls the maintainers' own deployment hook. It is not needed to build or publish the image, and an operator never runs it.

A push that changes only files the image never contains (`docs/**`, Markdown files, `.claude/**`, the issue and pull request templates, `release.yml`, `dependabot.yml`; the `paths-ignore` list in `deploy.yml`, which follows `.dockerignore`) triggers nothing. Run the workflow by hand (`workflow_dispatch`) to rebuild without a new commit. A newer push waits for a running one: `concurrency` never cuts a build short.

Image tags and how a release produces them are in [Releasing](https://github.com/bogd3v/micelio/blob/main/docs/architecture/releasing.md) and [Upgrade](../operate/upgrade.md#image-tags). Each pushed digest carries a signed provenance attestation and an SBOM; see [Verify the image](../operate/verify-image.md). Third-party actions are pinned to a commit SHA with the tag in a comment; update both together.

## Pull request labels and release notes

`.github/workflows/pr-labels.yml` labels each pull request from its conventional title prefix: `feat` → `enhancement`, `fix` → `bug`, `docs` → `documentation`, `refactor` and `style` → `refactor`, `test` → `testing`, `ci` → `ci`, `perf` → `performance`, `chore` → `code-quality`. The scope `security` adds `security` and the scope `deps` gives `dependencies` (Dependabot pull requests are skipped). `.github/release.yml` groups GitHub's generated release notes by those labels. The labels are repository settings, so a fork creates them once.

## The Dockerfile

A multi-stage build:

1. **base**: Node 22 Alpine with the production environment.
2. **deps**: production dependencies only.
3. **build**: all dependencies (`--include=dev`, because `NODE_ENV=production` would otherwise skip the esbuild and TypeScript the build needs) and the Strapi build.
4. **production**: the compiled JavaScript from `dist/config` and `dist/src` (never the TypeScript source: Strapi's runtime loads only `.js` and `.json` config), the admin build from `dist/build` (without it `/admin` fails with "file not found"), the fediverse plugin's bundle and its `package.json`, and `database/` and `scripts/`. It installs `tini` (PID 1, forwards SIGTERM) and `su-exec`, and runs `docker-entrypoint.sh`, which fixes the ownership of `/app/public/uploads` and `/app/.tmp` and starts node as the unprivileged `node` user. The health check uses busybox `wget`, since the image has no `curl`.

The base image is pinned by digest (`FROM node:22-alpine@sha256:… AS base`), so two builds of one commit start from the same layers. The tag stays in the line for readers and must match the Node major in `.nvmrc`. Dependabot's `docker` ecosystem opens a weekly `chore(docker)` pull request that moves the digest; major tag changes are ignored and done by hand. To bump it manually, run `docker buildx imagetools inspect node:22-alpine` and copy the top-level `Digest`. npm downloads use a BuildKit cache mount, so the build needs BuildKit (the default in `docker buildx` and in Podman).

`.dockerignore` keeps `node_modules`, `.git`, `.env` files, `public/uploads`, the tests, `docs/`, `.github/` and agent tooling out of the image.

### Change the Dockerfile

Build and run it locally before you open the pull request:

```bash
docker build -t micelio-cms:test .
docker run -p 1337:1337 --env-file .env micelio-cms:test
curl -i http://localhost:1337/_health   # 204
```

### Add an environment variable

Add it to `.env.example` with a comment, to [Configure](../operate/configure.md), and to the code with a neutral default or as required (standard, section 5). Environment variables are not version-controlled, so the documentation is the record.
