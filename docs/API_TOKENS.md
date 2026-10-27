# The frontend's API token

How the frontend server reads content from this CMS. This is the security model; the reporting policy and scope are in [`security.md`](security.md). The frontend's side of the contract is `docs/security.md` in micelio, which must keep matching `src/migrations/api-tokens.ts`.

The frontend server reads some content with a **custom** API token (Settings → API Tokens) instead of a role, so that content stays off the public API. No role has permissions on it: a migration removes them on every boot, and a request without the token gets 403.

| Content type   | Token permissions                                          | Roles cleared by                           |
| -------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `site-setting` | `find` (identity, modules, theme and privacy jurisdiction) | `src/migrations/site-settings.ts`          |
| `page`         | `find` (also the read-only `build` token)                  | `src/migrations/page-permissions.ts`       |
| `subscriber`   | what the newsletter flow needs (`strapi-subscriber` skill) | `src/migrations/subscriber-permissions.ts` |

The site's theme (`theme` in `site-setting`) is covered by the same `find`; it needs no permission of its own. Its values only pick an installed theme and bounded overrides, and the frontend re-serializes them instead of injecting the stored strings (micelio ADR 0005).

Instead of creating it by hand, an instance can set `FRONTEND_API_TOKEN` (32+ random characters, the same value as the frontend's `NUXT_STRAPI_API_TOKEN`): on every boot `src/migrations/api-tokens.ts` creates or updates a Custom token named `frontend` with that key and exactly the permissions the frontend documents (`docs/security.md` in micelio), and resets them if someone widened them. Rotating it means changing the variable on both sides. An instance that does not set it keeps a token created by hand. Both tokens have `find` on authors so `article.author` survives Strapi's relation sanitizer; `author.email` is private and never returned. When a permission is added to `FRONTEND_TOKEN_PERMISSIONS` (as `api::author.author.find` was in #93), add it by hand to any token created by hand too.

The frontend token also carries `plugin::micelio.preview.draft` (never `plugin::micelio.preview.exchange` in the default list, which stays an opt-in: a site that turns the preview on sets `MICELIO_PREVIEW=true`, and the demo, `MICELIO_DEMO=true`, gets it too; both use `PREVIEW_FRONTEND_TOKEN_PERMISSIONS`, only the exact string `true` counts, and any other boot resets the token without it, as [Configure](operate/configure.md#preview) says), even when the preview is off: at publish the CMS measures the page through the frontend, which reads the draft with this token (micelio ADR 0019, amendment of 2026-10-25). `@micelio/strapi-plugin-core` registers the action, so the boot creates the token with it, like every other listed action; an action no installed plugin registers stops the boot. A token created by hand needs it added under Settings → API Tokens → Plugin: Micelio.

A static or landing site's build (micelio ADR 0006) reads content with a second token: `BUILD_API_TOKEN` creates a Custom token named `build` with `find` on articles, categories, tags, authors, About, site settings and pages, nothing else. API tokens never get drafts (`src/utils/drafts-access.ts`), so it reads published content only. Both tokens are defined in `src/migrations/api-tokens.ts`.

Give each token only the permissions it needs, and rotate it if it leaks.

## Lifetime and rotation

The decision to keep these tokens without a lifespan, the 90-day rotation schedule and the forwarder secret are recorded in `bogd3v/micelio`: `docs/adr/0012-static-cms-credentials.md` (ADR 0012) and `docs/security.md`, section "Lifetime and rotation of the CMS credentials". This section keeps what is specific to this repository. It is an accepted risk for ASVS V13.2.1 ([asvs.md](security/asvs.md)).

What this repository does with the tokens:

- `ensureEnvToken` creates the `frontend` and `build` tokens with `lifespan: null` (`src/migrations/api-tokens.ts:150`). On later boots it writes only the key and the permissions, never `lifespan` or `expiresAt` (`:168-175`). Strapi rejects a token once its `expiresAt` has passed (`checkExpiry` in `node_modules/@strapi/admin/dist/server/server/src/strategies/api-token-utils.js`).
- A finite lifespan would need a manual step at every renewal, on both sides; the boot sets none for that reason (ADR 0012).
- A new value does not revive an expired token, because the boot never clears `expiresAt`. If someone set a lifespan on `frontend` by hand, delete that token in the admin panel instead; the next boot creates it again from `FRONTEND_API_TOKEN`.
- Each token row holds one key, stored as a hash. A new value replaces the old one at the CMS restart, so the frontend keeps the old value until it restarts with the new one.

Compensating controls:

- Custom tokens with only the listed permissions, reset on every boot. `build` can only `find`; `frontend` also looks subscribers up (`find`, and `lookup` for `POST /api/subscribers/lookup`), creates, updates and deletes them, posts comments and may call `plugin::micelio.preview.draft` (`FRONTEND_TOKEN_PERMISSIONS`; with `MICELIO_PREVIEW=true` or `MICELIO_DEMO=true` also `plugin::micelio.preview.exchange`). Neither reads drafts through the content types (`src/utils/drafts-access.ts`); the preview's draft route serves only the one document that a preview grant names, and it and the exchange are the only content API routes where that guard lets a token's request read a draft (micelio ADR 0019, `docs/architecture/drafts.md`).
- Server-to-server only. The frontend sends its copy from its server code, never from the browser, and the build uses its copy in the generate step (`bogd3v/micelio` `docs/security/keys.md`).
- Each key is stored as an HMAC-SHA512 keyed by `API_TOKEN_SALT` (`api-token.js`, `hash`). The encrypted copy the admin panel can show is not sent anywhere.
- Each token has its own rate limit, `RATE_LIMIT_TOKEN` (6000 requests per 60 seconds by default). See [RATE_LIMITING.md](RATE_LIMITING.md).
- The other secrets are environment variables and never in the repository. The production boot refuses an empty, placeholder or short Strapi key and the example database password (`src/utils/secrets.ts`); it does not check the SMTP, bucket, Umami or rebuild-hook values. The general policy is in [keys.md](security/keys.md).

Rotating `FRONTEND_API_TOKEN` here:

1. Generate 32 random bytes with `openssl rand -base64 32` (44 characters; the token needs at least 32, `src/migrations/api-tokens.ts:77`). Do not reuse one of the Strapi secrets that `npm run generate:keys` prints.
2. Set `FRONTEND_API_TOKEN` to it and restart the CMS. The boot logs `[api-tokens] updated the frontend API token`, and the old value stops working at once.
3. Set `NUXT_STRAPI_API_TOKEN` in the frontend to the same value and restart the frontend. Until it restarts, its content requests fail with 401; the order is in `bogd3v/micelio` `docs/security.md`.
4. Remove the old value from the environment and the secret store.

Rotate `RATE_LIMIT_FORWARDER_SECRET` here together with `NUXT_STRAPI_FORWARDER_SECRET` in the frontend, as `bogd3v/micelio` `docs/security.md` says.

A token created by hand (no `FRONTEND_API_TOKEN` set) is rotated in the admin panel.

Rotating `BUILD_API_TOKEN` is the same, with the build's copy of the value (its GitHub secret, `bogd3v/micelio` `docs/security/keys.md`) and a new build afterwards.
