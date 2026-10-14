# Comments plugin

Moved from `CLAUDE.md` (#113); the text is unchanged. The fediverse side is in [FEDIVERSE.md](../FEDIVERSE.md); the procedure is the `strapi-comments` skill.

`strapi-plugin-comments` returns pending comments from its public endpoints; `src/middlewares/hide-unapproved-comments.ts` hides them. Its responses also pass through a fixed zod schema that drops unknown attributes, so `src/middlewares/fediverse-comment-fields.ts` re-attaches `fediverseUri`/`fediverseActorHandle` after the plugin responds. Extend the comments schema through `src/extensions/comments/strapi-server.ts` (a `schema.json` would replace all the plugin's attributes). Most keys in the `comments` block of `config/plugins.ts` are inert.

## Reply notifications are off

`strapi-plugin-comments` emails the author of a parent comment when someone replies. A guest's address is never verified, so anyone could make the site send mail to any address, with text of their choice and the super admin's address as sender. `src/extensions/comments/strapi-server.ts` replaces `sendResponseNotification` with a no-op. A notification for registered readers only (confirmed address, approved reply, escaped template, `EMAIL_FROM` as sender) can be added later as its own feature. Test: `tests/comments-api.test.ts`.
