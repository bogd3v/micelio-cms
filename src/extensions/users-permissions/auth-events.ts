// Security events for the users-permissions routes (issue #180, ASVS V16.3.1).
// Each wrapper calls the original action, writes one event from its outcome and
// hands back the same result or throws the same error: the answer, which does
// not tell whether an account exists, never changes.
import type { Context } from 'koa'
import type { Core } from '@strapi/strapi'
import { SECURITY_EVENTS } from '../../constants/security-events'
import { logAuthEvent, userIdFromBody, userIdFromState } from '../../utils/auth-events'

type Action = (ctx: Context, ...rest: unknown[]) => Promise<unknown>

/** Messages of the plugin's `callback` that tell a refusal apart. */
const BLOCKED_MESSAGE = 'Your account has been blocked by an administrator'
const INVALID_MESSAGE = 'Invalid identifier or password'
const UNCONFIRMED_MESSAGE = 'Your account email is not confirmed'
const INVALID_CODE_MESSAGE = 'Incorrect code provided'
const INVALID_TOKEN_MESSAGE = 'Invalid token'
const WRONG_CURRENT_PASSWORD_MESSAGE = 'The provided current password is invalid'
const WRONG_DELETION_PASSWORD_MESSAGE = 'Invalid password'

/**
 * Wraps `callback` (sign-in) to log `auth.login.success` with the user id, or
 * `auth.login.failure` with a reason, then rethrow the plugin's error.
 *
 * @remarks
 * A provider that is disabled and a malformed body fail without a `reason`.
 */
export function wrapLoginEvents(strapi: Core.Strapi, callback: Action): Action {
  return async (ctx, ...rest) => {
    let result: unknown
    try {
      result = await callback(ctx, ...rest)
    } catch (error) {
      logAuthEvent(strapi, ctx, SECURITY_EVENTS.authLoginFailure, {
        reason: failureReason(error),
      })
      throw error
    }
    logAuthEvent(strapi, ctx, SECURITY_EVENTS.authLoginSuccess, {
      actor: userIdFromBody(ctx.body),
    })
    return result
  }
}

/**
 * Wraps `register` to log `auth.register` with the new user id once the
 * account exists, or `auth.register.failure` for any refusal.
 *
 * @remarks
 * Every refusal logs the same line, without a `reason`: the plugin's answer
 * for a taken name or email is the only place that says why, and the log does
 * not add to it.
 */
export function wrapRegisterEvents(strapi: Core.Strapi, register: Action): Action {
  return async (ctx, ...rest) => {
    let result: unknown
    try {
      result = await register(ctx, ...rest)
    } catch (error) {
      logAuthEvent(strapi, ctx, SECURITY_EVENTS.authRegisterFailure)
      throw error
    }
    logAuthEvent(strapi, ctx, SECURITY_EVENTS.authRegister, { actor: userIdFromBody(ctx.body) })
    return result
  }
}

/**
 * Wraps `forgotPassword` to log `auth.password-reset.requested` for every
 * request the plugin answers, with no user id: it answers the same whether or
 * not the address has an account, and so does the log.
 */
export function wrapForgotPasswordEvents(strapi: Core.Strapi, forgotPassword: Action): Action {
  return async (ctx, ...rest) => {
    const result = await forgotPassword(ctx, ...rest)
    logAuthEvent(strapi, ctx, SECURITY_EVENTS.authPasswordResetRequested)
    return result
  }
}

/**
 * Wraps `resetPassword` to log `auth.password-reset.completed` with the user id
 * once the password changed, or `auth.password-reset.failure` for a refusal
 * (`reason` `invalid-code` for an unknown or expired code; a rejected new
 * password has none).
 */
export function wrapResetPasswordEvents(strapi: Core.Strapi, resetPassword: Action): Action {
  return async (ctx, ...rest) => {
    let result: unknown
    try {
      result = await resetPassword(ctx, ...rest)
    } catch (error) {
      logAuthEvent(strapi, ctx, SECURITY_EVENTS.authPasswordResetFailure, {
        reason: messageOf(error) === INVALID_CODE_MESSAGE ? 'invalid-code' : undefined,
      })
      throw error
    }
    logAuthEvent(strapi, ctx, SECURITY_EVENTS.authPasswordResetCompleted, {
      actor: userIdFromBody(ctx.body),
    })
    return result
  }
}

/**
 * Wraps `emailConfirmation` to log `auth.email-confirmation.confirmed` when a
 * `POST` confirmed an account (204), or `auth.email-confirmation.failure` with
 * `invalid-token` when a `POST` was refused. The `GET` only redirects and
 * confirms nothing, so it is not an event.
 */
export function wrapEmailConfirmationEvents(strapi: Core.Strapi, confirm: Action): Action {
  return async (ctx, ...rest) => {
    let result: unknown
    try {
      result = await confirm(ctx, ...rest)
    } catch (error) {
      if (ctx.method === 'POST') {
        logAuthEvent(strapi, ctx, SECURITY_EVENTS.authEmailConfirmationFailure, {
          reason: messageOf(error) === INVALID_TOKEN_MESSAGE ? 'invalid-token' : undefined,
        })
      }
      throw error
    }
    if (ctx.method === 'POST' && ctx.status === 204) {
      logAuthEvent(strapi, ctx, SECURITY_EVENTS.authEmailConfirmed)
    }
    return result
  }
}

/**
 * Wraps `changePassword` to log `auth.password-change.success` with the user id,
 * or `auth.password-change.failure` (`reason` `invalid-credentials` for a wrong
 * current password, none for a rejected new password), then rethrow the error.
 *
 * @remarks
 * Nothing is logged when nobody is signed in: there is no password to check.
 */
export function wrapChangePasswordEvents(strapi: Core.Strapi, changePassword: Action): Action {
  return async (ctx, ...rest) => {
    const actor = userIdFromState(ctx.state.user)
    let result: unknown
    try {
      result = await changePassword(ctx, ...rest)
    } catch (error) {
      if (actor !== undefined) {
        logAuthEvent(strapi, ctx, SECURITY_EVENTS.authPasswordChangeFailure, {
          actor,
          reason:
            messageOf(error) === WRONG_CURRENT_PASSWORD_MESSAGE ? 'invalid-credentials' : undefined,
        })
      }
      throw error
    }
    if (actor !== undefined) {
      logAuthEvent(strapi, ctx, SECURITY_EVENTS.authPasswordChangeSuccess, { actor })
    }
    return result
  }
}

/**
 * Wraps `DELETE /api/users/me` to log `auth.account-deletion.success` with the
 * user id once the account is gone (204), or `auth.account-deletion.failure`
 * (`reason` `invalid-credentials` for a wrong or missing password, none for
 * any other error), then rethrow the error.
 *
 * @remarks
 * A request without a signed-in user answers 401 and logs nothing here.
 */
export function wrapDestroyMeEvents(strapi: Core.Strapi, destroyMe: Action): Action {
  return async (ctx, ...rest) => {
    const actor = userIdFromState(ctx.state.user)
    let result: unknown
    try {
      result = await destroyMe(ctx, ...rest)
    } catch (error) {
      if (actor !== undefined) {
        logAuthEvent(strapi, ctx, SECURITY_EVENTS.authAccountDeletionFailure, {
          actor,
          reason:
            messageOf(error) === WRONG_DELETION_PASSWORD_MESSAGE
              ? 'invalid-credentials'
              : undefined,
        })
      }
      throw error
    }
    if (actor !== undefined && ctx.status === 204) {
      logAuthEvent(strapi, ctx, SECURITY_EVENTS.authAccountDeletionSuccess, { actor })
    }
    return result
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

function failureReason(
  error: unknown
): 'invalid-credentials' | 'blocked-account' | 'unconfirmed-account' | undefined {
  const message = messageOf(error)
  if (message === INVALID_MESSAGE) return 'invalid-credentials'
  if (message === BLOCKED_MESSAGE) return 'blocked-account'
  if (message === UNCONFIRMED_MESSAGE) return 'unconfirmed-account'
  return undefined
}
