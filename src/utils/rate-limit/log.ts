import { SECURITY_EVENTS } from '../../constants/security-events'
import type { SecurityLogHost } from '../../types/security-events'
import { ipBucket } from '../client-ip'
import { hashIdentifier, logSecurityEvent, securityLogSecret } from '../security-log'

/** Length of the throttle window, in milliseconds. */
const WINDOW_MS = 60_000
/** Most `rate-limit.rejected` lines per window for each limiter group. */
const MAX_LINES_PER_GROUP = 20

/** Writes the security events of the limiter, throttled so a flood cannot flood the log. */
export interface RateLimitLogger {
  /**
   * Logs `rate-limit.rejected`, subject to two limits: once a minute per
   * throttle key and group, and 20 lines a minute per group. A group is one of
   * the limiter's own names, so the total is bounded by their number. Held-back
   * rejections are counted per group and reported in one summary line each
   * (`suppressed`) when the window ends.
   *
   * @param ip - The client the line names, hashed here and never written.
   * @param group - The limiter group that said no; it keys the throttle only.
   * @param path - Request path; the query is dropped when written.
   * @param bucket - The limiter's own opaque bucket key, when the group counts
   * by something other than the client (an account): it keys the throttle
   * instead of `ip`, and is never written.
   */
  rejected(ip: string, group: string, path: string, bucket?: string): void
  /** Logs `rate-limit.forwarder-secret.invalid`, at most once a minute per process. */
  forwarderSecretInvalid(): void
  /** Writes the pending summaries now and stops the timer; called when the server stops. */
  flush(): void
  /** Forgets all state, so a test starts with a fresh budget. @internal */
  reset(): void
}

/**
 * Builds the limiter's security logger for one instance.
 *
 * @remarks
 * Memory is bounded: the throttle map holds at most the line cap for each
 * group per window and is pruned from the front, as entries stay in time
 * order. The limits are per process, so with several replicas each writes its
 * own lines. The summary of a window is written when the next rejection opens
 * a new window, by an unreferenced timer at the window's end, or on `flush()`.
 * See `docs/security/logging.md`.
 */
export function createRateLimitLogger(strapi: SecurityLogHost): RateLimitLogger {
  const lastLogged = new Map<string, number>()
  const writtenByGroup = new Map<string, number>()
  const suppressedByGroup = new Map<string, number>()
  let windowStart = -Infinity
  let lastSecretLine = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined

  const stopTimer = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  /** One summary line per group that held rejections back. */
  const writeSummaries = (): void => {
    stopTimer()
    const counts = [...suppressedByGroup.values()]
    suppressedByGroup.clear()
    for (const suppressed of counts) {
      try {
        logSecurityEvent(strapi, SECURITY_EVENTS.rateLimitRejected, { suppressed })
      } catch {
        // A logging failure must not reach the request.
      }
    }
  }

  const rollWindow = (now: number): void => {
    if (now - windowStart < WINDOW_MS) return
    writeSummaries()
    windowStart = now
    writtenByGroup.clear()
  }

  const hold = (group: string): void => {
    suppressedByGroup.set(group, (suppressedByGroup.get(group) ?? 0) + 1)
    if (timer) return
    const wait = Math.max(0, windowStart + WINDOW_MS - Date.now())
    timer = setTimeout(writeSummaries, wait)
    timer.unref()
  }

  /** True when the line for `key` may be written now; records it. */
  const allow = (key: string, now: number): boolean => {
    for (const [k, at] of lastLogged) {
      if (now - at < WINDOW_MS) break
      lastLogged.delete(k)
    }
    if (lastLogged.has(key)) return false
    lastLogged.set(key, now)
    return true
  }

  return {
    rejected(ip, group, path, bucket) {
      try {
        const now = Date.now()
        rollWindow(now)
        const written = writtenByGroup.get(group) ?? 0
        if (written >= MAX_LINES_PER_GROUP || !allow(`${bucket ?? ipBucket(ip)}|${group}`, now)) {
          hold(group)
          return
        }
        writtenByGroup.set(group, written + 1)
        const client = hashIdentifier(ipBucket(ip), securityLogSecret(strapi))
        logSecurityEvent(strapi, SECURITY_EVENTS.rateLimitRejected, {
          client,
          path,
          reason: 'rate-limited',
        })
      } catch {
        // Logging must never change the answer: the 429 is sent either way.
      }
    },
    forwarderSecretInvalid() {
      const now = Date.now()
      if (now - lastSecretLine < WINDOW_MS) return
      lastSecretLine = now
      try {
        logSecurityEvent(strapi, SECURITY_EVENTS.rateLimitForwarderSecretInvalid, {
          reason: 'invalid-secret',
        })
      } catch {
        // Same: a logging failure must not reach the request.
      }
    },
    flush: writeSummaries,
    reset() {
      stopTimer()
      lastLogged.clear()
      writtenByGroup.clear()
      suppressedByGroup.clear()
      windowStart = -Infinity
      lastSecretLine = -Infinity
    },
  }
}
