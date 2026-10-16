# Subscribers

Moved from `CLAUDE.md` (#113); the text is unchanged. The procedure is the `strapi-subscriber` skill.

`api::subscriber` only stores newsletter subscriptions (no draft and publish, core controller and service). The frontend server owns the flow and writes them with its API token, storing the confirmation and unsubscribe tokens and the email `language` (`locale` is reserved by i18n). `src/migrations/subscriber-permissions.ts` removes any role permission on subscribers on boot. Details in the `strapi-subscriber` skill.

## Field rules

No users-permissions role reads or writes subscribers: `src/migrations/subscriber-permissions.ts` removes their permissions on every boot. The frontend's API token (`FRONTEND_API_TOKEN`) is the only API caller, with `find`, `create`, `update` and `delete` (`src/migrations/api-tokens.ts:32-35`). The token can read every attribute, and it can filter by any of them, the tokens included (`strapi-subscriber` skill).

| Attribute           | Type and constraints                           | Frontend token | Notes                                                                           |
| ------------------- | ---------------------------------------------- | -------------- | ------------------------------------------------------------------------------- |
| `email`             | email, required, `unique`                      | read, write    | Personal. `unique` is checked by the Document Service only, not by the database |
| `confirmationToken` | string                                         | read, write    | Restricted: a secret until the subscriber confirms; cleared on confirmation     |
| `unsubscribeToken`  | string, `unique`                               | read, write    | Restricted: the link in every newsletter. Looked up by value on unsubscribe     |
| `confirmed`         | boolean, required, default `false`             | read, write    |                                                                                 |
| `language`          | enumeration `en`, `es`, required, default `en` | read, write    | The language of the emails. `locale` is reserved by i18n                        |

The tokens are not `private` in the schema (`src/api/subscriber/content-types/subscriber/schema.json`), so they are returned to the frontend's token. The frontend generates the tokens, emails them and stores their SHA-256 hex digest (bogd3v/micelio#540, frontend 0.2.0); the CMS generates and returns none and stores what it is given. Rows written before that held the token itself, so `src/migrations/hash-subscriber-tokens.ts` hashes, on every boot, each token that is not already 64 lowercase hex characters (the same SHA-256 hex as the frontend's `hashToken`). It is idempotent, rewrites in place and cannot be undone. The emailed links keep working with frontend 0.2.0 or later, which looks a token up by its hash and falls back to the plain value; frontend 0.1.x looks up the plain value, so its links break, and each boot also hashes the plain tokens 0.1.x keeps writing. That is why the frontend is upgraded first ([upgrade.md](../operate/upgrade.md)). The migration reads only rows with a token and updates a token only if it still holds the value read, so it never overwrites a concurrent write. See [data.md](../security/data.md).
