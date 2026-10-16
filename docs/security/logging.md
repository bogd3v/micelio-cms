# Logs: what is written, where it goes and who reads it

**Kind:** reference. The inventory of the CMS's log output: the events, the format, the one destination, who can read it and what happens to it afterwards. Answers ASVS 5.0.0 V16.1.1, V16.2.2, V16.2.3 and V16.2.4 ([mapping](asvs.md)). The security events that are not logged yet are listed at the end; they belong to #180.

## Destination

The CMS writes to **standard output only**. Strapi's logger has a single console transport by default (`node_modules/@strapi/logger/dist/configs/default-configuration.js`, a winston `Console`), and `config/logger.ts` replaces only the format, never the transports, so no file, socket or network transport is created. No code in `src/` opens a log file or a log service. The fediverse library's own logging (LogTape) is not configured, so it writes nothing (`src/` never imports it).

Who reads it, and for how long, is decided by the operator's platform: `docker logs`, the hosting platform's log collection, or a log shipper the operator runs next to the container. The CMS keeps no copy, rotates nothing and has no retention setting. A reverse proxy in front writes its own access log, which is outside this repository ([configure.md](../operate/configure.md#security)).

## Format

- **Production** (`NODE_ENV=production`): one JSON object per line. `config/logger.ts` sets the format, `src/utils/json-log-format.ts` builds the line. Fields: `timestamp` (ISO 8601 UTC with milliseconds, ends in `Z`, whatever the container's `TZ`), `level`, `message`, then any metadata at the top level. The three fixed fields cannot be overwritten by metadata. Example, not captured output: `{"timestamp":"2026-10-14T10:00:00.000Z","level":"http","message":"GET /api/articles (12 ms) 200"}`.
- Errors, in production. A whole error (`strapi.log.error(error)`) is written with its message and stack in the single `message` string, plus its `name` and `code` if it has them; its other own properties are dropped, because some repeat submitted values (a Postgres unique violation has a `detail` such as `Key (email)=(a@example.com) already exists.`). An `Error` passed as metadata (`strapi.log.warn('...', { error })`) is written as the `error` field: message and stack in one string, nothing else. Either way an error is one line (JSON escapes the line breaks) and a message cannot forge a second entry. The message itself is written as the library produced it.
- **Development and test**: Strapi's own `prettyPrint` format (`node_modules/@strapi/logger/dist/formats/pretty-print.js`): `YYYY-MM-DD HH:mm:ss.SSS` in local time, the level, then the message, coloured; errors can span several lines, and an `{ error }` metadata value is not written at all. The examples under Events use this shape.
- **Upgrade note (operator-visible change):** production logs are JSON lines now, no longer the coloured text with a local-time stamp. A parser, alert or dashboard written for the old text stops matching and must read the fields above; timestamps are UTC with a `Z`, not local time. Errors keep their stack, on one line. There is no setting to switch back and no new variable.
- The level is `http` (`node_modules/@strapi/core/dist/Strapi.js:219`): `error`, `warn`, `info` and `http` are written; `verbose` and `debug` are not. Only the logger configuration (`config/logger.ts` or `server.logger.config`, which wins) changes it, and this repository's `config/logger.ts` sets the format only.

## Events

### Requests

`global::request-logger` (`src/middlewares/request-logger.ts`, `src/utils/request-context.ts`, first in `config/middlewares.ts`) writes one `http` line for every request that reaches the stack, admin, static and health requests included. Shape of a line, not captured output:

```
2026-10-14 10:00:00.000 http: GET /api/articles (12 ms) 200
```

Method, path (without the query string), duration in milliseconds and status. In production the metadata is written as top-level JSON fields next to them:

| Field       | Value                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestId` | A UUID the server generates per request (`crypto.randomUUID`). An incoming `X-Request-Id` or any other header is never read. Also in `ctx.state.requestId` for code that logs inside the request.                                                                                                                                                                                                                                       |
| `client`    | 16 hex characters of a keyed hash (`hashIdentifier`, key from `APP_KEYS`) of `ctx.request.ip`, the address `global::client-ip` resolved from `TRUST_PROXY`. With rate limiting on, on `/api/*` that is the visitor address the frontend forwarder sent (`src/middlewares/client-ip.ts:42-44`), not the frontend server's. The address itself is never written. Same key as security events, so a line and an event of one client match. |
| `actor`     | The numeric id of the user the request authenticated as, reader or admin. Absent for anonymous requests and content API tokens. No email, username or token.                                                                                                                                                                                                                                                                            |
| `actorKind` | `admin` or `user` (a reader): which table `actor` is an id of, since the two overlap. Taken from `ctx.state.auth.strategy.name` (`admin` and `admin-token` are `admin`, `users-permissions` is `user`); present only with `actor`.                                                                                                                                                                                                      |

The logger runs first and reads `client`, `actor` and `actorKind` after `next()`, when `client-ip` and authentication have run. The line is written even if a later middleware throws; the error is rethrown and the status logged is the one the client will get (`error.status`, else 500). If `APP_KEYS` is unusable the line is still written, without `client`, and one `warn` says so. The id is not sent back in a response header: nothing needs it yet, and a header would have to be exposed through CORS and kept out of caches. Strapi's own `strapi::logger` is not in the stack, because it would log the query string (`config/middlewares.ts`). Tests: `tests/log-hygiene.test.ts` "request context" (end to end), `tests/request-context.test.ts` (the middleware, including a downstream throw).

### Boot

`src/index.ts` writes one `info` line per migration that changed something, with counts and not the content: `[authors]`, `[roles]`, `[accounts]` (the report is `settingsApplied` and `permissionsGranted`, `src/migrations/account-settings.ts:156`), `[tags]`, `[subscribers]`, `[pages]`, `[site-settings]`, `[api-tokens]` (the report word and the token name), `[demo]`, `[rate-limit]` (table created), and the rate-limit mode at start (`src/utils/rate-limit/runtime.ts:67`, `:90`). Strapi's startup banner comes from `@strapi/core`.

### Errors and failures

| Line                                                                                                                                                                                                                              | Level                   | Source                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unexpected request error, the whole error object (`name`, `code`, message and stack in production)                                                                                                                                | `error`                 | `node_modules/@strapi/core/dist/middlewares/errors.js:26`                                                                                             |
| `[comments] refused a "fields" query parameter on the comments API`: one line per refused request, no query values                                                                                                                | `warn`                  | `src/middlewares/restrict-comment-filters.ts`                                                                                                         |
| `[rate-limit] …` a request sent a wrong forwarder secret, an invalid forwarded address, or a store failed. Once a minute per key; the key itself is never written                                                                 | `warn`                  | `src/utils/rate-limit/runtime.ts:50-61`, `src/utils/rate-limit/stores.ts:142`                                                                         |
| `[umami] sync failed, keeping the previous counts: <error>`                                                                                                                                                                       | `warn`                  | `src/index.ts:269-271`                                                                                                                                |
| `[umami] could not read the site totals: <error>`                                                                                                                                                                                 | `warn`                  | `src/api/article-stat/services/article-stat.ts:220`                                                                                                   |
| `[rebuild] the hook answered <status>`; `[rebuild] the hook failed: <error>`; `[rebuild] gave up after N attempts`                                                                                                                | `warn`, `warn`, `error` | `src/utils/rebuild-hook.ts:94-100`                                                                                                                    |
| `[fediverse] delivery failed for <activity id>: <message>`                                                                                                                                                                        | `error`                 | `src/plugins/fediverse/server/src/federation.ts` (`onOutboxError`)                                                                                    |
| `[fediverse] inbox listener failed: <message>`                                                                                                                                                                                    | `error`                 | `federation.ts:557`                                                                                                                                   |
| `[fediverse] … failed` with the error object as `{ error }` metadata (publisher, actor profile, followers, NodeInfo): in production the `error` field holds message and stack; the pretty format of development and test drops it | `warn` or `error`       | `src/plugins/fediverse/server/src/services/publisher.ts:139`, `federation.ts:321`, `services/actor-profile.ts:59`, `:67`, `services/followers.ts:108` |

### Fediverse activity

`info` lines for accepted and removed followers, unfollows, blocks, replies that were edited or deleted remotely, and the publication of an article or the profile (`federation.ts:408`, `:433`, `:474`, `:541`, `:553`; `services/publisher.ts:79`, `:98`, `:119`). `warn` lines for an ignored `Follow` or `Note` and a request guard that failed open (`federation.ts:350`, `:488`, `:645`). A `debug` line for an ignored reply (`federation.ts:520`) is not written at the default level.

The actor key pair is generated on the first boot that finds none (`src/plugins/fediverse/server/src/services/keys.ts:89`); the key material itself is never logged.

### Personal data in these lines

- Remote handles (`@user@host`) and actor ids of followers appear in the fediverse lines (`federation.ts:408`, `:433`, `:474`). They describe people on other servers.
- Remote text is cleaned before it is written (`src/plugins/fediverse/server/src/utils/remote-text.ts`, [ASVS V16.4.1](asvs.md)).
- Error messages are written as the library produced them, and a message can repeat a submitted value (not verified for every library). Properties such as a database `detail` are dropped in production (`tests/json-log-format.test.ts` "drops the own properties of an error logged whole except name and code"); development and test use Strapi's pretty format, which writes only the message and stack of a whole error.

## Security events

`logSecurityEvent` (`src/utils/security-log.ts`) writes one line per event of the catalogue in `src/constants/security-events.ts`: the message is `security: <event>`, and the metadata holds `event`, `outcome` (`success` or `failure`) and, when given, `requestId`, `actor`, `client`, `path` and `reason`. `info` for a success, `warn` for a failure or refusal. The function has no field for an address, email, token or password, and a value that does not fit its field is dropped, not written:

- `requestId`: letters, digits and hyphens, up to 64. Pass only a server-generated id.
- `actor`: a numeric user id.
- `client`: exactly the 16 hex characters of `hashIdentifier`, a truncated HMAC keyed from the first `APP_KEYS` entry. It correlates lines, and as long as `APP_KEYS` is secret it cannot be checked against a list of addresses. Without an app key the key derivation throws and names `APP_KEYS`.
- `reason`: one of the closed set `SECURITY_REASONS`.
- `path`: query string and fragment dropped, percent-escapes decoded, then emails, IPv4 and IPv6 literals and token-like runs (16 or more characters with a digit) replaced by `[redacted]`.

Strapi checks the route permission before the policy, so a user without the `drafts` permission gets `access.forbidden`, and `access.editor.refused` appears for a caller that has it but is not an editor (an API token, another role). `access.forbidden` is not sampled or throttled, on purpose: ASVS V16.3.2 asks for each refusal. Its volume is at most one line per refused request, and a client is capped by the `api` rate-limit group, whose 429s are not logged. It has no `reason`, because controller and plugin 403s are not all missing permissions. A request refused for a draft or by `is-editor` writes one line, not two: `logAccessRefusal` (`src/utils/access-log.ts`) marks it and `global::forbidden-log`, which sits just inside the request logger, skips marked requests. The actor is the numeric id of a signed-in user (none for the public or an API token). Logging never changes the answer and never throws.

The metadata reaches stdout only with the JSON log format (production, PR A1 of #180). The development format (Strapi's `prettyPrint`) prints only `level: message`.

The fediverse plugin is a self-contained unit and does not import `security-log.ts`: it keeps its own small copy, using the same event string and field names (`fediverse.inbox.signature-refused`). That copy is not part of this change.

| Event                                 | Level  | Emitted by                                                                                                                                                                                                    |
| ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.login.success`                  | `info` | `src/extensions/users-permissions/auth-events.ts` (`callback`), `src/middlewares/admin-login-log.ts` (`POST /admin/login`)                                                                                    |
| `auth.login.failure`                  | `warn` | the same two; `reason` is `invalid-credentials`, `blocked-account` or `unconfirmed-account`                                                                                                                   |
| `auth.register`                       | `info` | `auth-events.ts` (`register`)                                                                                                                                                                                 |
| `auth.password-reset.requested`       | `info` | `auth-events.ts` (`forgotPassword`), for every request, with no `actor`: the answer does not say whether the account exists                                                                                   |
| `auth.password-reset.completed`       | `info` | `auth-events.ts` (`resetPassword`)                                                                                                                                                                            |
| `auth.email-confirmation.confirmed`   | `info` | `auth-events.ts` (`POST /api/auth/email-confirmation` answering 204; the `GET` redirect is not an event)                                                                                                      |
| `auth.register.failure`               | `warn` | `auth-events.ts` (`register`), one identical line for every refusal, with no `reason`; also when the account was created but the confirmation email failed (the plugin answers 400 then, and the user exists) |
| `auth.password-reset.failure`         | `warn` | `auth-events.ts` (`resetPassword`); `reason` is `invalid-code` for an unknown or expired code, none for a rejected new password                                                                               |
| `auth.email-confirmation.failure`     | `warn` | `auth-events.ts` (`POST /api/auth/email-confirmation`); `reason` is `invalid-token`                                                                                                                           |
| `access.draft.refused`                | `warn` | `src/utils/drafts-access.ts` (Document Service middleware)                                                                                                                                                    |
| `access.editor.refused`               | `warn` | `src/policies/is-editor.ts`                                                                                                                                                                                   |
| `access.forbidden`                    | `warn` | `src/middlewares/forbidden-log.ts`: every other final 403, content API, admin panel and admin API alike                                                                                                       |
| `rate-limit.rejected`                 | `warn` | Not wired yet (#180)                                                                                                                                                                                          |
| `rate-limit.forwarder-secret.invalid` | `warn` | Not wired yet (#180)                                                                                                                                                                                          |
| `fediverse.inbox.signature-refused`   | `warn` | Not wired yet (#180)                                                                                                                                                                                          |

## What is not logged

These are not written, so they cannot be read from the logs. They are the open rows of #180 and are not accepted risks yet:

- Nothing is hidden among 403s: every final 403 is logged, on any route. What stays out of the log is the reason for an unclassified 403 (the line has no `reason`), and the rejected value, which is never written.
- Authentication attempts not covered yet (follow-up of #180): change-password and the `DELETE /api/users/me` password check; the admin `forgot-password`, `reset-password`, `register`, `register-admin` and `access-token` routes; an admin login answered 500; the 401s of invalid or expired sessions and tokens.
- Rate-limit rejections (the `429` is answered, not logged), and inbox requests whose signature is refused. Fedify reports these through LogTape, which is not configured.
- Admin actions other than signing in. Admin audit logs are an Enterprise feature, and this repository does not ship Enterprise code. Admin sign-ins are logged by `global::admin-login-log`, which needs none: a refusal logs `invalid-credentials` for a wrong password or unknown account, `blocked-account` for an inactive user and no reason for a malformed body; a `429` and a `500` are not logged there. Attempts the limiter rejects are left to `rate-limit.rejected`, not wired yet (#180).

## Access and retention

- **Access.** Whoever can read the container's output or the platform's logs. The CMS sets no access control on them.
- **Retention.** Set by the operator. The CMS keeps nothing on its disk for logging.
- **Tampering and shipping.** Outside the repository: the app writes to stdout, and collection belongs to the hosting platform (ASVS V16.4.2 and V16.4.3 are N/A for the CMS).
