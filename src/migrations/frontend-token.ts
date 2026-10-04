import type { Core } from '@strapi/strapi';

const TOKEN_UID = 'admin::api-token';
export const FRONTEND_TOKEN_NAME = 'frontend';

/**
 * What the frontend reads and writes through Strapi, as listed in micelio's
 * `docs/security.md` ("Permissions of the API token"). Keep both in step.
 */
export const FRONTEND_TOKEN_PERMISSIONS = [
  'api::article.article.find',
  'api::category.category.find',
  'api::tag.tag.find',
  'api::about.about.find',
  'api::site-setting.site-setting.find',
  'plugin::comments.client.findAllInHierarchy',
  'plugin::comments.client.findAllFlat',
  'plugin::comments.client.post',
  'api::subscriber.subscriber.find',
  'api::subscriber.subscriber.create',
  'api::subscriber.subscriber.update',
  'api::subscriber.subscriber.delete',
];

/** Shortest access key accepted: a guessable token would open the subscribers. */
const MIN_KEY_LENGTH = 32;

export type FrontendTokenReport = 'disabled' | 'created' | 'updated' | 'unchanged';

interface TokenRow {
  id: number;
  accessKey: string;
  type: string;
  permissions?: { action: string }[];
}

interface TokenService {
  hash(accessKey: string): string;
  getByName(name: string): Promise<{ id: number } | null>;
  create(attributes: Record<string, unknown>): Promise<{ id: number }>;
  update(id: number, attributes: Record<string, unknown>): Promise<unknown>;
}

/**
 * When `FRONTEND_API_TOKEN` is set, makes sure a Custom API token named
 * `frontend` exists whose access key is that value, with exactly
 * {@link FRONTEND_TOKEN_PERMISSIONS}. Strapi only generates random keys, so the
 * token is created and its key replaced (hash, and the encrypted copy the
 * admin panel shows). Lets an instance hand the same secret to the CMS and
 * the frontend (`NUXT_STRAPI_API_TOKEN`) without a manual step. Unset, it
 * does nothing: production keeps the token created by hand. Idempotent.
 */
export async function ensureFrontendToken(strapi: Core.Strapi): Promise<FrontendTokenReport> {
  const accessKey = process.env.FRONTEND_API_TOKEN?.trim();
  if (!accessKey) return 'disabled';
  if (accessKey.length < MIN_KEY_LENGTH) {
    throw new Error(`FRONTEND_API_TOKEN must be at least ${MIN_KEY_LENGTH} characters long`);
  }

  const tokens = strapi.service(TOKEN_UID) as unknown as TokenService;
  const hashed = tokens.hash(accessKey);
  const keyFields = {
    accessKey: hashed,
    encryptedKey: strapi.service('admin::encryption').encrypt(accessKey),
  };

  const existing = await tokens.getByName(FRONTEND_TOKEN_NAME);
  if (!existing) {
    const created = await tokens.create({
      name: FRONTEND_TOKEN_NAME,
      description: 'Frontend server (FRONTEND_API_TOKEN)',
      type: 'custom',
      lifespan: null,
      permissions: FRONTEND_TOKEN_PERMISSIONS,
    });
    await strapi.db.query(TOKEN_UID).update({ where: { id: created.id }, data: keyFields });
    return 'created';
  }

  const row = (await strapi.db.query(TOKEN_UID).findOne({
    where: { id: existing.id },
    populate: ['permissions'],
  })) as TokenRow;
  const actions = (row.permissions ?? []).map((permission) => permission.action).sort();
  const samePermissions =
    row.type === 'custom' &&
    actions.length === FRONTEND_TOKEN_PERMISSIONS.length &&
    [...FRONTEND_TOKEN_PERMISSIONS].sort().every((action, index) => actions[index] === action);
  if (row.accessKey === hashed && samePermissions) return 'unchanged';

  if (!samePermissions) {
    await tokens.update(row.id, { type: 'custom', permissions: FRONTEND_TOKEN_PERMISSIONS });
  }
  if (row.accessKey !== hashed) {
    await strapi.db.query(TOKEN_UID).update({ where: { id: row.id }, data: keyFields });
  }
  return 'updated';
}
