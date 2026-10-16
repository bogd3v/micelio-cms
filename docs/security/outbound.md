# Outbound connections and telemetry

**Kind:** reference. Every host the CMS connects to, what it sends, what turns it off and what is on by default. Answers ASVS 5.0.0 V13.1.1 and V14.2.3, and documents V13.2.4 ([mapping](asvs.md)). Operators' settings are in [configure.md](../operate/configure.md); this page is the complete list behind them.

Inbound traffic (the content API, the admin panel, the fediverse inbox) is not listed. The frontend server calls the CMS; that call is inbound here.

## Operator-configured destinations

| Destination                                               | Set by                                                                                          | Sent                                                                                                                                                                                                                               | Off when                                                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL (or the SQLite file)                           | `DATABASE_*` (`config/database.ts`)                                                             | Everything the CMS stores                                                                                                                                                                                                          | Not optional. TLS is used only with `DATABASE_SSL=true`, and then certificates are verified unless `DATABASE_SSL_REJECT_UNAUTHORIZED=false` (`config/database.ts:17-24`) |
| SMTP server                                               | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (`config/plugins.ts:43-59`)                  | Account confirmation and reset emails, with their links; the abuse-report notification of the comments plugin. Reply notifications are disabled (`src/extensions/comments/strapi-server.ts:19-25`)                                 | No `SMTP_HOST`: the default `sendmail` provider is kept and cannot deliver from a container. STARTTLS is required unless `SMTP_REQUIRE_TLS=false` (`src/utils/smtp.ts`)  |
| Media bucket (Cloudflare R2 or any S3-compatible service) | `R2_*` (`config/plugins.ts:10-33`), endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` | Uploaded files, and their reads                                                                                                                                                                                                    | No `R2_BUCKET`: uploads stay on the CMS disk                                                                                                                             |
| Umami                                                     | `UMAMI_URL`, `UMAMI_WEBSITE_ID`, `UMAMI_API_KEY` (`config/umami.ts`)                            | `GET` requests with the View-only key as bearer token; the answers are the visitors per article path (`src/api/article-stat/utils/umami-client.ts:14-22`)                                                                          | Any of the three unset. The sync also stops with `STRAPI_DISABLE_CRON=true` (`config/server.ts:25-27`)                                                                   |
| Rebuild hook                                              | `REBUILD_HOOK_URL`, `REBUILD_HOOK_TOKEN` (`src/utils/rebuild-hook.ts:47`)                       | `POST` of `{ event_type, client_payload: { changes, count } }`, with the token as bearer. Each change is the content type UID, the event, the document id and the locale, at most 50 (`src/utils/rebuild-hook.ts:27-32`, `:80-88`) | `REBUILD_HOOK_URL` unset                                                                                                                                                 |

The CMS refuses no destination in this list. The operator chooses each one, and a wrong URL is the operator's to fix.

The Umami sync (`src/api/article-stat/utils/umami-client.ts`) and the rebuild hook (`src/utils/rebuild-hook.ts`) call `fetch` with `redirect: 'error'` (ASVS V15.3.2): a 3xx answer is not followed, because undici resends a `POST` body on 307 and 308 and forwards every header except `Authorization` to another origin. The call fails instead. The Umami sync reports it like any failed sync (`Umami answered with a redirect for <path>, which is refused`). The rebuild hook logs one warning that names the redirect and does not retry, since a redirect means `REBUILD_HOOK_URL` is wrong and no retry fixes it. Neither log line carries the URL query, the token or the key. The operator sets the final address. Tests: `tests/outbound-redirects.test.ts`.

## Fediverse destinations (`FEDIVERSE_ENABLED=true`)

The destinations here are chosen by other servers, so they are not in the operator's configuration. Details are in [FEDIVERSE.md](../FEDIVERSE.md).

| Traffic           | Destination                                                                         | Sent                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Signed activities | The inbox of each follower, as Fedify delivers them                                 | `Create`, `Update` and `Delete` of published articles, and the actor's profile. Only public content |
| Document loading  | Any public host that a remote activity, a WebFinger lookup or an actor's icon names | A `GET` with Fedify's headers; the answers are parsed as ActivityPub                                |
| WebFinger lookups | The domain of a handle that an admin or a remote server names                       | `GET /.well-known/webfinger`                                                                        |

Private and loopback addresses are refused: Fedify's loader and delivery reject them, and the plugin enables them only under `NODE_ENV=test` (`src/plugins/fediverse/server/src/federation.ts:306-308`, `allowPrivateAddress`). The plugin's avatar lookup goes through the same loader (`federation.ts:130-150`, `extractAvatarUrl`).

### Why there is no allowlist

An allowlist would name the servers a site may talk to. Federation works with any server that a reader follows, so a site would have to know every server on the network in advance. The controls that exist are the ones that do not need that list: refused private addresses, signatures checked before any listener runs, the author check on each activity (`federation.ts:482-496`, `:553-558`), a rate limit on the inbox (`fediverse-inbox`, `docs/RATE_LIMITING.md`), and a block that removes a follower. A host-based allowlist mode would be a new decision with a cost for federation, so it is recorded here as an open question for the owner of the decision, not as a default. ASVS V13.2.4 stays open until that decision is taken.

## Strapi's own connections

The CMS runs on `@strapi/core` 5.56.0 and the admin panel of `@strapi/admin` 5.56.0. Both reach Strapi's services. The list below is what the packages do in this configuration, read from their code; it was not captured on the wire.

### Telemetry: `analytics.strapi.io`

**Off by default.** The server sends telemetry unless one of these holds (`node_modules/@strapi/core/dist/services/metrics/index.js:19-20`): the project has no uuid, the environment has `STRAPI_TELEMETRY_DISABLED=true` or `1`, or `package.json` sets `strapi.telemetryDisabled`. This repository has a uuid and sets `strapi.telemetryDisabled: true` in `package.json`, so none of the events below are sent unless the operator removes it before building the image.

With telemetry on, the CMS sends to `${STRAPI_ANALYTICS_URL || https://analytics.strapi.io}` (`node_modules/@strapi/core/dist/services/metrics/sender.js:99`):

- a `ping` once a day at 12:00 (`index.js:34-35`);
- a `didReceiveRequest` event for each `GET`, `POST`, `PUT` or `DELETE` under `/api` that carries no dot in its URL, the first 1000 per process per day (`middleware.js:14-28`). The event holds request metadata and the status (`middleware.js:37-41`);
- the events Strapi emits itself, such as media-library changes;
- on every event, the install id, the project uuid, the operating system, the Node version, the environment, the Strapi version, whether the process runs in Docker or in CI, whether TypeScript is used, the project type, and `userId`: the SHA-256 of the email of the user the request is authenticated as, read from the request context (`node_modules/@strapi/core/dist/services/metrics/admin-user-hash.js:11-17`). The code does not limit it to admin users. The value was not observed at runtime.

The admin panel sends one more event from the browser. When `/admin/init` returns a uuid, the panel posts `didInitializeAdministration` with an empty user id, the telemetry properties of the instance and the list of registered widgets (`node_modules/@strapi/admin/dist/admin/admin/src/features/Tracking.js:46-63`). `/admin/init` returns no uuid when `package.json` sets `strapi.telemetryDisabled` or the project has no uuid (`node_modules/@strapi/admin/dist/server/server/src/controllers/admin.js:50-54`). **`STRAPI_TELEMETRY_DISABLED` does not stop this event.**

To turn telemetry on: remove `strapi.telemetryDisabled` from `package.json` before building the image. `STRAPI_TELEMETRY_DISABLED` can only switch it off. With `telemetryDisabled` set, `/admin/init` returns no uuid, so the admin panel's start-up event is not sent either.

### Admin survey (NPS): `analytics.strapi.io/submit-nps`

**Off by default** (`FLAG_NPS`, `config/admin.ts:20`, read as `flags.nps`). The admin panel shows the survey to signed-in admins unless `window.strapi.flags.nps` is `false` (`node_modules/@strapi/admin/dist/admin/admin/src/components/NpsSurvey.js:97`). Answering posts to `${STRAPI_ANALYTICS_URL || https://analytics.strapi.io}/submit-nps` (`NpsSurvey.js:169`): the admin's email, the rating, the comment, the environment, the Strapi version, the license type and whether the host is Strapi Cloud. `STRAPI_TELEMETRY_DISABLED` does not control the survey. **Set `FLAG_NPS=true` to turn it on**; the value in `.env.example` is `false`.

### Update check: the npm registry

`logger.updates.enabled` defaults to `true` (`node_modules/@strapi/core/dist/configuration/index.js:40-44`, under the server configuration). When it is on, the server asks the npm registry, through `package-json`, for the latest `@strapi/strapi` version at most once a day, and stores the answer and the time of the check in `.strapi-updater.json` in the application root (`node_modules/@strapi/core/dist/utils/update-notifier/index.js:37-66`). The registry used is the package's default; it was not traced further.

To turn it off, set `logger: { updates: { enabled: false } }` in the server configuration (`config/server.ts`, a change to the image). `STRAPI_DISABLE_UPDATE_NOTIFICATION` no longer has an effect: it only prints a warning (`update-notifier/index.js:82-83`).

### Licence registry: `license.strapi.io`

Contacted only with an Enterprise licence key (`STRAPI_LICENSE` or a `license.txt`) (`node_modules/@strapi/core/dist/ee/index.js:53`, `:95-110`). `lint:ee` refuses Enterprise code in this repository, and no key is set. `STRAPI_DISABLE_EE=true` skips the licence check altogether (`ee/index.js:49`).

### AI service: `strapi-ai.apps.strapi.io`

Used only with an Enterprise licence that includes the AI feature (`node_modules/@strapi/admin/dist/server/server/src/ai/services/ai.js:64-68`, `:89`). Not reached in this repository. `STRAPI_AI_URL` changes the address.

### Links and images the admin panel offers

- `market.strapi.io` (Marketplace menu entry, `node_modules/@strapi/admin/dist/admin/admin/src/hooks/useMenu.js:56-61`), `billing.strapi.io` (upsell banners and the trial notice), `docs.strapi.io` and `strapi.io`: links that open when clicked. No request is made by the page itself.
- `market-assets.strapi.io` is allowed for images and media by the admin's Content Security Policy (`config/middlewares.ts:39`, `:46`). Whether the admin loads an image from it at runtime was not traced.

## Uploads by URL

The admin panel can import a file from an `http` or `https` URL. The CMS fetches it, after resolving the host and refusing blocked address ranges (`node_modules/@strapi/upload/dist/server/services/file.js:92-108`). The address is chosen by the admin, so this is a user-supplied destination. The frontend's own requests and the CMS's other calls are listed above.

## Summary for the operator

- Required by design: the database, the mail server if you want accounts, the bucket if you use one, and the fediverse servers if you enable federation.
- Sent to Strapi only if the operator opts in: telemetry (server events, and the admin page's event) and the admin survey. Both are off by default and documented above.
- On by default and sent to the npm registry: the update check. Turn it off in `config/server.ts`.
