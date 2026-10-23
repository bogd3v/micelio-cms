import type { Core } from '@strapi/strapi'
import { SUBSCRIBER_UID } from '../constants/uids'
import { deleteAccount } from '../extensions/users-permissions/delete-account'

const USER_UID = 'plugin::users-permissions.user'

/** Days an unconfirmed account or subscription is kept when `UNCONFIRMED_RETENTION_DAYS` is unset. */
const DEFAULT_RETENTION_DAYS = 30

/** Rows read and deleted per round, so a large backlog never loads at once. */
const BATCH_SIZE = 100

/** Daily at 03:17 server time; an odd minute keeps instances off the hour. */
const UNCONFIRMED_PURGE_CRON = '17 3 * * *'

const DAY_MS = 24 * 60 * 60 * 1000

/** Largest retention accepted, 100 years: beyond it the cutoff date leaves the range of `Date`. */
const MAX_RETENTION_DAYS = 36500

/** What one purge run removed. */
export interface PurgeReport {
  /** Unconfirmed reader accounts deleted. */
  users: number
  /** Unconfirmed newsletter subscriptions deleted. */
  subscribers: number
  /** Accounts whose deletion threw and were left for the next run. */
  usersFailed: number
  /** Whether accounts were skipped because `email_confirmation` is off. */
  usersSkipped: boolean
}

/**
 * Reads `UNCONFIRMED_RETENTION_DAYS`: whole days, `0` for never purge.
 *
 * @param value - The raw variable; unset or blank gives the default of 30.
 * @throws `Error` naming the variable when the value is not a whole number from 0 to 36500.
 */
export function parseRetentionDays(value: string | undefined): number {
  const text = value?.trim() ?? ''
  if (text === '') return DEFAULT_RETENTION_DAYS
  if (!/^\d+$/.test(text) || Number(text) > MAX_RETENTION_DAYS) {
    throw new Error(
      `UNCONFIRMED_RETENTION_DAYS must be a whole number of days from 0 to ${MAX_RETENTION_DAYS} (0 disables the purge), got "${text}"`
    )
  }
  return Number(text)
}

/** The instant before which an unconfirmed row is old enough to purge. */
export function purgeCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

/**
 * The one filter that selects purgeable reader accounts: unconfirmed, still
 * holding a confirmation token, not blocked, created before `cutoff`.
 *
 * @remarks
 * The token marks an account that signed up and waits for its email: confirming
 * clears it, an admin-created or provider account never has one. `blocked`
 * accounts are a moderator's decision and stay. Only `createdAt` counts:
 * resending the confirmation email edits the row, which must not extend the wait.
 */
export function unconfirmedUserFilter(cutoff: Date): Record<string, unknown> {
  return {
    confirmed: false,
    blocked: false,
    confirmationToken: { $notNull: true },
    createdAt: { $lt: cutoff.toISOString() },
  }
}

/**
 * The one filter that selects purgeable newsletter subscriptions: unconfirmed
 * and created before `cutoff`.
 *
 * @remarks
 * `createdAt` is the right clock: the frontend answers a repeated request by
 * deleting the pending row and creating a new one, so a person who asks again
 * restarts the wait, and `updatedAt` is never moved by anything else.
 */
export function unconfirmedSubscriberFilter(cutoff: Date): Record<string, unknown> {
  return { confirmed: false, createdAt: { $lt: cutoff.toISOString() } }
}

/**
 * Whether unconfirmed readers are kept out: with `email_confirmation` off the
 * plugin lets an unconfirmed user sign in, so such an account is in use.
 */
async function requiresEmailConfirmation(strapi: Core.Strapi): Promise<boolean> {
  const settings = (await strapi
    .store({ type: 'plugin', name: 'users-permissions', key: 'advanced' })
    .get({})) as { email_confirmation?: unknown } | null
  return settings?.email_confirmation === true
}

async function purgeUsers(
  strapi: Core.Strapi,
  cutoff: Date
): Promise<{ deleted: number; failed: number }> {
  const filter = unconfirmedUserFilter(cutoff)
  let deleted = 0
  let failed = 0
  let cursor = 0
  for (;;) {
    const batch = (await strapi.db.query(USER_UID).findMany({
      select: ['id'],
      where: { ...filter, id: { $gt: cursor } },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    })) as { id: number }[]
    if (batch.length === 0) return { deleted, failed }

    for (const { id } of batch) {
      try {
        const removed = await strapi.db.transaction(async () => {
          // Claims the row: a write that changes nothing but takes the row lock
          // and re-evaluates the filter, on PostgreSQL (a concurrent confirmation
          // waits, then no longer matches) and on SQLite (writes are serialised).
          // Zero rows means confirmed, blocked or deleted since the read.
          const { count } = (await strapi.db.query(USER_UID).updateMany({
            where: { ...filter, id },
            data: { confirmed: false },
          })) as { count: number }
          if (count === 0) return false
          // Also anonymises any comment and revokes refresh sessions.
          await deleteAccount(strapi, id)
          return true
        })
        if (removed) deleted += 1
      } catch {
        // Counted and reported by the caller; one bad row must not stop the run.
        failed += 1
      }
    }
    cursor = batch[batch.length - 1].id
  }
}

async function purgeSubscribers(strapi: Core.Strapi, cutoff: Date): Promise<number> {
  const filter = unconfirmedSubscriberFilter(cutoff)
  let deleted = 0
  let cursor = 0
  for (;;) {
    const batch = (await strapi.db.query(SUBSCRIBER_UID).findMany({
      select: ['id'],
      where: { ...filter, id: { $gt: cursor } },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    })) as { id: number }[]
    if (batch.length === 0) return deleted

    const ids = batch.map((row) => row.id)
    // The filter again: a subscriber confirmed since the read is not deleted.
    const { count } = (await strapi.db
      .query(SUBSCRIBER_UID)
      .deleteMany({ where: { ...filter, id: { $in: ids } } })) as { count: number }
    deleted += count
    cursor = ids[ids.length - 1]
  }
}

/**
 * Deletes the unconfirmed reader accounts and newsletter subscriptions created
 * more than `days` days before `now`. Idempotent and safe on several instances.
 *
 * @remarks
 * Accounts are skipped when the users-permissions `email_confirmation` setting
 * is off (`usersSkipped`), since those users can sign in. An account whose
 * deletion throws is counted in `usersFailed` and the run goes on, subscriptions
 * included.
 *
 * @param days - Retention in days; `0` does nothing.
 * @param now - The clock, injected so tests need not wait.
 * @returns How many rows of each kind were deleted, and what was skipped or failed.
 */
export async function purgeUnconfirmed(
  strapi: Core.Strapi,
  days: number,
  now: Date = new Date()
): Promise<PurgeReport> {
  if (days === 0) return { users: 0, subscribers: 0, usersFailed: 0, usersSkipped: false }
  const cutoff = purgeCutoff(now, days)
  const usersSkipped = !(await requiresEmailConfirmation(strapi))
  const users = usersSkipped ? { deleted: 0, failed: 0 } : await purgeUsers(strapi, cutoff)
  return {
    users: users.deleted,
    subscribers: await purgeSubscribers(strapi, cutoff),
    usersFailed: users.failed,
    usersSkipped,
  }
}

/**
 * Registers the daily purge when cron is enabled and retention is not `0`.
 * A failure only logs; the next run retries. Logs counts, never who.
 *
 * @param days - Validated retention from {@link parseRetentionDays}.
 */
export function scheduleUnconfirmedPurge(strapi: Core.Strapi, days: number): void {
  if (days === 0 || !strapi.config.get<boolean>('server.cron.enabled')) return

  const run = async (): Promise<void> => {
    try {
      const report = await purgeUnconfirmed(strapi, days)
      if (report.usersSkipped) {
        strapi.log.info('[purge] accounts skipped: email confirmation is off, so they can sign in')
      }
      if (report.users > 0 || report.subscribers > 0 || report.usersFailed > 0) {
        strapi.log.info(
          `[purge] deleted ${report.users} unconfirmed accounts (${report.usersFailed} failed) and ${report.subscribers} unconfirmed subscriptions older than ${days} days`
        )
      }
    } catch (error) {
      strapi.log.warn(
        `[purge] could not purge unconfirmed accounts: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  strapi.cron.add({ unconfirmedPurge: { task: run, options: { rule: UNCONFIRMED_PURGE_CRON } } })
}
