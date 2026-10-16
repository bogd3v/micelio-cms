# Upgrade the CMS

**Kind:** how-to. Goal: move a running CMS from one release to a newer one without losing content, in the order that keeps the site working.

The rules come from [ADR 0010](https://github.com/bogd3v/micelio/blob/main/docs/adr/0010-semantic-versioning.md) and section 7 of the [engineering standard](../engineering-standard.md). Read the release notes of the version you move to before you start.

## The rules

- **One release line.** `micelio` (the frontend) and `micelio-cms` (this CMS) share MAJOR and MINOR; each has its own PATCH. "Micelio 1.4" is any `micelio 1.4.z` with any `micelio-cms 1.4.z`.
- **CMS first**, unless the release notes say otherwise. Upgrade the CMS, then the frontend. The CMS of a release line also serves the frontend of the previous MINOR, so the site keeps working between the two steps. The release that adds the subscriber token migration is the exception: the frontend goes first (see [Migrations that rewrite data](#migrations-that-rewrite-data)).
- **From 1.0.0, within a MAJOR, no manual step.** The new version runs its boot migrations when it starts. They are idempotent, so a restart that stops halfway is safe to repeat. Across a MAJOR the release notes give the order and any step you must do by hand.
- **Going back is not supported across a MINOR.** Restore the backup you took before the upgrade instead.
- **Only the latest release line gets fixes**, security fixes included.
- **Before 1.0.0 nothing is stable.** A breaking change raises the second number (`0.y.z`) and may remove or rename a contract (content types, the API, the theme contract, environment variables, image names) without a deprecation period. Read the notes of every `0.y` you cross, and pin `X.Y.Z` instead of `latest` or `X.Y`. The guarantees in the other rules (the CMS also serving the previous MINOR, migrations with no manual step, deprecation before removal) are the target from 1.0.0; before it, the release notes say what holds.

## Migrations that rewrite data

Some boot migrations rewrite stored data in place. They run on every boot, are idempotent (a second run changes nothing), and cannot be undone, so back up first (step 2). Two releases add one each: the reader token migration and the subscriber token migration.

**Exception: frontend first.** The usual order is CMS first, but the release that adds `hash-subscriber-tokens` reverses it. Upgrade the frontend to 0.2.0 or later, then back up (step 2), then upgrade the CMS (step 3). Frontend 0.1.x generates UUID tokens and stores them in the clear, so with this migration:

- every unsubscribe and confirmation link already emailed stops working for frontend 0.1.x, which looks tokens up in the clear;
- each restart also hashes the plain tokens that 0.1.x keeps writing, so links emailed after the upgrade break too.

Frontend 0.2.0 or later looks a token up by its hash first and falls back to the plain value, so it works with old and migrated data. The frontend may drop that fallback in a later release.

- **Reader tokens** (`src/migrations/hash-user-tokens.ts`) replace the email confirmation tokens and password reset codes in `up_users` with their SHA-256 hex. Links and reset codes sent before the upgrade keep working, because lookups hash what they receive. Going back to the previous image runs, but the older code looks tokens up in plain text, so only the links pending at that moment stop working and their owners ask for a new one; restore the backup to keep them.
- **Subscriber tokens** (`src/migrations/hash-subscriber-tokens.ts`) replace the confirmation and unsubscribe tokens in the subscriber table the same way. Going back to the previous CMS image runs fine, because the old CMS never reads token values, but the links of frontend 0.1.x stay broken.

In a rolling deploy, stop the old CMS instances first: an old image keeps writing and looking up plain tokens until the new image has booted, and none of them should run next to a migrated database. The rewrites are irreversible; a rollback restores the code, not the plain values.

## 1. Read the release notes

Each GitHub release starts with its **Upgrade notes**, written by hand. It states the breaking changes, the theme contract it implements, the frontend line it was tested with and the minimum Node and PostgreSQL versions. Check your PostgreSQL version against the last one before you pull the image.

## 2. Back up

Back up the database and the uploads, and keep the current environment values. See [Backup](backup.md).

## 3. Pull and start the new image

Use the same environment and volumes. Wait for `GET /_health` to answer `204`: the migrations run on this boot, and the health check does not pass until the server is listening. Then open `/admin` and check one article.

If it does not come up, read the logs, fix the missing variable or the database access, and start it again. Do not roll the image back across a MINOR: restore the backup of step 2 instead.

**Purge of unconfirmed accounts and subscriptions.** From the release that adds `UNCONFIRMED_RETENTION_DAYS`, a daily job (not at boot) deletes reader accounts and newsletter subscriptions that were never confirmed and are older than that many days (default 30). The first run after the upgrade deletes everything already past the limit, and it cannot be undone: take the backup of step 2 first. Set `UNCONFIRMED_RETENTION_DAYS=0` before starting the new image to keep them. Confirmed accounts and subscribers, admin-created users and blocked users are never touched. Accounts are skipped too while the `email_confirmation` setting of users-permissions is off.

## 4. Upgrade the frontend

Then upgrade the frontend as its own [upgrade guide](https://github.com/bogd3v/micelio/blob/main/docs/operate/upgrade.md) says.

## Image tags

The image is `ghcr.io/bogd3v/micelio-cms`. Each release `vX.Y.Z` publishes these tags:

| Tag                          | Moves                       | Use it for                                                                                    |
| ---------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `X.Y.Z`, for example `0.1.0` | Never                       | An exact version. Pin production to this.                                                     |
| `X.Y`, for example `0.1`     | With each PATCH of the line | Following the patches of a line without a MINOR change.                                       |
| `latest`                     | With each release           | The newest release. It may be a new MINOR or MAJOR, and before 1.0.0 it may break your setup. |
| `edge`                       | With each merge to `main`   | Testing only. Not a release.                                                                  |
| A commit SHA                 | Never                       | A specific build of `main`.                                                                   |

A release candidate, `vX.Y.Z-rc.N`, moves neither `X.Y` nor `latest`. A published version never changes: a bad release is fixed by the next patch. [Verify an image](verify-image.md) before you run it if you want to check where it was built.
