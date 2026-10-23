import type { Core } from '@strapi/strapi'

import { DEFAULT_OBJECT_TYPE } from '../constants/object-type'
import { SITE_SETTING_UID } from '../constants/uids'
import type { FederatedObjectType } from '../types/articles'

/**
 * The type articles are sent as: `fediverse.objectType` of the site settings, read on every call
 * so a change needs no restart. Falls back to the `Note` default when the setting is empty,
 * unknown or cannot be read, so a site that never chose sends `Note` (#305).
 */
export async function getObjectType(strapi: Core.Strapi): Promise<FederatedObjectType> {
  try {
    const settings = (await strapi.documents(SITE_SETTING_UID).findFirst({
      populate: { fediverse: true },
    })) as { fediverse?: { objectType?: string | null } | null } | null
    return settings?.fediverse?.objectType === 'article' ? 'article' : DEFAULT_OBJECT_TYPE
  } catch (error) {
    strapi.log.warn('[fediverse] failed to load the object type from the site settings', {
      error,
    })
    return DEFAULT_OBJECT_TYPE
  }
}
