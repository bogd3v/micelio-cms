# Site settings

Moved from `CLAUDE.md` (#113).

`api::site-setting` is a single type (no draft and publish, `name` and `description` localized in `en`/`es`) with the site's identity (URL, author, logo, favicon, default OG image, social links, contact emails, Buy Me a Coffee handle), `tagline` and `addressLocality` (both localized), `timezone` (IANA name, validated against the runtime's tz data by `src/utils/site-timezone.ts`, which also fixes its case: `america/bogota` is stored as `America/Bogota`; aliases such as `EST5EDT` stay as written; empty by default, and empty means UTC: the frontend applies that default, so no boot migration sets it and the stored value stays `null`. It is the zone the frontend formats article dates in, on the server and the client alike, and the one of the `datetime` attributes, feeds and JSON-LD, micelio#431. A site that formatted dates in another zone must set it before deploying the matching frontend, or its dates shift to UTC around midnight), `securityContact` (not localized, empty by default, at most 512 characters: one RFC 3986 `mailto:` address (optionally with `?subject=`) or `https://` URI without credentials, ASCII only, checked by `src/utils/site-security-contact.ts`, which also trims it; it becomes the `Contact` of the frontend's `/.well-known/security.txt`, RFC 9116, so **it is public**: never a private address), `privacyJurisdiction` (not localized, an enumeration whose only value today is `colombia`, empty by default: empty means a neutral privacy page that names no law, and `colombia` makes the frontend's privacy page cite Ley 1581 de 2012; no boot migration sets it, so each operator chooses it in the admin panel, and a new jurisdiction is a new enum value added by a minor release, micelio#430), and `modules` (`site.modules`), the booleans the frontend uses to turn features on, all `true` by default. `theme` (`site.theme`, not localized, empty by default) picks the frontend's theme and its bounded overrides from micelio's ADR 0005: `themeId` and `defaultMode` (slugs), `accentOverrides` (`{ mode, color }` with `#RRGGBB`) and `displayFont` (curated enum). Strapi checks formats only, plus `src/utils/site-theme.ts` (a Document Service middleware) for what the schema cannot: overrides without a mode or color (`required` is not applied in a nested component) and repeated modes; the frontend resolves the theme and the accent's contrast. `populate=*` does not reach `accentOverrides`: request `populate[theme][populate]=*`. Only the frontend's custom API token reads it (`find`): `src/migrations/site-settings.ts` removes any role permission on boot, and creates neutral values («Micelio», `url` from `FRONTEND_URL`, no author or contacts) when no document exists (afterwards the admin panel owns them; the media are uploaded by hand). The code carries no values of any one site (#83): `FRONTEND_URL` is required in production (`src/utils/frontend-url.ts` stops the boot without it), `EMAIL_FROM` falls back to `no-reply@<frontend host>`, the admin CSP takes the media origin from `R2_BASE_URL`, and the fediverse plugin requires `FEDIVERSE_ACTOR_IDENTIFIER`. `fediverse` (`site.fediverse`, not localized, empty by default) is the home of the fediverse actor's profile (#303): `username` (`^[a-z0-9_]+$`, at most 30 characters, the handle's `@user`), `displayName`, `summary` (plain text, at most 500 characters), `header` (an image), `discoverable` (default `true`), `sourceUrl` and `objectType` (`article` or `note`, default `note`: what the plugin sends articles as, [FEDIVERSE.md](../FEDIVERSE.md#object-shape-article-or-note-305), #305; changing it sends nothing); Strapi checks the formats and the Document Service rejects an invalid `username`. The frontend's request names what it reads (`SITE_POPULATE` in micelio), so the component is not in its response, which is unchanged, and `populate=*` reaches its fields but not its `header` (`populate[fediverse][populate]=*` does). Saving the settings in the default locale sends an `Update(Person)` to the followers. The `FEDIVERSE_ACTOR_USERNAME`, `_NAME`, `_SUMMARY` and `_SOURCE_URL` variables and `global.fediverseHeader` are deprecated fallbacks of these fields ([FEDIVERSE.md](../FEDIVERSE.md#actor-profile-in-the-site-settings-303)). `global` still carries the avatar (`favicon`) and, as a deprecated fallback, the display name and bio.

## The theme: pin, picker and who may change it

`site.theme` holds the theme the site renders (micelio ADR 0005, 0008 and 0009; #97).

**The fields.**

- `themeId`: a slug; empty means the instance's default theme.
- `themeVersion`: an **exact** semver version such as `1.2.0`, no range, no `latest`. A static site
  is regenerated on every publish, so a floating version would let publishing an article change how
  the site looks.
- `themeDigest`: the `sha256:` digest the registry's index gave for that version.
- `defaultMode`, `accentOverrides` and `displayFont`: the bounded overrides.
- Strapi checks the format only (regexes in `src/components/site/theme.json`, the same grammar as
  micelio's `THEME_VERSION` and `THEME_DIGEST`). Whether the theme exists and the digest matches is
  the frontend's check against the signed index.
- Existing documents are not touched: a site that never chose a theme keeps empty fields.
- `populate[theme][populate]=*` returns all of it.

**The picker.**

- `themeId` is the custom field `global::theme-picker`, registered in `register()` of
  `src/index.ts`; its input is `src/admin/components/ThemePicker.tsx`.
- It lists the registry's themes (id, highest published public release, tier, contract, whether it
  ships code) from `GET /theme-picker/themes` of the admin API (`src/utils/theme-picker-route.ts`).
  Picking one writes `themeId`, `themeVersion` and `themeDigest` together.
- The route reads the registry's `index:v1` anonymously (`src/utils/theme-index.ts`; the registry
  comes from `MICELIO_THEME_REGISTRY`, default `ghcr.io/bogd3v/micelio-themes`) and keeps it five
  minutes. It parses the shape of micelio's `modules/theme/registry/registry-index.ts`.
- It **does not verify the index signature**: the picker only lists. The frontend verifies the
  signed index and the package attestation before it installs anything, and refuses a pin the index
  does not list with that digest (ADR 0009, section 3).
- When the registry cannot be read the route answers `200` with `indexAvailable: false` and the
  field is a text input with the slug check, so editing never depends on the network.
- A newer version is only offered (a button "Move to X", same contract major); nothing updates by
  itself.

**The status part.**

- It shows the active theme, the last error and the code themes the image lacks, marked unavailable.
- It is built from `ThemeStatus` in `src/types/theme-registry.ts` and stays hidden:
  `readThemeStatus()` returns `null` until the frontend exposes its status (micelio#403).

**Who may change it.** Only the Super Admin (ADR 0009, "Who may change the theme"), in two layers.

- Stored permissions. `restrictThemeToSuperAdmin` (`src/migrations/theme-permissions.ts`) runs on
  every boot and removes `theme` and `theme.*` from the `fields` of `create` and `update` on the
  site settings for every admin role and admin API token but those of Super Admin. Editor and Author
  keep editing the rest, and the content manager drops the theme from what they send.
- Write time. The stored permissions are only as fresh as the last boot, so `restrictThemeWrites`
  (`src/utils/theme-access.ts`, a Document Service middleware) checks every `create`, `update` and
  `clone` during a request. These are the only Document Service actions that carry `data`; the
  content manager's clone route does not check the kind of the model.
- A role created or edited in the admin after boot has `theme` dropped from what it sends.
- Any API token (content API or admin, whoever owns it) that sends `theme` gets 403.
- Calls outside a request (boot, seeding) are not checked.
- The picker route answers 403 to any other role and 401 without an admin session.
- No content API token has `update` of the site settings: `src/migrations/api-tokens.ts` grants
  `find` only (`tests/theme-access.test.ts`).
- A change of the site settings fires the rebuild hook like any other save.

## The core's site and its url

`@micelio/strapi-plugin-core` has its own `site` type and creates the default site (`isDefault`, no host names) in its `bootstrap`, with no `url`: the core carries no site (standard, principle 2). Without a `url` the plugin's preview has no frontend to load and its host check skips `frontend-release-line` and `preview-frame-src`, so `src/migrations/default-site-url.ts` gives the default site one. It runs in this repository's `bootstrap`, after `seedSiteSettings` and `seedDemoContent`, and only when the default site's `url` is empty: it takes the `url` of `api::site-setting` in the default locale, else `FRONTEND_URL`, stores the origin (scheme, host, port; the path is dropped) and ignores a value that is not an `http(s)` URL, so with neither the site stays empty and the boot goes on. `FRONTEND_URL` is read as the environment holds it, without the development default of `src/utils/frontend-url.ts`. It logs one `[sites]` line when it writes and nothing on the next boot. A site that has a `url` is never touched: the admin owns it afterwards, and changing `api::site-setting`'s `url` later does not move it. The site setting stays the frontend's source of the rest of the identity until it moves into the core's site (#360, phase 2); host names stay empty, so the default site answers every host.
