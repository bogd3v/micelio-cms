import type { Core } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import { EDITOR_ROLE_TYPE } from '../constants/roles'
import { SECURITY_EVENTS } from '../constants/security-events'
import type { AccessLogContext } from '../types/security-events'
import { logAccessRefusal } from './access-log'

/** Document Service actions that return documents to the caller. */
const READ_ACTIONS = new Set(['findMany', 'findOne', 'findFirst', 'count'])

/**
 * The plugin whose preview routes may read drafts: `@micelio/strapi-plugin-core`, registered as
 * `micelio`.
 */
const PREVIEW_PLUGIN = 'micelio'

/**
 * The only content API handlers allowed to read a draft without an Editor, as the plugin's route
 * file names them and Strapi keeps them in `ctx.state.route.handler`, next to
 * `ctx.state.route.info.pluginName`.
 *
 * @remarks
 * Both are routes of the core's preview (micelio ADR 0019, `docs/operate/preview.md` in
 * `micelio-plugin-core`) and each checks its own one-use credential before it reads, so the Editor
 * rule has nothing left to add:
 *
 * - `preview.exchange` trades a preview token (60 s, once, bound to an admin user, a site and a
 *   draft) for a grant. It reads the draft only through the token's binding, to check that its
 *   admin user may still read it (`stillReadable` of the `preview` service); an unknown, spent,
 *   expired or revoked token ends in `404` before any read.
 * - `preview.draft` serves the one document that a grant names (`resolveGrant` of the `preview`
 *   service, checked before `readDraft`); an unknown, spent, expired, revoked or wrong-site grant
 *   gets `404`.
 *
 * Checked against `@micelio/strapi-plugin-core` 0.2.0, the pinned version. Re-check the order of
 * reads in both handlers on every bump of the core: a release that reads a draft before its
 * credential check would be unguarded here, and the tests prove the refusals, not the order.
 *
 * The route is matched by its own info, never by its path: a route of another plugin or of an
 * `api::` type that is mounted under the same prefix, or that names a handler `preview.draft`,
 * does not match, and every other draft read keeps the refusal.
 */
const GRANT_CHECKED_PREVIEW_HANDLERS: ReadonlySet<unknown> = new Set([
  'preview.exchange',
  'preview.draft',
])

type RequestState = {
  route?: { info?: { type?: string; pluginName?: string }; handler?: unknown }
  auth?: { strategy?: { name?: string } }
  user?: { role?: { type?: string } }
}

/**
 * Whether a content API request may read drafts: only a users-permissions
 * user with the Editor role. Public, other roles and API tokens (including the
 * frontend's STRAPI_API_TOKEN) may not.
 */
export function canReadDrafts(state: RequestState): boolean {
  return (
    state.auth?.strategy?.name === 'users-permissions' &&
    state.user?.role?.type === EDITOR_ROLE_TYPE
  )
}

/** Whether the request is on one of the core's grant-checked preview routes. */
function isGrantCheckedPreviewRoute(state: RequestState): boolean {
  return (
    state.route?.info?.pluginName === PREVIEW_PLUGIN &&
    GRANT_CHECKED_PREVIEW_HANDLERS.has(state.route.handler)
  )
}

/**
 * Restricts `status=draft` on the content API to editors (issue #53).
 *
 * Strapi 5 serves drafts to any caller with `find`/`findOne` when the request
 * carries `?status=draft`, and the status also applies to populated relations
 * (`/api/categories?populate=articles&status=draft` returns article drafts).
 * Checking it in the Document Service covers every content API route, custom
 * or core, whatever the root content type. The one exception is the core's two
 * grant-checked preview routes (`GRANT_CHECKED_PREVIEW_HANDLERS`). Admin panel,
 * admin API and `/mcp` requests (not `content-api` routes) and calls outside a
 * request (cron, eventHub, bootstrap) are left alone.
 */
export function restrictDraftsToEditors(strapi: Core.Strapi): void {
  strapi.documents.use(async (context, next) => {
    const status = (context.params as { status?: unknown }).status
    if (!READ_ACTIONS.has(context.action) || status === undefined || status === 'published') {
      return next()
    }

    const state = strapi.requestContext.get()?.state as RequestState | undefined
    if (
      state?.route?.info?.type === 'content-api' &&
      !isGrantCheckedPreviewRoute(state) &&
      !canReadDrafts(state)
    ) {
      logAccessRefusal(
        strapi,
        strapi.requestContext.get() as AccessLogContext | undefined,
        SECURITY_EVENTS.accessDraftRefused,
        'draft-requested'
      )
      throw new errors.ForbiddenError('Drafts are only available to editors')
    }
    return next()
  })
}
