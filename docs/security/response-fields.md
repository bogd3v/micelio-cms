# Response fields

**Kind:** reference. The fields each public or token-readable route returns, which of them the frontend reads and which it does not. Answers ASVS 5.0.0 V15.3.1, "responses return only the required fields" ([mapping](asvs.md)); [#200](https://github.com/bogd3v/micelio-cms/issues/200) tracks it. The frontend limits what leaves its own server with allow-lists (`server/lib/publicShapes.ts` in micelio); this document covers what the CMS sends to it, to an integrator and to a visitor who calls the content API directly.

## Policy

- A field the frontend needs is **required**. It is documented here and never removed or ignored.
- A field the frontend does not need is **surplus**. It is listed with the reason it stays or the follow-up that would remove it; this document and its tests do not remove it.
- Private attributes (`plainText` and `author.email` of an article, the author email and the reports of a comment, password hashes and reset tokens of a user) appear in no response and in no table below. The tests back it: the constants list none of them (`tests/response-fields-rules.test.ts`), and every response is read against the constants, so a response that carried one fails the suite that reads it.

## How it is checked

The keys of every object of every response are listed in [`src/constants/response-fields/`](../../src/constants/response-fields/index.ts), each one `required` or `surplus`. The tables below are generated from those constants and `tests/response-fields-docs.test.ts` fails when they differ. After changing the constants, regenerate them with `npm run docs:response-fields` (it runs `UPDATE_RESPONSE_FIELDS_DOC=1 npx jest tests/response-fields-docs.test.ts`).

The suites seed one fully populated record of each content type, private attributes included, and call each route as each caller that may. Each response is read against the constants, and a test fails when:

- a response carries a key the constants do not list (the failure names the route and the field);
- a required key is missing from every response of the route;
- the constants list an object that no response returns, so a stale entry cannot linger;
- a caller the constants list for a route is never exercised by its suite.

| Suite                                     | Covers                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `tests/response-fields-fediverse.test.ts` | The fediverse counters                                                                                     |
| `tests/response-fields-checker.test.ts`   | The checker itself, on made-up and on real shapes                                                          |
| `tests/response-fields-rules.test.ts`     | The rules the constants must keep, such as no private attribute and no required key under a surplus object |
| `tests/response-fields-docs.test.ts`      | That this document renders the constants                                                                   |

The suites send the queries the frontend sends (`tests/helpers/frontend-queries.ts`, copied from micelio) and, for list routes, an unpopulated call too. The constants cover those queries. A caller who asks for another `populate` or `fields` can get relations or attributes that are not listed here; which relations a role may populate is access control, covered by [asvs.md](asvs.md) V8.

## How to read the tables

Each surface has a summary table, then one table per route with one row per object of the response. The path of an object is `(body)` for the body itself and `data.cover` for the `cover` of each item of `data`; `blocks[shared.media]` is the item of a dynamic zone with that `__component`. A row lists the keys of that object only: an object that sits inside it has its own row, and a shared object (`media-card`, `seo-card` and the others) is listed once under _Shared objects_.

| Term     | Meaning                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required | The frontend reads the field (the file that reads it is in the _Read by_ column of the summary). Documented, never removed.                                                                                                       |
| Surplus  | Returned and not read. The route's note says why it stays.                                                                                                                                                                        |
| Auth     | What the route asks of the caller. Token routes have no role permission at all (`src/migrations/page-permissions.ts`, `site-settings.ts` and `subscriber-permissions.ts` remove them on every boot), so the public role gets 403. |
| Counts   | The summary counts the keys of the whole response, shared objects included, once per place they appear.                                                                                                                           |

Callers in the tests: the **public role** (with `find` granted where the route is not public by default), the **frontend token** and the **build token** (`FRONTEND_TOKEN_PERMISSIONS` and `BUILD_TOKEN_PERMISSIONS` in `src/migrations/api-tokens.ts`), an **editor** and a signed-in **reader** (a JWT).

## What every response adds and cannot lose

Strapi adds `id` and `documentId` to every document whatever `fields` says, adds `createdAt`, `updatedAt` and `publishedAt` to every document that is not restricted with `fields`, and wraps lists and single types in `data` and `meta`. These are surplus where the frontend does not read them. Removing them needs a custom controller or a response middleware per route; that is a code change outside this document.

## Not covered

- **ActivityPub and NodeInfo.** The actor, followers, outbox, `Article` objects, WebFinger and NodeInfo documents (`/fediverse/*`, `/.well-known/*`, `/nodeinfo/*`, built by Fedify in `src/plugins/fediverse/server/src/federation.ts`) have a shape the protocols define, and remote servers expect those fields. They are excluded from the per-field tests; what they publish about the actor is configured in the fediverse module ([FEDIVERSE.md](../FEDIVERSE.md)).
- **Routes with no frontend caller and no role by default.** The `findOne` variants of the content types other than those listed under _Default grants not traced_, `POST`, `PUT` and `DELETE` on the content types other than the subscribers, the comments plugin's routes to report, edit and delete a comment and to list the comments of an author, `/api/users`, `/api/users/:id`, `/api/email` and `/api/upload`. They answer 403 until an operator grants a permission; their bodies are not traced here.
- **Default grants not traced.** The public role also has `auth.refresh`, `auth.forgotPassword`, `auth.resetPassword`, `auth.emailConfirmation`, `auth.sendEmailConfirmation` and `tag.findOne`, a reader has `auth.changePassword` and the session routes, and an editor has `findOne` on articles, categories, authors and tags and `find` and `findOne` on uploads. Their bodies come from Strapi's users-permissions and upload plugins and are not listed field by field yet.
- **Deleting your own account.** `DELETE /api/users/me` (`plugin::users-permissions.user.destroyMe`, granted to the public role, readers and editors by `src/migrations/account-settings.ts`) deletes the account of the JWT; its body is not traced.
- **Deleting a subscriber.** The frontend token's `subscriber.delete` answers 204 with no body (the accounts suite asserts it is empty), so there are no fields to list.
- **Admin API and the MCP endpoint.** They need an admin session or an admin API token and are covered by ASVS V8, not by this document.
- **Populates the frontend does not send.** See _How it is checked_.

## The tables

<!-- prettier-ignore-start -->
<!-- BEGIN GENERATED: tests/helpers/response-fields-doc.ts -->
### Fediverse counters

| Route | Method and path | Auth | Required | Surplus | Read by | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `fediverse.stats-batch` | `GET /api/fediverse/articles/stats?documentIds=:ids` | none (`auth: false`) | 3 | 0 | server/api/fediverse/stats/index.get.ts, server/api/posts/index.get.ts | Aggregates only, never who interacted. Keyed by `documentId`; each value has these keys. |
| `fediverse.stats-one` | `GET /api/fediverse/articles/:documentId/stats` | none (`auth: false`) | 2 | 0 | server/api/fediverse/stats/[documentId].get.ts | Published articles only; any other id is a 404. |
| `fediverse.ranking` | `GET /api/fediverse/articles/ranking` | none (`auth: false`) | 8 | 3 | server/api/posts/index.get.ts | The frontend takes the order from `documentId` and passes `meta` through; the counters are not read. |

#### `fediverse.stats-batch`

The body is a map from a document id; each value has the keys of `(body)`.

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `likes`, `boosts`, `replies` | none |

#### `fediverse.stats-one`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `likes`, `boosts` | none |

#### `fediverse.ranking`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data`, `meta` | none |
| `data` | `documentId` | `likes`, `boosts`, `replies` |
| `meta` | `pagination` | none |
| `meta.pagination` | as shared `pagination` | as shared `pagination` |

### Shared objects

#### `pagination`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `page`, `pageSize`, `pageCount`, `total` | none |
<!-- END GENERATED -->
<!-- prettier-ignore-end -->
