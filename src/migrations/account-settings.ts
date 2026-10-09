import type { Core } from '@strapi/strapi';
import { SITE_SETTING_UID } from '../constants/uids';
import { frontendBaseUrl } from '../utils/frontend-url';

const ROLE_UID = 'plugin::users-permissions.role';
const PERMISSION_UID = 'plugin::users-permissions.permission';
// DELETE /api/users/me (src/extensions/users-permissions). Never `user.destroy`:
// that one deletes any user by id. Public has it too so that a request without
// a JWT reaches the controller and gets a 401; the controller only ever deletes
// the user of the JWT.
const DELETE_ME_ACTION = 'plugin::users-permissions.user.destroyMe';
const DELETE_ME_ROLES = ['public', 'authenticated', 'editor'];
// Marks that the defaults below were written once; from then on the admin
// panel (Users & Permissions → Advanced settings, Email templates) owns them.
const MARKER = { type: 'core', name: 'migrations', key: 'account-settings' };
const VERSION = 1;

function frontendUrl(path: string): string {
  return `${frontendBaseUrl().replace(/\/+$/, '')}${path}`;
}

function advancedSettings() {
  return {
    allow_register: true,
    default_role: 'authenticated',
    unique_email: true,
    email_confirmation: true,
    email_confirmation_redirection: frontendUrl('/account/confirmed'),
    email_reset_password: frontendUrl('/account/reset-password'),
  };
}

// An empty `from` makes users-permissions fall back to the email provider's
// `defaultFrom` (EMAIL_FROM), so the sender is set per environment.
const FROM = { name: '', email: '' };

/** Name used in the emails when the site settings have none. */
const FALLBACK_SITE_NAME = 'Micelio';

/**
 * HTML-escapes the site name. users-permissions renders the templates with
 * lodash `template`, so escaping `<` also keeps a name like `<%= … %>` from
 * being evaluated.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Sign-up confirmation and password reset emails, in English or Spanish. */
export function accountEmailTemplates(siteName: string, language: string) {
  const site = escapeHtml(siteName);
  if (language === 'es') {
    return {
      email_confirmation: {
        object: `Confirma tu correo en ${site}`,
        message: `<p>Hola <%= USER.username %>,</p>

<p>Gracias por crear tu cuenta en ${site}. Confirma tu correo con este enlace:</p>

<p><a href="<%= URL %>?confirmation=<%= CODE %>">Confirmar mi correo</a></p>

<p>Si no creaste una cuenta, ignora este mensaje.</p>`,
      },
      reset_password: {
        object: `Restablece tu contraseña de ${site}`,
        message: `<p>Hola,</p>

<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en ${site}. Elige una nueva con este enlace:</p>

<p><a href="<%= URL %>?code=<%= TOKEN %>">Restablecer mi contraseña</a></p>

<p>Si no lo pediste, ignora este mensaje: tu contraseña no cambia.</p>`,
      },
    };
  }
  return {
    email_confirmation: {
      object: `Confirm your email for ${site}`,
      message: `<p>Hi <%= USER.username %>,</p>

<p>Thanks for creating your account on ${site}. Confirm your email with this link:</p>

<p><a href="<%= URL %>?confirmation=<%= CODE %>">Confirm my email</a></p>

<p>If you didn't create an account, ignore this message.</p>`,
    },
    reset_password: {
      object: `Reset your ${site} password`,
      message: `<p>Hi,</p>

<p>We received a request to reset the password of your account on ${site}. Choose a new one with this link:</p>

<p><a href="<%= URL %>?code=<%= TOKEN %>">Reset my password</a></p>

<p>If you didn't ask for it, ignore this message: your password stays the same.</p>`,
    },
  };
}

/**
 * The site's name and language for the emails: the site settings in their
 * `defaultLocale` (seeded before this migration runs), else neutral values.
 */
async function siteIdentity(strapi: Core.Strapi): Promise<{ name: string; language: string }> {
  const settings = strapi.documents(SITE_SETTING_UID);
  const any = (await settings.findFirst()) as { defaultLocale?: string; name?: string } | null;
  const language = any?.defaultLocale ?? 'en';
  const localized = (await settings.findFirst({ locale: language })) as { name?: string } | null;
  return { name: localized?.name || any?.name || FALLBACK_SITE_NAME, language };
}

type EmailTemplates = Record<
  keyof ReturnType<typeof accountEmailTemplates>,
  { options: Record<string, unknown> & { object: string; message: string } }
>;

/** `settingsApplied`: the settings were written in this run; `permissionsGranted`: permissions created in this run. */
export type AccountSettingsReport = { settingsApplied: boolean; permissionsGranted: number };

/**
 * Account settings for issue #52.
 *
 * - Once (tracked by a store marker): turns on sign-up with email confirmation,
 *   points the confirmation and reset links at the frontend (`FRONTEND_URL`)
 *   and writes the email templates with the site's name, in the language of
 *   the site settings' `defaultLocale` (English or Spanish). Later boots
 *   leave them alone, so what an admin changes in the panel sticks; an
 *   instance where they were already applied (BogDev's, in Spanish) keeps
 *   its templates.
 * - Every boot (idempotent): grants `DELETE /api/users/me` to the Public,
 *   Authenticated and Editor roles. Runs after `seedSiteSettings` and
 *   `ensureEditorRole`.
 */
export async function applyAccountSettings(strapi: Core.Strapi): Promise<AccountSettingsReport> {
  const applied = (await strapi.store.get(MARKER)) as { version?: number } | null;
  const settingsApplied = !applied || (applied.version ?? 0) < VERSION;

  if (settingsApplied) {
    const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });

    const advanced = ((await pluginStore.get({ key: 'advanced' })) ?? {}) as object;
    await pluginStore.set({ key: 'advanced', value: { ...advanced, ...advancedSettings() } });

    // users-permissions creates the templates in its own bootstrap, before ours.
    const email = (await pluginStore.get({ key: 'email' })) as EmailTemplates | null;
    if (email) {
      const site = await siteIdentity(strapi);
      const templates = accountEmailTemplates(site.name, site.language);
      for (const [name, template] of Object.entries(templates)) {
        const current = email[name as keyof EmailTemplates];
        if (current) current.options = { ...current.options, ...template, from: FROM };
      }
      await pluginStore.set({ key: 'email', value: email });
    }

    await strapi.store.set({ ...MARKER, value: { version: VERSION } });
  }

  let permissionsGranted = 0;
  for (const type of DELETE_ME_ROLES) {
    const role = (await strapi.db.query(ROLE_UID).findOne({ where: { type } })) as {
      id: number;
    } | null;
    if (!role) continue;
    const granted = await strapi.db
      .query(PERMISSION_UID)
      .count({ where: { role: role.id, action: DELETE_ME_ACTION } });
    if (granted > 0) continue;
    await strapi.db.query(PERMISSION_UID).create({
      data: { action: DELETE_ME_ACTION, role: role.id },
    });
    permissionsGranted += 1;
  }

  return { settingsApplied, permissionsGranted };
}
