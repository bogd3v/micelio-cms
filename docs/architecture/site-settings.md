# Site settings

Moved from `CLAUDE.md` (#113).

Since 0.7 the site settings are the attributes of the default site (`plugin::micelio.site`, edited in Content Manager → Site); until 0.6 they were the single type `api::site-setting`, which "The retired single type and the alias" below describes. The site (no draft and publish, `name` and `description` localized in `en`/`es`) holds the site's identity (URL, author, logo, favicon, default OG image, social links, contact emails, Buy Me a Coffee handle), `tagline` and `addressLocality` (both localized), `timezone` (IANA name, validated against the runtime's tz data by `src/utils/site-timezone.ts`, which also fixes its case: `america/bogota` is stored as `America/Bogota`; aliases such as `EST5EDT` stay as written; empty by default, and empty means UTC: the frontend applies that default, so no boot migration sets it and the stored value stays `null`. It is the zone the frontend formats article dates in, on the server and the client alike, and the one of the `datetime` attributes, feeds and JSON-LD, micelio#431. A site that formatted dates in another zone must set it before deploying the matching frontend, or its dates shift to UTC around midnight), `securityContact` (not localized, empty by default, at most 512 characters: one RFC 3986 `mailto:` address (optionally with `?subject=`) or `https://` URI without credentials, ASCII only, checked by `src/utils/site-security-contact.ts`, which also trims it; it becomes the `Contact` of the frontend's `/.well-known/security.txt`, RFC 9116, so **it is public**: never a private address), `privacyJurisdiction` (not localized, an enumeration whose only value today is `colombia`, empty by default: empty means a neutral privacy page that names no law, and `colombia` makes the frontend's privacy page cite Ley 1581 de 2012; no boot migration sets it, so each operator chooses it in the admin panel, and a new jurisdiction is a new enum value added by a minor release, micelio#430), and `modules` (`site.modules`), the booleans the frontend uses to turn features on, all `true` by default. `theme` (`site.theme`, not localized, empty by default) picks the frontend's theme and its bounded overrides from micelio's ADR 0005: `themeId` and `defaultMode` (slugs), `accentOverrides` (`{ mode, color }` with `#RRGGBB`) and `displayFont` (curated enum). Strapi checks formats only, plus `src/utils/site-theme.ts` (a Document Service middleware) for what the schema cannot: overrides without a mode or color (`required` is not applied in a nested component) and repeated modes; the frontend resolves the theme and the accent's contrast. `populate=*` does not reach `accentOverrides`: request `populate[theme][populate]=*`. Only the frontend's custom API token reads it (`find`): `src/migrations/site-settings.ts` removes any role permission on boot, and gives the default site a neutral description and the default locale, once, on a new instance (the name «Micelio» and the modules come from the core, the `url` from `src/migrations/default-site-url.ts`; no author or contacts; afterwards the admin panel owns them and the media are uploaded by hand). The single type is no longer seeded. The code carries no values of any one site (#83): `FRONTEND_URL` is required in production (`src/utils/frontend-url.ts` stops the boot without it), `EMAIL_FROM` falls back to `no-reply@<frontend host>`, the admin CSP takes the media origin from `R2_BASE_URL`, and the fediverse plugin requires `FEDIVERSE_ACTOR_IDENTIFIER`. `fediverse` (`site.fediverse`, not localized, empty by default) was the home of the fediverse actor's profile (#303); since #416 the plugin reads the default site's copy of it, so edit it there: `username` (`^[a-z0-9_]+$`, at most 30 characters, the handle's `@user`), `displayName`, `summary` (plain text, at most 500 characters), `header` (an image), `discoverable` (default `true`), `sourceUrl` and `objectType` (`article` or `note`, default `note`: what the plugin sends articles as, [FEDIVERSE.md](../FEDIVERSE.md#object-shape-article-or-note-305), #305; changing it sends nothing); Strapi checks the formats and the Document Service rejects an invalid `username`. The frontend's request names what it reads (`SITE_POPULATE` in micelio), so the component is not in its response, which is unchanged, and `populate=*` reaches its fields but not its `header` (`populate[fediverse][populate]=*` does). Saving the default site (`plugin::micelio.site`) sends an `Update(Person)` to the followers; saving this single type sends nothing. The `FEDIVERSE_ACTOR_USERNAME`, `_NAME`, `_SUMMARY` and `_SOURCE_URL` variables and `global.fediverseHeader` are gone (#307): the boot stops while a variable is set, and `src/migrations/fediverse-header.ts` copied the header ([FEDIVERSE.md](../FEDIVERSE.md#removal-of-the-fallbacks-307)). `global` still carries the avatar (`favicon`) and, as a fallback, the display name and bio.

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
- Separately, on a static or landing stack, the field shows how the builder's last run ended and,
  when a theme was refused, why (`LastRebuild.tsx`; the flow is in
  [demo-instances.md](demo-instances.md#the-builders-last-run-405)).

**Who may change it.** Only the Super Admin (ADR 0009, "Who may change the theme"), in two layers.

- Stored permissions. `restrictThemeToSuperAdmin` (`src/migrations/theme-permissions.ts`) runs on
  every boot and removes `theme` and `theme.*` from the `fields` of `create` and `update` on the
  the site (`plugin::micelio.site`) for every admin role and admin API token but those of Super Admin. Editor and Author
  keep editing the rest, and the content manager drops the theme from what they send.
- Write time. The stored permissions are only as fresh as the last boot, so `restrictThemeWrites`
  (`src/utils/theme-access.ts`, a Document Service middleware) checks every `create`, `update` and
  `clone` during a request. These are the only Document Service actions that carry `data`; the
  content manager's clone route does not check the kind of the model.
- A role created or edited in the admin after boot has `theme` dropped from what it sends.
- Any API token (content API or admin, whoever owns it) that sends `theme` gets 403.
- Calls outside a request (boot, seeding) are not checked.
- The picker route answers 403 to any other role and 401 without an admin session.
- No content API token has `update` of the site (the alias route reads only, and the core's `GET /api/micelio/sites` too): `src/migrations/api-tokens.ts` grants
  `find` only (`tests/theme-access.test.ts`).
- A change of the site fires the rebuild hook like any other save (`src/utils/rebuild-hook.ts` listens to `plugin::micelio.site`).
- The theme picker is the input of the site's `theme.themeId`: `src/utils/site-theme-component.ts` sets it, and the exact pin (a version without a range, a `sha256:` digest), on the core's `micelio-site.theme` while the host registers, because the core's component takes any text.

## The core's site and its url

`@micelio/strapi-plugin-core` has its own `site` type and creates the default site (`isDefault`, no host names) in its `bootstrap`, with no `url`: the core carries no site (standard, principle 2). Without a `url` the plugin's preview has no frontend to load and its host check skips `frontend-release-line` and `preview-frame-src`, so `src/migrations/default-site-url.ts` gives the default site one. It runs in this repository's `bootstrap`, after `seedSiteSettings` and `seedDemoContent`, and only when the default site's `url` is empty: it takes the `url` of `api::site-setting` in the default locale, else `FRONTEND_URL`, stores the origin (scheme, host, port; the path is dropped) and ignores a value that is not an `http(s)` URL, so with neither the site stays empty and the boot goes on. `FRONTEND_URL` is read as the environment holds it, without the development default of `src/utils/frontend-url.ts`. It logs one `[sites]` line when it writes and nothing on the next boot. A site that has a `url` is never touched: the admin owns it afterwards, and changing `api::site-setting`'s `url` later does not move it. Since 0.7 the readers are on the core's site: `GET /api/site-setting` answers from it and its values are copied from the single type at boot (below); host names stay empty, so the default site answers every host.

## Where each setting lives after the copy

`src/migrations/site-settings-to-site.ts` (#415, ADR-0017 section 4 and D3 of its amendment of 2026-10-26) copies every attribute of `api::site-setting` into the default site of the core, once. The single type is read by this copy and nothing else: `GET /api/site-setting` answers from the default site (below), the boot steps and the admin write the site, and an edit of the single type reaches nothing. The fediverse plugin (#416) reads `fediverse`, `name` and `description` of the default site, as it did since 0.7 began.

- **Which attributes.** The ones the single type declares, read from its runtime schema without the system fields Strapi adds (`createdBy`, `updatedBy`, `localizations`, the timestamps), so a field added to it is copied too. The site has a counterpart for each: the core declares all of them but `homePage`, which targets `api::page.page` and is added by `src/extensions/micelio/strapi-server.ts` (D5, next to the `articles` of `category` and `tag`). `tests/site-settings-to-site.test.ts` fails when an attribute of the single type has neither a counterpart nor a reason in the test.
- **Per locale.** `name`, `description`, `tagline`, `addressLocality` and `homePage` are localized: each locale of the single type (`en`, `es`) gives the site a row in that locale. The rest are not localized and come from the default locale; Strapi stores them in every row. Media, the `author`, `socialLinks`, `modules`, `theme` (with `accentOverrides`) and `fediverse` (with its `header`) travel with their values and not their row ids.
- **The fediverse profile goes below the Document Service.** It is written last, with `strapi.db` (a row for the component and its link, for each row of the site), because the fediverse package's username lock is a Document Service middleware that refuses a username going from empty to a value once the default site has a follower, and the package's boot step may have given it one before this step runs. `tests/fediverse-package.test.ts` ("copies the fediverse profile of the site settings into a default site that already has a follower") pins it.
- **Never over a value of the site.** An attribute is written only when the site's is empty or is what the core created the site with (the name `Micelio`, every module on, the default locale). One that differs is the operator's and stays (an attribute that is not localized counts as held when any row of the site holds it, whatever the default locale is); that includes the `url` that `src/migrations/default-site-url.ts` stored (the origin of the frontend), which runs first. The comparison cannot tell an operator who typed `Micelio` as the site's name from the default.
- **When it fails.** Three cases are logged and retried, not thrown: a core without an attribute of the single type, a missing default site, and a value the site refuses (stored before a constraint existed). Each is logged with `strapi.log.error`, naming the attributes and never their values, and the marker stays unset, so the next boot tries again; the attributes already written are then left alone, and a refused one does not keep the others out. While a value stays refused the marker is never set: every boot logs it again and reruns the copy, and a later edit of the single type still reaches the empty or default attributes of the site until the copy succeeds. A read that fails (the single type, the site, the default locale or a component schema) is not caught and still stops the boot. The fix for a missing attribute is a release of `@micelio/strapi-plugin-core`.
- **Once.** The store marker `core` / `migrations` / `site-settings-to-site` records that it ran; later boots return before reading anything, so a later edit of the single type (nothing makes one) is not copied, and neither is an edit of the site undone. A boot of an instance that never had the single type (a new one) finds no rows and sets no marker.
- **Not copied.** `slug`, `hosts`, `isDefault` and `editorialPolicy` exist only on the site and keep the core's values.
- `npm run test:upgrade` compares the name, the theme pin (`themeId`, `themeVersion`, `themeDigest`) and the fediverse `username` of both after an upgrade (`docs/architecture/testing.md`, "Upgrade check").

## The retired single type and the alias

ADR-0017 (D6) keeps `api::site-setting` for one release, hidden and never written, and removes it in 0.8, so the frontend of 0.6 keeps working while the CMS moves first.

- **Hidden.** Its `schema.json` sets `content-manager.visible` and `content-type-builder.visible` to `false`: no entry in the Content Manager or the Content-Type Builder, and Strapi gives the admin roles no permission on it, so even a Super Admin's write through the Content Manager's routes answers 403 (`tests/site-setting-alias.test.ts`, "a write to the single type is refused").
- **No router, no writer.** `src/api/site-setting/routes/site-setting.ts` declares one route, `GET /api/site-setting`, and not the core router: a `PUT`, `POST` or `DELETE` answers 405. Nothing in `src/` writes the single type; `src/migrations/site-settings-to-site.ts` and `src/migrations/default-site-url.ts` only read it, and `src/migrations/site-settings.ts` seeds the default site instead (a neutral description and the default locale, once: the store marker `core` / `migrations` / `site-seed`, set without writing on an instance that has rows in the single type, which is an upgrade).
- **The alias.** The controller and the service of `src/api/site-setting` read the default site (`isDefault`) through the Document Service with the caller's `locale`, `populate` and `fields`, sanitize the query and the output with the schema of the single type (so relations and private fields behave as in 0.6) and leave out `slug`, `hosts`, `isDefault` and `editorialPolicy`, which only a site has. The route keeps the action `api::site-setting.site-setting.find`, so the frontend token and the build token (`src/migrations/api-tokens.ts`) and a token created by hand keep working; the answer is `private, no-store` (`src/utils/cache-control.ts`). `tests/site-setting-alias.test.ts` compares it with answers recorded from the 0.6.0 image (`tests/fixtures/site-setting-0.6.0.json`, which says how it was recorded), `tests/response-fields-pages-site.test.ts` checks its fields against `src/constants/response-fields/site.ts`, and the contract suite of `bogd3v/micelio` reads it unchanged.
- **What moved to the site.** The theme rule (`src/migrations/theme-permissions.ts`, `src/utils/theme-access.ts`), the theme picker and the pin of the theme (`src/utils/site-theme-component.ts`), the validators of accent overrides, timezone and security contact (the Document Service middleware in `src/index.ts`), the rebuild hook and the cache rule. `src/utils/rebuild-status.ts` reads the builder's log, whose lines still say `site-setting.theme`, because the builder (the frontend) still reads the alias.
