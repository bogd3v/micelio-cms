import { hashIdentifier } from './security-log'

/** Which user table `actor` belongs to: admin and reader ids overlap. */
export type ActorKind = 'admin' | 'user'

/** Metadata the request line carries next to its message. Absent fields are omitted. */
export interface RequestLogMeta {
  /** Server-generated id, also in `ctx.state.requestId`. */
  requestId: string
  /** Keyed hash of the client address (16 hex characters), never the address. */
  client?: string
  /** Numeric id of the authenticated reader or admin user. */
  actor?: number
  /** Table of `actor`; present only with `actor`, and only when the auth strategy is known. */
  actorKind?: ActorKind
}

/** Auth strategy names of Strapi 5 (`ctx.state.auth.strategy.name`) that set `state.user`. */
const ACTOR_KINDS: Readonly<Record<string, ActorKind>> = {
  admin: 'admin',
  'admin-token': 'admin',
  'users-permissions': 'user',
}

/**
 * Numeric id of the user a request authenticated as, or `undefined`.
 *
 * @remarks
 * Reads `state.user`, which the users-permissions and admin strategies set.
 * Content API tokens set no user, so they have no actor. Nothing else of the user is read.
 *
 * @param state - Koa's `ctx.state`.
 */
export function requestActor(state: unknown): number | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const user: unknown = (state as { user?: unknown }).user
  if (typeof user !== 'object' || user === null) return undefined
  const id: unknown = (user as { id?: unknown }).id
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/**
 * Whether the actor is an admin or a reader, from the auth strategy that ran.
 *
 * @param state - Koa's `ctx.state`.
 */
export function requestActorKind(state: unknown): ActorKind | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  const auth: unknown = (state as { auth?: unknown }).auth
  if (typeof auth !== 'object' || auth === null) return undefined
  const strategy: unknown = (auth as { strategy?: unknown }).strategy
  if (typeof strategy !== 'object' || strategy === null) return undefined
  const name: unknown = (strategy as { name?: unknown }).name
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ACTOR_KINDS, name)
    ? ACTOR_KINDS[name]
    : undefined
}

/**
 * Builds the metadata of a request line.
 *
 * @param requestId - The id the server generated for this request.
 * @param ip - The client address as `global::client-ip` resolved it.
 * @param state - Koa's `ctx.state`, read after authentication ran.
 * @param secret - Key of the identifier hashes, or `undefined` to leave the client out.
 */
export function buildRequestLogMeta(
  requestId: string,
  ip: string | undefined,
  state: unknown,
  secret: Buffer | undefined
): RequestLogMeta {
  const meta: RequestLogMeta = { requestId }
  if (secret && ip) meta.client = hashIdentifier(ip, secret)
  const actor = requestActor(state)
  if (actor !== undefined) {
    meta.actor = actor
    const kind = requestActorKind(state)
    if (kind) meta.actorKind = kind
  }
  return meta
}
