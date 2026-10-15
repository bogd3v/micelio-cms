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
# site settings' URL. Without it a production boot stops with an error.
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

Check that the container reaches Umami before you deploy: the first sync runs right after boot and logs `[umami] synced article visitors: {...}`, or `[umami] sync failed` with the reason.

## Static and landing sites (rebuild hook)

Static and landing sites are rebuilt when content changes: on publish, unpublish or delete of an article or a page, and on every save of the site settings, the CMS calls `REBUILD_HOOK_URL` once per debounce window, with retries, without ever blocking the publish (`src/utils/rebuild-hook.ts`). The body is `{"event_type": "micelio-content", "client_payload": {...}}`, what GitHub's `repository_dispatch` requires; plain deploy hooks ignore it.

```env
REBUILD_HOOK_URL=https://api.github.com/repos/<owner>/<site-repo>/dispatches
REBUILD_HOOK_TOKEN=<fine-grained token with Contents: read and write on that repo>
REBUILD_HOOK_DEBOUNCE_MS=60000   # changes within the window produce one call
```

`REBUILD_HOOK_URL` follows the same rule as `UMAMI_URL`: in production a public `http://` URL stops the boot, because the bearer token would travel in the clear.

A site in dynamic mode sets none of them.

## Fediverse (ActivityPub)

The plugin is **off by default**. The full behaviour is in `docs/FEDIVERSE.md`.

```env
FEDIVERSE_ENABLED=true                  # master switch; off = no fediverse routes, content types or publish hooks
FEDIVERSE_ACTOR_USERNAME=blog           # required: the @user part of the handle; safe to change (WebFinger maps it)
FEDIVERSE_ACTOR_IDENTIFIER=blog         # required: path of the actor URI; never change it, remote follows are keyed by it
FRONTEND_ARTICLE_PATH=/blog/{slug}      # optional: article path template
FRONTEND_DEFAULT_LOCALE=en              # optional: locale the frontend serves without a URL prefix
FEDIVERSE_ACTOR_NAME=                   # optional: fallbacks when Global and the site settings are empty
FEDIVERSE_ACTOR_SUMMARY=
FEDIVERSE_ACTOR_SOURCE_URL=
```

While enabled, the two required values have no defaults: without them the plugin refuses to start. `URL` must be the CMS's real public origin, because activities sent in the background build their ids from it. Requirements that are easy to miss:

- **Node 22.12 or later.** Fedify depends on an ESM-only package that `require()` loads only from that version on. The image is on Node 22.
- **A persistent database.** Followers, the actor's key pair and the record of federated articles live in the database. If it is wiped, the next boot generates a new actor key and every follower is lost.
- **Proxy headers.** Behind a TLS-terminating proxy, generated URLs use `https` only if the CMS follows `X-Forwarded-Proto` and `X-Forwarded-Host`: that is the default, but only for a connection from a proxy that `TRUST_PROXY` trusts (a private address by default, see above); from any other peer the CMS uses the real scheme and the `Host` header. `TRUST_PROXY_PROTOCOL=false` turns it off. A proxy outside the private ranges must be listed in `TRUST_PROXY`. Federation does not depend on those headers when `URL` is set: every actor, inbox, key and WebFinger id is built from the origin of `URL`, so a forged `X-Forwarded-Host` cannot make the actor document name another host. Set `URL` to the real public origin in production; unset, the ids follow the request.
- **No proxy or DNS changes.** Fedify's routes (`/.well-known/webfinger`, `/nodeinfo/2.1`, `/fediverse/*`) are served by the CMS on the same domain as the API.

### Enable it on a running site

1. Take a database backup ([Backup](backup.md)). On the first boot with the plugin enabled the CMS creates `fediverse_followers` and `fediverse_interactions` and adds `fediverse_uri` and `fediverse_actor_handle` to the comments table.
2. Set `FEDIVERSE_ENABLED=true` and the two required values, and restart.
3. Verify from outside:
   ```bash
   curl -s https://cms.example.com/_health -o /dev/null -w '%{http_code}\n'   # 204
   npx @fedify/cli webfinger @blog@cms.example.com                            # 200, https links
   npx @fedify/cli lookup @blog@cms.example.com                               # actor with inbox, outbox, publicKey
   ```
4. Follow the actor from a Mastodon account, publish an article, and watch the logs for `[fediverse]` lines (each fan-out reports how many followers it reached).

**Rollback:** set `FEDIVERSE_ENABLED=false` and restart. The routes and hooks disappear; the tables, followers and key pair stay in the database, and the comments-visibility middleware keeps hiding pending comments. Remote servers that still know the actor get 404s until it is enabled again.

## Seeding

```env
MICELIO_DEMO=false   # seeds a bilingual demo site once on an empty database (compose.demo.yml)
```

## Generate the Strapi keys

What each key signs or encrypts, and what a rotation breaks, is in [keys.md](../security/keys.md).

```bash
node scripts/generate-keys.js
```

Copy the output into the environment of your container, or over the empty values of a local `.env` (`npm run generate:keys` prints the same). In production the CMS refuses to start when `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET` or `ENCRYPTION_KEY` is empty, a placeholder (`tobemodified`, `changeme`) or shorter than 32 characters, and the message names each one. With `DATABASE_CLIENT=postgres` and no `DATABASE_URL`, `DATABASE_PASSWORD` must be set and must not be `strapi`; `docker-compose.yml` refuses to start without it.

## Logs

The CMS writes its logs to standard output and nowhere else; retention and access are the platform's. The events, the format and what is not logged are in [logging.md](../security/logging.md).

## Docker and backup variables

`COMPOSE_PROJECT` names the Compose project whose volumes the backup scripts read; `BACKUP_DIR` and `RETENTION_DAYS` tell them where to write and how long to keep. See [Backup](backup.md).
