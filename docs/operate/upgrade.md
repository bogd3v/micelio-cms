# Upgrade the CMS

**Kind:** how-to. Goal: move a running CMS from one release to a newer one without losing content, in the order that keeps the site working.

The rules come from [ADR 0010](https://github.com/bogd3v/micelio/blob/main/docs/adr/0010-semantic-versioning.md) and section 7 of the [engineering standard](../engineering-standard.md). Read the release notes of the version you move to before you start.

## The rules

- **One release line.** `micelio` (the frontend) and `micelio-cms` (this CMS) share MAJOR and MINOR; each has its own PATCH. "Micelio 1.4" is any `micelio 1.4.z` with any `micelio-cms 1.4.z`.
- **CMS first.** Upgrade the CMS, then the frontend. The CMS of a release line also serves the frontend of the previous MINOR, so the site keeps working between the two steps.
- **Within a MAJOR, no manual step.** The new version runs its boot migrations when it starts. They are idempotent, so a restart that stops halfway is safe to repeat. Across a MAJOR the release notes give the order and any step you must do by hand.
- **Going back is not supported across a MINOR.** Restore the backup you took before the upgrade instead.
- **Only the latest release line gets fixes**, security fixes included.
- **Before 1.0.0**, a breaking change raises the second number (`0.y.z`), so read the notes of every `0.y` you cross.

## 1. Read the release notes

Each GitHub release starts with its **Upgrade notes**, written by hand. It states the breaking changes, the theme contract it implements, the frontend line it was tested with and the minimum Node and PostgreSQL versions. Check your PostgreSQL version against the last one before you pull the image.

## 2. Back up

Back up the database and the uploads, and keep the current environment values. See [Backup](backup.md).

## 3. Pull and start the new image

Use the same environment and volumes. Wait for `GET /_health` to answer `204`: the migrations run on this boot, and the health check does not pass until the server is listening. Then open `/admin` and check one article.

If it does not come up, read the logs, fix the missing variable or the database access, and start it again. Do not roll the image back across a MINOR: restore the backup of step 2 instead.

## 4. Upgrade the frontend

Then upgrade the frontend as its own [upgrade guide](https://github.com/bogd3v/micelio/blob/main/docs/operate/upgrade.md) says.

## Image tags

The image is `ghcr.io/bogd3v/micelio-cms`. Each release `vX.Y.Z` publishes these tags:

| Tag                          | Moves                       | Use it for                                                 |
| ---------------------------- | --------------------------- | ---------------------------------------------------------- |
| `X.Y.Z`, for example `0.1.0` | Never                       | An exact version. Pin production to this.                  |
| `X.Y`, for example `0.1`     | With each PATCH of the line | Following the patches of a line without a MINOR change.    |
| `latest`                     | With each stable release    | The newest stable release. It may be a new MINOR or MAJOR. |
| `edge`                       | With each merge to `main`   | Testing only. Not a release.                               |
| A commit SHA                 | Never                       | A specific build of `main`.                                |

A release candidate, `vX.Y.Z-rc.N`, moves neither `X.Y` nor `latest`. A published version never changes: a bad release is fixed by the next patch. [Verify an image](verify-image.md) before you run it if you want to check where it was built.
