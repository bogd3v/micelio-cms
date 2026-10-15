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
| `tests/response-fields-articles.test.ts`  | Articles, and the 400 for a query that names `plainText` or the author email                               |
| `tests/response-fields-checker.test.ts`   | The checker itself, on made-up and on real shapes                                                          |
| `tests/response-fields-rules.test.ts`     | The rules the constants must keep, such as no private attribute and no required key under a surplus object |
| `tests/response-fields-docs.test.ts`      | That this document renders the constants                                                                   |
| `tests/frontend-queries.test.ts`          | That the copied populates equal micelio's, when `../micelio` exists                                        |

The suites send the queries the frontend sends (`tests/helpers/frontend-queries.ts`, copied from micelio) and, for list routes, an unpopulated call too. The constants cover those queries. A caller who asks for another `populate` or `fields` can get relations or attributes that are not listed here; which relations a role may populate is access control, covered by [asvs.md](asvs.md) V8.

## How to read the tables

Each surface has a summary table, then one table per route with one row per object of the response. The path of an object is `(body)` for the body itself and `data.cover` for the `cover` of each item of `data`; `blocks[shared.media]` is the item of a dynamic zone with that `__component`. A row lists the keys of that object only: an object that sits inside it has its own row, and a shared object (`media-card`, `seo-card` and the others) is listed once under _Shared objects_.

| Term     | Meaning                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required | The frontend reads the field (the file that reads it is in the _Read by_ column of the summary). Documented, never removed.                                                                                                       |
| Surplus  | Returned and not read. The route's note says why it stays.                                                                                                                                                                        |
| Auth     | What the route asks of the caller. Token routes have no role permission at all (`src/migrations/page-permissions.ts`, `site-settings.ts` and `subscriber-permissions.ts` remove them on every boot), so the public role gets 403. |
| Counts   | The summary counts the keys of the whole response, shared objects included, once per place they appear.                                                                                                                           |

Callers in the tests: the **public role** (with `find` granted where the route is not public by default), the **frontend token** and the **build token** (`FRONTEND_TOKEN_PERMISSIONS` and `BUILD_TOKEN_PERMISSIONS` in `src/migrations/api-tokens.ts`), an **editor** and a signed-in **reader** (a JWT). The suites also check who cannot read: the draft list answers the public role, a reader, the frontend token and the build token with 403.

## What every response adds and cannot lose

Strapi adds `id` and `documentId` to every document whatever `fields` says, adds `createdAt`, `updatedAt` and `publishedAt` to every document that is not restricted with `fields`, and wraps lists and single types in `data` and `meta`. These are surplus where the frontend does not read them. Removing them needs a custom controller or a response middleware per route; that is a code change outside this document.

## Surplus worth a follow-up

These fields are public content, the caller's own data, or file metadata including the original file name and provider metadata. They are listed so a later change can decide.

| Where              | Surplus                                                                                                                                                                                                                                 | Follow-up                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `articles.feed`    | The whole file row of every image: `name`, `hash`, `ext`, `size`, `formats`, `provider`, `provider_metadata`, `previewUrl`, timestamps. `name` is the original file name and `provider_metadata` is whatever the upload provider stores | micelio: name the fields of each media in the populate, as `POST_CARD_POPULATE` does                                            |
| `articles.feed`    | The whole `category` and `author` (`bio`, `description`, `key`, `bird`, `pillar`, `order`)                                                                                                                                              | micelio: name the fields the feed reads (`title`, `description`, `slug`, `publishedAt`, `locale`, `cover.url`, `category.name`) |
| `articles.popular` | Everything: no frontend caller                                                                                                                                                                                                          | Keep for integrators, or revoke `find` where an operator granted it                                                             |
| `articles.search`  | `locale`, `meta.query`, `meta.count`                                                                                                                                                                                                    | None needed                                                                                                                     |

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
### Articles

| Route | Method and path | Auth | Required | Surplus | Read by | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `articles.list` | `GET /api/articles` | public role with `find`, or an API token with `find` | 60 | 4 | server/api/posts/index.get.ts, server/utils/pageSections.ts | The query is the post card populate of `POST_CARD_POPULATE`; an unpopulated call returns the scalar fields only. `readTime` and `snippet` are added by the frontend, not by the CMS. |
| `articles.detail` | `GET /api/articles?filters[slug]=:slug` | public role with `find`, an API token with `find`, or an editor JWT for drafts | 152 | 10 | server/api/posts/[slug].get.ts, server/api/drafts/[documentId].get.ts | The query is `ARTICLE_POPULATE`. An editor reads a draft the same way (`status=draft`, `GET /api/articles/:documentId`, a single object under `data`). `plainText` and `author.email` are private attributes and never appear. |
| `articles.feed` | `GET /api/articles?populate[]=cover&populate[]=category&populate[]=author` | public role with `find`, or an API token with `find` | 14 | 47 | server/utils/feed.ts | The RSS feed populates whole relations, so the whole file row, category and author come back; it reads `title`, `description`, `slug`, `publishedAt`, `locale`, `cover.url` and `category.name`. Follow-up in micelio: name the fields of each relation, as `POST_CARD_POPULATE` does. |
| `articles.sitemap` | `GET /api/articles?fields[]=slug&fields[]=locale&fields[]=publishedAt&fields[]=updatedAt` | public role with `find`, or an API token with `find` | 11 | 8 | server/routes/sitemap.xml.ts | Strapi adds `id` and `documentId` to every document whatever `fields` says; they cannot be dropped without a custom controller. |
| `articles.reading-path` | `GET /api/articles?fields[]=documentId&fields[]=slug&fields[]=title` | public role with `find`, or an API token with `find` | 4 | 7 | server/api/reading-path.get.ts | Strapi adds `id` to every document whatever `fields` says. |
| `articles.slugs` | `GET /api/articles?fields[]=slug` | public role with `find`, or an API token with `find` | 5 | 5 | modules/static-routes.ts | The static build lists the slugs page by page and reads `pageCount`. |
| `articles.search` | `GET /api/articles/search` | none (`auth: false`) | 11 | 4 | server/utils/articleSearch.ts | Custom route, `auth: false`. The service builds each row by hand (`src/api/article/services/article.ts`), so a new attribute never reaches it. |
| `articles.popular` | `GET /api/articles/popular` | none (`auth: false`) | 0 | 15 | none found | Custom route, `auth: false`, from the Umami sync. No frontend caller was found, so every field is surplus until one reads it; the route stays for integrators. |
| `articles.drafts` | `GET /api/articles/drafts` | editor JWT (`global::is-editor`) | 13 | 2 | server/api/drafts/index.get.ts | Editors only (`global::is-editor`); an API token, the public role and a reader get 403. The service builds each row by hand. |

#### `articles.list`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data`, `meta` | none |
| `data` | `id`, `documentId`, `title`, `slug`, `locale`, `description`, `publishedAt`, `tags`, `cover`, `category`, `author`, `seo` | `pathOrder`, `createdAt`, `updatedAt` |
| `data.tags` | as shared `tag-card` | as shared `tag-card` |
| `data.cover` | as shared `media-card` | as shared `media-card` |
| `data.category` | as shared `category-card` | as shared `category-card` |
| `data.author` | as shared `author-card` | as shared `author-card` |
| `data.seo` | as shared `seo-card` | as shared `seo-card` |
| `meta` | `pagination` | none |
| `meta.pagination` | as shared `pagination` | as shared `pagination` |

#### `articles.detail`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `id`, `documentId`, `title`, `slug`, `locale`, `description`, `publishedAt`, `tags`, `cover`, `category`, `author`, `seo`, `coverCredit`, `references`, `localizations`, `blocks` | `pathOrder`, `createdAt`, `updatedAt` |
| `data.tags` | as shared `tag-card` | as shared `tag-card` |
| `data.cover` | as shared `media-card` | as shared `media-card` |
| `data.category` | as shared `category-card` | as shared `category-card` |
| `data.author` | as shared `author-card` | as shared `author-card` |
| `data.seo` | as shared `seo-card` | as shared `seo-card` |
| `data.coverCredit` | as shared `image-credit` | as shared `image-credit` |
| `data.references` | as shared `reference` | as shared `reference` |
| `data.localizations` | as shared `localization-article` | as shared `localization-article` |
| `data.blocks[shared.rich-text]` | `id`, `__component`, `body` | none |
| `data.blocks[shared.quote]` | `id`, `__component`, `body`, `title` | none |
| `data.blocks[shared.media]` | `id`, `__component`, `file`, `caption`, `credit` | none |
| `data.blocks[shared.media].file` | as shared `media-card` | as shared `media-card` |
| `data.blocks[shared.media].credit` | as shared `image-credit` | as shared `image-credit` |
| `data.blocks[shared.slider]` | `id`, `__component`, `items`, `files` | none |
| `data.blocks[shared.slider].items` | `id`, `file`, `caption`, `credit` | none |
| `data.blocks[shared.slider].items.file` | as shared `media-card` | as shared `media-card` |
| `data.blocks[shared.slider].items.credit` | as shared `image-credit` | as shared `image-credit` |
| `data.blocks[shared.slider].files` | as shared `media-card` | as shared `media-card` |
| `data.blocks[shared.playground]` | `id`, `__component`, `runtime`, `code`, `expectedOutput`, `setup`, `caption` | none |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

#### `articles.feed`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `title`, `description`, `slug`, `publishedAt`, `locale`, `cover`, `category` | `id`, `documentId`, `pathOrder`, `createdAt`, `updatedAt`, `author` |
| `data.cover` | as shared `media-file` | as shared `media-file` |
| `data.category` | `name` | `id`, `documentId`, `slug`, `description`, `key`, `bird`, `pillar`, `order`, `createdAt`, `updatedAt`, `publishedAt`, `locale` |
| `data.author` | none | `id`, `documentId`, `name`, `bio`, `createdAt`, `updatedAt`, `publishedAt`, `locale` |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

#### `articles.sitemap`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `slug`, `locale`, `publishedAt`, `updatedAt`, `localizations` | `id`, `documentId` |
| `data.localizations` | as shared `localization-article` | as shared `localization-article` |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

#### `articles.reading-path`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `documentId`, `slug`, `title` | `id` |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

#### `articles.slugs`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data`, `meta` | none |
| `data` | `slug` | `id`, `documentId` |
| `meta` | `pagination` | none |
| `meta.pagination` | as shared `pagination-pages` | as shared `pagination-pages` |

#### `articles.search`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `documentId`, `slug`, `title`, `description`, `publishedAt`, `category`, `matchedIn`, `snippet` | `locale` |
| `data.category` | `slug`, `name` | none |
| `meta` | none | `query`, `count` |

#### `articles.popular`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | none | `data`, `meta` |
| `data` | none | `documentId`, `slug`, `title`, `description`, `publishedAt`, `locale`, `category`, `views` |
| `data.category` | none | `slug`, `name` |
| `meta` | none | `period`, `locale`, `syncedAt` |

#### `articles.drafts`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `documentId`, `title`, `slug`, `locale`, `updatedAt`, `publishedAt`, `state`, `category`, `author` | none |
| `data.category` | `name`, `slug` | none |
| `data.author` | `name` | none |
| `meta` | none | `count` |

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

#### `media-card`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `documentId`, `url`, `alternativeText`, `caption`, `width`, `height` | none |

#### `media-file`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `url`, `alternativeText`, `width`, `height`, `mime` | `id`, `documentId`, `name`, `caption`, `focalPoint`, `formats`, `hash`, `ext`, `size`, `previewUrl`, `provider`, `provider_metadata`, `createdAt`, `updatedAt`, `publishedAt` |

#### `image-credit`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `kind`, `author`, `authorUrl`, `source`, `sourceUrl`, `license`, `licenseUrl`, `modifications` | none |

#### `seo-card`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `metaTitle`, `metaDescription`, `metaImage`, `keywords`, `metaRobots`, `structuredData`, `canonicalURL` | `metaViewport` |
| `metaImage` | as shared `media-card` | as shared `media-card` |

#### `reference`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `key`, `type`, `authors`, `year`, `title`, `container`, `volume`, `issue`, `pages`, `venueLabel`, `doi`, `url`, `accessedAt` | none |

#### `localization-article`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `documentId`, `slug`, `locale`, `publishedAt` | none |

#### `category-card`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `documentId`, `name`, `slug` | none |

#### `tag-card`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `documentId`, `name`, `slug` | none |

#### `author-card`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `documentId`, `name`, `avatar` | none |
| `avatar` | as shared `media-card` | as shared `media-card` |

#### `pagination`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `page`, `pageSize`, `pageCount`, `total` | none |

#### `pagination-pages`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `pageCount` | `page`, `pageSize`, `total` |

#### `pagination-unread`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | none | `page`, `pageSize`, `pageCount`, `total` |
<!-- END GENERATED -->
<!-- prettier-ignore-end -->
