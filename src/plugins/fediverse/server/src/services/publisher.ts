import type { Core } from '@strapi/strapi';

import { PUBLIC_COLLECTION, Update, type Activity } from '@fedify/fedify/vocab';

import { ACTOR_IDENTIFIER } from '../constants/actor';
import { ARTICLE_UID, GLOBAL_UID } from '../constants/uids';
import { buildActor, getFederation } from '../federation';
import {
  buildArticleActivity,
  buildDeleteActivity,
  findPublishedArticle,
  getDefaultLocale,
} from './articles';
import { isFederated, recordFailure, recordSend } from './federated-articles';
import { listFollowers } from './followers';
import type { FederatedActivityType } from '../types/federated-articles';

interface EntryEvent {
  uid?: string;
  entry?: { documentId?: string; locale?: string | null } | null;
}

let unsubscribers: Array<() => void> = [];

/**
 * Fedify context for work that isn't tied to an HTTP request. Its origin comes
 * from Strapi's public `URL`, so ids match the ones served over HTTP.
 */
function createContext(strapi: Core.Strapi) {
  const origin = strapi.config.get('server.url') as string;
  return getFederation(strapi).createContext(new URL(origin), { strapi });
}

/** How many followers an activity was queued for, and how many were left out as unreachable. */
interface FanOut {
  queued: number;
  skipped: number;
}

/**
 * Queues the activity for every active follower not flagged unreachable.
 *
 * @remarks
 * Returns once the activity is enqueued; Fedify's queue delivers and retries it
 * in the background. A follower is unreachable after its inbox answered `404`
 * or `410`, until it sends us an activity again (`markReachable`).
 */
async function sendToFollowers(strapi: Core.Strapi, activity: Activity): Promise<FanOut> {
  const followers = await listFollowers(strapi);
  const reachable = followers.filter((follower) => follower.unreachableSince == null);
  const skipped = followers.length - reachable.length;
  if (reachable.length === 0) return { queued: 0, skipped };

  const ctx = createContext(strapi);
  await ctx.sendActivity(
    { identifier: ACTOR_IDENTIFIER },
    reachable.map((follower) => ({
      id: new URL(follower.actorId),
      inboxId: follower.inbox ? new URL(follower.inbox) : null,
    })),
    activity,
    { preferSharedInbox: true }
  );
  return { queued: reachable.length, skipped };
}

/**
 * Records the activity on the article's row, queues it and, when enqueueing
 * throws, marks the row failed with the reason before rethrowing for the caller
 * to log. A delivery that fails later is recorded by `settleDelivery`.
 */
async function sendRecorded(
  strapi: Core.Strapi,
  documentId: string,
  type: FederatedActivityType,
  activity: Activity
): Promise<FanOut> {
  const activityAt = await recordSend(strapi, documentId, type);
  try {
    return await sendToFollowers(strapi, activity);
  } catch (error) {
    await recordFailure(strapi, documentId, activityAt, error);
    throw error;
  }
}

function describeFanOut({ queued, skipped }: FanOut): string {
  const left = skipped > 0 ? ` (${skipped} unreachable skipped)` : '';
  if (queued > 0) return `queued for ${queued} follower${queued === 1 ? '' : 's'}${left}`;
  return skipped > 0
    ? `no reachable followers, nothing queued${left}`
    : 'no followers yet, nothing queued';
}

async function isDefaultLocale(strapi: Core.Strapi, event: EntryEvent): Promise<boolean> {
  const locale = event.entry?.locale;
  return locale == null || locale === (await getDefaultLocale(strapi));
}

async function onPublish(strapi: Core.Strapi, event: EntryEvent): Promise<void> {
  const documentId = event.entry?.documentId;
  if (!documentId || !(await isDefaultLocale(strapi, event))) return;

  const record = await findPublishedArticle(strapi, documentId);
  if (record == null) {
    strapi.log.warn(
      `[fediverse] not federating article ${documentId}: no published default-locale version with a title and slug`
    );
    return;
  }

  // Publishing again is how edits go live in Strapi 5, so a known article is an Update.
  const federated = await isFederated(strapi, documentId);
  const ctx = createContext(strapi);
  const fanOut = await sendRecorded(
    strapi,
    documentId,
    federated ? 'Update' : 'Create',
    buildArticleActivity(federated ? 'update' : 'create', ctx, ACTOR_IDENTIFIER, record)
  );
  strapi.log.info(
    `[fediverse] ${federated ? 'Update' : 'Create'}(Article) for ${documentId} (${record.slug}): ${describeFanOut(fanOut)}`
  );
}

async function onRemoved(strapi: Core.Strapi, event: EntryEvent): Promise<void> {
  const documentId = event.entry?.documentId;
  if (!documentId || !(await isDefaultLocale(strapi, event))) return;
  if (!(await isFederated(strapi, documentId))) return;

  // Deleting a draft-only revision must not retract a version that is still live.
  if ((await findPublishedArticle(strapi, documentId)) != null) return;

  const ctx = createContext(strapi);
  const fanOut = await sendRecorded(
    strapi,
    documentId,
    'Delete',
    buildDeleteActivity(ctx, ACTOR_IDENTIFIER, documentId)
  );
  strapi.log.info(`[fediverse] Delete(Article) for ${documentId}: ${describeFanOut(fanOut)}`);
}

/**
 * Mastodon caches remote profiles, so a change to the `global` single type
 * (name, description, avatar, header) only reaches followers' servers through
 * an Update(Person) carrying the new actor.
 */
async function onProfileChanged(strapi: Core.Strapi): Promise<void> {
  const ctx = createContext(strapi);
  const actor = await buildActor(ctx, ACTOR_IDENTIFIER);
  const fanOut = await sendToFollowers(
    strapi,
    new Update({
      id: new URL(`#profile-update/${Date.now()}`, actor.id!),
      actor: actor.id,
      object: actor,
      to: PUBLIC_COLLECTION,
      cc: ctx.getFollowersUri(ACTOR_IDENTIFIER),
    })
  );
  strapi.log.info(`[fediverse] Update(Person) for the profile: ${describeFanOut(fanOut)}`);
}

/**
 * Federates article publish state changes and profile edits. Failures are logged and swallowed:
 * the events fire after the Strapi operation has committed, and federation
 * problems must never surface as editor-facing errors.
 */
export function subscribe(strapi: Core.Strapi): void {
  const guarded =
    (
      uid: string,
      label: string,
      handler: (strapi: Core.Strapi, event: EntryEvent) => Promise<void>
    ) =>
    async (event: EntryEvent): Promise<void> => {
      if (event?.uid !== uid) return;
      try {
        await handler(strapi, event);
      } catch (error) {
        strapi.log.error(`[fediverse] ${label} failed`, { error });
      }
    };

  unsubscribers = [
    strapi.eventHub.on(
      'entry.publish',
      guarded(ARTICLE_UID, 'article publish federation', onPublish)
    ),
    strapi.eventHub.on(
      'entry.unpublish',
      guarded(ARTICLE_UID, 'article unpublish federation', onRemoved)
    ),
    strapi.eventHub.on(
      'entry.delete',
      guarded(ARTICLE_UID, 'article delete federation', onRemoved)
    ),
    // `global` has no draft & publish: saving it in the admin emits entry.update.
    strapi.eventHub.on(
      'entry.create',
      guarded(GLOBAL_UID, 'profile update federation', onProfileChanged)
    ),
    strapi.eventHub.on(
      'entry.update',
      guarded(GLOBAL_UID, 'profile update federation', onProfileChanged)
    ),
  ];
}

/** Stops federating article and profile changes; called by the plugin's `destroy()`. */
export function unsubscribe(): void {
  for (const off of unsubscribers) off();
  unsubscribers = [];
}
