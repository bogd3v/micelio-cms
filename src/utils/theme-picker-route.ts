import type { Core } from '@strapi/strapi'
import { SUPER_ADMIN_ROLE_CODE, THEME_PICKER_FIELD } from '../constants/theme-registry'
import type { ThemePin } from '../types/theme-registry'
import { createThemeIndexReader, type ThemeIndexReader } from './theme-index'
import { buildThemePicker, readThemeStatus } from './theme-picker'

interface AdminContext {
  state: { user?: { roles?: { code?: string }[] } }
  query: Record<string, unknown>
  body: unknown
  status: number
  throw(status: number, message?: string): never
}

/** Shared by every request, so the index is read once per 5 minutes. */
let reader: ThemeIndexReader | null = null

/** Whether the signed-in admin has the Super Admin role, the only one that may change the theme. */
export const isSuperAdmin = (ctx: AdminContext): boolean =>
  ctx.state.user?.roles?.some((role) => role.code === SUPER_ADMIN_ROLE_CODE) ?? false

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/**
 * Registers `GET /theme-picker/themes` in the admin API: the registry's themes for the picker of
 * `site.theme.themeId`, for the Super Admin only (an admin session is required, as for any admin
 * route; no API token reaches it). `?id=` and `?version=` name the pinned theme so the answer says
 * whether a newer compatible version exists.
 *
 * @remarks
 * When the registry cannot be read the answer is `200` with `indexAvailable: false` and no
 * themes, so the field falls back to free text instead of showing an error. The cause is logged.
 */
export function registerThemePickerRoute(strapi: Core.Strapi): void {
  strapi.server.routes({
    type: 'admin',
    prefix: '/theme-picker',
    routes: [
      {
        method: 'GET',
        path: '/themes',
        handler: async (ctx: AdminContext) => {
          if (!isSuperAdmin(ctx)) ctx.throw(403, 'Only the Super Admin may read the theme registry')
          const pin: ThemePin = { id: text(ctx.query.id), version: text(ctx.query.version) }
          reader ??= createThemeIndexReader()
          let index = null
          try {
            index = await reader.read()
          } catch (error) {
            strapi.log.warn(
              `[theme-picker] could not read the theme registry: ${error instanceof Error ? error.message : 'unknown error'}`
            )
          }
          ctx.body = { data: buildThemePicker(index, readThemeStatus(), pin) }
        },
        config: {
          policies: ['admin::isAuthenticatedAdmin'],
        },
        info: { apiName: THEME_PICKER_FIELD, type: 'admin' },
      },
    ],
  })
}

/** Forgets the cached index; for tests. */
export function resetThemePickerCache(): void {
  reader = null
}
