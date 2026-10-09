# Micelio CMS

Strapi 5 (TypeScript) headless CMS of [Micelio](https://github.com/bogd3v/micelio), a site engine. [BogDev](https://bogdev.com.co) is the reference site running it. The CMS provides articles, categories, tags, comments, reader accounts, newsletter subscribers, visitor stats from Umami and optional ActivityPub federation. Production runs at `api.bogdev.com.co` (PostgreSQL), staging at `staging-api.bogdev.com.co` (SQLite).

## Run your own site

Try Micelio on your machine with Docker only: Postgres, this CMS and the [frontend](https://github.com/bogd3v/micelio), with a small bilingual demo blog.

```bash
docker compose -f compose.demo.yml up
```

- Blog: <http://localhost:3000>, in English and Spanish (three articles, two categories, an About page).
- Admin: <http://localhost:1337/admin>. Strapi asks you to create the first administrator on the first visit.
- `docker compose -f compose.demo.yml down` stops it and keeps the data; add `-v` to delete everything.

The first run generates Strapi's keys, the database password and the frontend's API token into a volume (`scripts/demo-secrets.js`), and the CMS seeds the demo content once (`MICELIO_DEMO=true`). Ports are bound to `127.0.0.1`: it is a demo, not a deployment.

The demo runs Micelio under the [AGPL-3.0](LICENSE): if you host a modified copy for others, you must publish your changes (the frontend's footer links to your source with `NUXT_PUBLIC_SOURCE_URL`).

### Dynamic, static or landing

| Profile | Command                                    | Choose it when                                                                         |
| ------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Dynamic | `docker compose -f compose.demo.yml up`    | You want accounts, comments, newsletter, drafts and search served live by the frontend |
| Static  | `docker compose -f compose.static.yml up`  | You want plain files a CDN can serve; the CMS is only needed at build time             |
| Landing | `docker compose -f compose.landing.yml up` | Like static, with a showcase page as the home instead of the blog list                 |

The static and landing profiles have their own project names (`micelio-demo-static`, `micelio-demo-landing`), so they never shares volumes, secrets or the seed with the dynamic demo or each other. Only run one stack at a time: all publish the site on port 3000. The `build` service (the `micelio-builder` image) runs `nuxt generate` against the CMS with the read-only build token and writes the site to the `demo-site` volume; `site` then serves it on <http://localhost:3000> with the generated `_headers` (the CSP of a static host). It only mounts `build.env`, not the secrets volume that holds the CMS's keys.

- After editing content in the admin panel, rebuild: `docker compose -f compose.<mode>.yml run --rm build` (`static` or `landing`). `site` picks the new files up without a restart.
- `nuxt generate` needs about 2 GB of free RAM and a few minutes the first time.
- Images and the newsletter form endpoint (`NUXT_PUBLIC_NEWSLETTER_FORM_ACTION`) go in an env file: `docker compose --env-file demo/<mode>.env.example -f compose.<mode>.yml up`. Tokens never go there.
- Rebuilding on publish is not wired locally (`REBUILD_HOOK_URL` stays unset).

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
npm run check             # typecheck, lint, format:check and tests (a real Strapi per suite on an isolated SQLite file)
```

CI runs the same checks plus `npm run build` and `reuse lint` on every pull request to `main`.

## Documentation

| Topic                                         | Where                             |
| --------------------------------------------- | --------------------------------- |
| Architecture, commands, non-obvious behaviour | `CLAUDE.md`, `docs/architecture/` |
| Conventions, project layout, Strapi patterns  | `AGENTS.md`                       |
| CI/CD, Docker, Dokploy, environment variables | `docs/CI_CD.md`                   |
| Reader accounts, editors, account deletion    | `docs/ACCOUNTS.md`                |
| Umami visitors and most read articles         | `docs/ANALYTICS.md`               |
| ActivityPub federation (`fediverse` plugin)   | `docs/FEDIVERSE.md`               |
| Content types, media, comments, seeding, etc. | `.claude/skills/*/SKILL.md`       |
| Reporting vulnerabilities, dependency policy  | `SECURITY.md`                     |
| Accepted dependency vulnerabilities           | `docs/DEPENDENCY_RISKS.md`        |
| The frontend's API token and its permissions  | `docs/API_TOKENS.md`              |

## Deployment

Pushing to `main` builds a Docker image, pushes it to GHCR and deploys it to production through Dokploy; `develop` deploys staging. See `docs/CI_CD.md`.

## License

Micelio CMS is free software under the [GNU AGPL-3.0-only](LICENSE), like the [frontend](https://github.com/bogd3v/micelio). If you run a modified Micelio as a service, you must offer its source to your users.

- **Third-party material** (dependencies, Strapi's Enterprise code, the example data) and the content your site stores are not covered by Micelio's license and keep their own: see [THIRD-PARTY.md](THIRD-PARTY.md). Strapi's Enterprise code stays disabled.
- **Contributing**: under the same license, with a DCO sign-off on every commit; see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Future versions**: Micelio CMS is AGPL version 3 only. A proxy named in [LICENSE](LICENSE) (section 14) can accept a later version of the AGPL for it; a change to any other license is not possible this way.
- **Integrations over the network**: Micelio's maintainer does not consider an app that only talks to Micelio CMS over its HTTP API, without including its code (the Micelio frontend, a hosting control panel, a bot), to be combined with it or covered by its license.
- **Per file**: every file's license and copyright are recorded in [REUSE.toml](REUSE.toml), following the [REUSE specification](https://reuse.software/); the license texts are in [LICENSES/](LICENSES/).

The reasons are in [ADR 0007](https://github.com/bogd3v/micelio/blob/main/docs/adr/0007-license.md) of the frontend.
