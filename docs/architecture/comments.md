# Comments plugin

Moved from `CLAUDE.md` (#113); the text is unchanged. The fediverse side is in [FEDIVERSE.md](../FEDIVERSE.md); the procedure is the `strapi-comments` skill.

`strapi-plugin-comments` returns pending comments from its public endpoints; `src/middlewares/hide-unapproved-comments.ts` hides them, deciding from the database by comment id (the plugin accepts `omit` and `fields`, so the response can lack `approvalStatus`). Its responses also pass through a fixed zod schema that drops unknown attributes, so `src/middlewares/fediverse-comment-fields.ts` re-attaches `fediverseUri`/`fediverseActorHandle` after the plugin responds. Extend the comments schema through `src/extensions/comments/strapi-server.ts` (a `schema.json` would replace all the plugin's attributes). Most keys in the `comments` block of `config/plugins.ts` are inert. That includes `blockedAuthorProps`, which the public read routes do not apply, so `src/middlewares/strip-comment-author-email.ts` removes `author.email` from every response of the plugin's public API (a role allowed to read comments would otherwise get every commenter's address; `autopopulate` still asks for it, the moderators' admin views need it). Test: `tests/comments-author-email.test.ts`.

## Reply notifications are off

`strapi-plugin-comments` emails the author of a parent comment when someone replies. A guest's address is never verified, so anyone could make the site send mail to any address, with text of their choice and the super admin's address as sender. `src/extensions/comments/strapi-server.ts` replaces `sendResponseNotification` with a no-op. A notification for registered readers only (confirmed address, approved reply, escaped template, `EMAIL_FROM` as sender) can be added later as its own feature. Test: `tests/comments-api.test.ts`.

## Field rules

The plugin's mapper (`Vm` in `node_modules/strapi-plugin-comments/dist/server/index.js`) moves the author attributes `authorUser`, `authorId`, `authorName`, `authorEmail` and `authorAvatar` into one `author` object. Read rules, as far as this repository checks them:

| Field                                       | Public read routes                                                                                                       | Moderators in the admin panel | Note                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------- |
| `author.email` (`authorEmail`)              | **Never**: removed by `src/middlewares/strip-comment-author-email.ts` (`src/utils/comment-author.ts`)                    | Returned                      | Test: `tests/comments-author-email.test.ts` |
| `author.name`, `author.avatar`, `author.id` | Returned with the comment                                                                                                | Returned                      | Not restricted by this repository           |
| The comment itself (`approvalStatus`)       | Pending and rejected comments are removed, whatever fields are asked for (`src/middlewares/hide-unapproved-comments.ts`) | Not covered here              | Test: `tests/comments-api.test.ts`          |

- The frontend's token may post (`plugin::comments.client.post`, `src/migrations/api-tokens.ts:31`). `approvalStatus` is set by the server, not taken from the body (ASVS V15.3.3, [asvs.md](../security/asvs.md)).
- `strip-comment-author-email` runs on every response of the plugin's public API, bare arrays, single comments, `data` and nested `children` included (`stripAuthorEmails`).
- Account deletion keeps the comments and clears the link to the reader, the email and the avatar (see [ACCOUNTS.md](../ACCOUNTS.md)).
- The data level of each field is in [data.md](../security/data.md). The per-route field list of the plugin was not traced beyond these rows.
