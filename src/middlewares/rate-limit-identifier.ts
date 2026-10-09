import type { Core } from '@strapi/strapi';
import type { Context, Next } from 'koa';
import { AUTH_LOCAL_PATH } from '../constants/rate-limit';
import { isAuthEmailRoute, normalizePath } from '../utils/rate-limit/groups';
import { identityKey } from '../utils/rate-limit/keys';
import { rejectTooManyRequests } from '../utils/rate-limit/respond';
import { getRateLimitRuntime } from '../utils/rate-limit/runtime';

/**
 * Limits the account routes per account, after the body is parsed (the
 * group's per-client limit already ran). `POST /api/auth/local` counts per
 * login identifier and answers 429 past its limit. For the routes that send an
 * email, per address: past the limit `forgot-password` and
 * `send-email-confirmation` answer what they always do without sending
 * anything, so the response says nothing about the address; `register` has no
 * such answer (it returns the new user) and gets a 429. Both limits let an
 * attacker use up an account's quota; accepted.
 */
export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    const runtime = getRateLimitRuntime(strapi);
    if (!runtime) return next();
    const path = normalizePath(ctx.path);
    const body = (ctx.request as { body?: { email?: unknown; identifier?: unknown } }).body;

    // Sign-in is also limited per account, so many clients can't guess one password.
    // Past the limit it is a plain 429: a silent answer would look like a wrong password.
    if (ctx.method.toUpperCase() === 'POST' && path === AUTH_LOCAL_PATH) {
      const decision = await runtime.limiters.consume(
        'auth-identifier',
        identityKey(runtime.secret, body?.identifier, ctx.request.ip)
      );
      if (decision && !decision.allowed) return rejectTooManyRequests(ctx, decision);
      return next();
    }

    if (!isAuthEmailRoute(ctx.method, path)) return next();
    const decision = await runtime.limiters.consume(
      'auth-email',
      identityKey(runtime.secret, body?.email, ctx.request.ip)
    );
    if (!decision || decision.allowed) return next();

    if (path === '/api/auth/forgot-password') {
      ctx.status = 200;
      ctx.body = { ok: true };
      return;
    }
    if (path === '/api/auth/send-email-confirmation') {
      ctx.status = 200;
      ctx.body = { email: typeof body?.email === 'string' ? body.email : '', sent: true };
      return;
    }
    return rejectTooManyRequests(ctx, decision);
  };
