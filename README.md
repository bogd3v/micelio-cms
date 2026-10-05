# Micelio CMS

Strapi 5 (TypeScript) headless CMS of [Micelio](https://github.com/bogd3v/micelio), a blog engine. [BogDev](https://bogdev.com.co) is the reference site running it. The CMS provides articles, categories, tags, comments, reader accounts, newsletter subscribers, visitor stats from Umami and optional ActivityPub federation. Production runs at `api.bogdev.com.co` (PostgreSQL), staging at `staging-api.bogdev.com.co` (SQLite).

## Run your own site

Try Micelio on your machine with Docker only: Postgres, this CMS and the [frontend](https://github.com/bogd3v/micelio), with a small bilingual demo blog.

```bash
docker compose -f compose.demo.yml up
```

- Blog: <http://localhost:3000>, in English and Spanish (three articles, two categories, an About page).
- Admin: <http://localhost:1337/admin>. Strapi asks you to create the first administrator on the first visit.
- `docker compose -f compose.demo.yml down` stops it and keeps the data; add `-v` to delete everything.

The first run generates Strapi's keys, the database password and the frontend's API token into a volume (`scripts/demo-secrets.js`), and the CMS seeds the demo content once (`MICELIO_DEMO=true`). Ports are bound to `127.0.0.1`: it is a demo, not a deployment.

**Make it yours** in the admin panel, _Content Manager → Site settings_:

| What                                                                         | Where                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name, description, author, social links, contact emails, logo, favicon       | Site settings, per language for the name and description                                                                                                     |
| Modules (newsletter, comments, accounts, drafts, fediverse, search, support) | Site settings → Modules                                                                                                                                      |
| Theme, mode, accent per mode and display font                                | Site settings → Theme ([theme contract](https://github.com/bogd3v/micelio/blob/main/docs/adr/0005-theme-contract.md)); the demo image ships the Bogotá theme |
| Content                                                                      | Articles, categories, tags and the About page; delete the demo ones when you are done                                                                        |

**To run it for real**, the minimum on the CMS is a database, Strapi's keys (`npm run generate:keys`), `URL` (the CMS's public URL), `FRONTEND_URL` (required in production), `CORS_ORIGINS` and `FRONTEND_API_TOKEN` (any random string of 32+ characters, the same value as the frontend's `NUXT_STRAPI_API_TOKEN`; the CMS creates the token with the right permissions on boot). The frontend needs `NUXT_PUBLIC_STRAPI_URL`, `NUXT_STRAPI_API_TOKEN` and `NUXT_PUBLIC_SITE_URL` (its README lists the rest). Some modules need outside services:

| Module         | Needs                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Accounts       | SMTP on the CMS (`SMTP_*`, `EMAIL_FROM`): confirmation and password reset emails                                        |
| Newsletter     | SMTP on the frontend (`NUXT_SMTP_*`, `NUXT_NEWSLETTER_FROM`)                                                            |
| Analytics      | A self-hosted [Umami](https://umami.is) (`UMAMI_*` on the CMS, `NUXT_*UMAMI*` on the frontend), see `docs/ANALYTICS.md` |
| Fediverse      | A public HTTPS domain for the CMS and `FEDIVERSE_*`, see `docs/FEDIVERSE.md`                                            |
| Media on a CDN | An S3-compatible bucket such as Cloudflare R2 (`R2_*`); without it uploads stay on the CMS's disk                       |

Turn off in the site settings the modules whose services you don't set up. `docs/CI_CD.md` describes how BogDev deploys it with Dokploy.

## Development

Requires Node 22 (`.nvmrc`).

```bash
npm ci
cp .env.example .env
npm run generate:keys     # fills the Strapi secrets in .env
npm run develop           # http://localhost:1337/admin, SQLite in .tmp/data.db
npm run seed:example      # optional sample content
```

## Checks

```bash
npm run typecheck && npm run lint && npm run format:check
npm test                  # boots a real Strapi per suite on an isolated SQLite file
```

CI runs the same checks plus `npm run build` on every pull request to `main`.

## Documentation

| Topic                                         | Where                       |
| --------------------------------------------- | --------------------------- |
| Architecture, commands, non-obvious behaviour | `CLAUDE.md`                 |
| Conventions, project layout, Strapi patterns  | `AGENTS.md`                 |
| CI/CD, Docker, Dokploy, environment variables | `docs/CI_CD.md`             |
| Reader accounts, editors, account deletion    | `docs/ACCOUNTS.md`          |
| Umami visitors and most read articles         | `docs/ANALYTICS.md`         |
| ActivityPub federation (`fediverse` plugin)   | `docs/FEDIVERSE.md`         |
| Content types, media, comments, seeding, etc. | `.claude/skills/*/SKILL.md` |
| Reporting vulnerabilities, dependency policy  | `SECURITY.md`               |
| Accepted dependency vulnerabilities           | `docs/DEPENDENCY_RISKS.md`  |

## Deployment

Pushing to `main` builds a Docker image, pushes it to GHCR and deploys it to production through Dokploy; `develop` deploys staging. See `docs/CI_CD.md`.
