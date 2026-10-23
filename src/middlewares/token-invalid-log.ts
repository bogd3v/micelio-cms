import type { Core } from '@strapi/strapi'
import type { Context, Next } from 'koa'
import { AUTH_EVENT_LOGGED_STATE, SECURITY_EVENTS } from '../constants/security-events'
import { MCP_PATH } from '../constants/rate-limit'
import { logAuthEvent } from '../utils/auth-events'
import { normalizePath } from '../utils/rate-limit/groups'

const UNAUTHORIZED = 401

/**
 * Logs `auth.token.invalid` for every request that sent an `Authorization`
 * header and was answered 401 because the token was refused: an invalid,
 * expired or revoked reader JWT, Content API token, admin session or admin
 * token (`/mcp` included).
 *
 * @remarks
 * Runs inside `strapi::errors`, so it sees a thrown `UnauthorizedError` and an
 * answered 401 alike, and never changes either. Not an event: a 401 without
 * the header ("not signed in"), a route with `auth: false` other than `/mcp`
 * (its 401 is the route's own, for example an admin refresh with no cookie) and a request
 * whose token Strapi accepted (`ctx.state.isAuthenticated`, for example a
 * valid Content API token on a route that needs a user). The line holds no
 * token and no header, only the redacted path and the client hash. A request
 * that already wrote an authentication event is not logged again.
 *
 * The volume is the attacker's to choose and is not throttled. The
 * rate-limit groups bound it on the content API, but not on `/admin/*`
 * (exempt), `POST /admin/access-token`, `PUT /admin/users/me` and
 * `GET /admin/registration-info`. See `docs/security/logging.md`.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    try {
      await next()
    } catch (error) {
      if (isUnauthorizedError(error)) logIfPresented(strapi, ctx)
      throw error
    }
    if (ctx.status === UNAUTHORIZED) logIfPresented(strapi, ctx)
  }

function logIfPresented(strapi: Core.Strapi, ctx: Context): void {
  if (ctx.state[AUTH_EVENT_LOGGED_STATE] || !ctx.get('authorization')) return
  if (ctx.state.isAuthenticated === true) return
  // `/mcp` is `auth: false` too, but it checks the bearer itself: its 401 is a refused token.
  if (ctx.state.route?.config?.auth === false && normalizePath(ctx.path) !== MCP_PATH) return
  logAuthEvent(strapi, ctx, SECURITY_EVENTS.authTokenInvalid, { reason: 'invalid-token' })
}

function isUnauthorizedError(error: unknown): boolean {
  return (error as { name?: unknown } | null | undefined)?.name === 'UnauthorizedError'
}
