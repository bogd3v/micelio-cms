# Logs: what is written, where it goes and who reads it

**Kind:** reference. The inventory of the CMS's log output: the events, the format, the one destination, who can read it and what happens to it afterwards. Answers ASVS 5.0.0 V16.1.1, V16.2.2, V16.2.3 and V16.2.4 ([mapping](asvs.md)). The security events that are not logged yet are listed at the end; they belong to #180.

## Destination

The CMS writes to **standard output only**. Strapi's logger has a single console transport by default (`node_modules/@strapi/logger/dist/configs/default-configuration.js`, a winston `Console`), and `config/logger.ts` replaces only the format, never the transports, so no file, socket or network transport is created. No code in `src/` opens a log file or a log service. The fediverse library's own logging (LogTape) is not configured, so it writes nothing (`src/` never imports it).

Who reads it, and for how long, is decided by the operator's platform: `docker logs`, the hosting platform's log collection, or a log shipper the operator runs next to the container. The CMS keeps no copy, rotates nothing and has no retention setting. A reverse proxy in front writes its own access log, which is outside this repository ([configure.md](../operate/configure.md#security)).

## Format

- **Production** (`NODE_ENV=production`): one JSON object per line. `config/logger.ts` sets the format, `src/utils/json-log-format.ts` builds the line. Fields: `timestamp` (ISO 8601 UTC with milliseconds, ends in `Z`, whatever the container's `TZ`), `level`, `message`, then any metadata at the top level. The three fixed fields cannot be overwritten by metadata. Example, not captured output: `{"timestamp":"2026-10-14T10:00:00.000Z","level":"http","message":"GET /api/articles (12 ms) 200"}`.
- Errors, in production. A whole error (`strapi.log.error(error)`) is written with its message and stack in the single `message` string, plus its `name` and `code` if it has them; its other own properties are dropped, because some repeat submitted values (a Postgres unique violation has a `detail` such as `Key (email)=(a@example.com) already exists.`). An `Error` passed as metadata (`strapi.log.warn('...', { error })`) is written as the `error` field: message and stack in one string, nothing else. Either way an error is one line (JSON escapes the line breaks) and a message cannot forge a second entry. The message itself is written as the library produced it. No request id is added yet (#180).
- **Development and test**: Strapi's own `prettyPrint` format (`node_modules/@strapi/logger/dist/formats/pretty-print.js`): `YYYY-MM-DD HH:mm:ss.SSS` in local time, the level, then the message, coloured; errors can span several lines, and an `{ error }` metadata value is not written at all. The examples under Events use this shape.
- **Upgrade note (operator-visible change):** production logs are JSON lines now, no longer the coloured text with a local-time stamp. A parser, alert or dashboard written for the old text stops matching and must read the fields above; timestamps are UTC with a `Z`, not local time. Errors keep their stack, on one line. There is no setting to switch back and no new variable.
- The level is `http` (`node_modules/@strapi/core/dist/Strapi.js:219`): `error`, `warn`, `info` and `http` are written; `verbose` and `debug` are not. Only the logger configuration (`config/logger.ts` or `server.logger.config`, which wins) changes it, and this repository's `config/logger.ts` sets the format only.

## Events

### Requests

`global::request-logger` (`src/middlewares/request-logger.ts:12-18`, first in `config/middlewares.ts`) writes one `http` line for every request that reaches the stack, admin, static and health requests included. Shape of a line, not captured output:

```
2026-10-14 10:00:00.000 http: GET /api/articles (12 ms) 200
```

Method, path (without the query string), duration in milliseconds and status. Strapi's own `strapi::logger` is not in the stack, because it would log the query string (`config/middlewares.ts:18`).

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

The metadata reaches stdout only with the JSON log format (production, PR A1 of #180). The development format (Strapi's `prettyPrint`) prints only `level: message`.

The fediverse plugin is a self-contained unit and does not import `security-log.ts`: it keeps its own small copy, using the same event string and field names (`fediverse.inbox.signature-refused`). That copy is not part of this change.

| Event                                 | Level  | Emitted by           |
| ------------------------------------- | ------ | -------------------- |
| `auth.login.success`                  | `info` | Not wired yet (#180) |
| `auth.login.failure`                  | `warn` | Not wired yet (#180) |
| `auth.register`                       | `info` | Not wired yet (#180) |
| `auth.password-reset.requested`       | `info` | Not wired yet (#180) |
| `auth.password-reset.completed`       | `info` | Not wired yet (#180) |
| `auth.email-confirmation.confirmed`   | `info` | Not wired yet (#180) |
| `access.draft.refused`                | `warn` | Not wired yet (#180) |
| `access.editor.refused`               | `warn` | Not wired yet (#180) |
| `access.forbidden`                    | `warn` | Not wired yet (#180) |
| `rate-limit.rejected`                 | `warn` | Not wired yet (#180) |
| `rate-limit.forwarder-secret.invalid` | `warn` | Not wired yet (#180) |
| `fediverse.inbox.signature-refused`   | `warn` | Not wired yet (#180) |

## What is not logged

These are not written, so they cannot be read from the logs. They are the open rows of #180 and are not accepted risks yet:

- Successful and failed sign-ins, password resets and confirmations, beyond the request line with its status.
- Refused drafts, the `is-editor` policy refusals and other 403s, beyond the status in the request line.
- Rate-limit rejections (the `429` is answered, not logged), and inbox requests whose signature is refused. Fedify reports these through LogTape, which is not configured.
- Admin actions. Admin audit logs are an Enterprise feature, and this repository does not ship Enterprise code.

## Access and retention

- **Access.** Whoever can read the container's output or the platform's logs. The CMS sets no access control on them.
- **Retention.** Set by the operator. The CMS keeps nothing on its disk for logging.
- **Tampering and shipping.** Outside the repository: the app writes to stdout, and collection belongs to the hosting platform (ASVS V16.4.2 and V16.4.3 are N/A for the CMS).
