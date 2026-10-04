import type { Core } from '@strapi/strapi';
import { PAGE_UID } from '../constants/uids';

const PERMISSION_UID = 'plugin::users-permissions.permission';

/**
 * Removes every users-permissions permission on pages (#75): the frontend
 * reads them with its API token, and a static build with the read-only
 * `build` token, so neither the public role nor signed-in readers get them.
 * Idempotent. Returns how many were removed.
 */
export async function revokePagePermissions(strapi: Core.Strapi): Promise<number> {
  const permissions = (await strapi.db.query(PERMISSION_UID).findMany({
    select: ['id'],
    where: { action: { $startsWith: `${PAGE_UID}.` } },
  })) as { id: number }[];
  if (permissions.length === 0) return 0;

  await strapi.db.query(PERMISSION_UID).deleteMany({
    where: { id: { $in: permissions.map((permission) => permission.id) } },
  });
  await strapi.service('plugin::users-permissions.users-permissions').initialize();
  return permissions.length;
}
