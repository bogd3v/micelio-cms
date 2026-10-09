# Subscribers

Moved from `CLAUDE.md` (#113); the text is unchanged. The procedure is the `strapi-subscriber` skill.

`api::subscriber` only stores newsletter subscriptions (no draft and publish, core controller and service). The frontend server owns the flow and writes them with its API token, storing the confirmation and unsubscribe tokens and the email `language` (`locale` is reserved by i18n). `src/migrations/subscriber-permissions.ts` removes any role permission on subscribers on boot. Details in the `strapi-subscriber` skill.
