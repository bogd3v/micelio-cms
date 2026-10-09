# Rate Limiting

Application-level rate limiting (issue #100). The CMS protects itself whatever sits in front of it (Traefik, Nginx, Caddy, a CDN or nothing). Everything is configured with environment variables.

## Overview

Requests are counted with `rate-limiter-flexible` in a store that is either memory (default, per process) or Postgres (shared between instances, see [Stores](#stores)). Limiting is on by default and off under `NODE_ENV=test`. It is implemented by three global middlewares (`src/middlewares/{client-ip,rate-limit,rate-limit-identifier}.ts`, logic in `src/utils/rate-limit/`, config in `config/rate-limit.ts`):

1. `global::client-ip` sets `ctx.request.ip` from `TRUST_PROXY` (always, even with limiting off).
2. `global::rate-limit` counts the request in its group before the body is read.
3. `global::rate-limit-identifier` runs after the body is parsed and counts per account (login identifier or email).

A rejected request gets a 429 with Strapi's standard `RateLimitError` body. Allowed requests in a limited group carry the headers below.

### Response headers

Set on every request counted by a limited group (not on exempt routes such as `/_health`, nor on the silent `auth-email` 200):

```
RateLimit-Limit: 600
RateLimit-Remaining: 599
RateLimit-Reset: 60          # seconds until the window resets, not a timestamp
RateLimit-Policy: 600;w=60   # <points>;w=<window seconds>
```

A 429 adds `Retry-After` (the same seconds, at least 1). The per-account `auth-identifier` and `auth-email` limits set headers only when they reject.

## Groups and Limits

Paths are lower-cased and normalized before matching, so `/API/Auth/Local/` is the same route.

| Group             | Routes                                                                                                             | Key                                           | Default    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ---------- |
| `auth`            | Any method on `/api/auth/*` and `/api/connect/*`, plus `DELETE /api/users/me`                                      | Client + route family (below)                 | 10 / 60 s  |
| `auth-identifier` | `POST /api/auth/local` (sign-in)                                                                                   | HMAC of the trimmed, lower-cased `identifier` | 10 / 900 s |
| `auth-email`      | `POST /api/auth/forgot-password`, `/api/auth/send-email-confirmation`, `/api/auth/local/register`                  | HMAC of the trimmed, lower-cased `email`      | 5 / 3600 s |
| `admin-auth`      | `POST /admin/login`, `/admin/forgot-password`, `/admin/reset-password`, `/admin/register-admin`, `/admin/register` | Client                                        | 20 / 300 s |
| `comments`        | Non-GET/HEAD/OPTIONS `/api/comments/*`                                                                             | Client (never a token)                        | 10 / 600 s |
| `upload`          | Non-GET/HEAD/OPTIONS `/api/upload/*`                                                                               | Client (never a token)                        | 30 / 600 s |
| `fediverse-inbox` | `POST` to the federation inbox paths (handled by the fediverse guard)                                              | Client                                        | 60 / 60 s  |
| `api`             | Everything else under `/api/*`, federation requests other than inbox POSTs, and `/mcp`                             | Client, or content-API token after overflow   | 600 / 60 s |

"Client" is `ctx.request.ip` with IPv6 addresses grouped by their /64, since one subscriber controls the whole prefix. A rule of `0` (or `0/...`) turns a group off; an unset or unparsable value keeps the default.

### Auth route families

`auth` keys include the path, so one client may use each family up to the limit: each exact path of `/api/auth/local`, `/local/register`, `/forgot-password`, `/reset-password`, `/send-email-confirmation`, `/change-password`, `/email-confirmation`, `/refresh` and `/logout` has its own key; `/api/connect/*` is one family; `/api/auth/:provider/callback` is one family; any other `/api/auth/*` shares one key; `DELETE /api/users/me` has its own. A made-up path segment therefore cannot open a new bucket.

### Per-account limits

- `auth-identifier` counts sign-in attempts per login identifier across all IPs, alongside the per-client `auth` group. Past its limit the sign-in answers 429 (a silent answer would look like a wrong password).
- `auth-email` counts emails per address. Past its limit `forgot-password` and `send-email-confirmation` answer their normal 200 without sending anything, so the response does not reveal whether the address exists; `register` has no such answer and gets a 429.
- A missing or non-string identifier or email shares one bucket per client. Keys are HMACs, so the store never holds the address.
- Accepted risk: an attacker can use up an account's quota (block a victim's reset email for an hour, or lock sign-in attempts for that identifier).

### Token buckets (`api` group)

1. A request first counts against the client's `api` bucket.
2. Only when that bucket is over its limit and the request carries a bearer that can be an API token (not a JWT, 16 to 512 characters), the token is looked up. Lookups per client are capped at 60 per minute; answers are cached by the SHA-256 of the bearer (500 entries each way, 60 s for hits or until expiry, 10 s for misses), so a revoked token keeps its bucket for up to a minute.
3. A valid content-API token is counted in its own bucket (`RATE_LIMIT_TOKEN`, default 6000 / 60 s). Once a token is cached, its requests skip the client bucket.
4. An invalid, expired or unknown token stays on the client's 429. An admin token is only honoured on `/mcp`, where it is not limited.
5. `RATE_LIMIT_TOKEN=0`: valid content-API tokens are not limited at all.
6. A forwarded request that names the visitor (see [Forwarder](#forwarder)) ignores the token: the visitor's bucket counts.

## Environment Variables

Limits are `points/seconds` (`10/60`; spaces allowed) or `0` to turn the group off.

| Variable                      | Default                     | Notes                                                                                                                                                               |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_ENABLED`          | `true` (`false` under test) | Master switch. `false` restores the previous behaviour (see [Rollback](#rollback)).                                                                                 |
| `RATE_LIMIT_STORE`            | `memory`                    | `memory` or `database` (Postgres; SQLite falls back to memory).                                                                                                     |
| `TRUST_PROXY`                 | `private`                   | How the client IP is read: `private`, `false`, a number of hops or a CIDR list. `true` stops the boot. Applies even with limiting off.                              |
| `PROXY_IP_HEADER`             | `X-Forwarded-For`           | Header holding the client address; also passed to Strapi's `proxy.ipHeader`. Applies even with limiting off.                                                        |
| `TRUST_PROXY_PROTOCOL`        | `true`                      | Only drives Koa's `proxy` option (`ctx.protocol` and `ctx.host` follow `X-Forwarded-Proto`/`-Host`, needed for ActivityPub URLs). It does not affect the client IP. |
| `RATE_LIMIT_AUTH`             | `10/60`                     | `auth` group. With `0` the users-permissions limiter stays (see below).                                                                                             |
| `RATE_LIMIT_AUTH_IDENTIFIER`  | `10/900`                    | Sign-ins per login identifier.                                                                                                                                      |
| `RATE_LIMIT_ADMIN_AUTH`       | `20/300`                    | Admin credential routes.                                                                                                                                            |
| `RATE_LIMIT_AUTH_EMAIL`       | `5/3600`                    | Emails per address.                                                                                                                                                 |
| `RATE_LIMIT_COMMENTS`         | `10/600`                    | Comment writes.                                                                                                                                                     |
| `RATE_LIMIT_UPLOAD`           | `30/600`                    | Uploads.                                                                                                                                                            |
| `RATE_LIMIT_FEDIVERSE_INBOX`  | `60/60`                     | Inbox deliveries.                                                                                                                                                   |
| `RATE_LIMIT_API`              | `600/60`                    | Rest of the API. `0` turns the group off (it also disables the token and the forwarder ceiling for it).                                                             |
| `RATE_LIMIT_TOKEN`            | `6000/60`                   | Per content-API token. `0`: valid tokens are not limited.                                                                                                           |
| `RATE_LIMIT_FORWARDER_SECRET` | _(unset)_                   | At least 32 characters or the boot fails (checked only when limiting is on). Unset: forwarding is off.                                                              |

When limiting is on and `RATE_LIMIT_AUTH` is not `0`, the limiter replaces the users-permissions one (`config/plugins.ts` sets `ratelimit.enabled: false`). Otherwise the plugin's own limiter stays, so the auth routes are never left open.

## Client IP Resolution

Koa with `proxy: true` takes the leftmost `X-Forwarded-For` entry, which the client writes. `global::client-ip` overwrites `ctx.request.ip` according to `TRUST_PROXY`, so the limiters, the admin and users-permissions limiters and Strapi's request context agree.

`TRUST_PROXY`:

- `private` (default, also the empty value): the header is read only while the socket peer, and each next hop walking right to left, is loopback, RFC 1918, link-local or IPv6 unique-local. The first non-private entry is the client. If the peer is public, the socket address is used.
- `false` (also `0` or `none`): the socket address only.
- `N` (integer): the Nth entry from the right. If the chain has fewer than N entries the socket address is used and a warning is logged.
- A comma-separated list of IPs and CIDR ranges (`private` is also accepted as an entry): same right-to-left walk as `private`, skipping trusted addresses. An empty prefix, a prefix of `0`, or a prefix beyond the family's maximum is rejected at boot, since `/0` would trust everyone.
- `true` is rejected at boot, even with limiting off.

Warnings are logged at most once a minute per kind: `TRUST_PROXY=false` while requests carry the proxy header (every client behind the proxy shares its address), and `N` hops larger than the chain.

Residual risk of `private`: if the app sees a private address for a public client, any client can then write the header. This happens with Docker's userland proxy, rootless Podman, or another container on the same network reaching the app directly. Use `false` or an explicit hop count or CIDR list there.

### Setups

- **No proxy:** `TRUST_PROXY=false`.
- **One reverse proxy** (Traefik, Nginx, Caddy): `TRUST_PROXY=1`, and make sure the proxy overwrites the header rather than appending a client-supplied one. Production uses this.
- **CDN plus proxy:** count the hops (`2` for client, CDN, proxy when each appends its peer), or point `PROXY_IP_HEADER` at the header the CDN sets (e.g. `CF-Connecting-IP`) only if the proxy passes it untouched and the app can be reached only through it.
- **Several proxies at known addresses:** `TRUST_PROXY=10.0.0.0/8` (list your proxies).
- **Demo compose:** `compose.demo.yml` sets `TRUST_PROXY=false`; the containers and the browser reach the app from private addresses and there is no proxy.

### Verifying the resolved IP

The app logs no per-request address. To check what it sees:

- The boot line shows the setting: `[rate-limit] on: <store> store, TRUST_PROXY=<value>` (or `[rate-limit] off: client address from TRUST_PROXY=<value>`).
- A `[rate-limit]` warning about the proxy header or hop count means the setting does not match the deployment.
- Behavioural check: temporarily set a low `RATE_LIMIT_API` (e.g. `3/60`), call an `/api/*` route repeatedly through the proxy and watch `RateLimit-Remaining`. Repeat from a second machine: if the counters are independent the real client IP is used; if they are shared, every client resolves to the proxy's address and `TRUST_PROXY` is wrong. Adding your own `X-Forwarded-For` header from outside must not change the counter.

## Forwarder

The frontend calls the CMS from one server IP, so without help every visitor would share one bucket. With `RATE_LIMIT_FORWARDER_SECRET` set on the CMS and `NUXT_STRAPI_FORWARDER_SECRET` on the frontend (the same value, `openssl rand -base64 32`), the frontend sends:

- `X-Micelio-Forwarder-Secret: <secret>`
- `X-Micelio-Client-IP: <visitor IP>`

Behaviour (`src/utils/rate-limit/forwarder.ts`):

- Only honoured on `/api/*` paths and only when limiting is on. The secret is compared as SHA-256 digests with `timingSafeEqual`.
- Both headers are always deleted from the request when limiting is on, and never logged. With limiting off nothing is read or deleted.
- Wrong secret: the request counts against the peer and a warning is logged. Valid secret with a missing or invalid IP: counts against the peer (a warning is logged for an invalid one).
- Valid secret and IP: the visitor's IP counts in every group, and a token is ignored.
- **Forwarder ceiling:** every forwarded request also counts in a bucket keyed by the peer and the group, with 20 times that group's own rule (for `api`, 12,000 / 60 s with the defaults; `comments`, 200 / 600 s). It applies whenever the group is limited and always lives in memory, so with several replicas the ceiling is per replica. It stops a compromised frontend from claiming unlimited fake client IPs.

The frontend must resolve the visitor IP with a trust model matching its own proxy chain, or visitors are throttled inconsistently.

## Stores

### Memory (default)

Counters live in the process: replicas count independently (3 replicas allow roughly 3 times the limit) and a restart clears them. IPv6 clients are bucketed by /64, but an attacker controlling many /64s creates many keys; the memory growth is accepted.

### Database (Postgres)

`RATE_LIMIT_STORE=database` stores the counters of `auth`, `auth-identifier`, `admin-auth`, `auth-email`, `comments`, `upload` and `fediverse-inbox` in the `micelio_rate_limits` table, shared between replicas. The `api` group, the token buckets, the token lookup budget and the forwarder ceiling always count in memory, per process: they are the hot path.

- A separate knex pool (max 3 connections, 1.5 s acquire timeout) so counting cannot starve Strapi's pool.
- Keys are HMACs derived from `APP_KEYS[0]`; rotating it only resets the counters. Expired rows are pruned every 5 minutes.
- A key already over its limit is answered from memory until its window ends, with no query.
- Failure: a memory limiter takes over for the failing group; if that fails too the request is allowed (fail open). A warning naming the group (never the key) is logged at most once a minute.
- The table is created by the boot migration `src/migrations/rate-limit-table.ts` (root app, not a plugin), only on Postgres with limiting on and the database store. It is race-safe (`CREATE TABLE IF NOT EXISTS`, and the duplicate-table and unique-violation errors `42P07`/`23505` of a concurrent boot are swallowed) and survives restarts and Strapi's schema sync (verified on Postgres 18).
- On any other database the store falls back to memory with a warning on first use.

## Fediverse Inbox

Fedify's middleware runs before every root middleware and needs the raw body, so the inbox is limited by a guard. The root registers it in `plugin::fediverse.requestGuard` (`src/utils/rate-limit/guard.ts`) only while limiting is on; the plugin reads it on every federation-path request (`mountFediverseMiddleware` in `federation.ts`) and calls it before Fedify.

- The guard resolves the IP itself, never reads the body, counts `POST` inbox paths in `fediverse-inbox` and other federation requests in `api`, and marks the request so the root middleware does not count it again. It does not use the forwarder or tokens.
- If it returns `true` the 429 is already written. If it is missing or throws, the request goes through (fail open; a thrown error logs a warning at most once a minute).

## Reverse-Proxy Limits (optional)

A proxy or CDN can add its own limits as defense in depth; the app does not depend on them. Check the syntax in your proxy's documentation before use. Minimal examples:

```yaml
# Traefik (dynamic configuration)
http:
  middlewares:
    api-rate-limit:
      rateLimit:
        average: 100
        period: 1s
        burst: 200
```

```nginx
# Nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
# in the location that proxies to the app:
limit_req zone=api burst=50 nodelay;
```

Caddy has no built-in rate limiter; it needs a third-party module.

## Exempt Paths

Never limited (`src/constants/rate-limit.ts`):

- `/_health` and `/favicon.ico`, and `/uploads/*`.
- `/admin` and everything under it, except `POST` on `/admin/login`, `/admin/forgot-password`, `/admin/reset-password`, `/admin/register-admin` and `/admin/register` (group `admin-auth`).
- The admin-panel API prefixes `/content-manager`, `/content-type-builder`, `/upload`, `/i18n`, `/users-permissions`, `/email`, `/seo`, `/comments` and `/article-stats`. The content API's `/api/upload` and `/api/comments` are limited. The list is static: add the prefix of any plugin that adds admin routes.
- `/mcp` with a bearer that resolves to an admin token (see Token buckets). Without one it counts in the `api` group.

## Rollout and Rollback

Limiting is on by default and `main` deploys to production automatically.

1. **Before merging to `main`**, set `RATE_LIMIT_ENABLED=false` in the production environment (Dokploy), so the deploy changes nothing. Also set `TRUST_PROXY=1` there (Traefik is the single hop).
2. Merge and deploy the CMS; check the boot line `[rate-limit] off: ...`.
3. Merge and deploy the frontend change that sends the forwarder headers.
4. Generate the secret and set `RATE_LIMIT_FORWARDER_SECRET` (CMS) and `NUXT_STRAPI_FORWARDER_SECRET` (frontend) to the same value. Without forwarding every visitor of the frontend would share one bucket.
5. Set `RATE_LIMIT_ENABLED=true`, redeploy both, [verify the resolved IP](#verifying-the-resolved-ip) and watch the logs for 429s on legitimate traffic. Adjust limits if needed.

### Rollback

Set `RATE_LIMIT_ENABLED=false` and restart the CMS. The limiter and the fediverse guard are not registered. The client IP is still resolved from `TRUST_PROXY` and `TRUST_PROXY=true` still stops the boot. The forwarder is not applied, so the forwarder headers are neither read nor deleted (nothing reads them). The users-permissions limiter is back in effect. No image rollback or data change is needed.

## Testing

Suites are `tests/rate-limit*.test.ts`, running on SQLite like the rest. With `TEST_DATABASE_URL=postgres://user:pass@host:5432/postgres npm test` every Jest worker gets its own freshly recreated database (`strapi_test_<worker>`), which also exercises the database store.

## Implementation notes

Moved from `CLAUDE.md` (#113); the text is unchanged.

**Rate limiting** (#100, `docs/RATE_LIMITING.md`): the app protects itself whatever proxy sits in front (clients will host it behind Nginx, Caddy, a CDN or nothing; Traefik is only today's deployment). `rate-limiter-flexible` middlewares (`src/middlewares/{client-ip,rate-limit,rate-limit-identifier}.ts`, logic in `src/utils/rate-limit/`, config in `config/rate-limit.ts`) are on by default except under `NODE_ENV=test`; `RATE_LIMIT_ENABLED=false` is the rollback switch. Koa with `proxy: true` and no `maxIpsCount` takes the **leftmost** `X-Forwarded-For` entry, which the client controls, so `global::client-ip` overwrites `ctx.request.ip` from `TRUST_PROXY` (`private` by default: trust the header only from loopback/private peers; `N` hops; CIDR list; `false`; `true` stops the boot) even when limiting is off, which also fixes the keys of Strapi's admin and users-permissions limiters; `TRUST_PROXY_PROTOCOL` alone drives `proxy.koa` (`ctx.protocol` for ActivityPub URLs). Groups and keys: `auth` per client and route family, `auth-identifier` and `auth-email` per HMAC of the identifier/email (`forgot-password` and `send-email-confirmation` answer their normal 200 without sending), `admin-auth`, `comments` and `upload` per client (never per API token), `fediverse-inbox`, and `api` per client or, after a first overflow, per valid content-API token. The frontend calls the CMS from one IP, so with `RATE_LIMIT_FORWARDER_SECRET` it sends the visitor's IP (`X-Micelio-Client-IP`, only honoured on `/api/*`, token ignored, capped per peer and group); without it every visitor shares one bucket, hence the rollout: CMS deployed with limiting off, then micelio forwarding, then on. When on (and `RATE_LIMIT_AUTH` ≠ 0) it replaces the users-permissions limiter. Fedify runs before every root middleware, so the inbox is limited by a guard the root sets in `plugin::fediverse.requestGuard` (read per request, fail open). `RATE_LIMIT_STORE=database` shares counters through Postgres (own knex pool, HMAC'd keys, memory fallback, fail open; table `micelio_rate_limits` survives schema sync); SQLite falls back to memory. Exempt: `/_health`, `/uploads`, the admin panel and its API prefixes (`ADMIN_API_PREFIXES`, a static list to extend when a plugin adds admin routes) except login and password routes, `/mcp` with a valid admin token.
