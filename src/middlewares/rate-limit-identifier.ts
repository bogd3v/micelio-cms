import type { Core } from '@strapi/strapi'
import type { Context, Next } from 'koa'
import { ADMIN_LOGIN_PATH, AUTH_LOCAL_PATH } from '../constants/rate-limit'
import { isAuthEmailRoute, normalizePath } from '../utils/rate-limit/groups'
import { identityKey } from '../utils/rate-limit/keys'
import { rejectLogged } from '../utils/rate-limit/respond'
import { getRateLimitRuntime } from '../utils/rate-limit/runtime'

/**
 * Limits the account routes per account, after the body is parsed (the
 * group's per-client limit already ran). `POST /api/auth/local` counts per
 * login identifier and answers 429 past its limit; `POST /admin/login` does
 * the same per admin email (`admin-identifier`). For the routes that send an
 * email, per address: past the limit `forgot-password` and
 * `send-email-confirmation` answer what they always do without sending
 * anything, so the response says nothing about the address; `register` has no
 * such answer (it returns the new user) and gets a 429. Both limits let an
 * attacker use up an account's quota; accepted.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    const runtime = getRateLimitRuntime(strapi)
    if (!runtime) return next()
    const path = normalizePath(ctx.path)
    const body = (ctx.request as { body?: { email?: unknown; identifier?: unknown } }).body

    // Sign-in is also limited per account, so many clients can't guess one password.
    // Past the limit it is a plain 429: a silent answer would look like a wrong password.
    if (ctx.method.toUpperCase() === 'POST' && path === AUTH_LOCAL_PATH) {
      const bucket = identityKey(runtime.secret, body?.identifier, ctx.request.ip)
      const decision = await runtime.limiters.consume('auth-identifier', bucket)
      if (decision && !decision.allowed) {
        return rejectLogged(ctx, runtime, 'auth-identifier', decision, { bucket })
      }
      return next()
    }

    // Same for the admin panel, which has no second factor.
    if (ctx.method.toUpperCase() === 'POST' && path === ADMIN_LOGIN_PATH) {
      const bucket = identityKey(runtime.secret, body?.email, ctx.request.ip)
      const decision = await runtime.limiters.consume('admin-identifier', bucket)
      if (decision && !decision.allowed) {
        return rejectLogged(ctx, runtime, 'admin-identifier', decision, { bucket })
      }
      return next()
    }

    if (!isAuthEmailRoute(ctx.method, path)) return next()
    const bucket = identityKey(runtime.secret, body?.email, ctx.request.ip)
    const decision = await runtime.limiters.consume('auth-email', bucket)
    if (!decision || decision.allowed) return next()

    // The two silent answers below are rejections too: log them, answer as before.
    if (path === '/api/auth/forgot-password') {
      runtime.events.rejected(ctx.request.ip, 'auth-email', ctx.path, bucket)
      ctx.status = 200
      ctx.body = { ok: true }
      return
    }
    if (path === '/api/auth/send-email-confirmation') {
      runtime.events.rejected(ctx.request.ip, 'auth-email', ctx.path, bucket)
      ctx.status = 200
      ctx.body = { email: typeof body?.email === 'string' ? body.email : '', sent: true }
      return
    }
    return rejectLogged(ctx, runtime, 'auth-email', decision, { bucket })
  }
