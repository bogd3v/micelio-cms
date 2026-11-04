import type { Core } from '@strapi/strapi'
import { SUPER_ADMIN_ROLE_CODE, THEME_PICKER_FIELD } from '../constants/theme-registry'
import type { LastRebuildModel } from '../types/rebuild-status'
import type { ThemePin } from '../types/theme-registry'
import { createThemeIndexReader, type ThemeIndexReader } from './theme-index'
import { readLastRebuild } from './rebuild-status'
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
 * Registers the admin routes of the theme field, both for the Super Admin only (an admin session
 * is required, as for any admin route; no API token reaches them):
 *
 * - `GET /theme-picker/themes`: the registry's themes for the picker of `site.theme.themeId`.
 *   `?id=` and `?version=` name the pinned theme so the answer says whether a newer compatible
 *   version exists.
 * - `GET /theme-picker/last-rebuild`: how the static builder's last run ended, read from the file
 *   `REBUILD_STATUS_FILE` names (#405). It reads one small file and never waits on the builder.
 *
 * @remarks
 * When the registry cannot be read the answer of `themes` is `200` with `indexAvailable: false`
 * and no themes, so the field falls back to free text instead of showing an error. The cause is
 * logged.
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
      {
        method: 'GET',
        path: '/last-rebuild',
        handler: async (ctx: AdminContext) => {
          if (!isSuperAdmin(ctx)) ctx.throw(403, 'Only the Super Admin may read the last rebuild')
          const configured = Boolean(process.env.REBUILD_STATUS_FILE)
          let lastRebuild = null
          let unreadable = false
          try {
            lastRebuild = await readLastRebuild()
          } catch (error) {
            unreadable = true
            // Only the cause's code: the message of a failed read names the path.
            const code = (error as NodeJS.ErrnoException).code
            strapi.log.warn(
              `[theme-picker] could not read the builder's last run${typeof code === 'string' ? ` (${code})` : ''}`
            )
          }
          const model: LastRebuildModel = { configured, lastRebuild, unreadable }
          ctx.body = { data: model }
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
