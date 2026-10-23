import type { Core } from '@strapi/strapi'
import { factories } from '@strapi/strapi'

import categorySchema from './content-types/category/schema.json'
import { CATEGORY_UID, TAG_UID } from './constants/actions'
import tagSchema from './content-types/tag/schema.json'
import { renameLegacyUids } from './migrations/rename-legacy-uids'

// `prefix: ''` drops the `/micelio` segment a plugin's content-api routes get, so
// `/api/categories` and `/api/tags` keep answering where the frontend expects them.
const categoryRouter = factories.createCoreRouter(CATEGORY_UID, { prefix: '' })
const tagRouter = factories.createCoreRouter(TAG_UID, { prefix: '' })

export default {
  register({ strapi }: { strapi: Core.Strapi }): void {
    // Before any plugin bootstraps: users-permissions deletes the permissions of an action that no
    // longer exists in its own bootstrap, and the rename has to reach them first.
    strapi.hook('strapi::content-types.beforeSync').register(async () => {
      const report = await renameLegacyUids(strapi)
      if (report.actions + report.subjects + report.layouts > 0) {
        strapi.log.info(`[micelio] moved legacy category and tag UIDs: ${JSON.stringify(report)}`)
      }
    })
  },
  contentTypes: {
    category: { schema: categorySchema },
    tag: { schema: tagSchema },
  },
  controllers: {
    category: factories.createCoreController(CATEGORY_UID),
    tag: factories.createCoreController(TAG_UID),
  },
  services: {
    category: factories.createCoreService(CATEGORY_UID),
    tag: factories.createCoreService(TAG_UID),
  },
  routes: {
    category: categoryRouter,
    tag: tagRouter,
  },
}
