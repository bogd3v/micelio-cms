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

| Suite                                      | Covers                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `tests/response-fields-fediverse.test.ts`  | The fediverse counters                                                                                     |
| `tests/response-fields-articles.test.ts`   | Articles, and the 400 for a query that names `plainText` or the author email                               |
| `tests/response-fields-pages-site.test.ts` | Categories, tags, About, pages, authors, global, site settings, and who cannot read them                   |
| `tests/response-fields-accounts.test.ts`   | Comments, sign up and sign in, the signed-in user, subscribers                                             |
| `tests/response-fields-checker.test.ts`    | The checker itself, on made-up and on real shapes                                                          |
| `tests/response-fields-rules.test.ts`      | The rules the constants must keep, such as no private attribute and no required key under a surplus object |
| `tests/response-fields-docs.test.ts`       | That this document renders the constants                                                                   |
| `tests/frontend-queries.test.ts`           | That the copied populates equal micelio's, when `../micelio` exists                                        |

The suites send the queries the frontend sends (`tests/helpers/frontend-queries.ts`, copied from micelio) and, for list routes, an unpopulated call too. The constants cover those queries. A caller who asks for another `populate` or `fields` can get relations or attributes that are not listed here; which relations a role may populate is access control, covered by [asvs.md](asvs.md) V8.

## How to read the tables

Each surface has a summary table, then one table per route with one row per object of the response. The path of an object is `(body)` for the body itself and `data.cover` for the `cover` of each item of `data`; `blocks[shared.media]` is the item of a dynamic zone with that `__component`. A row lists the keys of that object only: an object that sits inside it has its own row, and a shared object (`media-card`, `seo-card` and the others) is listed once under _Shared objects_.

| Term     | Meaning                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required | The frontend reads the field (the file that reads it is in the _Read by_ column of the summary). Documented, never removed.                                                                                                       |
| Surplus  | Returned and not read. The route's note says why it stays.                                                                                                                                                                        |
| Auth     | What the route asks of the caller. Token routes have no role permission at all (`src/migrations/page-permissions.ts`, `site-settings.ts` and `subscriber-permissions.ts` remove them on every boot), so the public role gets 403. |
| Counts   | The summary counts the keys of the whole response, shared objects included, once per place they appear.                                                                                                                           |

Callers in the tests: the **public role** (with `find` granted where the route is not public by default), the **frontend token** and the **build token** (`FRONTEND_TOKEN_PERMISSIONS` and `BUILD_TOKEN_PERMISSIONS` in `src/migrations/api-tokens.ts`), an **editor** and a signed-in **reader** (a JWT). The suites also check who cannot read: the draft list answers the public role, a reader, the frontend token and the build token with 403; the page and site settings routes answer the public role, a reader and an editor with 403, and `global` answers the frontend token and the build token with 403; the subscriber routes answer the public role, a reader, an editor and the build token with 403, and the comment routes answer the build token with 403.

## What every response adds and cannot lose

Strapi adds `id` and `documentId` to every document whatever `fields` says, adds `createdAt`, `updatedAt` and `publishedAt` to every document that is not restricted with `fields`, and wraps lists and single types in `data` and `meta`. These are surplus where the frontend does not read them. Removing them needs a custom controller or a response middleware per route; that is a code change outside this document.

## Surplus worth a follow-up

V15.3.1 is met with an accepted risk: the surplus fields below remain, and nothing here removes them. They are public content or the caller's own data. The frontend names the `fields` of every media and relation it populates (`PAGE_POPULATE`, `SITE_POPULATE` and `FEED_POPULATE`), so the file row (original file name, provider metadata) no longer comes back. The CMS already reduces `threadOf` to `{ id }`.

| Where                                             | Surplus                                                                                                                                                                                                                                                | Follow-up                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `comments.flat`, `comments.tree`                  | `gotThread`, `threadFirstItemId`, `locale`, `publishedAt`; `pagination` is read as `meta.pagination` and is never there                                                                                                                                | None needed; plugin internals                                                                 |
| `site-setting.find`                               | `tagline`, `securityContact`, `timezone`, `addressLocality`: public identity the frontend schema does not read yet                                                                                                                                     | micelio: read them (`security.txt` needs `securityContact`) or stop populating                |
| `articles.popular`, `authors.find`, `global.find` | Everything: no frontend caller                                                                                                                                                                                                                         | Keep for integrators, or revoke `find` where an operator granted it                           |
| `articles.search`                                 | `locale`, `meta.query`, `meta.count`                                                                                                                                                                                                                   | None needed                                                                                   |
| `users.me`, `auth.login`, `auth.register`         | `id`, `documentId`, `provider`, `confirmed`, `blocked`, timestamps, `role` details; on login the whole `user`                                                                                                                                          | The caller's own account; none needed                                                         |
| `subscribers.*`                                   | `id`, timestamps and, on `create` and `update`, the stored row the frontend does not read. The tokens come back as stored: the frontend stores SHA-256 hashes, but rows written before it did keep the token in clear, and the token holder reads them | None needed here: token only. V14.2.1 in [asvs.md](asvs.md) covers the tokens stored in clear |

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
| `articles.feed` | `GET /api/articles?populate[cover][fields][0]=url&populate[category][fields][0]=name` | public role with `find`, or an API token with `find` | 10 | 20 | server/utils/feed.ts | The query is `FEED_POPULATE`: the cover returns `url` and the category `name`, and the feed no longer asks for the author. It reads `title`, `description`, `slug`, `publishedAt`, `locale`, `cover.url` and `category.name`. |
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
| `data` | `title`, `description`, `slug`, `publishedAt`, `locale`, `cover`, `category` | `id`, `documentId`, `pathOrder`, `createdAt`, `updatedAt` |
| `data.cover` | as shared `media-feed` | as shared `media-feed` |
| `data.category` | `name` | `id`, `documentId`, `slug`, `createdAt`, `updatedAt`, `publishedAt`, `locale` |
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

### Categories and tags

| Route | Method and path | Auth | Required | Surplus | Read by | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `categories.find` | `GET /api/categories` | public role with `find`, or an API token with `find` | 6 | 19 | server/api/categories.get.ts | The frontend asks for `name`, `slug` and the ids of `articles`. An unrestricted call also returns `description`, `key`, `bird`, `pillar`, `featured`, `color` and `order`, which the frontend does not read. Strapi adds `documentId` whatever `fields` says. |
| `tags.find` | `GET /api/tags` | public role (granted by default), or an API token with `find` | 4 | 14 | server/api/tags.get.ts | Public by default. The frontend reads `name`, `slug` and the number of `articles`; `id` and `documentId` are added by Strapi whatever `fields` says. |

#### `categories.find`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `id`, `name`, `slug`, `articles` | `documentId`, `description`, `key`, `bird`, `pillar`, `featured`, `color`, `order`, `createdAt`, `updatedAt`, `publishedAt`, `locale` |
| `data.articles` | `id` | `documentId` |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

#### `tags.find`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `name`, `slug`, `articles` | `id`, `documentId`, `createdAt`, `updatedAt`, `publishedAt`, `locale` |
| `data.articles` | none | `id`, `documentId` |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

### About and pages

| Route | Method and path | Auth | Required | Surplus | Read by | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `about.find` | `GET /api/about` | public role with `find`, or an API token with `find` | 191 | 5 | server/api/about.get.ts (`publicAbout`) | Single type; the query is `ABOUT_POPULATE`. The frontend re-filters the body with its own allow-list, which this shape mirrors. |
| `pages.find` | `GET /api/pages` | API token with `find`; no role | 164 | 62 | server/utils/pageSections.ts (`parsePage`) | Token only. The frontend asks for one page by `limit`, so the pagination is offset based. The query is `PAGE_POPULATE`, which names `url`, `alternativeText`, `width`, `height` and `mime` for each media, as `parsePage` reads them. |
| `pages.slugs` | `GET /api/pages?fields[]=slug` | API token with `find`; no role | 5 | 5 | modules/static-routes.ts | Token only. Strapi adds `id` and `documentId` whatever `fields` says. |

#### `about.find`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `id`, `documentId`, `title`, `locale`, `seo`, `blocks` | `createdAt`, `updatedAt`, `publishedAt` |
| `data.seo` | as shared `seo-card` | as shared `seo-card` |
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
| `data.blocks[about.profile]` | `id`, `__component`, `eyebrow`, `title`, `lead`, `facts`, `links`, `photo`, `plateLabel`, `plateCoordinates`, `caption` | none |
| `data.blocks[about.profile].facts` | `id`, `label`, `value`, `mono` | none |
| `data.blocks[about.profile].links` | as shared `link-about` | as shared `link-about` |
| `data.blocks[about.profile].photo` | as shared `media-card` | as shared `media-card` |
| `data.blocks[about.statement]` | `id`, `__component`, `eyebrow`, `statement`, `body` | none |
| `data.blocks[about.topics]` | `id`, `__component`, `eyebrow`, `title`, `intro`, `topics`, `footnoteLabel`, `footnote` | none |
| `data.blocks[about.topics].topics` | `id`, `category`, `title`, `description` | none |
| `data.blocks[about.projects]` | `id`, `__component`, `anchor`, `eyebrow`, `title`, `intro`, `projects` | none |
| `data.blocks[about.projects].projects` | `id`, `eyebrow`, `meta`, `title`, `description`, `facts`, `stack`, `links`, `featured`, `visual`, `visualCaption` | none |
| `data.blocks[about.projects].projects.facts` | `id`, `label`, `value`, `mono` | none |
| `data.blocks[about.projects].projects.stack` | `id`, `name` | none |
| `data.blocks[about.projects].projects.links` | as shared `link-about` | as shared `link-about` |
| `data.blocks[about.principles]` | `id`, `__component`, `eyebrow`, `title`, `principles` | none |
| `data.blocks[about.principles].principles` | `id`, `title`, `text` | none |
| `data.blocks[about.open-source]` | `id`, `__component`, `eyebrow`, `text`, `code`, `guideTitle`, `guide` | none |
| `data.blocks[about.open-source].guide` | `id`, `title`, `text` | none |
| `data.blocks[about.contact]` | `id`, `__component`, `eyebrow`, `title`, `fediverseLabel`, `fediverseHandle`, `fediverseLink`, `extraLink`, `socials` | none |
| `data.blocks[about.contact].fediverseLink` | as shared `link-about` | as shared `link-about` |
| `data.blocks[about.contact].extraLink` | as shared `link-about` | as shared `link-about` |
| `data.blocks[about.contact].socials` | `id`, `network`, `handle`, `url` | none |
| `meta` | as shared `meta-single` | as shared `meta-single` |

#### `pages.find`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `documentId`, `title`, `slug`, `locale`, `seo`, `sections`, `localizations` | `id`, `createdAt`, `updatedAt`, `publishedAt` |
| `data.seo` | as shared `seo-page` | as shared `seo-page` |
| `data.sections[section.hero]` | `__component`, `variant`, `title`, `text`, `primaryLink`, `secondaryLink`, `media` | `id` |
| `data.sections[section.hero].primaryLink` | as shared `link-section` | as shared `link-section` |
| `data.sections[section.hero].secondaryLink` | as shared `link-section` | as shared `link-section` |
| `data.sections[section.hero].media` | as shared `media-page` | as shared `media-page` |
| `data.sections[section.feature-grid]` | `__component`, `variant`, `title`, `text`, `items` | `id` |
| `data.sections[section.feature-grid].items` | `icon`, `title`, `text` | `id` |
| `data.sections[section.feature-grid].items.icon` | as shared `media-page` | as shared `media-page` |
| `data.sections[section.media-showcase]` | `__component`, `variant`, `title`, `text`, `media`, `link` | `id` |
| `data.sections[section.media-showcase].media` | as shared `media-page` | as shared `media-page` |
| `data.sections[section.media-showcase].link` | as shared `link-section` | as shared `link-section` |
| `data.sections[section.stats]` | `__component`, `variant`, `title`, `items` | `id` |
| `data.sections[section.stats].items` | `value`, `label` | `id` |
| `data.sections[section.logo-cloud]` | `__component`, `variant`, `title`, `logos` | `id` |
| `data.sections[section.logo-cloud].logos` | `image`, `name`, `url` | `id` |
| `data.sections[section.logo-cloud].logos.image` | as shared `media-page` | as shared `media-page` |
| `data.sections[section.testimonials]` | `__component`, `variant`, `title`, `items` | `id` |
| `data.sections[section.testimonials].items` | `quote`, `author`, `role`, `avatar` | `id` |
| `data.sections[section.testimonials].items.avatar` | as shared `media-page` | as shared `media-page` |
| `data.sections[section.pricing]` | `__component`, `variant`, `title`, `text`, `plans` | `id` |
| `data.sections[section.pricing].plans` | `name`, `price`, `period`, `features`, `link`, `recommended` | `id` |
| `data.sections[section.pricing].plans.link` | as shared `link-section` | as shared `link-section` |
| `data.sections[section.faq]` | `__component`, `variant`, `title`, `items` | `id` |
| `data.sections[section.faq].items` | `question`, `answer` | `id` |
| `data.sections[section.cta]` | `__component`, `variant`, `title`, `text`, `primaryLink`, `secondaryLink` | `id` |
| `data.sections[section.cta].primaryLink` | as shared `link-section` | as shared `link-section` |
| `data.sections[section.cta].secondaryLink` | as shared `link-section` | as shared `link-section` |
| `data.sections[section.post-list]` | `__component`, `variant`, `title`, `count`, `category`, `tag` | `id` |
| `data.sections[section.post-list].category` | as shared `relation-slug` | as shared `relation-slug` |
| `data.sections[section.post-list].tag` | as shared `relation-slug` | as shared `relation-slug` |
| `data.sections[section.newsletter]` | `__component`, `variant`, `title`, `text`, `buttonLabel` | `id` |
| `data.sections[section.rich-text]` | `__component`, `body` | `id` |
| `data.sections[section.gallery]` | `__component`, `variant`, `title`, `images` | `id` |
| `data.sections[section.gallery].images` | as shared `media-page` | as shared `media-page` |
| `data.sections[section.scene]` | `__component`, `variant`, `model`, `poster`, `alt`, `title`, `text` | `id` |
| `data.sections[section.scene].model` | as shared `media-page` | as shared `media-page` |
| `data.sections[section.scene].poster` | as shared `media-page` | as shared `media-page` |
| `data.localizations` | as shared `localization-page` | as shared `localization-page` |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-offset` | as shared `pagination-offset` |

#### `pages.slugs`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data`, `meta` | none |
| `data` | `slug` | `id`, `documentId` |
| `meta` | `pagination` | none |
| `meta.pagination` | as shared `pagination-pages` | as shared `pagination-pages` |

### Authors, global and site settings

| Route | Method and path | Auth | Required | Surplus | Read by | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `authors.find` | `GET /api/authors` | public role with `find`, or an API token with `find` | 0 | 15 | none found | The frontend token has `find` only so that `article.author` survives the relation sanitizer; no frontend caller reads this route, so every field is surplus. `email` is private and never appears; `bio` is public content, returned only here and in the feed. |
| `global.find` | `GET /api/global` | public role with `find` | 0 | 9 | none found | Open only when an operator grants `find` to the public role: the frontend does not call it (the fediverse actor profile reads it inside the CMS). Every field is surplus. Relations (`favicon`, `fediverseHeader`, `defaultSeo`) come back only when a caller populates them and are not covered. |
| `site-setting.find` | `GET /api/site-setting` | API token with `find`; no role | 47 | 24 | server/utils/site.ts (`parseSiteSettings`), modules/static-routes.ts | Token only. The query is `SITE_POPULATE`, which names the fields of each media and of the author. `tagline`, `securityContact`, `timezone` and `addressLocality` are public site identity (`securityContact` feeds `security.txt`) that the frontend schema does not read yet. `mime` is read for pages, not for the site images. |

#### `authors.find`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | none | `data`, `meta` |
| `data` | none | `id`, `documentId`, `name`, `bio`, `createdAt`, `updatedAt`, `publishedAt`, `locale` |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

#### `global.find`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | none | `data`, `meta` |
| `data` | none | `id`, `documentId`, `siteName`, `siteDescription`, `createdAt`, `updatedAt`, `publishedAt` |
| `meta` | as shared `meta-single` | as shared `meta-single` |

#### `site-setting.find`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `name`, `description`, `url`, `defaultLocale`, `contactEmail`, `privacyContactEmail`, `privacyUpdatedAt`, `supportHandle`, `author`, `logo`, `favicon`, `defaultOgImage`, `socialLinks`, `modules`, `theme`, `homePage` | `id`, `documentId`, `tagline`, `securityContact`, `timezone`, `addressLocality`, `locale`, `createdAt`, `updatedAt`, `publishedAt` |
| `data.author` | `name`, `url` | `id` |
| `data.logo` | as shared `media-site` | as shared `media-site` |
| `data.favicon` | as shared `media-site` | as shared `media-site` |
| `data.defaultOgImage` | as shared `media-site` | as shared `media-site` |
| `data.socialLinks` | `network`, `url` | `id` |
| `data.modules` | `newsletter`, `comments`, `accounts`, `drafts`, `fediverse`, `search`, `support` | `id` |
| `data.theme` | `themeId`, `defaultMode`, `displayFont`, `accentOverrides` | `id` |
| `data.theme.accentOverrides` | `mode`, `color` | `id` |
| `data.homePage` | as shared `relation-slug` | as shared `relation-slug` |
| `meta` | as shared `meta-single` | as shared `meta-single` |

### Comments, sign in, the signed-in user and subscribers

| Route | Method and path | Auth | Required | Surplus | Read by | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `comments.flat` | `GET /api/comments/:relation/flat` | public role or API token with `findAllFlat` | 21 | 9 | server/api/comments/*.get.ts, server/api/comments/index.post.ts (`toPublicComment`) | Only approved comments. `reports`, the author email and the author of a hidden parent never appear (PR #207). The frontend allow-lists `authorUser`, which the plugin does not return, and reads `related` as an object although the plugin returns a string. `fediverseUri` and `fediverseActorHandle` are added by `src/middlewares/fediverse-comment-fields.ts`. `gotThread` and `threadFirstItemId` are plugin internals the frontend does not read. |
| `comments.tree` | `GET /api/comments/:relation` | public role or API token with `findAllInHierarchy` | 18 | 4 | server/api/comments/*.get.ts, server/api/comments/index.post.ts (`toPublicComment`) | A bare list of top-level comments with their `children`, which have the same keys. The hierarchy carries no `related` and no `threadOf`. Same rules as `comments.flat`. |
| `comments.post` | `POST /api/comments/:relation` | API token with `post` | 18 | 2 | server/api/comments/index.post.ts (`toPublicComment`) | The comment just stored, without the email that was sent. It has no fediverse fields and no `gotThread`. |
| `auth.login` | `POST /api/auth/local` | none (the public role has `auth.callback`) | 1 | 11 | server/api/auth/login.post.ts | The frontend keeps the `jwt` and reads the user again from `/api/users/me`, so the `user` that comes with it is surplus. Password hash, reset and confirmation tokens are private and never appear. |
| `auth.register` | `POST /api/auth/local/register` | none (the public role has `auth.register`) | 4 | 7 | server/api/auth/register.post.ts (`toPublicUser`) | The new account, with no `jwt` and no `role`: the frontend shows it as a reader until the person confirms the address and signs in. |
| `users.me` | `GET /api/users/me?populate=role` | JWT of the signed-in user | 5 | 10 | server/utils/auth.ts, app/helpers/auth.ts (`toPublicUser`) | The caller's own account: a JWT is needed and nobody else's row is returned. `role` is added by `src/extensions/users-permissions/strapi-server.ts`. Password hash, reset and confirmation tokens are private and never appear. |
| `subscribers.find` | `GET /api/subscribers` | API token with `find`; no role | 7 | 10 | server/utils/subscribers.ts (`findSubscriber`) | Token only. The CMS stores the tokens as the frontend sends them: the frontend stores SHA-256 hashes (`hashToken` in micelio), but rows written before it did keep the token in clear, and `find`, `create` and `update` return the stored values to the token holder. The frontend reads `documentId`, `email`, `confirmed`, `language` and both tokens. |
| `subscribers.lookup` | `POST /api/subscribers/lookup` | API token with `lookup`; no role | 7 | 4 | server/utils/subscribers.ts (`findSubscriber`, `findSubscriberByToken`) | Token only. Takes `{ field, value }` in the body, so an email or a token never travels in a URL; the answer is one subscriber or `null`. Same row and fields as `subscribers.find`; the frontend reads `documentId`, `email`, `confirmed`, `language` and both tokens. The frontend switches to it in bogd3v/micelio#542. |
| `subscribers.create` | `POST /api/subscribers` | API token with `create`; no role | 2 | 10 | server/utils/subscribers.ts (`createSubscriber`) | Token only. The frontend reads `documentId` of the answer; the rest is the stored row, with the `confirmationToken` the frontend sent (as stored, see `subscribers.find`) and a null `unsubscribeToken`, which `createSubscriber` never sends. |
| `subscribers.update` | `PUT /api/subscribers/:documentId` | API token with `update`; no role | 0 | 12 | server/utils/subscribers.ts (`updateSubscriber`) | Token only. The frontend ignores the body, so every field is surplus. It returns the stored row, tokens as stored (see `subscribers.find`). |

#### `comments.flat`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `pagination` |
| `data` | `id`, `documentId`, `content`, `blocked`, `blockedThread`, `blockReason`, `isAdminComment`, `removed`, `approvalStatus`, `createdAt`, `updatedAt`, `author`, `related`, `threadOf`, `fediverseUri`, `fediverseActorHandle` | `publishedAt`, `locale`, `gotThread`, `threadFirstItemId` |
| `data.author` | `id`, `name`, `avatar` | none |
| `data.threadOf` | `id` | none |
| `pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

#### `comments.tree`

The body is a list; each item has the keys of `(body)`.

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `documentId`, `content`, `blocked`, `blockedThread`, `blockReason`, `isAdminComment`, `removed`, `approvalStatus`, `createdAt`, `updatedAt`, `author`, `children`, `fediverseUri`, `fediverseActorHandle` | `publishedAt`, `locale`, `gotThread`, `threadFirstItemId` |
| `author` | `id`, `name`, `avatar` | none |
| `children` | as the enclosing object | as the enclosing object |

#### `comments.post`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `documentId`, `content`, `blocked`, `blockedThread`, `blockReason`, `isAdminComment`, `removed`, `approvalStatus`, `createdAt`, `updatedAt`, `author`, `related`, `threadOf` | `publishedAt`, `locale` |
| `author` | `id`, `name`, `avatar` | none |
| `threadOf` | `id` | none |

#### `auth.login`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `jwt` | `user` |
| `user` | none | `id`, `documentId`, `username`, `email`, `provider`, `confirmed`, `blocked`, `createdAt`, `updatedAt`, `publishedAt` |

#### `auth.register`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `user` | none |
| `user` | `username`, `email`, `createdAt` | `id`, `documentId`, `provider`, `confirmed`, `blocked`, `updatedAt`, `publishedAt` |

#### `users.me`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `username`, `email`, `createdAt`, `role` | `id`, `documentId`, `provider`, `confirmed`, `blocked`, `updatedAt`, `publishedAt` |
| `role` | `type` | `id`, `documentId`, `name` |

#### `subscribers.find`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `documentId`, `email`, `confirmationToken`, `unsubscribeToken`, `confirmed`, `language` | `id`, `createdAt`, `updatedAt`, `publishedAt` |
| `meta` | none | `pagination` |
| `meta.pagination` | as shared `pagination-unread` | as shared `pagination-unread` |

#### `subscribers.lookup`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | none |
| `data` | `documentId`, `email`, `confirmationToken`, `unsubscribeToken`, `confirmed`, `language` | `id`, `createdAt`, `updatedAt`, `publishedAt` |

#### `subscribers.create`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `data` | `meta` |
| `data` | `documentId` | `id`, `email`, `confirmationToken`, `unsubscribeToken`, `confirmed`, `language`, `createdAt`, `updatedAt`, `publishedAt` |
| `meta` | none | none |

#### `subscribers.update`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | none | `data`, `meta` |
| `data` | none | `id`, `documentId`, `email`, `confirmationToken`, `unsubscribeToken`, `confirmed`, `language`, `createdAt`, `updatedAt`, `publishedAt` |
| `meta` | none | none |

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

#### `media-page`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `url`, `alternativeText`, `width`, `height`, `mime` | `id`, `documentId` |

#### `media-site`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `url`, `alternativeText`, `width`, `height` | `id`, `documentId` |

#### `media-feed`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `url` | `id`, `documentId` |

#### `image-credit`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `kind`, `author`, `authorUrl`, `source`, `sourceUrl`, `license`, `licenseUrl`, `modifications` | none |

#### `seo-card`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `metaTitle`, `metaDescription`, `metaImage`, `keywords`, `metaRobots`, `structuredData`, `canonicalURL` | `metaViewport` |
| `metaImage` | as shared `media-card` | as shared `media-card` |

#### `seo-page`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `metaTitle`, `metaDescription`, `metaImage`, `keywords`, `metaRobots`, `canonicalURL` | `id`, `structuredData`, `metaViewport` |
| `metaImage` | as shared `media-page` | as shared `media-page` |

#### `reference`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `key`, `type`, `authors`, `year`, `title`, `container`, `volume`, `issue`, `pages`, `venueLabel`, `doi`, `url`, `accessedAt` | none |

#### `localization-article`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `documentId`, `slug`, `locale`, `publishedAt` | none |

#### `localization-page`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `slug`, `locale` | `id`, `documentId` |

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

#### `meta-single`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | none | none |

#### `pagination-offset`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | none | `start`, `limit`, `total` |

#### `link-about`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `id`, `label`, `url`, `variant` | none |

#### `link-section`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `label`, `url` | `id` |

#### `relation-slug`

| Object | Required | Surplus |
| --- | --- | --- |
| `(body)` | `slug` | `id`, `documentId` |
<!-- END GENERATED -->
<!-- prettier-ignore-end -->
