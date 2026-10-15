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

The tokens are not `private` in the schema (`src/api/subscriber/content-types/subscriber/schema.json`), so they are returned to the frontend's token. Whether they are stored hashed is decided by the frontend; see [data.md](../security/data.md).
