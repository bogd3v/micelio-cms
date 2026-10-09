# Drafts

Moved from `CLAUDE.md` (#113); the text is unchanged.

Strapi 5 serves drafts to any caller with `find` when the request carries `?status=draft`, including through populated relations (`/api/categories?populate=articles&status=draft`). `src/utils/drafts-access.ts` (a Document Service middleware registered in `register()`) rejects non-`published` reads on `content-api` routes with 403 unless the caller is a users-permissions user with the `editor` role; API tokens are rejected too, while the admin panel, `/mcp` and server-side code are untouched. The Editor role and its read-only permissions are created by the idempotent `src/migrations/editor-role.ts`. `GET /api/articles/drafts` (editors only: `drafts` permission plus the `global::is-editor` policy, which also rejects API tokens) lists drafts per document and locale that were never published or were edited after publishing, using the admin's "Modified" rule (draft `updatedAt` later than the published one).
