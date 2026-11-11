# Configure the CMS

**Kind:** reference. Goal: look up what a variable does and what it needs. `.env.example` lists every variable with its default; this page adds what that file cannot say.

The code carries no value of any one site. What identifies your site comes from these variables and from the site settings in the admin panel. A new database starts with neutral site settings ("Micelio") and English account emails with that name.

Never commit a `.env` file with real secrets. Set the variables in the environment of your container.

## Required

<a id="required"></a>

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=1337
URL=https://cms.example.com            # the CMS's public origin

# Strapi's keys: node scripts/generate-keys.js
APP_KEYS=<comma-separated-keys>
API_TOKEN_SALT=<salt>
ADMIN_JWT_SECRET=<secret>
TRANSFER_TOKEN_SALT=<salt>
JWT_SECRET=<secret>
ENCRYPTION_KEY=<key>

# Database: PostgreSQL 18 in production
DATABASE_CLIENT=postgres
DATABASE_URL=postgres://user:password@db:5432/strapi   # or the DATABASE_HOST, _PORT, _NAME, _USERNAME and _PASSWORD set
DATABASE_SSL=false

UPLOAD_PATH=/app/public/uploads

# The frontend: links in emails, analytics paths, federated links and the
# site settings' URL, and the one origin the admin may frame for the preview.
# Without it a production boot stops with an error.
FRONTEND_URL=https://example.com
```

`DATABASE_CLIENT` defaults to `sqlite` (`.tmp/data.db`), which is for development and tests. The pool and timeout settings (`DATABASE_POOL_MIN`, `DATABASE_POOL_MAX`, `DATABASE_CONNECTION_TIMEOUT`, `DATABASE_SCHEMA`) are in `.env.example`.

## API tokens

The CMS creates the tokens the frontend uses on boot, from these values (32 or more random characters each). Unset, nothing is created. Their permissions and the reason for each are in `docs/API_TOKENS.md`.

```env
FRONTEND_API_TOKEN=<32+ random characters>   # the frontend's NUXT_STRAPI_API_TOKEN
BUILD_API_TOKEN=<32+ random characters>      # read-only, for static builds
```

## Security

```env
CORS_ORIGINS=https://example.com   # browser origins allowed by CORS, comma separated
STRAPI_MCP_ENABLED=true            # /mcp (admin API tokens); false where no agent needs it
POPULATE_MAX_DEPTH=3               # relation levels a content API `populate`, `filters` or `sort` may nest
STRAPI_REMOTE_TRANSFER_ENABLED=false   # Strapi's remote data transfer; off by default
# PASSWORD_BANNED_WORDS=my-site,my-org   # words no reader password may contain
```

Reader passwords need 8 or more characters, may not be one of the 3000 most common passwords or in a local list of 45,986 breached ones (no password leaves the server), and may not contain `micelio`, `strapi` or a word of `PASSWORD_BANNED_WORDS` (comma separated, 4 or more characters each: set the site and organisation names). The check runs on sign-up, reset and change; an existing password is not re-checked. Admin passwords follow Strapi's own rules. Details in `docs/security/authentication.md`.

Without `CORS_ORIGINS` only the origin of `FRONTEND_URL` is allowed (browsers fetch 3D scene models from the CMS, and that is the one page that needs it). List more origins, comma separated, when the site is also served from another one, such as `www` and the bare domain. The admin panel is same-origin and fediverse servers call server to server, so neither needs to be listed. Credentials (cookies, `Authorization`) are allowed only to listed origins: `CORS_ORIGINS=*` still reflects any origin, without credentials.

`FRONTEND_URL` is also the origin the admin may frame for the preview: the admin's CSP carries `frame-src 'self'` plus the scheme, host and port of `FRONTEND_URL` (its path is dropped), and no other origin. The preview of the builder (`@micelio/strapi-plugin-core`) loads the site in an iframe of the admin, and without that origin the browser refuses the frame. Unset outside production, or not an `http(s)` URL, the admin frames only itself.

`STRAPI_REMOTE_TRANSFER_ENABLED` is off by default. Strapi enables its remote data transfer unless told otherwise: with a transfer token created in the admin panel (`TRANSFER_TOKEN_SALT` signs them), another Strapi instance can pull or push the whole database over `/admin/transfer`. Nothing in these guides uses it: back up with `pg_dump` and the uploads volume ([Backup](backup.md)). Set it to `true` only for the time of a migration between instances, then back to `false`; with it off those routes answer `404`. Local `strapi export` and `strapi import` need no setting.

The request log (`global::request-logger`, instead of Strapi's `strapi::logger`) writes the method, the path, the time and the status, never the query string: account confirmation and the newsletter lookups carry emails and live tokens there. A reverse proxy in front has its own access log; configure it the same way.

Every response carries HSTS (one year, subdomains included), `nosniff` and a frame restriction (`frame-ancestors 'self'`), federation responses too, and the CSP sets `base-uri 'none'`. Answers that are per user or token-only (`/api/auth/*`, `/api/users/me`, site settings, subscribers, and content API reads with `status=draft`) carry `Cache-Control: private, no-store`; public content is left to your proxy or CDN. A CDN that keeps its own copy must honour these headers. HSTS makes browsers refuse plain http for the domain for a year: serve the CMS over https before exposing it.

A content API request whose `populate`, `filters` or `sort` nests deeper than `POPULATE_MAX_DEPTH` levels (default 3, the deepest the Micelio frontend asks for) is answered with 400: Strapi has no limit of its own, and articles, categories and tags relate back to each other. In `filters` each relation key is a level and `$and`, `$or`, `$not` and comparison operators (`$eq`, `$in`) are not (`filters[category][slug][$eq]` is 2); in `sort`, each dotted segment is. A custom frontend that needs more raises the value.

## Telemetry and the admin survey

Micelio makes no request to Strapi's analytics host unless you opt in. Strapi telemetry is off through `"telemetryDisabled": true` under `strapi` in `package.json`, and the admin satisfaction survey is off (`FLAG_NPS=false`). To turn the survey on, set `FLAG_NPS=true`. To turn telemetry on, remove `telemetryDisabled` from `package.json` before building the image (`STRAPI_TELEMETRY_DISABLED=true` can only switch it off, never on). Upgrading needs no action; a site that relied on the old defaults loses only those two reports.

Outbound connections, telemetry and the admin survey are listed in [outbound.md](../security/outbound.md). Strapi's telemetry and the survey are off by default (see above), and the update check is turned off in `config/server.ts` (`logger.updates.enabled`).

## Rate limiting

<a id="rate-limiting"></a>

The CMS limits requests itself, on by default, whatever sits in front of it. Groups, store, client IP resolution and how to check the address the app sees are in `docs/RATE_LIMITING.md`; every variable is in `.env.example`. The two settings that depend on your infrastructure:

```env
RATE_LIMIT_ENABLED=true     # false restores the previous behaviour (only the users-permissions /api/auth limiter)
TRUST_PROXY=1               # proxy hops in front of the app; private (default), false, N or a CIDR list
RATE_LIMIT_FORWARDER_SECRET=<32+ random characters>   # same value as NUXT_STRAPI_FORWARDER_SECRET in the frontend
# RATE_LIMIT_STORE=database # only with several replicas on PostgreSQL; memory (default) is per process
```

The frontend calls the CMS from one server address until it forwards its visitors' addresses. To turn the limits on for a site that already runs, in this order:

1. Set `RATE_LIMIT_ENABLED=false` and `TRUST_PROXY` to the number of proxies in front of the CMS, and deploy. No limit changes; the client address now comes from `TRUST_PROXY`.
2. Deploy a frontend release that forwards the client address.
3. Generate the secret (`openssl rand -base64 32`), set it on both sides, set `RATE_LIMIT_ENABLED=true` and restart both.
4. Check the client address as `docs/RATE_LIMITING.md` describes before you rely on the limits.

To roll back, set `RATE_LIMIT_ENABLED=false` and restart the CMS. No image rollback and no data change is needed.

With one instance the default `memory` store is right; its counters reset on every restart. `RATE_LIMIT_STORE=database` is for several replicas on PostgreSQL sharing their counters, and falls back to memory on SQLite.

## Email (accounts)

Reader accounts need SMTP for the confirmation and password reset emails, and `FRONTEND_URL` for the links inside them. Set `FRONTEND_URL` before the first deploy that includes accounts: the links are written to the Users & Permissions settings once, then edited in the admin panel. Full behaviour in `docs/ACCOUNTS.md`.

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587                                 # 465 = implicit TLS
SMTP_REQUIRE_TLS=true                         # refuse to send in clear; only the value false turns it off
SMTP_USER=
SMTP_PASS=
EMAIL_FROM="My site <no-reply@example.com>"   # a sender the SMTP provider accepts; unset: no-reply@<FRONTEND_URL host>
```

Without `SMTP_HOST` no email is delivered. After deploying, send a test email from the admin panel (Settings → Email).

## Media

Uploads stay on the CMS's disk unless you set an S3-compatible bucket (the variables carry the name of Cloudflare R2, but any compatible service works):

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_BASE_URL=https://media.example.com   # public URL of the bucket; also allowed in the admin's CSP
```

With the local disk the files are served from the CMS origin, the one the admin panel runs on, so the CMS treats an upload as untrusted: HTML and XHTML uploads are refused, and everything under `/uploads` is sent with `X-Content-Type-Options: nosniff`. Anything that is not a raster image, video, audio or PDF (an SVG, a text file) also gets `Content-Security-Policy: … sandbox` and `Content-Disposition: attachment`, so opened on its own it runs no script; as an `<img>` it renders as usual. A bucket on its own origin avoids the question, and is the better choice when editors are not all trusted.

The local provider is meant for development and small setups. A file that a browser renders inline runs with the privileges of the admin origin, which is why `global::upload-headers` serves only raster images, video, audio and PDF inline and everything else as an attachment under a sandbox policy. In production, serve uploads from object storage (the `R2_*` variables above) or from another hostname. With `NODE_ENV=production` and the local provider, the CMS logs one `[uploads]` warning at boot and keeps starting; there is no setting to silence it. Setting `R2_BUCKET` removes it.

**Import from a URL.** The Media Library "From URL" tab is off by default: the CMS answers `403` to that import. Set `UPLOAD_FROM_URL_ENABLED=true` (exactly `true`; `TRUE`, `1` and `yes` leave it off) to let admins import files from an `http` or `https` address. Uploading from the computer is not affected.

Accepted types, the size limit and the headers that keep an upload inert when opened are in [uploads.md](../security/uploads.md).

## Analytics (Umami)

The CMS reads the visitors of each article from a self-hosted [Umami](https://umami.is) every hour and serves the most read list at `GET /api/articles/popular`. Without `UMAMI_URL` nothing runs and that endpoint answers an empty list. Full behaviour in `docs/ANALYTICS.md`.

```env
UMAMI_URL=http://umami:3000      # an address the CMS container reaches, not necessarily the public domain
UMAMI_WEBSITE_ID=<website id>
UMAMI_API_KEY=umami_...          # API key of a View only user
UMAMI_SYNC_CRON=0 * * * *        # optional, default shown
UMAMI_PUBLIC_URL=https://analytics.example.com   # optional, link in the admin widget
STRAPI_DISABLE_CRON=false        # true disables every cron task, this one included
```

In production the CMS refuses to boot, naming the variable, when `UMAMI_URL` is `http://` and its host is public. `https://` is always accepted, and so is `http://` on a private network: a loopback or private address, `localhost`, a service name without a dot, or a name ending in `.internal`, `.local` or `.localhost`. There is no setting to switch the check off. The API key would otherwise cross the network in the clear.

`UMAMI_URL` must be the final address: the CMS does not follow redirects (such as `http` to `https` or a missing trailing slash). A redirect is refused, the sync fails and the error is logged.

Check that the container reaches Umami before you deploy: the first sync runs right after boot and logs `[umami] synced article visitors: {...}`, or `[umami] sync failed` with the reason.

### Unconfirmed accounts and subscriptions

```bash
UNCONFIRMED_RETENTION_DAYS=30    # optional, default shown; 0 disables the purge
```

A daily job (cron must be enabled) deletes reader accounts that never confirmed their email and newsletter subscriptions that were never confirmed, once they are older than this many days. The value is a whole number of days from 0 to 36500; anything else (negative, decimal, text, above 36500) stops the boot naming the variable. Accounts are purged only while the users-permissions `email_confirmation` setting is on (it is by default): with it off, unconfirmed users can sign in, so the job leaves accounts alone and still purges subscriptions. Blocked unconfirmed accounts are kept without a time limit. Deletion is permanent: see [Upgrade](upgrade.md) before the first run.

## Theme registry

The theme picker in Site settings (Super Admin only) lists the themes of the registry's index.

- `MICELIO_THEME_REGISTRY` (`host[:port]/path`, https, or http on a loopback host) defaults to
  `ghcr.io/bogd3v/micelio-themes`. It is the same variable the frontend reads.
- The CMS reads `index:v1` anonymously and keeps it five minutes. When it cannot, the field is a
  text input and everything else works.
- The picker does not verify the index signature: the frontend does, before it installs a theme,
  with the signer it expects. A registry that is not the default needs its signer set on the
  frontend (micelio ADR 0009).

## Static and landing sites (rebuild hook)

Static and landing sites are rebuilt when content changes: on publish, unpublish or delete of an article or a page, and on every save of the site settings, the About page or a category, the CMS calls `REBUILD_HOOK_URL` once per debounce window, with retries, without ever blocking the publish (`src/utils/rebuild-hook.ts`). The body is `{"event_type": "micelio-content", "client_payload": {...}}`, what GitHub's `repository_dispatch` requires; plain deploy hooks ignore it.

```env
REBUILD_HOOK_URL=https://api.github.com/repos/<owner>/<site-repo>/dispatches
REBUILD_HOOK_TOKEN=<fine-grained token with Contents: read and write on that repo>
REBUILD_HOOK_DEBOUNCE_MS=60000   # changes within the window produce one call
```

`REBUILD_HOOK_URL` follows the same rule as `UMAMI_URL`: in production a public `http://` URL stops the boot, because the bearer token would travel in the clear. It must also be the final address: a redirect is refused and logged as one warning, without retries.

A site in dynamic mode sets none of them.

### Showing the admin why a rebuild failed

The hook only starts the build and never sees how it ends.
A static or landing build refuses a theme it cannot use and keeps the site published before it
(micelio `docs/operate/static-site.md`), and the reason is in the builder's output.
To show it in the admin, next to the theme setting, the builder records its last run in a file
and the CMS reads that file:

```env
REBUILD_STATUS_FILE=/build-status/last-run   # empty (the default): nothing is recorded or shown
```

- The builder runs through `scripts/builder-last-run.sh`
  (`builder-last-run.sh micelio-builder generate`) with the same `REBUILD_STATUS_FILE`.
  It writes the exit code, the time, whether the output held a site before the run
  and the builder's `Static theme: …` lines,
  and replaces the whole file when the run ends.
- The CMS needs the file read-only, in a volume the builder can write.
  `compose.static.yml` and `compose.landing.yml` set all of this up.
- Only the Super Admin, the role that may change the theme, reads it
  (`GET /theme-picker/last-rebuild` of the admin API; no API token reaches it).
- A failed run shows the reasons and, when the builder said so and the output held a site, that
  the previous site is kept in the output volume (kept, not necessarily served).
  A later good run replaces the record.
- The admin shows no text the builder printed.
  The script drops all of the output but those lines, and the CMS parses each `Static theme: …`
  line into a code of a fixed list: the settings could not be read (with the HTTP status), the
  settings are not valid, the theme was refused (with the switch's rule: `pin`, `unknown`,
  `code`, `off`, `tier`, `limit`, `registry`, `install` or `integrity`; an invalid theme id, and a
  registry that does not list the version or lists the theme as not public, have their own
  sentence; any other `registry` refusal says only that the theme could not be installed from it)
  or was not ready (with the seconds waited).
  No theme id is shown.
  The rest of the line, the switch's own message included, is not shown, and a line that does not
  parse shows "see the builder's log".
- A site that rebuilds with a GitHub workflow or another job runs its builder through the same
  script and mounts the same file for the CMS, or leaves the variable empty and reads the log.

## Fediverse (ActivityPub)

Federation is the package [`@micelio/strapi-plugin-fediverse`](https://github.com/bogd3v/micelio-plugin-fediverse) (exact version in `package.json`). This image lists it in `config/plugins.ts` as always enabled and the package reads `FEDIVERSE_ENABLED` itself: **off by default**, it is an empty plugin with no routes, content types, permission actions, admin page, status check or export section. What this repository still owns is in `docs/FEDIVERSE.md`; everything else (every variable, the profile, hosts and the handle, the Fediverse page and its diagnostics, the delivery queue, the move of an article to the editorial workflow, rollback) is in the package's [`docs/operate/configure.md`](https://github.com/bogd3v/micelio-plugin-fediverse/blob/main/docs/operate/configure.md), and the upgrade in its [`docs/operate/upgrade-0.7.md`](https://github.com/bogd3v/micelio-plugin-fediverse/blob/main/docs/operate/upgrade-0.7.md).

```env
FEDIVERSE_ENABLED=true                  # master switch; off = no fediverse routes, content types or publish hooks
FEDIVERSE_ACTOR_IDENTIFIER=blog         # required while enabled: path of the actor URI; never change it, remote follows are keyed by it
FRONTEND_ARTICLE_PATH=/blog/{slug}      # optional: article path template
FRONTEND_DEFAULT_LOCALE=en              # deprecated: the site's Default locale replaces it
```

While enabled, `FEDIVERSE_ACTOR_IDENTIFIER` has no default: without it the plugin refuses to start. `FEDIVERSE_HANDLE_HOST` is gone: the handle host is the first host of the site (Content Manager → Sites). `FEDIVERSE_ACTOR_USERNAME`, `_NAME`, `_SUMMARY` and `_SOURCE_URL` are not read either: a boot with federation on and one of them set stops with a message that names the setting that replaces it.

The profile (username, display name, summary, header, discoverable, source URL, object type) is edited under Content Manager → Sites → the entry marked default → **Fediverse profile**, not in the environment.

**Roles and the plugin's permissions.** `plugin::fediverse.read` (the Fediverse page) and `plugin::fediverse.manage` (block, unblock, retry) are given to a role in Settings → Administration Panel → Roles, under Plugins; the super admin has both. They exist only while `FEDIVERSE_ENABLED=true`. **A boot with federation off removes them from every role but the super admin**, because the package registers no action while it is off (Strapi deletes the permissions of an action that is not registered): after turning federation on again, grant them again. An upgrade from `0.6` with federation on before and after keeps them (`npm run test:upgrade` counts them).

**Rollback:** set `FEDIVERSE_ENABLED=false` and restart. The routes and hooks disappear; the tables, followers and key pair stay in the database, and the comments-visibility middleware of this image keeps hiding pending comments. Remote servers that still know the actor get 404s until it is enabled again.

## Preview

<a id="preview"></a>

The builder's preview shows a draft page on the frontend, in a frame of the admin. It is off until the operator turns it on, in three places; the steps of the plugin are in its [preview guide](https://github.com/bogd3v/micelio-plugin-core/blob/main/docs/operate/preview.md).

```env
MICELIO_PREVIEW=false   # true gives the frontend token the preview's exchange on every boot
```

1. **This CMS.** Set `MICELIO_PREVIEW=true` together with `FRONTEND_API_TOKEN`. On every boot `src/migrations/api-tokens.ts` then adds `plugin::micelio.preview.exchange` to the `frontend` token (the frontend trades an admin's one-use token for a grant with it). Only the exact string `true` turns it on; `false`, `TRUE`, `1` or anything else is off, and then the boot removes the exchange from the token, a hand-added one included. Adding it by hand under Settings → API Tokens does not last: the token is reset to its list on every boot. Without `FRONTEND_API_TOKEN` the token is yours and you add the exchange by hand (Plugin: Micelio). The switch grants the exchange and nothing else.
2. **The frontend.** Set `NUXT_PREVIEW_ADMIN_ORIGIN` to the origin of the admin (the scheme, host and port of this CMS's `URL`). It needs a frontend image that has the `/_preview` route: `micelio` 0.6 or `edge`. Without it the frontend's preview is off.
3. **The admin's frame.** `FRONTEND_URL` must be the frontend's origin: the admin's `frame-src` carries it ([Security](#security)). Give each site a `url` in the admin, and the roles that preview the permission **Preview drafts on the frontend** (Settings → Roles → Plugins → Micelio).

Restart the CMS after setting the switch. Turning it off and restarting removes the exchange again. The demo sets its own grant (`MICELIO_DEMO=true`, below) and needs none of this.

## Seeding

```env
MICELIO_DEMO=false   # seeds a bilingual demo site once on an empty database (compose.demo.yml)
```

With `true` and `FRONTEND_API_TOKEN` set, `MICELIO_DEMO` also gives the `frontend` token the preview's exchange (`plugin::micelio.preview.exchange`) on every boot, whatever the database holds, so the preview works out of the box. Never set it on a real site: it widens the token, and the seed's refusal on an instance with articles does not stop the grant. A real site that wants the preview sets [`MICELIO_PREVIEW`](#preview) instead. `static` and `landing` do not grant it.

## Generate the Strapi keys

What each key signs or encrypts, and what a rotation breaks, is in [keys.md](../security/keys.md).

```bash
node scripts/generate-keys.js
```

Copy the output into the environment of your container, or over the empty values of a local `.env` (`npm run generate:keys` prints the same). In production the CMS refuses to start when `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET` or `ENCRYPTION_KEY` is empty, a placeholder (`tobemodified`, `changeme`) or shorter than 32 characters, and the message names each one. The check is on length only: `ENCRYPTION_KEY` must be random, such as the 32 random bytes (256 bits) `npm run generate:keys` prints, never a password or a phrase. Its SHA-256 is used directly as an AES key with no key-derivation function, which is only safe for a high-entropy value ([keys.md](../security/keys.md#rotating-encryption_key)). With `DATABASE_CLIENT=postgres` and no `DATABASE_URL`, `DATABASE_PASSWORD` must be set and must not be `strapi`; `docker-compose.yml` refuses to start without it.

## Logs

The CMS writes its logs to standard output and nowhere else; retention and access are the platform's. The events, the format and what is not logged are in [logging.md](../security/logging.md).

## Docker and backup variables

`COMPOSE_PROJECT` names the Compose project whose volumes the backup scripts read; `BACKUP_DIR` and `RETENTION_DAYS` tell them where to write and how long to keep. See [Backup](backup.md).
