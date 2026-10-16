---
name: strapi-subscriber
description: Use when the user asks about newsletter subscriptions, email signup, subscriber deduplication, confirmation or unsubscribe tokens, or the subscriber API in the Micelio CMS.
---

# Strapi Subscriber Skill

The `subscriber` content type stores newsletter subscriptions. The whole flow (sign-up, double opt-in, unsubscribe, emails) lives in the frontend server (`micelio`, `server/api/newsletter/`), which reads and writes subscribers through the REST API with its full-access API token. Strapi only stores them.

## When to use this skill

- Changing the subscriber schema or its permissions.
- Debugging why a confirmation or unsubscribe link does not find its subscriber.

## Schema

The frontend stores the SHA-256 (64 hex characters) of each token the emails carry and looks subscribers up by that hash (bogd3v/micelio#540); rows stored before it were hashed by `src/migrations/hash-subscriber-tokens.ts` on every boot. Frontend 0.1.x links break (it looks tokens up in the clear), so the frontend is upgraded to 0.2.0 or later before the CMS (`docs/operate/upgrade.md`). The CMS generates no token and stores whatever string it is given.

`src/api/subscriber/content-types/subscriber/schema.json`, without draft and publish (every entry is published, so `GET /api/subscribers` finds it):

| Field               | Type                                | Notes                                                                                                                                          |
| ------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`             | email, required, unique             | Stored lowercase by the frontend                                                                                                               |
| `confirmationToken` | string                              | UUID sent in the confirmation email; `null` once confirmed                                                                                     |
| `unsubscribeToken`  | string, unique                      | Random 32-byte base64url token for the unsubscribe link and `List-Unsubscribe` header of every email. Stored as is so each send can include it |
| `confirmed`         | boolean, default `false`            |                                                                                                                                                |
| `language`          | enumeration `en`/`es`, default `en` | Email language. `locale` is reserved by Strapi i18n                                                                                            |

Controller, service and router are the core factories: no custom logic.

`unique: true` is only Document Service validation (no database index), which is enough here because only the frontend writes.

## Permissions

No users-permissions role may touch subscribers: a public `create` would let anyone store a subscriber already confirmed or with tokens of their choosing, and `find` leaks email addresses. `src/migrations/subscriber-permissions.ts` removes any such permission on every boot. The frontend uses its API token.

## Typical consumer requests (frontend server, API token)

```http
POST /api/subscribers
{ "data": { "email": "ana@example.com", "confirmationToken": "<sha256 hex>", "unsubscribeToken": "<sha256 hex>", "confirmed": false, "language": "es" } }

GET /api/subscribers?filters[unsubscribeToken][$eq]=<sha256 of the token>
PUT /api/subscribers/:documentId    { "data": { "confirmed": true, "confirmationToken": null } }
DELETE /api/subscribers/:documentId
```

## Do not

- Grant any role permissions on subscribers.
- Return subscriber entries to browsers: only the frontend server reads them.
