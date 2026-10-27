/**
 * page router
 */

import { factories } from '@strapi/strapi'
import { SITE_SCOPE_MIDDLEWARE } from '@micelio/strapi-plugin-core/strapi-server'

// One object for each action: Strapi writes the route's `auth.scope` into the config object it is
// given, so a shared one would carry the scope of the first action (`find`) onto `create`, `update`
// and `delete`, and a token that may only read could write.
const scoped = () => ({ middlewares: [SITE_SCOPE_MIDDLEWARE] })

export default factories.createCoreRouter('api::page.page', {
  config: {
    find: scoped(),
    findOne: scoped(),
    create: scoped(),
    update: scoped(),
    delete: scoped(),
  },
})
