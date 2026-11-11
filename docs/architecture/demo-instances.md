# Demo instance and new instances

Moved from `CLAUDE.md` (#113); the text of the first section is unchanged.

`compose.demo.yml` runs Postgres, this CMS and the micelio frontend from GHCR images (README, "Run your own site"). An `init` service generates the secrets once into a volume (`scripts/demo-secrets.js`); the frontend shares the CMS's network namespace so its server and the browser both use `http://localhost:1337`, and its distroless image loads the token with an inline Node loader. `MICELIO_DEMO` accepts `true`, `static` and `landing` (any other value disables it): `true` and `static` make `src/migrations/demo-seed.ts` write a neutral bilingual site once (content in `src/migrations/demo/content.ts`, covers generated as SVG; store marker, and never on an instance with articles); `landing` also sets the localized `homePage` of the default site to the showcase page in each language (#84). `scripts/demo-secrets.js` generates `cms.env`, `frontend.env`, `build.env` and `db_password`, creating each file only when missing and upgrading old volumes without rotating keys; it stops if an existing `cms.env` lacks `FRONTEND_API_TOKEN` or `DATABASE_PASSWORD`. `FRONTEND_API_TOKEN` and `BUILD_API_TOKEN` make `src/migrations/api-tokens.ts` create or update the `frontend` and the read-only `build` Custom API tokens with those keys and their permissions (the frontend's match micelio's `docs/security.md`; the model is in `docs/API_TOKENS.md`). The preview is on in the dynamic demo (#382): the `frontend` service sets `NUXT_PREVIEW_ADMIN_ORIGIN` to the admin's origin (`http://localhost:1337`, the CMS's `URL`), and with `MICELIO_DEMO=true` (not `static` or `landing`, which have no drafts) `ensureFrontendToken` adds `plugin::micelio.preview.exchange` to the token (`PREVIEW_FRONTEND_TOKEN_PERMISSIONS`, which a real site gets with `MICELIO_PREVIEW=true`, #387); every other instance keeps `FRONTEND_TOKEN_PERMISSIONS`. `compose.static.yml` and `compose.landing.yml` (#90, own projects `micelio-demo-static` and `micelio-demo-landing`, identical but for `MICELIO_DEMO` and `NUXT_PUBLIC_SITE_MODE`) extend `init`, `db` and `cms` from the demo compose with `MICELIO_DEMO=static`, a `build` service (micelio-builder `generate`, `network_mode: service:cms`, only `build.env` mounted through a volume `subpath`) writing to the `demo-site` volume, and a `site` service (`serve`) on `127.0.0.1:3000`; `demo/{static,landing}.env.example` hold the image and newsletter variables. `consolidateCategories` only runs on an instance that already has one of BogDev's categories, so new instances get none of them; tests that need them call `tests/helpers/bogdev-categories.ts`.

## The builder's last run (#405)

Since micelio#315 a static or landing build that cannot use the theme the site settings name fails
and leaves the site published before it.
The rebuild hook only starts the job, so the reason would stay in the builder's output.
The admin reads it from a file instead.

- **The wrapper.**
  `compose.static.yml` and `compose.landing.yml` run the builder through
  `scripts/builder-last-run.sh` in the `build` service
  (`builder-last-run.sh micelio-builder generate`),
  with the script mounted read-only from the repository.
  It passes stdout and stderr through, keeps the builder's exit code, and when the run ends writes
  `exit=`, `finished=`, `site_before=` (1 when `OUT_DIR`, `/out` by default, held a site before
  the run)
  and the stderr lines that contain `Static theme: ` or start with
  `micelio-builder: the generation failed; `, to `REBUILD_STATUS_FILE` (`/build-status/last-run`).
  The file is written beside its final name and renamed, so it is never half written.
  It filters nothing inside a line, so the file holds those lines as the builder wrote them
  (the CMS mounts it read-only); what reaches the admin is decided by the reader, below.
- **The volume.**
  `demo-build-status` is written by `build` and mounted read-only in `cms`.
  Docker creates it owned by root, so the `build-status` service (the `init` image) gives it to
  uid 1000, the builder's user, before the build starts.
  `site` does not mount it.
- **The reader.**
  `src/utils/rebuild-status.ts` reads at most 16 KiB of the file.
  Only lines that start with `Static theme: ` are read (five reasons at most), and none of their
  text reaches the page: each line must match, whole, one of the four shapes of micelio's
  `modules/theme/static-theme.ts`, and becomes a code of a closed list with a few values that are
  checked.
  `settings-unreadable` carries the HTTP status (three digits) when the line has one.
  `settings-invalid` carries nothing.
  `theme-refused` carries the switch's rule (`pin`, `unknown`, `code`, `off`, `tier`, `limit`,
  `registry`, `install`, `integrity`) and, for two rules, a detail that the switch's message gives
  when it is one of a fixed list: `pin` with `theme-id` (the line names a theme id that is not
  valid, or a version or digest with no id) and `registry` with `not-listed` or `not-public` (the
  registry answered that it does not list the version with this digest, or lists the theme as not
  public, which a server does not install: that rule is the switch's own).
  Any other message of the switch is matched and dropped, so the admin says why in the rule's words:
  a `pin` that fails says the id, version or digest is not accepted, and a `registry` says the
  theme could not be installed from the registry and names no cause: the rule also covers a package
  whose digest, size or attestation does not verify and an instance with no signer identity, and
  the network errors are free text that cannot be told apart.
  `theme-not-ready` carries the seconds waited.
  The theme id between the quotes is matched with the id rule of micelio
  (`THEME_ID` in `modules/theme/constants.ts`: 1 to 64 characters, lowercase letters and digits in
  groups split by single hyphens) so that the line parses, and is never passed on: the admin shows
  no theme id, since a valid id has the shape of a short secret too.
  Colour sequences are removed before matching.
  Any other line becomes the reason `unknown`, which the admin words as "see the builder's log".
  The sentences are in the admin's translations, built from the code.
  So there is no list of secrets to maintain: whatever the builder prints, a reason shows only a
  rule, a detail of the fixed list or a number.
  The builder's "generation failed" line is never shown, since it names the output path:
  it only sets `previousSiteKept`, when it says the volume keeps the site it held and the
  wrapper saw a site there before the run (`site_before=1`): the builder prints that line on every
  failure, a first build on an empty volume included.
  Any other exit says it did not report a kept site, instead of claiming one.
  The admin says the site is kept in the output volume, not that it is served: with `site` waiting
  for `build` to complete, after a `down` and `up` with a bad theme nothing serves the kept site
  until a build succeeds.
  The status file is opened without following links and must be a regular file; a file that cannot
  be read, or is not a status file, shows "cannot be read" instead of "has not run yet".
- **The route and the admin.**
  `GET /theme-picker/last-rebuild` (admin API, Super Admin only, like the picker's
  `/theme-picker/themes`) answers `{ configured, lastRebuild, unreadable }` and reads one small
  file:
  nothing in a request waits on the builder, which can be running.
  `src/admin/components/LastRebuild.tsx` shows it under the theme field:
  succeeded and when, or failed, the reasons (sentences built from the codes) and
  "The previous site is kept in the output volume."
  It reads again when the tab or window gets the focus back.
  A good run replaces the file, so it clears the failure.
- **Out of scope.**
  A stack that runs its builder elsewhere (a GitHub workflow) sets `REBUILD_STATUS_FILE` and
  mounts the file for the CMS itself (`docs/operate/configure.md`).
  The CMS never starts the builder and never reads its environment.
