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

| Traffic              | Destination                                                                         | Sent                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed activities    | The inbox of each follower, and of the remote author a moderator answers            | `Create`, `Update` and `Delete` of published articles, and the actor's profile. Only public content. Queued and retried: a failing inbox is tried again up to 10 times over about half an hour (a host that stays down is then held for up to a week), and an inbox that answered `404` or `410` is not tried again and a moderator's replies to fediverse comments |
| Document loading     | Any public host that a remote activity, a WebFinger lookup or an actor's icon names | A `GET` with Fedify's headers; the answers are parsed as ActivityPub                                                                                                                                                                                                                                                                                                |
| Thread resolution    | The servers of the notes above a delivered reply whose parent is not stored         | A signed `GET` of each parent note through Fedify's loader (private addresses refused), at most 5 per delivery, and of each fetched note's author once the chain reaches the site's conversation; all within 5 s per delivery (`constants/replies.ts`, `docs/FEDIVERSE.md`, "Threads deeper than one hop")                                                          |
| Reply addressing     | The actor of the remote author whose comment a moderator answers                    | A `GET` of the actor document through Fedify's loader (private addresses refused), to find its inbox; the reply itself goes to that inbox and to the followers                                                                                                                                                                                                      |
| WebFinger self-check | The CMS's own public origin (`URL`)                                                 | `GET /.well-known/webfinger?resource=acct:<user>@<host>` with a 5 s timeout and no redirects, when an admin with the plugin permission opens the Fediverse page. The address is the operator's setting, never a visitor's                                                                                                                                           |
| WebFinger lookups    | The domain of a handle that an admin or a remote server names                       | `GET /.well-known/webfinger`                                                                                                                                                                                                                                                                                                                                        |

Private and loopback addresses are refused for everything Fedify fetches, **except** the WebFinger self-check above, which uses a plain `fetch` to the operator's own `URL`: Fedify's loader and delivery reject them, and the plugin enables them only under `NODE_ENV=test` (`src/plugins/fediverse/server/src/federation.ts:306-308`, `allowPrivateAddress`). The plugin's avatar lookup goes through the same loader (`federation.ts:130-150`, `extractAvatarUrl`).

## Accepted risk: no host allowlist (V13.2.4)

The CMS has no list of hosts it may contact. The owner accepted this risk in issue #181 instead of adding an allowlist mode. The ASVS row stays Open, as an accepted risk, in [asvs.md](asvs.md).

**Fixed by the environment.** The operator-configured destinations in the first table. Each address is read from an environment variable; no request data chooses one.

**Chosen by an admin, only if the operator opts in.** Uploads by URL: with `UPLOAD_FROM_URL_ENABLED=true`, the admin panel names the host (see [Uploads by URL](#uploads-by-url)). The feature is off by default.

**Chosen by a remote server.** The fediverse destinations: the inbox of each follower, the documents a remote activity, a WebFinger lookup or an actor's icon names, and the domain of a handle that an admin or a remote server names. These are public hosts that federation needs, and they cannot be listed in advance.

**Enforced in code.**

- Private, loopback and link-local addresses are refused for document loading, WebFinger and delivery, by Fedify's `validatePublicUrl` (`validatePublicIpAddress` in `@fedify/vocab-runtime`, which covers 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16 and the IPv6 loopback, unique-local and link-local ranges). The plugin turns the check off only under `NODE_ENV=test` (the `allowPrivateAddress` option of `createFediverseFederation`). The check looks up the host and tests every address it returns, then the request resolves the host again. An address that changes between the two lookups is not covered. The check narrows the exposure and does not close it.
- Document loading follows a redirect one hop at a time, and each hop goes through the same check, with the same limit. Fedify stops after 20 redirections, and when a redirect returns to a URL it already visited (`@fedify/vocab-runtime`, `getDocumentLoader`). The Umami sync and the rebuild hook refuse every redirect (see above).
- Timeouts: the Umami sync aborts after 15 s (`src/api/article-stat/utils/umami-client.ts:6`). Document loading aborts after 10 s: the plugin sets no `documentLoaderTimeout`, so Fedify's default applies. Thread resolution aborts all its fetches after 5 s in total per inbox delivery (`THREAD_TIME_BUDGET_MS`). Uploads by URL, when enabled, abort after 60 s (`node_modules/@strapi/upload/dist/server/services/file.js:24`). The rebuild hook sets no timeout.
- Size limits for remote documents (`@fedify/vocab-runtime`, `MAX_BODY_SIZE`, `MAX_HTML_SIZE`, `MAX_ERROR_BODY_SIZE`): a JSON document is read up to 16 MiB; an HTML document up to 1 MiB, and a larger one is refused. An error response's body is kept up to 1 MiB, and a larger one is dropped, keeping only its status and headers. Umami answers are parsed with no size limit (`umami-client.ts:40`). The rebuild hook does not read the response body. Uploads by URL are limited in the next section.

**Why there is no allowlist.** An allowlist would name the servers a site may talk to. Federation works with any server that a reader follows, so a site would have to know every server on the network in advance. The controls that exist are the ones that do not need that list: refused private addresses (with the limit above), signatures checked before any listener runs, the author check on each activity (`federation.ts:482-496`, `:553-558`), a rate limit on the inbox (`fediverse-inbox`, `docs/RATE_LIMITING.md`), and a block that removes a follower. A host-based allowlist mode would be a new decision with a cost for federation.

**Egress filtering is the operator's job.** This repository configures no firewall, proxy or outbound rule, and the hosting platform decides what the container may reach (ASVS V13.2.5, not applicable here). The tables above list every host the CMS calls by design. With `FEDIVERSE_ENABLED=true` the fediverse hosts cannot be listed in advance, so a rule that allows only a fixed list would stop federation.

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

An opt-in feature, **off by default**. The admin panel can import a file from an `http` or `https` URL only when the operator sets `UPLOAD_FROM_URL_ENABLED=true`; otherwise the CMS answers `403` (`src/middlewares/upload-from-url.ts`, test `tests/upload-from-url.test.ts`; see [uploads.md](uploads.md#import-from-a-url)). When it is on, Strapi's own import code does the fetch (`fetchUrlToInputFile` in `node_modules/@strapi/upload/dist/server/services/file.js`):

- the protocol must be `http:` or `https:`;
- the download aborts after 60 s (`file.js:24`);
- the download is read up to the upload size limit. The limit is `sizeLimit` in `config/plugins.ts`: 250 MiB for the local provider. With the R2 provider (`R2_BUCKET` set) that file sets no `sizeLimit`, so Strapi's default applies, 1,000,000,000 bytes (`node_modules/@strapi/upload/dist/server/config.js:7`). A `Content-Length` above the limit is refused before the download, and the bytes read are counted (`file.js:129`, `:167`).

The address is chosen by an admin, so this is a user-supplied destination. The frontend's own requests and the CMS's other calls are listed above.

## Summary for the operator

- Required by design: the database, the mail server if you want accounts, the bucket if you use one, and the fediverse servers if you enable federation.
- Sent to Strapi only if the operator opts in: telemetry (server events, and the admin page's event) and the admin survey. Both are off by default and documented above.
- On by default and sent to the npm registry: the update check. Turn it off in `config/server.ts`.
