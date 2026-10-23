/**
 * Finds a subscriber by a request body, so the email or token never travels in
 * a URL (ASVS V14.2.1). Registered ahead of the core router (see
 * article/routes/01-search.ts). No `auth: false`: it needs an API token that
 * holds `api::subscriber.subscriber.lookup`, which only the frontend token
 * gets (src/migrations/api-tokens.ts); no role has it.
 */

import { SUBSCRIBER_UID } from '../../../constants/uids'

export default {
  routes: [
    {
      method: 'POST',
      path: '/subscribers/lookup',
      handler: `${SUBSCRIBER_UID}.lookup`,
    },
  ],
}
