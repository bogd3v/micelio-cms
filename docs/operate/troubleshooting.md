# Troubleshooting the CMS

**Kind:** how-to. Goal: find the cause of a CMS that does not start or does not behave.

## The container stops at boot

In production a missing required value stops the boot with a message that names it. Read the first lines of the log and compare with [Configure](configure.md#required). The common ones are `APP_KEYS` and the other Strapi keys, the database settings and `FRONTEND_URL`.

## The health check never passes

`GET /_health` answers `204` once the server is listening, outside `/api` and with no permissions.

```bash
curl -i http://localhost:1337/_health
```

Check, in this order: the application logs for a startup error; that the database is reachable from the container (host, credentials, `DATABASE_SSL`); that every required variable is set. The first boot after an upgrade runs migrations and can take longer: the image's health check allows a start period for it.

## `The upload folder (/app/public/uploads) doesn't exist or is not accessible`

Strapi's local upload provider needs the directory at startup. The image creates it, and its entrypoint fixes the ownership of a volume mounted as root. If you still see the error, use the current image, and check that the mount targets `/app/public/uploads` and that `UPLOAD_PATH` has that value.

## Uploaded files disappear after a deploy

The uploads are not on a persistent volume. Mount a volume at `/app/public/uploads`, or use an S3-compatible bucket (`R2_*`). Files already lost can only come from a backup ([Backup](backup.md)).

## 502 or the site is unreachable behind a proxy

Check that the proxy forwards to container port `1337`, that DNS points to the proxy, and that the TLS certificate was issued. Then check the CMS sees the right client address and protocol (`TRUST_PROXY`, `TRUST_PROXY_PROTOCOL`): see `docs/RATE_LIMITING.md`.

## Every visitor is rate limited together

The CMS sees the proxy's address instead of the client's. Set `TRUST_PROXY` to the number of proxies in front of it and make the proxy overwrite the forwarding header. See [Configure](configure.md#rate-limiting).

## Federation links use `http`

The CMS does not follow `X-Forwarded-Proto`. Keep `TRUST_PROXY_PROTOCOL` at its default `true` behind a TLS-terminating proxy, and check `URL` is the real public origin.

## The image does not build

Run `npm run build` locally to catch TypeScript errors, make sure `package-lock.json` is committed, and check `.dockerignore` does not exclude something the build needs. The Dockerfile needs BuildKit.
