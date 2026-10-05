import type { Core } from '@strapi/strapi';
import { checkArticleCitations } from './api/article/utils/check-citations';
import { blocksToPlainText } from './api/article/utils/plain-text';
import { backfillArticlePlainText } from './migrations/article-plain-text';
import { backfillCommentLocale } from './migrations/comment-locale';
import { consolidateCategories, hasChanges } from './migrations/consolidate-categories';
import { grantPublicTagPermissions } from './migrations/public-tag-permissions';
import { revokeSubscriberPermissions } from './migrations/subscriber-permissions';
import { ensureEditorRole } from './migrations/editor-role';
import { applyAccountSettings } from './migrations/account-settings';
import { migrateSliderItems } from './migrations/slider-items';
import { revokeSiteSettingPermissions, seedSiteSettings } from './migrations/site-settings';
import { seedDemoContent } from './migrations/demo-seed';
import { ensureBuildToken, ensureFrontendToken } from './migrations/api-tokens';
import { revokePagePermissions } from './migrations/page-permissions';
import {
  ABOUT_UID,
  ARTICLE_STAT_UID,
  ARTICLE_UID,
  PAGE_UID,
  SITE_SETTING_UID,
} from './constants/uids';
import { isUmamiConfigured } from './api/article-stat/utils/umami-client';
import type { UmamiConfig } from './types/article-stat';
import { assertImageCreditsValid } from './utils/image-credit';
import { assertAccentOverridesValid } from './utils/site-theme';
import { assertPageSectionsValid } from './utils/page-sections';
import { registerRebuildHook } from './utils/rebuild-hook';
import { restrictDraftsToEditors } from './utils/drafts-access';
import { assertFrontendUrlConfigured } from './utils/frontend-url';

/** Unsubscribes the rebuild hook; set while it is registered. */
let stopRebuildHook: (() => void) | null = null;

export default {
  /** Before init: Document Service middlewares and extra admin routes. */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Links in emails, analytics paths and the site settings' URL point to the
    // frontend; in production there is no default to fall back on.
    assertFrontendUrlConfigured();
    if (process.env.SMTP_HOST && !process.env.EMAIL_FROM) {
      strapi.log.warn(
        "[email] EMAIL_FROM is not set: emails go out from no-reply@ the frontend's host"
      );
    }

    // Rejects citations without a reference, and keeps the article's
    // searchable plain text in step with its body.
    strapi.documents.use(async (context, next) => {
      if (
        context.uid === ARTICLE_UID &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const params = context.params as {
          documentId?: string;
          locale?: string;
          data?: Record<string, unknown>;
        };
        await checkArticleCitations(strapi, params);
        const data = params.data;
        if (data && 'blocks' in data) data.plainText = blocksToPlainText(data.blocks);
      }
      return next();
    });

    // Rejects image credits that break their license's attribution terms.
    strapi.documents.use(async (context, next) => {
      if (
        (context.uid === ARTICLE_UID || context.uid === ABOUT_UID) &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const data = (context.params as { data?: Record<string, unknown> }).data;
        if (data) assertImageCreditsValid(data);
      }
      return next();
    });

    // Rejects a post list with both a category and a tag, and a scene whose
    // model is not a glTF file.
    strapi.documents.use(async (context, next) => {
      if (
        context.uid === PAGE_UID &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const data = (context.params as { data?: Record<string, unknown> }).data;
        if (data) await assertPageSectionsValid(strapi, data);
      }
      return next();
    });

    // Rejects incomplete accent overrides and two overrides for one mode.
    strapi.documents.use(async (context, next) => {
      if (
        context.uid === SITE_SETTING_UID &&
        (context.action === 'create' || context.action === 'update')
      ) {
        const data = (context.params as { data?: Record<string, unknown> }).data;
        if (data) assertAccentOverridesValid(data);
      }
      return next();
    });

    // Only editors may read drafts through the content API (?status=draft).
    restrictDraftsToEditors(strapi);

    // Admin API route (admin session required) for the visitors widget on the
    // admin homepage (src/admin). Routes under src/api are always registered as
    // content API, so this one is added here.
    strapi.server.routes({
      type: 'admin',
      prefix: '/article-stats',
      routes: [
        {
          method: 'GET',
          path: '/summary',
          handler: `${ARTICLE_STAT_UID}.summary`,
          config: { policies: ['admin::isAuthenticatedAdmin'] },
          info: { apiName: 'article-stat', type: 'admin' },
        },
      ],
    });
  },

  /**
   * On every boot, before listening: idempotent data migrations
   * (src/migrations), then the Umami cron. Order matters where noted.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const report = await consolidateCategories(strapi);
    if (hasChanges(report)) {
      strapi.log.info(`[categories] consolidated: ${JSON.stringify(report)}`);
    }
    if (report.untouched.length > 0) {
      strapi.log.warn(`[categories] not part of the redesign: ${report.untouched.join(', ')}`);
    }

    const filled = await backfillArticlePlainText(strapi);
    if (filled > 0) strapi.log.info(`[articles] filled the plain text of ${filled} rows`);

    const sliders = await migrateSliderItems(strapi);
    if (sliders > 0) strapi.log.info(`[sliders] copied files into items for ${sliders} sliders`);

    const localized = await backfillCommentLocale(strapi);
    if (localized > 0) strapi.log.info(`[comments] set the locale of ${localized} comments`);

    const tagPermissions = await grantPublicTagPermissions(strapi);
    if (tagPermissions > 0) {
      strapi.log.info(`[tags] granted ${tagPermissions} public read permissions`);
    }

    const subscriberPermissions = await revokeSubscriberPermissions(strapi);
    if (subscriberPermissions > 0) {
      strapi.log.info(`[subscribers] revoked ${subscriberPermissions} role permissions`);
    }

    const siteLocales = await seedSiteSettings(strapi);
    if (siteLocales.length > 0) {
      strapi.log.info(`[site-settings] created neutral settings in ${siteLocales.join(', ')}`);
    }
    // After the site settings exist: the demo replaces their neutral values.
    const demo = await seedDemoContent(strapi);
    if (demo !== 'disabled' && demo !== 'already-applied') {
      strapi.log.info(`[demo] ${demo}`);
    }

    for (const [name, ensure] of [
      ['frontend', ensureFrontendToken],
      ['build', ensureBuildToken],
    ] as const) {
      const report = await ensure(strapi);
      if (report === 'created' || report === 'updated') {
        strapi.log.info(`[api-tokens] ${report} the ${name} API token`);
      }
    }

    const pagePermissions = await revokePagePermissions(strapi);
    if (pagePermissions > 0) {
      strapi.log.info(`[pages] revoked ${pagePermissions} role permissions`);
    }

    const siteSettingPermissions = await revokeSiteSettingPermissions(strapi);
    if (siteSettingPermissions > 0) {
      strapi.log.info(`[site-settings] revoked ${siteSettingPermissions} role permissions`);
    }

    const editor = await ensureEditorRole(strapi);
    if (editor.roleCreated || editor.permissionsGranted > 0) {
      strapi.log.info(`[roles] editor: ${JSON.stringify(editor)}`);
    }

    // After the Editor role exists: it also gets DELETE /api/users/me.
    const accounts = await applyAccountSettings(strapi);
    if (accounts.settingsApplied || accounts.permissionsGranted > 0) {
      strapi.log.info(`[accounts] ${JSON.stringify(accounts)}`);
    }

    scheduleUmamiSync(strapi);

    // Static and landing sites rebuild when published content changes.
    stopRebuildHook = registerRebuildHook(strapi);
  },

  destroy() {
    stopRebuildHook?.();
    stopRebuildHook = null;
  },
};

/**
 * Syncs article visitors from Umami every `UMAMI_SYNC_CRON` and once right
 * after boot, so a deploy doesn't leave the most read list empty for an hour.
 * A failure only logs: the previous counts stay until the next run.
 */
function scheduleUmamiSync(strapi: Core.Strapi) {
  const config = strapi.config.get<UmamiConfig>('umami');
  if (!strapi.config.get<boolean>('server.cron.enabled') || !isUmamiConfigured(config)) return;

  const run = async () => {
    try {
      const report = await strapi.service(ARTICLE_STAT_UID).sync();
      strapi.log.info(`[umami] synced article visitors: ${JSON.stringify(report)}`);
    } catch (error) {
      strapi.log.warn(`[umami] sync failed, keeping the previous counts: ${error}`);
    }
  };
  strapi.cron.add({ umamiSync: { task: run, options: { rule: config.syncCron } } });
  void run();
}
