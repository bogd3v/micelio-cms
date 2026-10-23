import { factories } from '@strapi/strapi'
import { SUBSCRIBER_UID } from '../../../constants/uids'
import { LOOKUP_FIELDS, LOOKUP_MAX_LENGTH } from '../constants'
import type { LookupField } from '../types'

interface LookupBody {
  field: LookupField
  value: string
}

function isLookupBody(body: unknown): body is LookupBody {
  if (typeof body !== 'object' || body === null) return false
  const { field, value } = body as Record<string, unknown>
  return (
    typeof field === 'string' &&
    (LOOKUP_FIELDS as readonly string[]).includes(field) &&
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= LOOKUP_MAX_LENGTH
  )
}

export default factories.createCoreController(SUBSCRIBER_UID, ({ strapi }) => ({
  /** POST /api/subscribers/lookup `{ field, value }` (frontend token only, see routes/01-lookup.ts) */
  async lookup(ctx) {
    const body: unknown = ctx.request.body
    if (!isLookupBody(body)) {
      return ctx.badRequest(
        `field must be one of ${LOOKUP_FIELDS.join(', ')} and value a string of 1 to ${LOOKUP_MAX_LENGTH} characters`
      )
    }

    const data = await strapi.service(SUBSCRIBER_UID).findOneBy(body.field, body.value)
    // The answer holds an email and tokens: no cache may keep it.
    ctx.set('Cache-Control', 'private, no-store')
    return { data }
  },
}))
