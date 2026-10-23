import { randomUUID } from 'node:crypto'
import type { Core } from '@strapi/strapi'
import type { Context, Next } from 'koa'
import { buildRequestLogMeta } from '../utils/request-context'
import { securityLogSecret } from '../utils/security-log'

let warnedNoSecret = false

/**
 * Logs each request like `strapi::logger` does, without the query string, and
 * adds who and where as metadata.
 *
 * @remarks
 * Strapi's logger writes `ctx.url`. Account confirmation and the newsletter
 * lookups carry an email address or a live token in the query, so anyone who
 * reads the logs would collect them. The path is enough to follow a request.
 *
 * Every request gets a server-generated `requestId` (an incoming header is
 * never read), kept in `ctx.state.requestId`. The line also holds a keyed hash
 * of the client address, the numeric id of the authenticated user and whether
 * it is an admin or a reader, all read after `next()` because that is when
 * `client-ip` and authentication have run. The line is written even when a
 * downstream middleware throws (the error is rethrown, and the status logged is
 * the one the client will get). No response header carries the id. See
 * `docs/security/logging.md`.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    const requestId = randomUUID()
    ctx.state.requestId = requestId
    const start = Date.now()
    let status: number | undefined
    try {
      await next()
    } catch (error) {
      status = errorStatus(error)
      throw error
    } finally {
      const delta = Math.ceil(Date.now() - start)
      strapi.log.http(
        `${ctx.method} ${ctx.path} (${delta} ms) ${status ?? ctx.status}`,
        buildRequestLogMeta(requestId, ctx.request.ip, ctx.state, hashSecret(strapi))
      )
    }
  }

/** The status Koa answers an escaped error with. */
function errorStatus(error: unknown): number {
  const { status, statusCode } = (error ?? {}) as { status?: unknown; statusCode?: unknown }
  const code = typeof status === 'number' ? status : statusCode
  return typeof code === 'number' && code >= 400 && code <= 599 ? code : 500
}

/** The hash key, or `undefined` when `APP_KEYS` is unusable: the line is still written, without a client. */
function hashSecret(strapi: Core.Strapi): Buffer | undefined {
  try {
    return securityLogSecret(strapi)
  } catch {
    if (!warnedNoSecret) {
      warnedNoSecret = true
      strapi.log.warn('request lines carry no client hash: APP_KEYS is missing or empty')
    }
    return undefined
  }
}
