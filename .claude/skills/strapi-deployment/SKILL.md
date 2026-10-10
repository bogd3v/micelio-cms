---
name: strapi-deployment
description: Use when the user asks about the Docker image, installing or configuring a Micelio CMS node, CI/CD, production environment variables, health checks, backups or build issues for the Micelio CMS.
---

# Strapi Deployment Skill

The CMS ships as a Docker image (`ghcr.io/bogd3v/micelio-cms`) that runs on any host with containers. Nothing in the repository depends on a hosting platform or a proxy. The operator's documentation is in `docs/operate/`; the CI and image pipeline is in `docs/architecture/ci-pipeline.md`.

## When to use this skill

- Changing the Dockerfile or `.dockerignore`.
- Adding or documenting environment variables.
- Debugging a container that does not start or fails its health check.
- Changing the CI or image workflows.

## Where the answer is

| Question                                   | Read                                                |
| ------------------------------------------ | --------------------------------------------------- |
| How do I run a node?                       | `docs/operate/install.md`                           |
| What does a variable do?                   | `docs/operate/configure.md`, `.env.example`         |
| How do I upgrade, back up, restore?        | `docs/operate/upgrade.md`, `docs/operate/backup.md` |
| It does not start, 502, uploads disappear  | `docs/operate/troubleshooting.md`                   |
| What do CI and the image workflow do?      | `docs/architecture/ci-pipeline.md`                  |
| Rate limiting and client IP behind a proxy | `docs/RATE_LIMITING.md`                             |

## Dockerfile rules

The multi-stage `Dockerfile` copies **compiled JavaScript** from `dist/`, not TypeScript source:

- `dist/config` and `dist/src` → runtime code
- `dist/build` → admin panel build
- `database/` and `scripts/` → already JavaScript

Run `npm run build` before you build the image. The health check uses busybox `wget`: the image has no `curl`.

## Health check

The image's `HEALTHCHECK` probes `GET /_health`, which is built into Strapi: it answers `204 No Content` (no body) once the server listens, outside `/api` and without permissions. There is no custom health endpoint. Interval 30 s, timeout 10 s, start period 60 s, 3 retries.

If a container never gets healthy, read the application logs first: the usual causes are a missing required variable, a database it cannot reach, or a crash at boot.

## Behind a proxy

Behind a TLS-terminating proxy, `config/server.ts` reads `proxy.koa` from `TRUST_PROXY_PROTOCOL` (default `true`) so Koa follows `X-Forwarded-Proto`; without it federated URLs are generated as `http`. Who the client is comes from `TRUST_PROXY`. Neither assumes a particular proxy.

## Upload persistence

Mount a persistent volume at `/app/public/uploads`, or use an S3-compatible bucket (`R2_*`). Without either, uploaded media is lost when the container is replaced.

## Local build check

```bash
npm run build
docker build -t micelio-cms:test .
docker run -p 1337:1337 --env-file .env micelio-cms:test
curl -i http://localhost:1337/_health
```

## Do not

- Commit real secrets in `.env` files.
- Copy `.ts` files into the production image.
- Put a value that identifies one site in code, a default or the documentation (standard, principle 2).
- Run a fediverse-enabled node without a persistent database: the actor key and the followers live in it.
