# The frontend's API token

How the frontend server reads content from this CMS. This is the security model; the reporting policy is in [`SECURITY.md`](../SECURITY.md). The frontend's side of the contract is `docs/security.md` in micelio, which must keep matching `src/migrations/api-tokens.ts`.

The frontend server reads some content with a **custom** API token (Settings → API Tokens) instead of a role, so that content stays off the public API. No role has permissions on it: a migration removes them on every boot, and a request without the token gets 403.

| Content type   | Token permissions                                          | Roles cleared by                           |
| -------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `site-setting` | `find` (identity, modules and theme)                       | `src/migrations/site-settings.ts`          |
| `page`         | `find` (also the read-only `build` token)                  | `src/migrations/page-permissions.ts`       |
| `subscriber`   | what the newsletter flow needs (`strapi-subscriber` skill) | `src/migrations/subscriber-permissions.ts` |

The site's theme (`theme` in `site-setting`) is covered by the same `find`; it needs no permission of its own. Its values only pick an installed theme and bounded overrides, and the frontend re-serializes them instead of injecting the stored strings (micelio ADR 0005).

Instead of creating it by hand, an instance can set `FRONTEND_API_TOKEN` (32+ random characters, the same value as the frontend's `NUXT_STRAPI_API_TOKEN`): on every boot `src/migrations/api-tokens.ts` creates or updates a Custom token named `frontend` with that key and exactly the permissions the frontend documents (`docs/security.md` in micelio), and resets them if someone widened them. Rotating it means changing the variable on both sides. An instance that does not set it keeps a token created by hand. Both tokens have `find` on authors so `article.author` survives Strapi's relation sanitizer; `author.email` is private and never returned. When a permission is added to `FRONTEND_TOKEN_PERMISSIONS` (as `api::author.author.find` was in #93), add it by hand to any token created by hand too.

A static or landing site's build (micelio ADR 0006) reads content with a second token: `BUILD_API_TOKEN` creates a Custom token named `build` with `find` on articles, categories, tags, authors, About, site settings and pages, nothing else. API tokens never get drafts (`src/utils/drafts-access.ts`), so it reads published content only. Both tokens are defined in `src/migrations/api-tokens.ts`.

Give each token only the permissions it needs, and rotate it if it leaks.
