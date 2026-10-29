import type { Core } from '@strapi/strapi'
import { errors } from '@strapi/utils'
import { SITE_SETTING_UID } from '../constants/uids'
import { SUPER_ADMIN_ROLE_CODE } from '../constants/theme-registry'

interface RequestState {
  auth?: { strategy?: { name?: string } }
  user?: { roles?: { code?: string }[] }
}

/** The Document Service actions whose `params.data` is written to the document (`clone` copies the source, then applies `data`). */
const WRITES = new Set(['create', 'update', 'clone'])

/**
 * Keeps the theme of the site settings writable by the Super Admin only, at the moment of the write.
 *
 * @remarks
 * The stored field permissions (`restrictThemeToSuperAdmin`) are applied at boot, so a role created
 * or edited in the admin could change the theme until the next restart, and the permissions of an
 * admin API token are not tied to a role at all. This Document Service middleware closes both:
 * during a request, a `create`, `update` or `clone` that carries `theme` is refused (403) when the caller is an API token
 * of any kind, and has `theme` dropped when it is an admin session without the Super Admin role,
 * which is how Strapi treats a field the role may not write. Calls outside a request (boot, seeding,
 * cron) are left alone.
 */
export function restrictThemeWrites(strapi: Core.Strapi): void {
  strapi.documents.use(async (context, next) => {
    if (context.uid !== SITE_SETTING_UID || !WRITES.has(context.action)) return next()
    const data = (context.params as { data?: Record<string, unknown> }).data
    if (!data || !('theme' in data)) return next()

    const state = strapi.requestContext.get()?.state as RequestState | undefined
    if (!state) return next()

    if (state.auth?.strategy?.name !== 'admin') {
      throw new errors.ForbiddenError('Only the Super Admin may change the theme')
    }
    if (!state.user?.roles?.some((role) => role.code === SUPER_ADMIN_ROLE_CODE)) {
      delete data.theme
    }
    return next()
  })
}
