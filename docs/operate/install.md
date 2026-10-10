# Install the CMS

**Kind:** how-to. Goal: a running CMS from the published image, first as a local demo and then as a node you operate.

## Try it: the demo Compose files

The repository carries three Compose files. Each starts PostgreSQL, this CMS and the [frontend](https://github.com/bogd3v/micelio) with a small bilingual demo blog.

| Profile | Command                                    | Choose it when                                                                         |
| ------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Dynamic | `docker compose -f compose.demo.yml up`    | You want accounts, comments, newsletter, drafts and search served live by the frontend |
| Static  | `docker compose -f compose.static.yml up`  | You want plain files a CDN can serve; the CMS is only needed at build time             |
| Landing | `docker compose -f compose.landing.yml up` | Like static, with a showcase page as the home instead of the blog list                 |

The step-by-step guide for the dynamic demo is in the [frontend's install guide](https://github.com/bogd3v/micelio/blob/main/docs/operate/install.md). In short: the blog is at <http://localhost:3000>, the admin at <http://localhost:1337/admin> (Strapi asks for the first administrator on the first visit), `down` stops the stack and keeps the data, and `down -v` deletes everything.

The first run generates Strapi's keys, the database password and the frontend's API token into the `demo-secrets` volume (`scripts/demo-secrets.js`). The CMS seeds the demo content once on an empty database (`MICELIO_DEMO`). The demo is not a deployment: ports are bound to `127.0.0.1`, and there is no TLS, no email and no backup.

The static and landing profiles have their own project names, so they never share volumes, secrets or the seed with the dynamic demo or each other. Run one stack at a time: all publish the site on port 3000. How they rebuild is in [Static sites](https://github.com/bogd3v/micelio/blob/main/docs/operate/static-site.md).

## Run it as a node

A node is the CMS image, a PostgreSQL database and a place for the uploads. Any host that runs containers works: nothing in the image depends on a platform, a reverse proxy or a provider.

1. **Pick an image tag.** The image is `ghcr.io/bogd3v/micelio-cms`. Pin an exact version (`X.Y.Z`) as [Upgrade](upgrade.md#image-tags) explains, and [verify it](verify-image.md) if you want to check where it came from.
2. **Create the database.** PostgreSQL 18, with a database and a user the CMS can own. SQLite is for development and tests only.
3. **Generate the secrets.** `node scripts/generate-keys.js` prints the six Strapi values; keep them in your secret store, not in the repository.
4. **Set the environment.** The required variables are in [Configure](configure.md#required). A production boot stops with a message that names a missing required value.
5. **Mount the uploads.** Give the container a persistent volume at `/app/public/uploads` (the default `UPLOAD_PATH`), or set the `R2_*` variables to use an S3-compatible bucket instead. Without either, uploaded files disappear when the container is replaced.
6. **Start the container** and wait for `GET /_health` to answer `204`. The image's `HEALTHCHECK` probes the same route, and its start period covers a slow first boot.
7. **Create the first administrator** at `/admin`, then turn on only the modules whose services you have set up, in the site settings.

Put a TLS-terminating proxy in front if the CMS is public, and tell the CMS how many proxies there are (`TRUST_PROXY`, see [Configure](configure.md#rate-limiting)). The CMS's public URL goes in `URL`, the frontend's in `FRONTEND_URL`.

### What the image contains

A multi-stage build keeps the final image small: it holds the compiled JavaScript (`dist/config`, `dist/src`), the admin build (`dist/build`), the fediverse plugin's bundle, `database/` and `scripts/`, and no source or dev dependencies. It runs under `tini` as the unprivileged `node` user; `docker-entrypoint.sh` first fixes the ownership of `/app/public/uploads` and `/app/.tmp`, so a volume created as root still works. The port is 1337. The health check uses busybox `wget`, because the image has no `curl`.

## Next

[Configure](configure.md) every variable, [back up](backup.md) before you put real content in, and read [Upgrade](upgrade.md) before the first update. When something fails, see [Troubleshooting](troubleshooting.md).
