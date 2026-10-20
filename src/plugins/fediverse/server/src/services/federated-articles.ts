import type { Core } from '@strapi/strapi';

import { FEDERATED_ARTICLE_UID } from '../constants/uids';
import type {
  FederatedActivityType,
  FederatedArticleRow,
  FederatedArticleStatus,
} from '../types/federated-articles';
import { describeDeliveryError } from '../utils/delivery-error';

/** Plugin store key that held the federated article ids before the content type. */
const LEGACY_STORE_KEY = 'federatedArticles';
/** Ids per `$in` filter, under the 999 variables SQLite accepts in one statement. */
const MIGRATION_CHUNK = 500;

const STATUS_OF: Record<FederatedActivityType, FederatedArticleStatus> = {
  Create: 'created',
  Update: 'updated',
  Delete: 'deleted',
};

// The article is referenced by documentId rather than a relation, as the
// interactions are: articles are draft-and-publish and localized.
function query(strapi: Core.Strapi) {
  return strapi.db.query(FEDERATED_ARTICLE_UID);
}

/**
 * Keeps the oldest row of an article and deletes the others. Strapi's
 * `unique: true` creates no database index, so concurrent inserts through
 * `db.query` can both succeed; every writer settles the set after inserting,
 * as `services/interactions.ts` does, so exactly one row survives.
 */
async function settleDuplicates(
  strapi: Core.Strapi,
  articleDocumentId: string
): Promise<FederatedArticleRow> {
  const rows = (await query(strapi).findMany({
    where: { articleDocumentId },
    orderBy: { id: 'asc' },
  })) as FederatedArticleRow[];
  const [oldest, ...duplicates] = rows;
  for (const duplicate of duplicates) {
    await query(strapi).delete({ where: { documentId: duplicate.documentId } });
  }
  return oldest;
}

/** Whether the article has been sent and not retracted, so a re-publish becomes an `Update`. */
export async function isFederated(
  strapi: Core.Strapi,
  articleDocumentId: string
): Promise<boolean> {
  const row = (await query(strapi).findOne({
    where: { articleDocumentId },
    orderBy: { id: 'asc' },
  })) as FederatedArticleRow | null;
  // A failed delivery still counts: the article may have reached some followers.
  return row != null && row.status !== 'deleted';
}

/**
 * Records that an activity is about to be sent for the article and returns the
 * timestamp that identifies it, for `recordFailure`.
 *
 * @remarks
 * Written before delivering on purpose: an unpublish that lands mid-delivery,
 * or a delivery that fails for one follower, must still end in a `Delete`.
 * `attempts` restarts at 1 for each new activity. `createSentAt` is set by a
 * `Create` and kept by the others.
 */
export async function recordSend(
  strapi: Core.Strapi,
  articleDocumentId: string,
  type: FederatedActivityType
): Promise<string> {
  const now = new Date().toISOString();
  const data = {
    status: STATUS_OF[type],
    lastActivityAt: now,
    lastActivityType: type,
    attempts: 1,
    lastError: null,
  };

  const existing = (await query(strapi).findOne({
    where: { articleDocumentId },
    orderBy: { id: 'asc' },
  })) as FederatedArticleRow | null;
  if (existing) {
    await query(strapi).update({
      where: { id: existing.id },
      data: type === 'Create' ? { ...data, createSentAt: now } : data,
    });
    return now;
  }

  const created = (await query(strapi).create({
    data: { articleDocumentId, createSentAt: type === 'Create' ? now : null, ...data },
  })) as FederatedArticleRow;
  const oldest = await settleDuplicates(strapi, articleDocumentId);
  if (oldest.id !== created.id) {
    await query(strapi).update({ where: { id: oldest.id }, data });
  }
  return now;
}

/**
 * Marks the activity identified by `activityAt` as failed and keeps why.
 * Does nothing when a newer activity has been recorded since, so a slow failure
 * never overwrites the state of a later publish or unpublish.
 */
export async function recordFailure(
  strapi: Core.Strapi,
  articleDocumentId: string,
  activityAt: string,
  error: unknown
): Promise<void> {
  await query(strapi).update({
    where: { articleDocumentId, lastActivityAt: activityAt },
    data: { status: 'failed', lastError: describeDeliveryError(error) },
  });
}

function legacyIds(value: unknown): string[] {
  return value != null && typeof value === 'object' ? Object.keys(value) : [];
}

/**
 * Turns every id of the old `federatedArticles` store key into a row with
 * `status: created` and no `createSentAt`. Idempotent: an article that already
 * has a row is left untouched, and the key stays in place for one release line
 * so a rollback still finds it.
 *
 * @returns How many rows were created.
 */
export async function migrateFederatedArticles(strapi: Core.Strapi): Promise<number> {
  const stored: unknown = await strapi
    .store({ type: 'plugin', name: 'fediverse' })
    .get({ key: LEGACY_STORE_KEY });
  const ids = legacyIds(stored);

  let created = 0;
  for (let start = 0; start < ids.length; start += MIGRATION_CHUNK) {
    const chunk = ids.slice(start, start + MIGRATION_CHUNK);
    const known = new Set(
      (
        (await query(strapi).findMany({
          where: { articleDocumentId: { $in: chunk } },
        })) as FederatedArticleRow[]
      ).map((row) => row.articleDocumentId)
    );
    for (const articleDocumentId of chunk.filter((id) => !known.has(id))) {
      await query(strapi).create({
        data: { articleDocumentId, status: 'created', createSentAt: null, attempts: 0 },
      });
      await settleDuplicates(strapi, articleDocumentId);
      created += 1;
    }
  }
  if (created > 0) {
    strapi.log.info(`[fediverse] migrated ${created} federated article(s) from the plugin store`);
  }
  return created;
}

export default (): {
  isFederated: typeof isFederated;
  recordSend: typeof recordSend;
  recordFailure: typeof recordFailure;
  migrateFederatedArticles: typeof migrateFederatedArticles;
} => ({
  isFederated,
  recordSend,
  recordFailure,
  migrateFederatedArticles,
});
