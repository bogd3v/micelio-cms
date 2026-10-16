// /api/auth/email-confirmation (issue #178, ASVS V3.5.3): the POST confirms an
// account; the GET only redirects to the frontend, so a mail scanner that
// opens the link cannot spend the token.
import type { Context, Next } from 'koa';
import { errors } from '@strapi/utils';
import { hashUserToken } from '../../utils/user-token';

const USER_UID = 'plugin::users-permissions.user';

/** What Strapi's `generateConfirmationToken` produces: 20 random bytes, hex. */
const TOKEN_PATTERN = /^[0-9a-f]{40}$/;

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
 * Reads the token from the body only, never the query, looks it up by its SHA-256 (the stored form) and clears it so a
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
    where: { confirmationToken: hashUserToken(confirmation) },
    data: { confirmed: true, confirmationToken: null },
  });
  if (!updated) throw new errors.ValidationError('Invalid token');

  ctx.status = 204;
}

/**
 * Answers `GET` and `HEAD /api/auth/email-confirmation` with a 303 to the configured
 * `email_confirmation_redirection`.
 *
 * @remarks
 * Never confirms, never reads the user table and never clears the token, so a link
 * previewer cannot use it up and the answer does not tell whether the token exists;
 * the frontend confirms with the POST. A redirection that is empty, unparseable or not
 * an absolute `http(s)` URL sends to `/` with no token, whatever the query. Otherwise
 * the target keeps its own query and gets `confirmation=<token>` when the request holds
 * a 40-character lowercase hex token, or an empty `confirmation=` when the token is
 * missing or malformed, which the frontend reads as an invalid token.
 */
export async function redirectToConfirmation(ctx: Context): Promise<void> {
  const settings = (await strapi
    .store({ type: 'plugin', name: 'users-permissions', key: 'advanced' })
    .get()) as { email_confirmation_redirection?: unknown } | null;
  const target = settings?.email_confirmation_redirection;

  let location = '/';
  try {
    if (typeof target === 'string') {
      const url = new URL(target);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        const token = ctx.query.confirmation;
        url.searchParams.set(
          'confirmation',
          typeof token === 'string' && TOKEN_PATTERN.test(token) ? token : ''
        );
        location = url.toString();
      }
    }
  } catch {
    // Empty or relative target: there is no frontend to send the visitor to.
  }
  ctx.redirect(location);
  ctx.status = 303;
}

/**
 * Serves `/api/auth/email-confirmation`: the POST with `confirmEmailByPost`, the GET and HEAD with
 * `redirectToConfirmation`, and anything else with 405.
 *
 * @remarks
 * It replaces the plugin's handler instead of wrapping it. The plugin's own lookup compares the
 * stored hash with the raw value it receives, so reaching it would make the stored hash usable as
 * a token. Only the two routes of this file reach the action (`@strapi/plugin-graphql`, the one
 * other caller, is not installed), so nothing else can.
 */
export async function handleEmailConfirmation(ctx: Context): Promise<unknown> {
  if (ctx.method === 'POST') return confirmEmailByPost(ctx);
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return redirectToConfirmation(ctx);
  return ctx.methodNotAllowed();
}
