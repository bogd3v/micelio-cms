# Architecture overview

Moved from `CLAUDE.md` (#113); the text is unchanged.

**Standard Strapi content types** live in `src/api/<name>/{content-types,controllers,routes,services}`, generated via `strapi generate` or hand-written using `factories.createCoreController/Service/Router`. Business logic beyond CRUD goes in `services/`. Shared constants (content type UIDs), types and helpers live in `src/constants/`, `src/types/` and `src/utils/`; the fediverse plugin has its own copies of these folders and never imports from the root `src/` (see "Where code goes" in `AGENTS.md`). `config/plugins.ts` wires up `strapi-plugin-comments`, `@notum-cz/strapi-plugin-seo`, and conditionally an S3-compatible (Cloudflare R2) vs. local upload provider based on whether `R2_BUCKET` is set.
