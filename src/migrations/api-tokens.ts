import type { Core } from '@strapi/strapi';

const TOKEN_UID = 'admin::api-token';

/** A Custom API token an instance creates from an environment variable. */
export interface EnvToken {
  /** Variable holding the access key, shared with whoever uses the token. */
  env: string;
  name: string;
  description: string;
  permissions: string[];
}

/** Name of the frontend server's Custom API token. */
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
  'api::page.page.find',
  'api::author.author.find',
  'plugin::comments.client.findAllInHierarchy',
  'plugin::comments.client.findAllFlat',
  'plugin::comments.client.post',
  'api::subscriber.subscriber.find',
  'api::subscriber.subscriber.create',
  'api::subscriber.subscriber.update',
  'api::subscriber.subscriber.delete',
];

/** Name of the static build's Custom API token. */
export const BUILD_TOKEN_NAME = 'build';

/**
 * What a static build reads (micelio ADR 0006, section 7): published content
 * only. API tokens never get drafts (`src/utils/drafts-access.ts`), and this
 * one cannot write anything.
 */
export const BUILD_TOKEN_PERMISSIONS = [
  'api::article.article.find',
  'api::category.category.find',
  'api::tag.tag.find',
  'api::about.about.find',
  'api::site-setting.site-setting.find',
  'api::page.page.find',
  'api::author.author.find',
];

/** Definition of the frontend token, created from `FRONTEND_API_TOKEN`. */
export const FRONTEND_TOKEN: EnvToken = {
  env: 'FRONTEND_API_TOKEN',
  name: FRONTEND_TOKEN_NAME,
  description: 'Frontend server (FRONTEND_API_TOKEN)',
  permissions: FRONTEND_TOKEN_PERMISSIONS,
};

/** Definition of the static build token, created from `BUILD_API_TOKEN`. */
export const BUILD_TOKEN: EnvToken = {
  env: 'BUILD_API_TOKEN',
  name: BUILD_TOKEN_NAME,
  description: 'Static build, read-only (BUILD_API_TOKEN)',
  permissions: BUILD_TOKEN_PERMISSIONS,
};

/** Shortest access key accepted: a guessable token would open the subscribers. */
const MIN_KEY_LENGTH = 32;

/** `disabled`: the variable is unset; `created`, `updated`: the token was written; `unchanged`: key and permissions already match. */
export type EnvTokenReport = 'disabled' | 'created' | 'updated' | 'unchanged';

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
 * When the token's variable is set, makes sure a Custom API token with that
 * name exists whose access key is the variable's value, with exactly its
 * permissions. Strapi only generates random keys, so the token is created and
 * its key replaced (hash, and the encrypted copy the admin panel shows). Lets
 * an instance hand the same secret to the CMS and to whoever uses the token
 * (the frontend's `NUXT_STRAPI_API_TOKEN`, a build's secret) without a
 * manual step, and resets permissions someone widened. Unset, it does
 * nothing: production keeps its tokens created by hand. Idempotent.
 */
export async function ensureEnvToken(
  strapi: Core.Strapi,
  token: EnvToken
): Promise<EnvTokenReport> {
  const accessKey = process.env[token.env]?.trim();
  if (!accessKey) return 'disabled';
  if (accessKey.length < MIN_KEY_LENGTH) {
    throw new Error(`${token.env} must be at least ${MIN_KEY_LENGTH} characters long`);
  }

  const tokens = strapi.service(TOKEN_UID) as unknown as TokenService;
  const hashed = tokens.hash(accessKey);
  const keyFields = {
    accessKey: hashed,
    encryptedKey: strapi.service('admin::encryption').encrypt(accessKey),
  };

  const existing = await tokens.getByName(token.name);
  if (!existing) {
    const created = await tokens.create({
      name: token.name,
      description: token.description,
      type: 'custom',
      lifespan: null,
      permissions: token.permissions,
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
    actions.length === token.permissions.length &&
    [...token.permissions].sort().every((action, index) => actions[index] === action);
  if (row.accessKey === hashed && samePermissions) return 'unchanged';

  if (!samePermissions) {
    await tokens.update(row.id, { type: 'custom', permissions: token.permissions });
  }
  if (row.accessKey !== hashed) {
    await strapi.db.query(TOKEN_UID).update({ where: { id: row.id }, data: keyFields });
  }
  return 'updated';
}

/** The frontend's token, from `FRONTEND_API_TOKEN`. */
export const ensureFrontendToken = (strapi: Core.Strapi) => ensureEnvToken(strapi, FRONTEND_TOKEN);

/** The static build's read-only token, from `BUILD_API_TOKEN`. */
export const ensureBuildToken = (strapi: Core.Strapi) => ensureEnvToken(strapi, BUILD_TOKEN);
