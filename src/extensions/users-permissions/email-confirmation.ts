// POST /api/auth/email-confirmation (issue #178, ASVS V3.5.3): confirms an
// account without a GET, so a mail scanner that opens the link cannot spend
// the token. The GET stays as the plugin has it.
import type { Context, Next } from 'koa';
import { errors } from '@strapi/utils';
import { normalizePath } from '../../utils/rate-limit/groups';

const CONFIRM_PATH = '/api/auth/email-confirmation';
const USER_UID = 'plugin::users-permissions.user';

/** What Strapi's `generateConfirmationToken` produces: 20 random bytes, hex. */
const TOKEN_PATTERN = /^[0-9a-f]{40}$/;

type Action = (ctx: Context, ...rest: unknown[]) => Promise<unknown>;
type ConfirmationBody = { confirmation?: unknown };

/**
 * Keeps only `confirmation` in the body before the rate limiter, which keys
 * its bucket on `body.email` when present: an extra `email` per request would
 * get a fresh bucket each time and bypass the limit.
 */
export async function onlyConfirmation(ctx: Context, next: Next): Promise<void> {
  const body = (ctx.request as unknown as { body?: ConfirmationBody }).body;
  (ctx.request as unknown as { body: object }).body = { confirmation: body?.confirmation };
  await next();
}

/**
 * Confirms the account that owns the emailed token and answers 204.
 *
 * @remarks
 * Reads the token from the body only, never the query, and clears it so a
 * later request gets 400. Strapi's `update` finds the row and then writes it,
 * so two concurrent requests can both answer 204; both write the same
 * state, so nothing is lost. It issues no JWT: the person signs in afterwards.
 * The write goes through `strapi.db.query`, so the user service, Document
 * Service middlewares and the `entry.update` event do not run for a confirmation.
 *
 * @throws `ValidationError` ("Invalid token", HTTP 400) when the token is malformed, unknown or already used.
 */
export async function confirmEmailByPost(ctx: Context): Promise<void> {
  const body = (ctx.request as unknown as { body?: ConfirmationBody }).body;
  const confirmation = body?.confirmation;

  if (typeof confirmation !== 'string' || !TOKEN_PATTERN.test(confirmation)) {
    throw new errors.ValidationError('Invalid token');
  }

  const updated = await strapi.db.query(USER_UID).update({
    where: { confirmationToken: confirmation },
    data: { confirmed: true, confirmationToken: null },
  });
  if (!updated) throw new errors.ValidationError('Invalid token');

  ctx.status = 204;
}

/** Serves `POST /api/auth/email-confirmation` with `confirmEmailByPost` and leaves every other call to the plugin's action. */
export function wrapEmailConfirmation(original: Action): Action {
  return async (ctx, ...rest) => {
    if (ctx.method === 'POST' && normalizePath(ctx.path) === CONFIRM_PATH) {
      return confirmEmailByPost(ctx);
    }
    return original(ctx, ...rest);
  };
}
