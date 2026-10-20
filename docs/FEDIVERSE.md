# Fediverse Federation (ActivityPub) Plan & Architecture

This document is the source of truth for connecting the Micelio CMS to the fediverse, so users on Mastodon (and any other ActivityPub network) can follow the blog, receive published articles in their timeline, and reply, like, and boost — with replies landing as moderated comments in the existing `strapi-plugin-comments` collection.

> **Status: Phases 0–4 complete and verified live on staging. Phase 5 is done and federation is live in production (`@blog@cms.example.com`); only cross-server verification against a non-Mastodon implementation is still open.** Implementation is tracked in the [`fediverse-federation` milestone](https://github.com/bogd3v/micelio-cms/milestone/1) (one issue per phase, 0–5). Update the phase checklist in this document as work progresses so future agents always see the current state.

## Table of Contents

- [Goal & Decisions](#goal--decisions)
- [Architecture](#architecture)
- [Components](#components)
- [Federation Flows](#federation-flows)
- [Discoverability on Other Networks](#discoverability-on-other-networks)
- [Moderation & Security](#moderation--security)
- [Risks & Mitigations](#risks--mitigations)
- [Implementation Phases](#implementation-phases)
- [Future Work (Out of Scope)](#future-work-out-of-scope-for-mvp)
- [References](#references)

---

## Goal & Decisions

| Decision         | Choice                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| Architecture     | **Fedify embedded in Strapi** as a local plugin — no sidecar service, single deploy unit                          |
| Protocol library | [`@fedify/fedify`](https://fedify.dev) + `@fedify/koa` Koa middleware (same stack Ghost uses for its ActivityPub) |
| Actor domain     | `cms.example.com` → handle `@blog@cms.example.com` (served directly by Strapi; no reverse-proxy changes)          |
| Actor identity   | Single blog actor (not per-author)                                                                                |
| Replies storage  | Existing `strapi-plugin-comments` collection, entering as `PENDING` for the existing approval workflow            |
| MVP scope        | Follow + article federation + replies-as-comments **plus likes & boosts**                                         |
| i18n             | MVP federates the default locale only                                                                             |

Rejected alternatives (for context):

- **Sidecar microservice** (Ghost's exact `TryGhost/ActivityPub` architecture) — cleaner isolation but an extra service, proxy config, and database.
- **Bridgy Fed + webmentions** — zero protocol code but a third-party hosted bridge, frontend microformats2 changes, and less control.
- **Cross-posting to an existing Mastodon account** — syndication, not federation; replies would not flow back as site comments.

---

## Architecture

```
Mastodon / Pleroma / Misskey / Friendica / any ActivityPub server
   │  WebFinger, HTTP signatures, inbox delivery (ActivityPub S2S)
   ▼
cms.example.com  (Strapi 5 = Koa)
   ┌──────────────────────────────────────────────────────────┐
   │  local plugin: src/plugins/fediverse/                    │
   │                                                          │
   │  @fedify/koa middleware mounted via strapi.server.use()  │
   │    /.well-known/webfinger                                │
   │    /.well-known/nodeinfo  +  /nodeinfo/2.1               │
   │    /fediverse/user/blog          (actor)               │
   │    /fediverse/user/blog/inbox     (personal inbox)     │
   │    /fediverse/inbox                 (shared inbox)       │
   │    /fediverse/user/blog/followers                       │
   │    /fediverse/user/blog/outbox                          │
   │    /fediverse/articles/:documentId (Article objects)     │
   ├──────────────────────────────────────────────────────────┤
   │  Strapi core                                             │
   │    api::article.article        (publish events → fan-out)          │
   │    plugin::comments.comment   (replies → PENDING, hidden until approved)│
   │    plugin content types: follower, interaction, federated-article │
   │    GET /api/fediverse/articles/:documentId/stats (public)         │
   │    GET /api/fediverse/articles/stats | ranking (public)           │
   └──────────────────────────────────────────────────────────┘
                 │
                 ▼
   Article objects carry url → https://example.com/blog/{slug}
   (humans click through to the frontend; the fediverse dereferences
    the JSON-LD object on cms.example.com)
```

Fedify handles the protocol hard parts: HTTP signatures (including Mastodon's draft-cavage vs RFC 9421 "double-knock" quirks), WebFinger server, NodeInfo, JSON-LD Activity Vocabulary, and inbox signature verification **before** any listener code runs.

**Path collisions:** Strapi already serves `/api/*`, `/admin`, `/upload/*`, `/_health`, `/mcp`, and static `/public`. Neither `/.well-known/*` (unused) nor `/fediverse/*` (new prefix) collide with anything.

---

## Components

### Local plugin `src/plugins/fediverse/`

| Part                      | Responsibility                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register()`              | Create the `Federation` instance and mount `@fedify/koa` middleware via `strapi.server.use()` (must be `register()`, not `bootstrap()` — see Phase 0 findings)                                                                                                        |
| `bootstrap()`             | Subscribe to `entry.publish` / `entry.unpublish` / `entry.delete` on `strapi.eventHub` (Strapi 5 does **not** emit publish lifecycles via `strapi.db.lifecycles` — see Phase 0 findings); `services/publisher.ts` turns them into `Create`/`Update`/`Delete(Article)` |
| Actor dispatcher          | Serves `/fediverse/user/blog` — username, name, bio, header and `discoverable` from the site settings' `fediverse` component (then the deprecated variables and `global`), avatar from `global`, `Blog`/`Código` profile fields, `url` pointing at the frontend       |
| Key pairs dispatcher      | Reads keypairs from plugin store (`strapi.store({ type: 'plugin', name: 'fediverse' })`), the private key encrypted with `ENCRYPTION_KEY` (see [Actor key at rest](#actor-key-at-rest))                                                                               |
| Article object dispatcher | Serves `/fediverse/articles/:documentId` as an `Article` (title, self-contained HTML body, frontend `url`, cover image) — published default-locale articles only                                                                                                      |
| Outbox dispatcher         | Serves `/fediverse/user/blog/outbox` — paginated, publicly-addressed `Create(Article)` activities, so a remote server can show/backfill recent posts before anyone there has followed the blog                                                                        |
| Followers dispatcher      | Backed by the `fediverse-follower` content type                                                                                                                                                                                                                       |
| NodeInfo dispatcher       | Serves `/nodeinfo/2.1` with honest software/usage stats (published article count)                                                                                                                                                                                     |
| Inbox listeners           | `Follow`, `Undo(Follow)`, `Block`, `Create(Note)`, `Update(Note)`, `Delete(Note)`, `Like`, `Announce` + `Undo`                                                                                                                                                        |
| Services                  | `articles` + `publisher` (Phase 2), `replies` (Phase 3), `interactions` (Phase 4), `followers`/`keys`/`actor-profile` (Phase 1)                                                                                                                                       |

### Plugin content types

| Content type                          | Fields                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin::fediverse.follower`          | `actorId` (string, AP actor URI), `handle` (`@user@host`), `name`, `inbox`, `avatar` (same rule as `authorAvatar`), `blocked` (boolean), `unreachableSince` (datetime: set when the inbox answered `404`/`410`, cleared by any activity from the actor)                                                                                |
| `plugin::fediverse.interaction`       | `type` (enum `like`/`boost`), `actorId`, `handle`, `articleDocumentId` (string, not a relation — see Phase 4 findings), `interactionKey` (`type\|actor\|article`, used to dedupe)                                                                                                                                                      |
| `plugin::fediverse.federated-article` | `articleDocumentId` (string, not a relation, one row per article), `status` (enum `created`/`updated`/`deleted`/`failed`), `createSentAt`, `lastActivityAt`, `lastActivityType` (enum `Create`/`Update`/`Delete`), `attempts` (integer, of the last activity), `lastError` (text, sanitized: no query string, no IP literal, no email) |

### Comment schema extension

`src/extensions/comments/strapi-server.ts` — extends `strapi-plugin-comments` with the fields below. It is a `strapi-server` extension (not an extension `schema.json`) on purpose: Strapi merges schema files shallowly (`{ ...original, ...extension }`), so a `schema.json` declaring `attributes` would replace every attribute of the plugin and break it on the next upgrade.

| Field                  | Purpose                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fediverseUri`         | Remote Note object id (unique — checked by the Document Service, not a DB index) — dedupe of ingested replies + thread resolution |
| `fediverseActorHandle` | `@user@host`, or `null` when it could not be resolved of the remote author (display/source badge on frontend)                     |

### Custom public routes

All `auth: false`, aggregates only (never who interacted), and absent when `FEDIVERSE_ENABLED=false`.

- `GET /api/fediverse/articles/:documentId/stats` → `{ likes: number, boosts: number }`, 404 for unpublished or unknown articles.
- `GET /api/fediverse/articles/stats?documentIds=a,b,c` (at most 50, else 400) → `{ [documentId]: { likes, boosts, replies } }`. Only articles published in the default locale are included; other ids are left out. `Cache-Control: public, max-age=60`.
- `GET /api/fediverse/articles/ranking?page=1&pageSize=6&locale=es&category=ia&tag=vue&search=rag` → `{ data: [{ documentId, likes, boosts, replies }], meta: { pagination: { page, pageSize, pageCount, total } } }`. Articles published in `locale` (default locale if omitted), ordered by `likes + boosts + replies` desc, then `publishedAt` desc; articles with no interactions come last so paging covers the whole blog. `pageSize` defaults to 6, max 50. Optional filters narrow the list before ranking, so pages match the blog filters: `category` (category slug), `tag` (tag slug; combined with the others with AND) and `search` (title contains it, case-insensitive; `%` and `_` are plain text; ignored under 3 characters). `Cache-Control: public, max-age=60`. Bounds: `page` above 10 000 is clamped to 10 000; `search`, `category` or `tag` over 200 characters (UTF-16 code units) and a `locale` that is not configured in the i18n plugin answer 400; an empty `locale` counts as absent.

The outbox cursor (`/fediverse/user/<handle>/outbox?cursor=N`) is an offset and is clamped to 100 000.

`replies` counts approved comments with a `fediverseUri` (every fediverse reply has one, even when its actor handle could not be resolved) that are not removed or blocked. Blocked actors' likes, boosts and replies never count.

### Dependencies

- `@fedify/fedify` (pin exact 2.x version — the framework moves fast)
- `@fedify/koa` (Koa v2/v3 middleware)
- `@fedify/postgres` (pinned exactly, the same version as Fedify: `PostgresKvStore` and `PostgresMessageQueue`; MIT, maintained by the Fedify project) and `postgres` (its driver and peer dependency, pinned exactly; Unlicense, one maintainer)
- `@js-temporal/polyfill` (Fedify's timestamp type; explicit because Node has no global `Temporal`)
- `@logtape/logtape` (Fedify's logger, already installed through it; direct so the plugin's `configureSync` resolves the same package Fedify logs to)
- `structured-field-values` (pinned exactly to the copy Fedify uses, for the `Signature-Input` check; see "RFC 9421 signatures must cover `content-digest`")

### Environment variables

| Variable                     | Default                                                       | Purpose                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FEDIVERSE_ENABLED`          | `false`                                                       | Master switch (enable explicitly, e.g. staging before prod)                                                                                                                                                                          |
| `URL` _(Strapi's own)_       | `http://localhost:1337`                                       | **Must be the public origin** (e.g. `https://cms.example.com`). Fan-out runs outside any request and builds every activity id from it; a wrong value makes ids disagree with the ones served over HTTP                               |
| `FEDIVERSE_ACTOR_USERNAME`   | _(unset)_                                                     | **Deprecated** (#303): the site settings' `fediverse.username` replaces it; the handle's `@user` falls back to this, then to the identifier. Safe to change: WebFinger maps it (and the identifier, as a former handle) to the actor |
| `FEDIVERSE_ACTOR_IDENTIFIER` | _(required)_                                                  | Path of the actor URI (`/fediverse/user/blog`). Never change it: remote servers key the account and its followers by that URI                                                                                                        |
| `FEDIVERSE_ACTOR_NAME`       | _(unset)_                                                     | **Deprecated** (#303), replaced by `fediverse.displayName`: display name fallback, used only when the component, `global.siteName` and the site settings' `name` are empty                                                           |
| `FEDIVERSE_ACTOR_SUMMARY`    | _(unset)_                                                     | **Deprecated** (#303), replaced by `fediverse.summary`: bio fallback, used only when the component, `global.siteDescription` and the site settings' `description` are empty                                                          |
| `FEDIVERSE_ACTOR_SOURCE_URL` | backend GitHub repo                                           | **Deprecated** (#303), replaced by `fediverse.sourceUrl`: link shown in the "Código" profile field                                                                                                                                   |
| `FRONTEND_URL`               | _(required in production)_; `http://localhost:3000` otherwise | Human-facing `url` embedded in federated `Article` objects. Without it in production the plugin refuses to start                                                                                                                     |
| `FRONTEND_ARTICLE_PATH`      | `/blog/{slug}`                                                | Article URL pattern (confirmed against the frontend repo: default locale, `prefix_except_default`)                                                                                                                                   |
| `FRONTEND_DEFAULT_LOCALE`    | `en`                                                          | Locale the frontend serves without a URL prefix (Nuxt `prefix_except_default`); articles in any other locale get `/<locale>` in their link, e.g. `https://example.com/es/blog/{slug}`                                                |

### KV store and delivery queue

Fedify needs a `kv` for caches, inbox idempotency and its circuit breaker, and a message queue for outgoing deliveries. Both follow the database Strapi runs on, with no variable to choose (`utils/federation-backend.ts`):

| Database   | `kv`                                   | Queue                                                                    |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------ |
| PostgreSQL | `PostgresKvStore` (`@fedify/postgres`) | `PostgresMessageQueue`: a table, `LISTEN`/`NOTIFY`, a poll every 5 s     |
| SQLite     | `MemoryKvStore`                        | `InProcessMessageQueue`: memory, lost on restart (development and tests) |

Both Postgres backends share one small pool of their own (`FEDIFY_POOL_SIZE` in `constants/queue.ts`: 3 connections, plus the one the queue keeps open to listen), so federation never competes with Strapi's pool; the operator's view is in [operate/configure.md](operate/configure.md#delivery-queue-and-database-connections). The tables, `fedify_kv_v2` and `fedify_message_v2`, are created on first use in the schema Strapi uses. All persistent federation state still lives in Strapi content types or the plugin store (followers, actor keys, interactions, comments, `federated-article` rows); the queue only holds what is waiting to be sent.

The queue worker starts in the plugin's `bootstrap()` (`manuallyStartQueue: true`, `startFederationQueue`), not at the first request, so what a previous run left in the table is delivered as soon as the CMS is up, and stops in `destroy()`. Only the `outbox` and `fanout` queues are set: the inbox is still handled while the request is open.

### Delivery, retries and what the row says

`ctx.sendActivity` signs the activity and enqueues it, so the `entry.publish` handler returns once it is queued and publishing in the admin does not wait for any remote server. Fedify delivers each inbox as its own message and retries a failure with its default `outboxRetryPolicy` (exponential backoff from 1 to 2 seconds, doubling, up to 10 retries: about 20 to 35 minutes in all; the 12-hour cap is never reached). The plugin adds nothing to that policy; `plugin::fediverse.outboxRetryPolicy` in the Strapi config replaces it for tests.

What the `federated-article` row records for the last activity:

| Field                      | Meaning                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lastActivityAt`, `status` | When it was queued, and `created`/`updated`/`deleted`. Nothing says it was **delivered**: Fedify 2.4.4 has no callback for a delivery that worked, so every panel and log line says "queued" |
| `attempts`                 | Delivery attempts made or scheduled for the inbox that has been retried most. 1 when queued                                                                                                  |
| `lastError`                | The last failure, sanitized: for a refusing inbox only its host and HTTP status, never its answer                                                                                            |
| `status: failed`           | At least one inbox was given up on (a `404`/`410`, or the retry policy ran out). Others may have received it, as in #296. A later success does not clear it                                  |

A delivery that fails and is retried raises `attempts` and sets `lastError` but keeps the status; it only turns `failed` when Fedify gives up. A delivery that eventually works leaves its `lastError` behind.

An inbox that answers `404` or `410` is gone for good. Fedify calls `setOutboxPermanentFailureHandler` once and does not retry, and the plugin flags every follower at that inbox with `follower.unreachableSince`. A flagged follower is skipped by the next fan-outs (the log says `N unreachable skipped`) but stays in the followers collection and its count. Any signed activity from that actor, whatever it is, clears the flag (`heardFrom` wraps every inbox listener), and the next fan-out includes it again. Other failures, an inbox that only answers `5xx` or is down for days, are retried and then abandoned with the row `failed`, but the follower is not flagged: only a definitive answer takes a follower out.

---

## Federation Flows

### 1. Follow

1. Remote user searches `@blog@cms.example.com` → WebFinger resolves → actor profile shown.
2. Inbox receives `Follow` → create `fediverse-follower` row → auto-send signed `Accept`. A blocked actor's `Follow` is ignored with no answer (neither `Accept` nor `Reject`, so it is not told it is blocked).
3. `Undo(Follow)` or incoming `Block` → remove follower, unless the actor is blocked: a blocked row is kept, so an actor cannot lift its own block. Admin sets `blocked: true` → excluded from fan-out, their activities ignored. Unblocking one row of an actor that has another blocked row keeps it blocked. Deleting a blocked row in the admin panel lifts the block (the next `Follow` creates a fresh row): to keep it, leave the row and its flag. Unblocking an actor whose row was kept makes it an active follower again, even if it undid its follow meanwhile; delete the row instead to drop it.

### 2. Publish / update / delete articles

1. Plugin `bootstrap()` subscribes via `strapi.eventHub.on(...)` to `entry.publish`, `entry.unpublish` and `entry.delete` (payload `{ model, uid, entry }`). Events fire **asynchronously, after the operation's transaction commits** — handlers must not assume the DB still holds the pre-operation state. In Strapi 5 an edit only reaches the published version when the editor publishes again, so `entry.publish` is also the signal for edits.
2. `entry.publish` → build `Article` object → signed `Create(Article)` addressed **publicly** (`to: https://www.w3.org/ns/activitystreams#Public`, `cc:` the followers collection) and delivered to every accepted follower's inbox. Public addressing — not just `cc` to followers — is what makes the post eligible for a remote instance's local/federated timeline and public directories; addressing it only to followers would silently cap reach at people who already follow the blog, which undermines the "consumed on other networks" goal (see [Discoverability on Other Networks](#discoverability-on-other-networks)).
3. The same `Create(Article)` activities are also served from a public **outbox dispatcher** (`/fediverse/user/blog/outbox`, paginated), so a remote server that discovers the actor — e.g. someone views the profile before deciding to follow — can backfill recent posts. Several Mastodon-derived UIs fetch the outbox on first contact with an unfollowed account.
4. Mastodon renders `Article` as a link card (title, excerpt, cover image from `media.example.com`, link to frontend).
5. Re-publishing an article that was already sent → `Update(Article)` (tracked in the `plugin::fediverse.federated-article` row, so no duplicate `Create`); unpublish or delete → `Delete(Article)` with a `Tombstone`, but only if no published default-locale version remains. The activities are queued and delivered in the background ([Delivery, retries and what the row says](#delivery-retries-and-what-the-row-says)); an error while queueing is logged and never breaks the editor's publish flow, and with no followers nothing is queued and the log says so.
6. Article AP id is stable: `/fediverse/articles/{documentId}`.
7. **i18n:** only the default locale federates in the MVP.

### 3. Reply → comment

1. Inbox receives `Create(Note)` with `inReplyTo` pointing at:
   - our article AP id (`/fediverse/articles/{documentId}`) → top-level comment, or
   - the frontend article URL pattern (some clients use `url`), or
   - another note's URI matching a stored comment's `fediverseUri` → `threadOf` = that comment (one hop). Anything that doesn't resolve to one of our published articles is ignored: it is not our conversation.
2. Create `plugin::comments.comment` via `strapi.documents()`:

| Comment field          | Source                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `content`              | Remote Note content, sanitized to plain text (strip HTML)                                                                                 |
| `authorName`           | Actor `name` or `preferredUsername@host`                                                                                                  |
| `authorAvatar`         | Actor `icon.url`, kept only as an absolute `http(s)` URL without credentials, at most 255 characters (`utils/remote-url.ts`), else `null` |
| `authorId`             | Remote actor URI (stable identity). `authorEmail` is never set: the plugin exposes it publicly                                            |
| `threadOf`             | Resolved parent (see above), else `null`                                                                                                  |
| `approvalStatus`       | `PENDING` — set explicitly; the plugin's public API would show it, so a global middleware hides it until a moderator approves             |
| `locale`               | The default (federated) locale; the frontend reads comments per locale (`?locale=`), and only that version federates                      |
| `fediverseUri`         | Note object id (dedupe key)                                                                                                               |
| `fediverseActorHandle` | `@user@host`, or `null` when it could not be resolved                                                                                     |

3. Dedupe: skip if a comment with the same `fediverseUri` exists.
4. `Update(Note)` → edit the content **and send the comment back to `PENDING`** (an approved comment must not be swappable for spam); `Delete(Note)` → set `removed`. Both are only honoured from the original author.
5. Admin approves/rejects in the existing comments moderation view — no new admin UI needed.

### 4. Likes & boosts

1. Inbox receives `Like(Article)` → upsert `fediverse-interaction` (type `like`).
2. `Announce(Article)` → upsert type `boost`.
3. `Undo(Like)` / `Undo(Announce)` → remove the row.
4. Stats endpoint aggregates counts for the frontend.

### 5. Reply → remote thread

1. A moderator answers a fediverse comment in the admin's comments view: the comments plugin creates a comment with `threadOf` (the remote comment), `authorId` (the admin user's id) and `isAdminComment: true`.
2. The plugin hooks the database lifecycle of `plugin::comments.comment` (`services/reply-publisher.ts`), so it sees that creation and every later change or removal. A reply federates only if: an admin user who has the permission to moderate comments wrote it; its parent is a **fediverse** comment of someone else (it has a `fediverseUri`) that is itself shown; and the article is published. A reader's or guest's comment, a reply to a local comment and a reply by an admin account without that permission send nothing.
3. It stores the reply's own note id in `fediverseNoteUri` (`<origin>/fediverse/notes/<documentId>`) and sends a signed `Create(Note)` from the blog actor: `inReplyTo` the remote note, `to` the remote author, `cc` the public collection and the followers, a `Mention` tag of the author, `content` the comment text as escaped HTML (a paragraph per blank line), `url` the article page with `#comment-<documentId>`. It goes to the remote author's inbox, found by fetching the author's actor with the blog's signed loader (not if the author is blocked here), and to every reachable follower, through the queue. The public `fediverseUri` and `fediverseActorHandle` stay `null`, so the frontend does not mark the site's own reply as remote.
4. Editing the text sends an `Update(Note)`. Removing, blocking (the reply, or a thread above it), rejecting it, sending it back to moderation, or deleting its row sends a `Delete(Note)` with a `Tombstone`; showing it again sends a `Create` again. Every activity has an id of its own.
5. `GET /fediverse/notes/<documentId>` serves the `Note` only while the reply is shown: `404` once it is removed, blocked, pending or rejected, and for any comment that is not a moderator's reply to a fediverse comment.
6. A reply to the admin's note from Mastodon arrives as a `Create(Note)` whose `inReplyTo` is the note id: reply ingestion finds the comment by `fediverseNoteUri` and nests it (one hop; deeper threads are #302).

---

## Discoverability on Other Networks

The MVP's technical mechanism is accepting `Follow`s and fanning out to followers, but the actual goal — blog content **consumed on other social networks**, not only by people who already follow the blog — needs a bit more than that:

- **Public addressing** (Federation Flows §2) is required for posts to land in a remote instance's local/federated timeline and directories, not just in individual followers' home feeds. This is a correctness requirement for Phase 2, not a nice-to-have — without it, federation "works" (followers see posts) but the blog is effectively invisible to everyone else on that instance.
- **Outbox dispatcher** (`/fediverse/user/blog/outbox`) lets remote servers and apps enumerate recent posts without requiring a follow first. The architecture diagram already lists this endpoint; the phase checklists below now call it out explicitly so it doesn't get skipped as "just an implementation detail" of the actor dispatcher.
- **`discoverable` actor flag** (`toot:discoverable: true`, from Mastodon's `toot` vocabulary extension namespace): opts the actor into Mastodon's public directory and "suggested accounts." Set on the `Person` object (done in Phase 1).
- **Cross-server verification**: ActivityPub implementations diverge in how they parse `Article` and `Person` objects. Mastodon is the reference target, but Pleroma/Akkoma, Misskey, Friendica, and GoToSocial are all realistic destinations for this blog's followers, and Meta's Threads has historically shipped partial/limited outbound federation. Still open: verify against at least one non-Mastodon server (Phase 5), not only Mastodon accounts / activitypub.academy.
- **Fediverse relays** (submitting the actor's public posts to a relay so instances with no existing followers of this domain still see them) are a plausible reach multiplier beyond direct follows, but out of scope for the MVP — tracked under Future Work.

---

## Moderation & Security

- **Signature verification:** Fedify verifies HTTP signatures before listeners run — unsigned/forged activities never reach ingestion code. That only covers the _outer_ activity's actor, so listeners also check that an embedded activity (`Undo(Follow)`) or object (`Note.attributedTo`) belongs to the verified sender, and interaction withdrawals key on the verified sender.
- **Content sanitization:** remote Note content is HTML from untrusted servers — strip to plain text before storing.
- **Moderation:** all fediverse replies enter `PENDING` and are approved in the existing comments moderation view; remote actors can be `blocked` (their replies are ignored). The `approvalScores`/`moderation`/`nested` options in `config/plugins.ts` are **not** options of `strapi-plugin-comments` 3.x (the only approval option is `approvalFlow: [uids]`) and have no effect; `PENDING` is set explicitly by the reply-ingest code. Edited replies go back to `PENDING` so an approved comment can't be swapped for spam.
- **Pending replies are hidden by a global middleware.** The plugin's public endpoints return _every_ comment unless the caller filters by `approvalStatus`, and the frontend doesn't. `src/middlewares/hide-unapproved-comments.ts` (registered in `config/middlewares.ts`) prunes `PENDING`/`REJECTED` comments and their subtrees from `GET /api/comments/*`. It is app-level rather than part of the fediverse plugin so it keeps protecting readers even if the plugin is later disabled.
- **Public API surface unchanged:** fediverse endpoints are handled by Fedify's middleware outside Strapi's auth/permissions; the only new public REST route is the stats endpoint (`auth: false`). No seed/permission changes required.
- **SSRF:** Fedify fetches remote objects (standard fediverse behavior); keep Fedify updated to benefit from its fetch hardening. Every destination the plugin contacts, and why there is no host allowlist, is in [security/outbound.md](security/outbound.md).

---

## Risks & Mitigations

| #   | Risk                                                                                                                                                                                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Middleware ordering in Strapi's Koa stack** — Fedify middleware must intercept `/.well-known/*` and `/fediverse/*` before `strapi::router`, and ideally before `strapi::body` (raw body needed for signature verification)                           | **Resolved in Phase 0:** mounting via `strapi.server.use()` inside plugin `register()` runs before `initMiddlewares()` (so before `strapi::body`) and before the router (mounted at `listen()`). No fallback needed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | **Comments schema extension** — extension fields could be dropped by the plugin's own services                                                                                                                                                         | **Resolved in Phase 3:** fields are added by `strapi-server.ts` on top of the plugin's attributes, and comments are created through `strapi.documents('plugin::comments.comment')`; a test proves the fields persist and `fediverseUri` is unique                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3   | **Strapi 5 publish lifecycles** — confirm `afterPublish`/`afterUnpublish` fire via `strapi.db.lifecycles.subscribe`                                                                                                                                    | **Resolved in Phase 0:** they do **not**. Publish maps to `afterCreate` and unpublish to `afterDelete` at the DB layer; publish state changes are only observable via `strapi.eventHub` (`entry.publish` / `entry.unpublish`), emitted post-commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4   | **Fedify version churn**                                                                                                                                                                                                                               | Pin exact 2.x versions in `package.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | **Postgres connection limits** (the Postgres KV and queue open their own pool)                                                                                                                                                                         | **Resolved in #297:** one dedicated pool of `FEDIFY_POOL_SIZE` (3) plus one listening connection per process, documented in `operate/configure.md`; persistent state lives in Strapi content types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | **Followers-only addressing silently caps reach** — if `Create(Article)` is only `cc`'d to followers (no public `to`), posts never reach federated/local timelines or directories on remote instances, defeating the "consumed on other networks" goal | Address publicly (`to: as:Public`) per Federation Flows §2, and implement the outbox dispatcher so a visitor who hasn't followed yet can still see posts — see [Discoverability on Other Networks](#discoverability-on-other-networks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 7   | **Pending comments visible publicly** — `strapi-plugin-comments` returns every comment from its public API unless the caller filters, and the frontend doesn't                                                                                         | **Resolved in Phase 3:** `src/middlewares/hide-unapproved-comments.ts` prunes `PENDING`/`REJECTED` comments and their subtrees; a test fails without it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 8   | **Duplicates from concurrent deliveries** — Strapi's `unique: true` creates no database index                                                                                                                                                          | **Resolved for interactions in Phase 4** (post-insert convergence to the oldest row, tested five-way concurrent, on SQLite and Postgres). **Followers** (`actorId`) converge the same way: the rows of an actor are folded into the oldest after the insert and on every later `Follow`, a block is never lost in the merge, and every read treats an actor as blocked when any of its rows is. Until the next `Follow` or `Undo` folds them, two unblocked rows of one actor are still listed and counted twice; that is accepted. Deletes of follower rows (a merge, `Undo(Follow)`, `Block`) skip any row that is blocked at that moment, so a block an admin sets while they run is not erased. Rows made with `db.query` have no `publishedAt`, so the admin panel's uniqueness check does not see them: an admin can create or edit a duplicate without an error, and the any-row reads cover that. Comments (`fediverseUri`) are checked before inserting but not race-proof; accepted as unlikely |
| 9   | **Production is PostgreSQL, tests were SQLite**                                                                                                                                                                                                        | **Resolved in Phase 5:** the whole suite also passes on PostgreSQL (`TEST_DATABASE_URL`, see `tests/strapi.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## Implementation Phases

Tracked as GitHub issues under the `fediverse-federation` milestone. Check off as completed.

### Phase 0 — Spike: mount Fedify in Strapi `[x]` (#3)

- [x] Local plugin skeleton + `@fedify/fedify`@2.3.6 / `@fedify/koa`@2.3.6 (pinned exact) installed and mounted via `strapi.server.use()` in `register()`
- [x] Verify `/.well-known/webfinger` responds on `npm run dev` (200 JRD, correct subject + self link)
- [x] Verify inbox `POST` is intercepted: unsigned and forged-signature deliveries are rejected with `401 Failed to verify the request signature.` **before any listener runs** (full signed delivery from a real server is verified manually in Phase 1 via a follow from activitypub.academy)
- [x] Resolve middleware-ordering risk (#1) — primary strategy confirmed, no fallback needed
- [x] Confirm publish lifecycle events (risk #3) — via `strapi.eventHub`, see below

**Phase 0 findings (binding for later phases):**

- **Plugin loading (Strapi 5):** local plugins are loaded through `loadConfigFile`, which only reads `.js`/`.json` — the plugin entry must be compiled JS. The root `tsconfig.json` excludes `src/plugins/**`, so the plugin ships its own esbuild bundle (`npm run build:fediverse`, wired into `predev`/`prebuild`/`pretest`). The plugin `package.json` must have **no `main` field** (it breaks the loader's `require.resolve` path) — only `exports: { "./strapi-server": "./dist/strapi-server.js", "./package.json": "./package.json" }` plus the `strapi.kind`/`strapi.name` marker.
- **Middleware order:** `strapi.server.use()` in plugin `register()` runs before `initMiddlewares()` (hence before `strapi::body`, whose parsed body would starve Fedify's raw-body signature verification) and before the router (mounted at `listen()`). Mounting in `bootstrap()` would be too late.
- **Publish events:** Strapi 5 emits `entry.publish`/`entry.unpublish`/`entry.update`/`entry.delete` on `strapi.eventHub` (payload `{ model, uid, entry }`, sanitized full entry), **asynchronously after the operation's transaction commits**. `strapi.db.lifecycles` only sees the underlying row CRUD (`afterCreate` for publish, `afterDelete` for unpublish) and cannot distinguish publish state. Phase 2 fan-out subscribes to `eventHub`.
- **Fedify 2.x API notes:** vocabulary types import from the `@fedify/fedify/vocab` subpath; `setKeyPairsDispatcher` takes a single `(contextData, identifier)` signature; `Person.assertionMethods` must be `keyPair.multikey` (a `Multikey`), not `cryptographicKey`.
- **Jest:** `@fedify/fedify` requires `structured-field-values`, an ESM-only `.js` package. Node ≥22 `require()`s it fine (dev/prod), but Jest cannot — `jest.config.js` now uses an esbuild transformer (`tests/helpers/esbuild-transformer.js`) with `transformIgnorePatterns` allowlisting that package.
- **Spike scope:** keypairs are in-memory (regenerated per boot — fine for the spike); Phase 1 persists them in the plugin store. `tests/fediverse.test.ts` covers webfinger, actor document, content negotiation, unknown actor, unsigned inbox rejection, `/_health` isolation, and publish/unpublish event delivery.

### Phase 1 — Blog actor, keypairs, followers `[x]` (#4)

- [x] Actor dispatcher (profile from `global`), keypair generation + plugin-store persistence
- [x] `fediverse-follower` content type; `Follow` → record + signed `Accept`; `Undo(Follow)`/`Block` → remove; `blocked` flag
- [x] Followers collection + NodeInfo
- [x] Actor opts into Mastodon's directory (`toot:discoverable: true`) — see [Discoverability on Other Networks](#discoverability-on-other-networks)
- [x] Verify: search `@blog@cms.example.com` from a Mastodon account and follow successfully

**Phase 1 findings (verified 2026-09-23 against a live Mastodon account on `staging.example.com`):** the actor dispatcher (now `discoverable: true`), RSA keypair generation + JWK persistence in the plugin store, the `fediverse-follower` content type, the followers dispatcher/counter, NodeInfo, and the `Follow`/`Undo`/`Block` inbox listeners (with signed `Accept`) live in `federation.ts` and `services/{keys,actor-profile,followers}.ts`. `tests/fediverse-phase1.test.ts` covers them end-to-end, including a fully HTTP-signed `Follow` → `Accept` round trip against a fake remote actor (`tests/helpers/remote-actor.ts`).

**Actor profile (2026-09-26):** with no `global` document in production, the actor fell back to `about.title` and showed up on Mastodon as "Acerca de este blog". `about.title` is no longer a fallback (the About page heading isn't a name). The profile now reads `global.siteName`, `global.siteDescription`, `global.favicon` (avatar) and `global.fediverseHeader` (the header, 1500×500), populating the media explicitly: the document service doesn't populate media by default, so `favicon` was never reaching the actor. Mastodon caches remote profiles, so creating or saving `global` sends an `Update(Person)` to followers (`publisher.ts`, on `entry.create`/`entry.update`, since `global` has no draft & publish). The profile fields carry `rel="me"`: Mastodon only shows the green checkmark if the linked page links back to the actor with `rel="me"`.

- **Behind a TLS-terminating proxy, Koa must trust it.** Strapi 5 reads `server.proxy.koa`; the old `proxy: true` (Strapi 4 syntax) left `ctx.protocol` as `http`, and `@fedify/koa` builds request URLs from it, so every ActivityPub id came out as `http://`. `config/server.ts` now sets `proxy: { koa: true }` (regression test included). Any new federated URL must be checked over HTTPS on staging, not only locally.
- **A staging instance is the live test bed**: a public HTTPS domain that a Mastodon account can reach, with `URL`, `FEDIVERSE_ENABLED=true` and a persistent database. See [Configure](operate/configure.md#fediverse-activitypub).

### Phase 2 — Article federation `[x]` (#5)

- [x] Article object dispatcher (`/fediverse/articles/:documentId`, stable ids, frontend `url`, cover image)
- [x] Outbox dispatcher (`/fediverse/user/blog/outbox`, paginated), backed by the published articles, so remote servers can backfill posts without a prior follow
- [x] `entry.publish` → `Create(Article)` addressed **publicly** (`to: as:Public`, `cc:` followers) and fanned out to all accepted followers' inboxes; `Update(Article)` on re-publish; `Delete(Article)` on unpublish/delete
- [x] Verify: a published article appears in a follower's timeline (verified live on `mastodon.social`, 2026-09-23)
- [x] Verify: editing and re-publishing propagates as an `Update`, and unpublishing removes it from the remote timeline
- [x] Verify: the article is visible on the actor's profile/outbox from an account that does not follow it

**Phase 2 findings:**

- **Code layout:** `services/articles.ts` (loading published default-locale articles, building `Article`/`Create`/`Update`/`Delete`, tracking which articles were federated) and `services/publisher.ts` (subscribes to `entry.publish` / `entry.unpublish` / `entry.delete` and sends to `'followers'`). The `Federation` instance is now one per Strapi instance (`getFederation(strapi)`), shared by the HTTP middleware and the publisher. `tests/fediverse-phase2.test.ts` covers the dispatcher, outbox, and the fan-out against a fake remote inbox.
- **Editing = publishing again.** In Strapi 5 an edit only reaches the published version when the editor publishes it, which fires `entry.publish` again. The `plugin::fediverse.federated-article` row of the document records that a `Create` was sent, so the second publish becomes `Update(Article)` instead of a duplicate `Create`. Articles published while the plugin was disabled are never retro-federated (no event, no record).
- **Federation state is a row per article (#296).** `plugin::fediverse.federated-article` replaces the plugin store key `federatedArticles`, which could only say "sent". The publisher writes the row _before_ delivering (`status` = `created`/`updated`/`deleted`, `lastActivityAt`, `lastActivityType`, `attempts` back to 1, `lastError` cleared) so an unpublish that lands mid-delivery still ends in a `Delete`; when queueing throws it marks the row `failed` with `lastError` (`utils/delivery-error.ts`: URLs without query string or fragment, IP literals and emails replaced, `cleanRemoteText`, 500 characters) unless a newer activity has been recorded since. An article is _federated_ when its row exists and is not `deleted`: a `failed` row still counts, as the old key did, because some followers may have received it. `createSentAt` is set by each `Create` and kept by the other activities. With no followers nothing is sent, but the row is still written (`status: created`), as the old key was.
- **Migration of the old key.** `bootstrap()` runs `migrateFederatedArticles` after the key encryption: each id of `federatedArticles` without a row becomes a row with `status: created` and `createSentAt: null` (the key's timestamps are not copied). It is idempotent, touches no existing row and leaves the key in place for one release line so a rollback still finds it; after a rollback the key is stale for articles published since. A release line later the key can be removed. Rows have no database index (`unique: true` is Document Service validation only, risk 8), so every writer keeps the oldest row of the article and deletes the others after inserting, as the interactions do; `tests/fediverse-federated-articles.test.ts` runs five concurrent writers on SQLite and PostgreSQL.
- **Delete is guarded.** Unpublish and delete both send `Delete(Article)` (with a `Tombstone`), but only if the article was federated _and_ no published default-locale version remains, so deleting a draft revision doesn't retract a live article.
- **Body shape.** `content` is self-contained HTML (bold title, escaped excerpt, link to the frontend) so it reads well on servers that ignore `name`/`image`, and the link lets Mastodon build a preview card. `summary` is intentionally **not** set — Mastodon renders it as a content warning. `image` is used instead of an attachment so Mastodon keeps the link card rather than showing a bare media attachment. It is the article's `cover` first, falling back to `seo.metaImage`; media whose mime type isn't `image/*` is skipped (both fields also accept videos and files). When the cover has a `coverCredit`, the body ends with its attribution line («Foto: autor · fuente · CC BY-SA 4.0 · recortada», with links), because licenses such as CC BY require it wherever the image is shared; `image.name` stays the alt text. **The article was seen in a Mastodon timeline on staging;** how the card/body actually renders on Mastodon and on other servers (Pleroma, Misskey) is still worth a visual check.
- **Frontend URLs are locale-aware.** The frontend serves `en` unprefixed and `es` under `/es` (`prefix_except_default`), and the article page loads the post for the _current_ locale. The federated link therefore gets `/<locale>` whenever the article's locale differs from `FRONTEND_DEFAULT_LOCALE`; if Strapi's default locale is `es`, links become `https://example.com/es/blog/{slug}`.
- **Delivery failures are logged.** `onOutboxError` (one line per activity and reason per minute, with the HTTP status, never the remote answer) and the inbox `onError` write `[fediverse] ...` entries to Strapi's log — look there first when a post doesn't reach a timeline. Fedify's own LogTape records are forwarded too (see [Fedify's LogTape records](#fedifys-logtape-records)).
- **Publish logs say who received it.** Each fan-out logs `[fediverse] Create(Article) for <id> (<slug>): queued for N followers` (with `(M unreachable skipped)` when some were left out) or `no followers yet, nothing queued`; with no followers nothing is queued at all. "The article never reached my timeline" is usually a missing follow — check that line first.
- **Staging state must persist.** Followers, the actor key pair and federated-article records live in the SQLite database. If `/app/.tmp` isn't a persistent volume, every deploy regenerates the actor key and drops all followers (visible as `hasAdmin: false` on `/admin/init` and a `generated and persisted a new actor key pair` log line), and remote servers keep a follow and a cached key that no longer match.
- **Background context origin.** Work not tied to a request (the publisher) builds ids from Strapi's public `URL` (`strapi.config.get('server.url')`), so `URL` must be correct in every deployed environment or activity ids will not match the ones served over HTTP.
- **`slug` is not autogenerated by the document service** (only by the admin UI). Articles without a slug or title are skipped with a `[fediverse] not federating article ...` warning, because there would be no frontend URL to link to. Tests must pass `slug` explicitly.
- **Test harness fix:** `tests/strapi.ts` passed an absolute `DATABASE_FILENAME`, but `config/database.ts` joins it to the project root, so the real SQLite file landed in a stray `home/...` directory the harness never cleaned. Stale rows leaked between runs and eventually pushed articles off the first API page. The path is now relative to the project root.

### Phase 3 — Fediverse replies → moderated comments `[x]` (#6)

- [x] Comment schema extension (`fediverseUri`, `fediverseActorHandle`) via `src/extensions/comments/strapi-server.ts`
- [x] `services/replies.ts`: `Create(Note)` → `PENDING` comment; dedupe by `fediverseUri`; `threadOf` resolution; plain-text sanitization; replies addressing the article by its `id` or its frontend `url`; blocked actors, unpublished articles, unrelated notes and forged authors ignored
- [x] `Update(Note)` → edit (back to `PENDING`); `Delete(Note)` → `removed`
- [x] Global middleware hiding `PENDING`/`REJECTED` comments from the public comments API
- [x] Verify live (2026-09-23, staging): reply from Mastodon → `PENDING` comment in the admin → approve → visible through the comments REST API; reply to that reply nests correctly; deleting the Mastodon reply marks it removed

**Phase 3 findings:**

- **The comments plugin does not hide pending comments.** Its public `GET /api/comments/:relation` (hierarchy) and `/flat` only filter by what the caller passes, and the frontend passes nothing. Storing replies as `PENDING` alone would have published remote spam instantly. The `hide-unapproved-comments` middleware fixes this in the backend; a mutation check (removing it) makes the visibility test fail.
- **Approval config in `config/plugins.ts` is inert.** See Moderation & Security above. Note that comments left through the site's own form are therefore approved immediately today; enabling the plugin's real `approvalFlow: ['api::article.article']` would put those in `PENDING` too (a product decision, not made here).
- **Comment `related` is `api::article.article:<documentId>`** (not the numeric id), and `threadOf` is set through the document service by the parent's `documentId`.
- **Author mapping:** `authorId` = remote actor URI (stable identity), `authorName` = actor name or `preferredUsername`, `authorAvatar` = actor icon (absolute `http(s)` URL without credentials and of at most 255 characters, else `null`; any other scheme such as `javascript:` or `data:` is dropped). The 255 is the size of a Strapi `string` column: the comment is written through the Document Service, whose validation rejects a longer `authorAvatar` on any database (seen on SQLite: the whole reply was lost), and `follower.avatar` is written through `db.query`, with no Strapi validation, so SQLite stores a longer value while PostgreSQL's `varchar(255)` rejects the write, `fediverseActorHandle` = `@user@host`. `authorEmail` is deliberately never set: the plugin exposes it publicly.
- **Threading is one hop.** A reply to a stored fediverse reply attaches to it via `threadOf`; a reply to something we don't know is ignored (not our conversation), not attached as top-level.
- **Sanitization order:** tags are stripped first (keeping `<br>`/paragraph breaks), entities decoded after, so an encoded `&lt;script&gt;` ends up as literal text, never markup. The frontend renders comments as text (no `v-html`). Mastodon's leading mention of the actor (the handle, or a former one) is stripped; content is capped at 5000 characters.
- **Authorship is checked.** A `Note` whose `attributedTo` differs from the signature-verified activity actor is dropped, and edits/deletes are only honoured from the original author.

### Phase 4 — Likes & boosts `[x]` (#7)

- [x] `plugin::fediverse.interaction` content type; `Like`/`Announce` + `Undo` handlers
- [x] `GET /api/fediverse/articles/:documentId/stats` public route (`auth: false`, aggregates only)
- [x] Hardening found on the way: `Undo` now requires the embedded activity's actor to match the signature-verified sender
- [x] Verify live (2026-09-23, staging): a like and a boost from Mastodon move the counts; undoing them decrements

**Phase 4 findings:**

- **The article is referenced by `articleDocumentId` (a string), not by a relation** as the original plan said. Articles are draft-and-publish and localized, so a relation points at one specific row and can be orphaned every time the article is re-published; the documentId is stable. Interactions of a deleted article are left behind (never counted: the stats route 404s for unknown articles).
- **`unique: true` in a Strapi schema is not a database constraint.** It is only enforced by the Document Service's validation; the table gets no unique index, so `db.query` can insert duplicates. `interactions.ts` therefore builds a single `interactionKey` (`type|actor|article`) and settles concurrent deliveries _after_ the insert — every writer deletes all rows for the key except the oldest — which converges to one row even across processes and on Postgres, where a lower id can commit after a higher one (a test fires five concurrent inserts). Followers (`actorId`) converge the same way (see risk 8). The same caveat still applies to `fediverseUri` on comments, which is checked before inserting but is not race-proof; simultaneous duplicate deliveries of the same activity are unlikely, so this was left as is.
- **Blocked actors don't count, retroactively.** `countInteractions` excludes blocked actors' rows, so blocking someone also removes their earlier likes from the totals.
- **`Undo` and embedded activities.** Only the outer activity's actor is covered by the HTTP signature. Fedify already refuses to trust an embedded object from a _different origin_ (it tries to re-fetch it), but for two accounts on the _same_ origin the embedded actor was trusted, so the `Undo(Follow)` handler could be made to remove another account's follow. It now requires `undone.actor === undo.actor` (a test fails without it). `Undo(Like/Announce)` removes by the verified sender, so it can only ever retract the sender's own interaction.
- **Stats endpoint:** returns `{ likes, boosts }` only — never who interacted — and 404s for unpublished or unknown articles. It is a plugin content-API route (`routes/index.ts` + `controllers/stats.ts`) so it is served at `/api/fediverse/articles/:documentId/stats`, outside the Fedify middleware paths.

### Batch counts and ranking `[x]` (#16)

- [x] `GET /api/fediverse/articles/stats` (batch) and `GET /api/fediverse/articles/ranking` for the frontend's Bitácora view and "most discussed in the fediverse" sort
- [x] Tests with interactions, replies in every moderation state, a blocked actor, a draft, a tie and a second locale (`tests/fediverse-stats.test.ts`)

**Findings:**

- **One aggregate query, not a loop.** `services/stats.ts` builds two grouped subqueries — interactions by `articleDocumentId`, fediverse replies by `related` — and left-joins them onto the published article rows of the locale, ordering and paging in SQL. The batch route reuses the same subqueries filtered by id. Table and column names come from `strapi.db.metadata`, not hardcoded.
- **Counts are per document, not per locale.** Interactions reference the documentId and replies arrive through the default-locale article, so an article shows the same counts in every locale; `locale` only selects which published articles are listed.
- **Postgres and GROUP BY.** The reply subquery selects `SUBSTR(related, n)` but groups by `related` itself: two parameterized `SUBSTR()` calls in `SELECT` and `GROUP BY` are different expressions to Postgres. `COUNT`/`SUM` come back as strings on Postgres and are converted to numbers.

### Phase 5 — Tests, lint, docs, deployment `[~]` (#8)

- [x] Integration and unit coverage of everything the issue lists — WebFinger (`fediverse.test.ts`), actor, keys and follower add/remove with signed `Follow`/`Undo`/`Block` (`fediverse-phase1`), article dispatcher/outbox/fan-out (`phase2`), signed `Create(Note)` → `PENDING` comment with field mapping, dedupe, nesting and sanitizer/URL/prune unit tests (`phase3`), likes/boosts and the public stats route (`phase4`), and the switched-off plugin (`fediverse-disabled`)
- [x] `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` green; the whole suite also passes on **PostgreSQL** and under **Node 20.20** (the production image's runtime)
- [x] Update this document's status markers; add `.claude/skills/strapi-fediverse/SKILL.md`
- [x] Deployment notes: fediverse env vars, requirements and a production rollout/rollback checklist in [`docs/operate/configure.md`](operate/configure.md#fediverse-activitypub)
- [ ] Cross-server verification against at least one non-Mastodon implementation (Pleroma/Akkoma, Misskey, or GoToSocial) — see [Discoverability on Other Networks](#discoverability-on-other-networks). Waiting on account approval on a non-Mastodon server (as of 2026-09-24)
- [x] Enable in production (`develop` → `main` via #10 and #11, `FEDIVERSE_ENABLED=true`). Checked 2026-09-24: `/_health` 204; WebFinger, the actor and NodeInfo answer 200 on `cms.example.com`

**Phase 5 findings:**

- **PostgreSQL parity.** Production is PostgreSQL but the suites only ran on SQLite. `tests/strapi.ts` now runs against Postgres when `TEST_DATABASE_URL` is set (one database per Jest worker, recreated at start), and all suites pass there. It also confirmed that Strapi creates no unique indexes on Postgres either.
- **Runtime parity.** The production `Dockerfile` uses `node:20-alpine`, whereas the staging build ran Node 22. Fedify needs an ESM-only package that `require()` only loads on Node ≥ 20.19 / ≥ 22.12, so `engines` now says `>=20.19.0`. The complete suite was run under Node 20.20.2 with Postgres. The Docker image (Alpine, `Dockerfile` layout) was first built end to end by the production deploy, and runs there.
- **Switched-off plugin is tested.** With `FEDIVERSE_ENABLED=false` no route, content type or hook exists, article publishing is unaffected, and the comments-visibility middleware still hides pending comments.
- **Wire-format check against staging** with `npx @fedify/cli` (`webfinger`, `nodeinfo`, `lookup`): the actor (with `inbox`, `outbox`, `followers`, keys, `discoverable`) and a federated article parse cleanly. The CLI uses the same library as the plugin, so this validates the format, not other servers' behaviour, and does not replace the cross-server item above.
- **CI scope.** `.github/workflows/ci.yml` runs only for pull requests to and pushes on `main`; `develop` pushes deploy to staging without running it. The `develop` → `main` pull request is where CI gates this work, and it does not run the Postgres variant of the suite.
- **Production incident: the Fedify middleware stalled large request bodies (found the day it was enabled).** `@fedify/koa` turns the Node request stream of every non-GET request into a web stream _before_ deciding whether the route is its own. That stream pauses the shared Node stream once its queue fills (bodies of roughly 16 KB on Node 20, 64 KB on Node 24), and because the middleware runs ahead of `strapi::body` nobody drains it, so any large POST/PUT elsewhere in the app hung until the client aborted — publishing a long article in the admin was the first to show it (`request aborted` in `raw-body`, a 2-minute request). Small bodies were fine, which is why staging, the tests and every earlier check missed it. `mountFediverseMiddleware` now only runs Fedify for `/fediverse/*`, `/.well-known/*` and `/nodeinfo/*`; `tests/fediverse.test.ts` posts a 512 KB body to a non-federation route (the test times out without the fix). Lesson: a global middleware that touches the request stream needs a large-body test on an unrelated route.
- **Request guard hook for rate limiting (#100).** The Fedify middleware is mounted in the plugin's `register()` and runs ahead of every root middleware, so no root middleware ever sees federation requests. `mountFediverseMiddleware` therefore calls an optional guard (`types/request-guard.ts`: `(ctx, kind: 'inbox' | 'read') => Promise<boolean>`, `true` = response already written, e.g. 429) on federation paths before Fedify touches the request stream, so a rejected request is answered with its body unread. `kind` is `inbox` for a POST whose path matches `INBOX_PATH` or `SHARED_INBOX_PATH` (a trailing slash counts too), `read` otherwise. The guard is passed through config (`plugin::fediverse.requestGuard`) rather than imported because the plugin never imports from root `src/`, and it is read on every request because the root `register()` (which sets it) runs after the plugin's, when the middleware is already mounted. Missing or non-function guard: federation works as before. A guard that throws or rejects fails open, with a warning logged at most once a minute and no request data.
- **NodeInfo** reports `localComments: 0` unconditionally; making it a real count is a possible refinement.
- **Changing the handle without losing followers (2026-09-26).** The handle's `@user` (`preferredUsername`, `FEDIVERSE_ACTOR_USERNAME`) is now separate from the actor identifier (`FEDIVERSE_ACTOR_IDENTIFIER`, the URI path), and the actor dispatcher sets Fedify's `mapHandle`, so WebFinger resolves `acct:<new username>@…` — and the former `acct:<old username>@…` — to the unchanged `/fediverse/user/blog`. Remote servers key accounts by URI, so follows and already-federated posts keep working; Mastodon shows the new handle once it refetches the actor (it re-verifies `preferredUsername` through WebFinger). Renaming the identifier instead would have orphaned every follow.

---

## Future Work (Out of Scope for MVP)

- Locale-specific federation objects (`inLanguage` fan-out, per-locale handles)
- `fediverse:creator` author attribution
- WebFinger on the frontend domain (`@blog@example.com`) via the proxy
- Fediverse relay submission for reach beyond direct followers

---

## References

- [Fedify — ActivityPub server framework for TypeScript](https://fedify.dev) | [GitHub](https://github.com/fedify-dev/fedify)
- [Fedify × Koa integration docs](https://fedify.dev/manual/integration)
- [Fedify tutorial: Building a federated blog](https://fedify.dev/tutorial/blog) (actor setup, followers, `Create(Article)` on publish, replies as comments)
- [TryGhost/ActivityPub](https://github.com/TryGhost/ActivityPub) — Ghost's Fedify-based multi-tenant ActivityPub service (precedent)
- [Ghost's "Building ActivityPub" build log](https://activitypub.ghost.org) — practical federation lessons
- [Mastodon ActivityPub spec](https://docs.joinmastodon.org/spec/activitypub)
- [W3C ActivityPub](https://www.w3.org/TR/activitypub/) / [Activity Streams 2.0](https://www.w3.org/TR/activitystreams-core/)
- [Strapi 5 Server API — server-level middleware via `strapi.server.use()`](https://docs.strapi.io/cms/plugins-development/server-lifecycle)

## Implementation notes

Non-obvious findings moved from `CLAUDE.md` (#113), unchanged except for the opening sentence. The plugin lives in `src/plugins/fediverse/` and is a local Strapi plugin (not a workspace package) implementing ActivityPub federation with `@fedify/fedify` + `@fedify/koa`. It is gated by `FEDIVERSE_ENABLED` (default `false`) in `config/plugins.ts`. Read this document before touching it, or `src/extensions/comments/` (which adds `fediverseUri`/`fediverseActorHandle` fields to the comments schema for reply ingestion/dedupe).

- Fedify's middleware is mounted in plugin `register()` (not `bootstrap()`), via `strapi.server.use()` directly — this must run before Strapi's `initMiddlewares()` mounts `strapi::body`, since HTTP signature verification needs the raw request body, and before the router mounts at `listen()` time.
- Strapi 5 does **not** emit `afterPublish`/`afterUnpublish` through `strapi.db.lifecycles`; publish/unpublish state is only observable via `strapi.eventHub` (`entry.publish` / `entry.unpublish`), fired asynchronously after the transaction commits.
- All federation state that must survive a restart (followers, actor keys, interactions, the state of each article) is stored in Strapi content types or the plugin store. Fedify's key-value store only backs caches and idempotency, and its queue only holds the deliveries waiting to be sent; on PostgreSQL both are tables, on SQLite they are in memory.
- Strapi's `unique: true` is only Document Service validation — there is no database index, so `db.query` writes can create duplicates. Race-prone inserts (see `services/interactions.ts`) dedupe after inserting.
- The Fedify Koa middleware is guarded to federation paths only (`mountFediverseMiddleware`): unguarded, it stalls any non-GET request with a body over ~16 KB on other routes, because it consumes the request stream before `strapi::body` can.
- Behind a TLS-terminating proxy, `config/server.ts` needs `proxy: { koa: true }`; otherwise `ctx.protocol` is `http` and every ActivityPub URL is generated with the wrong scheme.
- Fediverse code paths are split across `federation.ts` (Fedify dispatchers and inbox listeners) and `services/` (`articles`, `publisher`, `replies`, `interactions`, `followers`, `keys`, `actor-profile`); `docs/FEDIVERSE.md` has the per-phase findings.
- The comments plugin findings are in [architecture/comments.md](architecture/comments.md).

## Delivery queue (#297)

Verified against the installed Fedify 2.4.4 before the design, because the issue said to:

- **There is no success callback.** The outbox has `onOutboxError` (every failed attempt, retries included, with the activity and no attempt number) and `setOutboxPermanentFailureHandler` (once, only for `permanentFailureStatusCodes`, `[404, 410]` by default, or a held activity whose circuit-breaker lifetime expired). Nothing reports a delivery that worked, so the row and every panel say "queued" and `failed`, never "delivered".
- **Running out of retries is silent.** The "giving up" branch only logs; neither handler is called. The one hook is `outboxRetryPolicy`, which returns `null` at that moment, and it does not receive the activity.
- **A refused delivery is knocked twice.** For a server whose signature spec Fedify does not know yet, one failed attempt sends the POST twice (RFC 9421, then draft-cavage). A fake inbox that counts POSTs sees two per attempt; `tests/helpers/remote-actor.ts` says so.
- **The queued message holds the actor's private key as a plain JWK.** `sendActivity` writes `keys: [{ keyId, privateKey }]` into every outbox message, and into the fan-out message it queues first when there are five or more inboxes. On PostgreSQL that is a row in `fedify_message_v2` for as long as the delivery is pending or retrying, which would undo [Actor key at rest](#actor-key-at-rest). `ObservedMessageQueue` (`utils/observed-queue.ts`) encrypts `privateKey` of any message that has `keys` (outbox and fan-out) with the actor-key scheme on the way into the queue and decrypts it on the way out; a queued message that cannot be decrypted (`ENCRYPTION_KEY` changed since it was queued) is dropped with one `[fediverse]` error line a minute, because the queue has already removed it; without `ENCRYPTION_KEY` (development, tests) it passes the message through, as the stored key does. A message queued before the upgrade is read as it is. Test: `tests/fediverse-queue-postgres.test.ts` reads the table.
- **`PostgresMessageQueue` deletes a message before handling it** (`DELETE … RETURNING`, no transaction around the handler), and handles one message at a time per process. So a restart loses nothing that is waiting, retries included (`tests/fediverse-delivery-restart.test.ts`), but a crash during a delivery loses that one attempt, and a slow remote delays the ones behind it: a follower with an inbox that accepts the connection and never answers holds the worker for minutes per delivery (undici's timeout), so many such followers delay every publish. Accepted for now; the inbox rate limit bounds how fast they can register, and `ParallelMessageQueue` was left out because it widens the window of the lost attempt. The Fedify pool verifies the database certificate for the `sslmode`s that `pg` verifies (`postgresOptions`); `sslrootcert`, `sslcert` and `sslkey` in `DATABASE_URL` are not read by the `postgres` driver, use `DATABASE_SSL_*`. Fedify re-enqueues a failed attempt as a new message, so only the attempt in flight is at risk. `ParallelMessageQueue` would add concurrency and widen the window; not used.
- **The circuit breaker is on by default** once an outbox queue exists: five failures in ten minutes on one host (`host:port`) hold its activities for up to 30 minutes at a time and drop them after a week. It is kept. A held activity produces no failure, so its row keeps its last state.
- **The response body of a refusing inbox is logged.** Fedify's outbox record `Failed to send activity … ({status} {statusText}):\n{error}` carries the body in `{error}`, and `SendActivityError.message` ends with it. The plugin's LogTape sink now leaves that slot out (`withoutRemoteBody`) and renders a `SendActivityError` as its status and host, and `describeDeliveryError` does the same for the row.

How it fits together: `ObservedMessageQueue` runs each outbox message inside an `AsyncLocalStorage` observation. `onOutboxError`, the retry policy wrapper and the permanent failure handler write what they see into it (`failure`, `retry`, `permanent`); when Fedify has handled the message the queue passes the observation to `settleDelivery` (`services/delivery-outcomes.ts`), which writes the row and flags followers. The three callbacks know nothing of one another and the retry policy sees no activity, so the observation is what ties them to the message. A message that left no failure behind is ignored. The article and the kind of activity come back from the activity id (`parseArticleActivityId`); a failure is dropped when the row's last activity is of another kind, so a late failure does not overwrite a newer publish (two `Update`s in a row are not told apart).

**Open decision applied (issue #297): unreachable followers are skipped, not retried forever.** Only a `404`/`410` flags a follower; the flag clears on any activity from it. Keeping on trying for ever, as Mastodon does, would put a dead inbox into every fan-out for good. Revisiting it means removing the `markUnreachable` call in `settleDelivery`.

Two more windows where a queued message can be lost: `PostgresMessageQueue` checks its abort signal after deleting a message, so a clean shutdown that lands during a poll can drop one; and a message that cannot be decrypted after an `ENCRYPTION_KEY` change is dropped (logged once a minute).

Release-note material (#297, minor, no upgrade step): publishing returns once the activities are queued. On PostgreSQL the CMS creates two Fedify tables on first use and keeps up to four more connections open (`FEDIFY_POOL_SIZE` plus one); check `max_connections` ([operate/configure.md](operate/configure.md#delivery-queue-and-database-connections)). The `follower` table gets one nullable column. Rolling back leaves the tables and the column in place; an older release ignores them and delivers synchronously again, and a delivery still waiting in `fedify_message_v2` is not sent.

## Article panel (#299)

An editor sees the federation state of an article in the side column of its edit view, next to the publish button: the state of the last activity (never federated, `Create` queued, `Update` queued, retracted, or failed with its reason and attempts), likes, boosts, approved and pending fediverse replies, and a **Federate now** button. It says "queued", never "delivered" (see [Delivery, retries and what the row says](#delivery-retries-and-what-the-row-says)). Code: `src/plugins/fediverse/admin/src/` (panel, pure logic in `state.ts`, strings in `translations/`), server side in `controllers/federation.ts` and `services/federation-panel.ts`. Verified before building, against Strapi 5.58:

- **A local plugin's admin code is bundled only if the plugin is enabled while the admin is built.** The build reads `exports["./strapi-admin"].import` of the plugin's `package.json` and skips plugins that are not enabled. The image is built with `FEDIVERSE_ENABLED` unset (`Dockerfile`, `npm run build`), so an admin export of the plugin would never reach a site that enables federation at runtime. The panel is registered from the root admin app instead (`src/admin/app.tsx` calls `registerFederationPanel`), always bundled; the plugin has no `./strapi-admin` export. The bundle was checked after a build with the plugin off. A site with federation off gets a panel that says so: its routes do not exist, which the panel reads from a `404` without a problem `code`.
- **The edit view's extension point is `addEditViewSidePanel`**, not the `right-links` injection zone the issue named: the zone still exists but holds small links, and the side panel API is what Content Manager's own panels (Entry, Preview) use. `src/admin/tsconfig.json` already included `plugins/**/admin/src`; `npm run typecheck` now runs it, which it did not before.
- **Plugin admin routes are served at the root, not under `/admin`.** The default prefix is the plugin's name, `/fediverse`, which is Fedify's: its middleware would put the federation security headers and the federation rate limit on the panel and read the body of the `POST`. The routes have a prefix of their own, `/fediverse-panel` (`routes/index.ts`), instead of the `/fediverse/articles/…` of the issue: `GET /fediverse-panel/articles/:documentId/federation?locale=` and `POST /fediverse-panel/articles/:documentId/federate?locale=`. Both need an admin session (`admin::isAuthenticatedAdmin`) and are absent when `FEDIVERSE_ENABLED=false` (`tests/fediverse-disabled.test.ts`). `locale` is the language the editor has open, the default locale when omitted.
- **Permissions are Content Manager's own.** Each route reads the article document and asks `strapi.plugin('content-manager').service('permission-checker').create({ userAbility, model })`: `cannot.read(document)` for the state, `cannot.publish(document)` for the button, so the conditions and locale restrictions of the editor's role apply. A refusal is `403`, checked in Content Manager's order: the role first (so a role with no access learns nothing about which ids exist), then the document, loaded with its `createdBy` so a condition such as "is creator" can match. Only an admin session or an admin-kind API token gets in: a content-API token or a users-permissions JWT is `401`. An admin with the role "may read, not publish" can open the panel and not press the button.
- **Errors are RFC 9457 problem details** (`application/problem+json`, `utils/problem.ts`) with a stable `code`: `article-not-found` (404), `forbidden` (403), `article-not-published` and `locale-not-federated` (409). `Federate now` is `202` with `{ activity, queued, skipped }`. It sends a `Create` when no row exists or the last activity was a `Delete`, an `Update` otherwise, through the same function as the publish event (`federateArticle` in `services/publisher.ts`), so it goes through the queue and the unreachable-follower rule.
- **The admin fetch client hides problem details.** For an error body with no `error` member, which is what an RFC 9457 problem is, Strapi's client throws a bare `FetchError('Unknown Server Error')` that carries only the status. The panel therefore asks for the body as text and accepts every status (`responseType: 'text'`, `validateStatus`), and `interpretResponse` in `state.ts` reads the status and the problem `code` itself; a plain `404` with no `code` (Koa's "Not Found", or Strapi's own error body) is "federation off". `tests/fediverse-admin-panel.test.ts` runs it against the shapes the client really produces. A first version read `error.response`, which never exists, and so could not tell "off" or "hidden" from an error; the check by hand had only covered successful answers.
- **Double press.** Two presses on a never-federated article, or one racing a publish, can both read "never federated" and queue two `Create`s; the row settles to one and Mastodon ignores a repeated `Create` for the same object id, so it is accepted. The button is disabled while a press is in flight.
- **Rate limiting.** `/fediverse-panel` is not an exempt admin prefix on purpose: it counts in the `api` group, which limits "Federate now" per client address (`docs/RATE_LIMITING.md`).
- **No component test harness exists** (no jsdom or React Testing Library in the repository). The decisions of the panel live in `state.ts` and are unit-tested (`tests/fediverse-admin-panel.test.ts`, with a check that both locales have the same strings and arguments); the rendering was checked by hand in the admin on a running instance, in each state and with the button (screenshots in the pull request).
- **`es` strings ship but show only when that admin language is enabled.** `src/admin/app.tsx` has `locales: []`, so the admin offers English only; the panel's Spanish is registered through `config.translations` and appears the day `es` is added to `locales`.

## Plugin page (#300)

The admin menu has a **Fediverse** entry with three sections: **Diagnostics** (is federation set up right), **Followers** (with block and unblock) and **Failed deliveries** (with retry). Strings in `en` and `es` (`src/plugins/fediverse/admin/src/translations/`). Code: `controllers/plugin-page.ts`, `services/diagnostics.ts`, `services/inbox-refusals.ts`, and in the admin `pages/FediversePage.tsx` with `components/{Diagnostics,Followers,Failures}Section.tsx`.

**Permissions.** Two plugin permissions, registered at bootstrap (`services/permissions.ts`) and so existing only while the plugin is enabled: `plugin::fediverse.read` shows the menu entry and answers the three `GET`s, `plugin::fediverse.manage` allows block, unblock and retry. The super admin has both at once; any other role needs them in Settings → Administration Panel → Roles. The issue named only `manage` and said an admin without it "can still read"; reading followers' handles and delivery errors is not something every admin should do, so reading has its own permission. The handlers check the admin's ability and answer a problem detail `403`; the routes need an admin session (`401` otherwise).

**Granted roles are lost when federation is turned off.** With the plugin disabled the two actions are not registered, and Strapi's boot removes `plugin::fediverse.*` from every role; the operator must grant them again after enabling it. Keeping them registered while disabled would show a menu entry that opens nothing, so it was not done.

**Menu entry and federation off.** The code is always in the bundle (see [Article panel (#299)](#article-panel-299)), so the entry is gated by `read`: with the plugin off the permission does not exist, no role has it, and the entry does not show. Checked in a running admin, with and without `FEDIVERSE_ENABLED`.

**Routes** (prefix `/fediverse-panel`, not the issue's `/fediverse/admin/*`, for the reason in the article panel section): `GET /diagnostics`, `GET /followers`, `POST /followers/:documentId/block|unblock`, `GET /failures`, `POST /failures/:documentId/retry`. Errors are problem details (`forbidden`, `follower-not-found` 404, `not-failed` 409, `article-not-published` 409, `queue-unavailable` 503).

**Diagnostics.** Each returns `ok`, a stable failure `code` and, for figures, a `value`; the page shows the fix text of the code (the texts are in the translations and in [operate/configure.md](operate/configure.md#fediverse-page)).

| Check                                  | Fails with                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Public address                         | `url-missing`, `url-not-https` (`URL`, read as `publicOrigin()`)                                                                          |
| Actor key                              | `actor-key-missing-encryption-key` (`ActorKeyDecryptionError`), `actor-key-unreadable`; only the error's class is used, never its message |
| WebFinger of this site                 | `webfinger-skipped` (no `URL`), `webfinger-unreachable`, `webfinger-not-found` (any status but 200), `webfinger-wrong-subject`            |
| Backend, followers, refused deliveries | figures only: `postgres` or `memory`, the active followers, and the refused inbox deliveries of the last 24 hours                         |

- **A diagnostics `GET` writes nothing.** The actor key check reads the store (`verifyStoredActorKey`) and decrypts; unlike `getActorKeyPairs`, which the actor document uses, it never generates a key pair or rewrites an entry, so opening the page cannot create the identity. No key stored is its own failure, `actor-key-missing`. Each figure (followers, refused deliveries) fails alone to `null` and a warning instead of blanking the page, and the follower list is capped at 500 rows (`FOLLOWER_ROWS_LIMIT`).
- **The WebFinger check is a request to the instance's own origin** (`fetch` of `${URL}/.well-known/webfinger?resource=acct:<user>@<host>`, 5 s timeout, redirects not followed). The address is the operator's `URL`, never one a visitor gave. Listed in [security/outbound.md](security/outbound.md). The handle-host variant the issue mentions waits for #298 (a handle host separate from the web origin); today the subject host is the host of `URL`.
- **Refused deliveries are counted per hour in Fedify's key-value store** (`services/inbox-refusals.ts`, one key per hour, kept 25 hours). The middleware counts each `401` it writes at the inbox, the digest refusals and Fedify's own. On PostgreSQL the count survives a restart; on SQLite (memory) it does not. Every refused delivery costs one key-value read and write, which the inbox request guard bounds (60 a minute per client); the write is not awaited, so it never delays the `401`. The counter is read-then-write without a lock, so two refusals at the same instant can count once: it is a figure for a person, not an audit log (the `security:` events are).

**Block and unblock act on the actor, not on one row.** Duplicate rows of an actor are possible (risk 8), and an actor with any blocked row counts as blocked, so unblocking one of two blocked rows would leave the actor blocked. The page sets `blocked` on every row of the actor, and unblocking keeps the row. A blocked actor's `Follow` gets no answer (tested with a signed `Follow`).

**The activity type follows the row, not `isFederated`.** `activityTypeFor` (`services/federated-articles.ts`) makes a failed `Create` a `Create` again: a `failed` row used to count as federated and the retry became an `Update`, which a server that never got the post ignores, so the button would not have repaired the commonest failure. The publish event and "Federate now" use it too. A failed `Update` stays an `Update`, and a failed `Delete` of an article that was published again is sent as a `Create`.

**Retry** goes through `retryFailedDelivery` in `services/publisher.ts`: a failed `Create` or `Update` is sent again through the same path as "Federate now" (`federateArticle`), so it is queued and skips unreachable followers; a failed `Delete` is sent as a `Delete` again unless the article was published since. Fedify reports no success, so the row says `created`, `updated` or `deleted` (queued) at once and turns `failed` again only if Fedify gives up again.

**A bug of #299 found here.** Strapi's admin fetch client takes no `responseType` for `post`: it parses the body itself and returns only `{ data }`, with no status, so a refusal arrives as the parsed problem detail. The first version of "Federate now" read a status that was never there and showed an error notice after every press, although the activity was queued; checking only that the state changed did not show it. `interpretPostResponse` (`state.ts`) reads that shape, with tests, and both the panel and the page use it.

## Moderator replies (#301)

A moderator's answer to a fediverse comment is sent back to the remote thread (flow 5 above). Code: `services/reply-publisher.ts` (lifecycle hook, what to send), `services/reply-notes.ts` (the `Note`, the activities, who federates), the `Note` dispatcher in `federation.ts`.

**Open decision applied (issue #301): admin only.** Only comments written by an admin user (`isAdminComment`) federate. Replies from registered readers ([ACCOUNTS.md](ACCOUNTS.md)) do not; the author of a federated reply is the blog actor, so nothing of the moderator (name, email) leaves the server. Widening it means widening `resolveReplyTarget` and deciding what a reader's name is on another server.

**A contract that never changes: `/fediverse/notes/<documentId>`.** The documentId of the comment is the `Note` id (`NOTE_PATH` in `constants/paths.ts`). Remote servers store it and a reply to the note comes back with it as `inReplyTo`, so it is a visitor-facing identifier in the sense of the engineering standard, section 6: it is not renamed or reused.

Differences from the issue's text, and findings:

- **The note id is in `fediverseNoteUri`, not in the public `fediverseUri`, and `fediverseNoteRetracted` says whether it was last retracted.** Both are non-public attributes added in `src/extensions/comments/strapi-server.ts` and not re-attached by `src/middlewares/fediverse-comment-fields.ts`. The issue says the comment gets its own `fediverseUri`, expecting the frontend's badge to follow `fediverseActorHandle`; the frontend (`app/helpers/comments.ts`) marks a comment as remote by `fediverseActorHandle || fediverseUri` and links "View on instance" to `fediverseUri`. With the note id there, the site's own reply would be badged as remote and linked to a URL that only answers ActivityPub. `fediverseUri` keeps meaning "a remote server's note id". **The criterion "the public API shows `fediverseUri`" is therefore not met on purpose:** it shows `fediverseUri: null` and `fediverseActorHandle: null`. If the frontend later wants to show the thread link, it is a change on its side first. Reply ingestion resolves a reply to the admin's note through `fediverseNoteUri`.
- **The hook is in the fediverse plugin, not in `src/extensions/comments/strapi-server.ts`.** That extension is root code that must not depend on a plugin that is off by default; the plugin subscribes to the comments model's lifecycle (`afterCreate`, `afterUpdate`, `afterUpdateMany`, `beforeDelete`, `beforeDeleteMany`) in `bootstrap()` and only runs while it is enabled. The work is done in the background, one comment at a time, so the admin's request is not held by the lookup of the remote author.
- **Who may speak as the blog is checked here, because the comments plugin does not check it.** Its admin routes (`postComment`, `updateComment`, and the moderation routes) have no policy: any admin account can post a comment, and `isAdminComment` only says an admin wrote it. Since federating signs the text as the blog actor, `authorMayModerate` builds the author's ability as Strapi's admin login does and requires `plugin::comments.comments-moderate`. An admin account without it can still post on the site, as before. The gap in the comments plugin itself is not fixed here: it is a third-party plugin's routes (it needs a policy on them, or a report upstream).
- **State, not changes.** A note is _live_ remotely when it has a `fediverseNoteUri` and `fediverseNoteRetracted` is not true. A shown reply that is not live is sent as a `Create`; a hidden one that is live is retracted; a shown, live one whose text changed is an `Update`. Comparing states means a write that changes nothing visible sends nothing, and the `updateMany` paths of the comments plugin (a blocked thread, a deleted article's comments, a reader removing a comment with replies) are covered by re-examining the federated replies after them.
- **A retracted reply stays retracted on Mastodon.** Mastodon keeps a tombstone for a deleted URL and ignores a later `Create` of the same id; showing the reply again sends a `Create` with a new activity id, which servers that do not keep tombstones accept. Sending a reply back to moderation therefore retracts it for good there. The plugin does not guess otherwise.
- **"Shown" has no `APPROVED` requirement:** an admin's reply made through the plugin has no approval status, and is shown unless it is removed, blocked (itself or by a blocked thread), `PENDING` or `REJECTED`. The parent must be shown too, and the article published.
- **The plugin stores a moderator's text as sanitized HTML** (`&` becomes `&amp;`; some tags stay). The `Note` content is that text escaped once: the four entities the sanitizer writes are decoded first and any markup that remains is escaped, so it is text remotely as it is on the site.
- **The remote author is addressed through a fetched actor** (an outbound `GET`, see [security/outbound.md](security/outbound.md)); if that fails, the reply goes to the followers only and a warning is logged. A `Mention` tag is sent, because a remote server notifies a person only of a mention.
- **Not verified here:** the live check on staging (the reply under the Mastodon post, and a Mastodon reply nesting under it). The tests run against a fake remote server, signed deliveries included, and the served `Note` parses with Fedify's vocabulary, which is what `npx @fedify/cli lookup` uses.

Release-note material (#301, minor, no upgrade step): replies a moderator writes to fediverse comments are now sent to the remote thread, and the comments table gets two nullable columns. Nothing changes for a site where federation is off, or that has no fediverse comments.

## Actor profile in the site settings (#303)

The actor's profile is edited in the admin panel, in the `fediverse` component of the site settings (`site.fediverse`, `src/components/site/fediverse.json`): `username`, `displayName`, `summary`, `header`, `discoverable` and `sourceUrl`. `services/actor-profile.ts` resolves each field from the component first; an empty one falls back to what a site had before, so no site changes until its editor fills the component.

| Field          | Order                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `username`     | `fediverse.username` → `FEDIVERSE_ACTOR_USERNAME` → the actor identifier                                        |
| `displayName`  | `fediverse.displayName` → `global.siteName` → site settings `name` → `FEDIVERSE_ACTOR_NAME` → "Micelio"         |
| `summary`      | `fediverse.summary` → `global.siteDescription` → site settings `description` → `FEDIVERSE_ACTOR_SUMMARY` → none |
| `header`       | `fediverse.header` → `global.fediverseHeader`                                                                   |
| `sourceUrl`    | `fediverse.sourceUrl` → `FEDIVERSE_ACTOR_SOURCE_URL` → this repository                                          |
| `discoverable` | `fediverse.discoverable`, `true` when the component is empty                                                    |

**Open decision applied (issue #303): `api::site-setting`, not `global`, is the home of the profile.** `global` keeps the avatar (`favicon`) and its `siteName`, `siteDescription` and `fediverseHeader` stay as fallbacks, deprecated like the variables; removing the variables and those fields is #307. The site settings are the CMS's own identity (the engineering standard, section 5: per-site values come from the CMS), carry the same name and description, and are what the frontend already reads; `global` is a leftover of the first site. Moving the avatar is not part of this issue.

**Differences from the issue's text, on purpose:**

- **The old order is kept after the component.** The issue lists the variables before `global.siteName`; in the code the variables were the last fallback, after `global` and the site settings. Putting them first would change what a site that has both shows, and the issue asks for an additive change. So the component comes first and the rest keep their order. With the component and the variables empty, the name is the site settings' name (a required field); the bio is the site settings' description when it has one. The neutral bio "A Micelio site, federated on the fediverse." is gone: with nothing set there is no summary, as the issue says.
- **`FEDIVERSE_ACTOR_USERNAME` is no longer required.** It was required next to the identifier because the handle had no neutral value. Now the handle falls back to the identifier, which is what WebFinger already accepted as a former handle, so an instance that never sets a username has `@<identifier>@host`. A site with the variable keeps its handle. `assertActorConfigured` checks the identifier only.

**Verified before building** (the issue asked for the media and the handle):

- **The document service does not populate media of a component either.** `loadSiteSettings` populates `fediverse.header` explicitly (`populate: { fediverse: { populate: { header: true } } }`); the test serves the header's URL from the component.
- **`populate=*` reaches the component's fields but not its `header`**, and the frontend's request names what it reads (`SITE_POPULATE` in micelio, which has no `fediverse`), so its response is the same before and after the component is filled (`tests/site-settings.test.ts`, with that populate copied from micelio). The contract suite of micelio needs Docker and the CMS image, and was not run here.
- **Fedify 2.4.4's `mapHandle` accepts an async callback** (`ActorHandleMapper` returns `string | null | Promise<string | null>`), so the handle is read from the database on each WebFinger request instead of being fixed at boot. The username is therefore live: saving it changes the next WebFinger answer and the next actor document, with no restart. The former handles that keep resolving are the identifier, as before, and the value of `FEDIVERSE_ACTOR_USERNAME` while it is still set; a previous username typed in the settings is not remembered, so a rename from `news` to `desk` stops resolving `news` (storing former usernames is not part of this issue).
- **The `username` regex is validated by the Document Service** for a component's field like any other (`News Desk`, `news.desk`, `News` and `news@desk` are rejected; `summary` over 500 characters too).

**`Update(Person)`.** `services/publisher.ts` also subscribes to `entry.create` and `entry.update` of the site settings and sends the same activity as for `global`, for any locale: the `fediverse` component is not localized, so a save in `es` changes the actor too, and Strapi copies it to the other locales without an event of their own, after the `es` event: a save in another locale therefore waits one second before the actor is built (`LOCALE_SYNC_DELAY_MS`), or the `Update` would carry the old profile. Any save sends one, including changes the actor does not show (a module switch, say); a followers' server refetches one small document. A save that changes nothing visible is not detected.

**Deprecation warnings.** `bootstrap()` calls `warnDeprecatedActorVariables` (`utils/deprecated-variables.ts`): one line per `FEDIVERSE_ACTOR_USERNAME`, `_NAME`, `_SUMMARY` or `_SOURCE_URL` that is set and not blank, naming the setting. `global.fediverseHeader` has no line: it is data, not a variable, and reading `global` at boot only to warn was left out.

Release-note material (#303, minor, no upgrade step): the actor's username, display name, bio, header, discoverability and source link are edited in Site settings → Fediverse profile. The four `FEDIVERSE_ACTOR_*` variables still work and log a deprecation warning at boot; `FEDIVERSE_ACTOR_USERNAME` is no longer required. A site with no bio anywhere no longer shows "A Micelio site, federated on the fediverse." The site settings table gets one component table (`components_site_fediverses`); rolling back leaves it in place.

## Origin of the ids

When `URL` is set, `getFederation` passes its origin (`publicOrigin`, `src/plugins/fediverse/server/src/utils/public-origin.ts`) to `createFederation`, so the actor, inbox, key and WebFinger ids never depend on the request's `Host` or `X-Forwarded-*` headers. The publisher already used `server.url`. With `URL` unset (development, tests) Fedify takes the origin from the request. Test: `tests/fediverse-origin.test.ts`.

## Remote text in logs and storage

A handle or display name from a remote server is untrusted text. `cleanRemoteText` (`src/plugins/fediverse/server/src/utils/remote-text.ts`) turns control characters and line breaks into spaces, drops invisible format characters (zero width, bidi overrides) and cuts the value to 255 characters, before it is logged or stored as a follower's or an interaction's `handle` and `name`. Other remote values in log lines are URLs, which are serialised and so carry no line breaks.

## Fedify's LogTape records

Fedify logs only through LogTape, which writes nothing until someone configures it. The plugin configures it once per process in `register()` (`src/plugins/fediverse/server/src/utils/fedify-logging.ts`) with a single sink that calls `strapi.log`, so the records follow Strapi's format and destination. What it does and why:

- **Level `warning` and above only.** Fedify writes `debug` records on every request, some with the full request headers (the `Signature` header included) or the activity. They never reach the sink.
- **`fedify.federation.http` is dropped.** Fedify writes an access line per request, at `warning` for a 4xx, with the query string. `global::request-logger` already writes each request without it.
- **One line per template per minute.** Some warnings fire on every request (the actor dispatcher warns that the actor has no `endpoints.sharedInbox` on every actor fetch), so a template is forwarded once per minute and category, and the next one says how many were held back; plugin `destroy()` writes the counts still pending. The security event below is not throttled.
- **Only the message, rendered by the plugin, with bounded work.** Each value is cut to 1,000 characters and the joined text to 2,000 before any pattern runs, and every pattern has bounded quantifiers. Values are reduced to text: an object becomes `[object]`, an error its name and message, a URL loses its query string. Then `cleanRemoteText` removes line breaks and invisible characters, and only after that are IP literals replaced by `[address]`, so an invisible character cannot hide one. The record's properties are not written, except a `reason` code (`fedifyReason`, such as `noSignature` or `keyFetchError`).
- **`contextLocalStorage` is required.** Fedify runs its work inside `withContext`; without an `AsyncLocalStorage` in the configuration, LogTape's meta logger warns on every request.
- **Several Strapi instances in one module scope** share LogTape's state (each Jest test file gets its own `globalThis` and module registry, so this is about instances booted within one file or one process). `configureFedifyLogging` keeps a stack of `strapi.log` targets and writes to the newest; plugin `destroy()` removes its own, falling back to the previous one, and resets the configuration when none is left, which also removes LogTape's process `exit` listener. A LogTape configuration made by someone else is left alone, with one warning.
- **CJS and ESM.** The esbuild bundle keeps `@logtape/logtape` external, so the plugin and Fedify's CJS build load the same `mod.cjs`; LogTape keeps its root logger on `globalThis` anyway, so a second copy would still share the loggers.

A refused inbox request is also a security event: when a `POST` on the shared or the actor inbox is answered `401` (by Fedify, or by the digest checks below), the middleware writes `security: fediverse.inbox.signature-refused` with the app's field names (`utils/security-log.ts`, a plugin-local copy of `src/utils/security-log.ts`), after the response is written, which is not changed. Its `reason` is `digest-algorithm` or `content-digest-not-covered` for the digest checks and `invalid-signature` for every `401` Fedify gives. Fedify answers `401` there only for authentication failures (no or bad HTTP signature, digest mismatch, unfetchable key, signer that is not the actor, failed integrity proof). Tests: `tests/fediverse-logging.test.ts`. The inventory is in [security/logging.md](security/logging.md).

## Inbox digest algorithms

Fedify 2.4.2 verifies a draft-cavage `Digest` header with any algorithm of its `supportedHashAlgorithms` table: `sha` (SHA-1), `sha-256` and `sha-512`. It skips entries it does not know, and every entry it knows must match the body. There is no option to drop SHA-1, so a remote server could authenticate a delivery with `Digest: SHA=<sha1>` alone. RFC 9421 `Content-Digest` is different: `verifyRfc9421ContentDigest` accepts only `sha-256` and `sha-512`, but Fedify calls it only when the signature covers the `content-digest` component.

So `mountFediverseMiddleware` checks the header itself (`inbox-digest.ts`): a `POST` to the shared or an actor inbox whose `Digest` header is empty or has no `sha-256` or `sha-512` entry with a value (SHA-1 only, MD5, an unknown algorithm) gets `401` (`text/plain`, `The Digest header must use SHA-256 or SHA-512.`) with its body unread. It runs after the request guard and before Fedify, writes the `fediverse.inbox.signature-refused` security event with `reason: digest-algorithm` and a `[fediverse]` warning at most once a minute, and never logs the header. A request without `Digest` is left to Fedify, which refuses a draft-cavage `POST` without one; whether the digest matches the body is still Fedify's check. Mastodon, and Fedify itself, send `SHA-256=`.

Decision: a header with at least one approved entry is accepted even when it also lists `SHA=` or an unknown algorithm. Fedify requires every entry it knows to match the body, so the SHA-256 or SHA-512 entry is always checked and a SHA-1 entry next to it can only add a check, never replace it; refusing such headers would turn away senders that list several algorithms for no gain in integrity. The rule is fixed: there is no switch for the stricter reading.

Tests: `tests/fediverse-inbox-digest.test.ts`.

### RFC 9421 signatures must cover `content-digest`

Fedify 2.4.2 picks RFC 9421 verification whenever a `Signature-Input` header is present (draft-cavage otherwise, no fallback between the two), accepts the delivery when any one of its signatures verifies (the first `maxSignatures`, 3 by default), and checks `Content-Digest` only for a signature whose covered components include `"content-digest"`. Nothing makes an inbox `POST` cover it, so a captured RFC 9421 delivery whose signature skipped it could be replayed with another body inside the signature window (one hour). Fedify's own signer always covers it when there is a body.

So the same middleware step refuses (`401`, `text/plain`, `The signature must cover the Content-Digest header.`, body unread, `reason: content-digest-not-covered`, its own once-a-minute warning) an inbox `POST` that has a `Signature-Input` header unless every signature in it covers `content-digest` (`inbox-signature-input.ts`). A header that does not parse, or has no signature, is refused too; Fedify would refuse it anyway. The check runs before the `Digest` check, which still applies to an RFC 9421 delivery that also sends `Digest`.

Decision: two refusals are stricter than Fedify and kept on purpose.

- An RFC 9421 delivery that also sends a `Digest` header with no SHA-256 or SHA-512 entry is refused (`digest-algorithm`), although Fedify's RFC 9421 path never reads `Digest`. No sender is known to pair RFC 9421 with a SHA-1-only `Digest`, and refusing it costs nothing.
- Fedify verifies a FEP-8b32 Object Integrity Proof first and, when it verifies, never looks at the HTTP signature. A delivery authenticated by its proof that also carries a `Signature-Input` skipping `content-digest`, or a `Digest` with no approved entry, is still refused here, because the middleware runs before the body is read and cannot know a proof will verify. A delivery with a proof and neither header is not touched and reaches Fedify as before. This loses only deliveries from a sender that pairs a valid proof with a weak HTTP digest or signature, and it never weakens a check.

The parser must not disagree with Fedify's `parseRfc9421SignatureInput`, so it uses the same library (`structured-field-values`, a direct dependency pinned to exactly the version Fedify's range resolves to, `2.0.4`, so npm dedupes the two to one copy) and the same rules: a dictionary member is a signature only if it is an inner list with a string `keyid` and a numeric `created` (other members are ignored, as Fedify ignores them); a component counts only as an sf-string equal to `content-digest`, so `"Content-Digest"` or a bare token does not; component parameters (`"content-digest";sf`) are ignored because Fedify signs the whole header whatever they are; a duplicate label keeps its last value. One difference: a member without parameters (`sig1=("content-digest")`) decodes with `params: null`, on which Fedify throws while the plugin skips it; the result is never more permissive, because a header left with no signature is refused and any other one reaches Fedify, which still fails on that member. Requiring every signature, not just the first three or the one that verified, is stricter than needed and never lets through a header Fedify would accept unchecked. Once the component is covered, Fedify itself requires `Content-Digest`, accepts only `sha-256` or `sha-512` there and compares it with the body, so the plugin does not repeat that. Draft-cavage deliveries (no `Signature-Input`) are not touched.

The plugin's and the tests' `tsconfig.json` use `"module": "Node20"` so TypeScript accepts the `require` of this ESM-only package, which Node 22+ loads natively (Fedify's CJS build does the same); Jest already transforms it (`jest.config.js`). Tests: `tests/fediverse-inbox-content-digest.test.ts`, with `postSignedActivity(url, activity, { rfc9421: { coverContentDigest } })` in `tests/helpers/remote-actor.ts`.

Version coupling: the plugin and Fedify must load the same copy of `structured-field-values`, or the two parsers could read one header differently. `package.json` pins it without a caret, and `tests/fediverse-structured-field-values.test.ts` resolves it from the project root, from the plugin bundle's directory and from `@fedify/fedify`'s directory (Node's `createRequire`), and fails when the real paths or versions differ or the version is not the pinned one. When a Fedify upgrade moves its range, raise the pin to the version npm installs for Fedify in the same pull request.

Release-note material (#181, patch, no upgrade step): a remote server that sends a SHA-1-only `Digest`, or an RFC 9421 signature that does not cover `content-digest`, now gets `401` from the inbox. Operators who alert on `fediverse.inbox.signature-refused` will see two new `reason` values, `digest-algorithm` and `content-digest-not-covered` (`docs/security/logging.md`). Fedify's own signer sends neither.

## Actor key at rest

The private JWK of the actor key pair is stored encrypted (`services/keys.ts`, `utils/key-encryption.ts`): in the `keyPairs` entry of the plugin store, `privateJwk` holds `{ v: 1, alg: 'aes-256-gcm', iv, tag, data }` (base64url), the scheme of Strapi's encrypted API token copies (key = SHA-256 of `ENCRYPTION_KEY`, 16-byte random IV, GCM tag) plus a fixed additional-data label, `micelio:fediverse:actor-key:v1`. `publicJwk` stays plain. The plugin reads the key as `strapi.config.get('admin.secrets.encryptionKey')`, the value Strapi's own encryption service uses, and keeps its own derivation because it does not import root `src/`.

- **Legacy entries.** A plain `privateJwk` is encrypted in `bootstrap()` (`encryptStoredActorKeys`) and, failing that, at first use. Only the stored form changes: the key material, the key id and the actor id stay the same. An envelope is never encrypted again.
- **Decryption failure.** A missing or different `ENCRYPTION_KEY`, or an altered envelope, throws `ActorKeyDecryptionError`, whose message names `ENCRYPTION_KEY`. The stored entry is never regenerated, rewritten or deleted, because a new key pair would be a new identity for every follower. The boot does not fail: the actor and WebFinger answer `500`, an inbox delivery that needs a signed answer answers `500` without it, and nothing is signed until the key is put back. The body of those `500`s is the generic `Internal Server Error`: the actor, WebFinger and the inbox are public, so the cause goes only to the server log.
- **No `ENCRYPTION_KEY` outside production.** Production refuses to boot without it (`src/utils/secrets.ts`). In development and tests a missing key keeps the private key plain, with one warning per process, and the next boot with a key encrypts it. A deterministic development key was rejected: it would be a published key, and a database copied to production would carry a ciphertext under a key everyone knows.
- **Fedify hides a failing key pairs dispatcher.** `Context.getActorKeyPairs` (Fedify 2.4.2) catches any error of the dispatcher, logs it as `No actor key pairs dispatcher registered.` and returns no keys, so the actor document was served without `publicKey`. The dispatcher now logs the real error through `strapi.log`, each distinct line at most once a minute (`logKeyPairsFailure` in `federation.ts`, `WARNING_INTERVAL_MS`; only `ActorKeyDecryptionError` messages are logged in full, any other error by its name and never with a stack, so nothing read from the stored key reaches the log). The limit is by time, not once per process, because the same path also fails on a transient error (the database down): a once-only line would hide the next outage for the life of the process, while a crawler fetching the actor still adds at most one line a minute, and `buildActor` throws `ActorKeyUnavailableError` when there is no key pair instead of publishing a keyless actor.
- **Koa prints every escaped error.** An error thrown out of the Fedify middleware reaches Koa's `app.onerror`, which writes it with its stack to `console.error` on every request, past `strapi.log` and any once-only guard. `mountFediverseMiddleware` therefore catches the two key errors itself and answers `500` with `Internal Server Error` as `text/plain`; any other error is rethrown unchanged. It runs after the guard and the inbox digest checks, so their `401`s come first.
- **Rolling back.** The code of an earlier release cannot read the envelope: it serves the actor without a key and signs nothing until this release runs again, and it does not regenerate the key either (its `isStoredKeyPairs` only checks that `privateJwk` is present, and the import then throws). Federating on the earlier release needs the previous key material, from a backup taken before the upgrade ([operate/upgrade.md](operate/upgrade.md#migrations-that-rewrite-data)).
- **Copies written before the upgrade.** Old backups and free database pages keep the plain JWK; the key is not rotated by default, because rotating means a new federated identity ([security/keys.md](security/keys.md#the-actor-key-written-before-encryption)).

### Key types and which key signs

Stored keys are imported by their JWK type (`importStoredJwk` in `services/keys.ts`, through Fedify `importJwk`); new pairs are RSA (`NEW_KEY_ALGORITHM`, `RSASSA-PKCS1-v1_5`). Three facts from Fedify 2.4.2 constrain it (`tests/fediverse-actor-key-agility.test.ts`):

- **`alg` is required for RSA.** `importJwk` rejects an RSA JWK unless `alg` is `RS256`. WebCrypto always writes it on export, but a JWK edited by hand or restored without it would fail, so `importStoredJwk` fills in `RS256` when it is missing.
- **`publicKey` must be the signing key.** Fedify signs outgoing HTTP requests and Linked Data signatures with the first `RSASSA-PKCS1-v1_5` pair it finds, so `buildActor` publishes that same pair as `publicKey` (not `keyPairs[0]`). With no RSA pair the actor fails closed with the generic `500`. `assertionMethods` lists every pair.
- **Key ids follow the order of the pairs.** `#main-key`, `#key-2` and so on come from the position in the stored array. Moving the RSA pair first would change the ids remote servers have cached, which is why the code selects the RSA pair instead of sorting.

Rotation of `ENCRYPTION_KEY` and backups: [security/keys.md](security/keys.md#rotating-encryption_key), [operate/backup.md](operate/backup.md). Tests: `tests/fediverse-actor-key-encryption.test.ts`. A WebFinger request in a test must name the test server's own host (`acct:bogdev@<serverHost()>`): Fedify answers `404` for another domain whatever the key state, which once made a fail-closed assertion on WebFinger pass for the wrong reason.
