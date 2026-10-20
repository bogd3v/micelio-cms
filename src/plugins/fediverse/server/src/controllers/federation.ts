import type { Core } from '@strapi/strapi';
import type { Ability } from '@casl/ability';

import { ARTICLE_UID } from '../constants/uids';
import { getDefaultLocale } from '../services/articles';
import { describeFederation, federateBlocker } from '../services/federation-panel';
import { federateArticle } from '../services/publisher';
import type { FederateResult, FederationProblemCode } from '../types/federation-panel';
import { PROBLEM_CONTENT_TYPE, problemBody } from '../utils/problem';

interface Context {
  params: Record<string, string>;
  query: Record<string, unknown>;
  state: { userAbility?: Ability };
  status: number;
  type: string;
  body: unknown;
}

const PROBLEM_TITLES: Record<FederationProblemCode, string> = {
  'article-not-found': 'Article not found',
  forbidden: 'Not allowed',
  'article-not-published': 'Article not published',
  'locale-not-federated': 'Locale not federated',
  'queue-unavailable': 'Delivery queue unavailable',
};

function sendProblem(
  ctx: Context,
  status: number,
  code: FederationProblemCode,
  detail: string
): void {
  ctx.status = status;
  ctx.body = problemBody(status, code, PROBLEM_TITLES[code], detail);
  // After the body: assigning an object sets the type to plain JSON.
  ctx.type = PROBLEM_CONTENT_TYPE;
}

/**
 * The federation panel of the Content Manager: admin routes, so they need an admin session, and
 * Content Manager permissions on articles, checked the way Content Manager checks its own.
 */
export default ({
  strapi,
}: {
  strapi: Core.Strapi;
}): Record<'find' | 'federate', (ctx: Context) => Promise<void>> => {
  /**
   * Reads the article the request names, in the locale the editor has open, and checks that the
   * admin may do `action` on it. Answers the problem itself and returns `null` when not.
   */
  async function authorize(ctx: Context, action: 'read' | 'publish') {
    const { documentId } = ctx.params;
    const queried = ctx.query.locale;
    const locale =
      typeof queried === 'string' && queried !== '' ? queried : await getDefaultLocale(strapi);

    if (ctx.state.userAbility == null) {
      sendProblem(ctx, 403, 'forbidden', `Your role may not ${action} articles.`);
      return null;
    }
    const checker = strapi
      .plugin('content-manager')
      .service('permission-checker')
      .create({ userAbility: ctx.state.userAbility, model: ARTICLE_UID });
    // As Content Manager does: the role first, so a role with no access learns nothing about
    // which ids exist; then the document, whose conditions (e.g. "is creator") need its relations.
    if (checker.cannot[action]()) {
      sendProblem(ctx, 403, 'forbidden', `Your role may not ${action} articles.`);
      return null;
    }
    const document = await strapi
      .documents(ARTICLE_UID)
      .findOne({ documentId, locale, populate: { createdBy: true } });
    if (document == null) {
      sendProblem(ctx, 404, 'article-not-found', 'There is no such article in this locale.');
      return null;
    }
    if (checker.cannot[action](document)) {
      sendProblem(ctx, 403, 'forbidden', `Your role may not ${action} this article.`);
      return null;
    }
    return { documentId, locale };
  }

  return {
    async find(ctx) {
      const target = await authorize(ctx, 'read');
      if (target == null) return;
      ctx.body = await describeFederation(strapi, target.documentId, target.locale);
    },

    async federate(ctx) {
      const target = await authorize(ctx, 'publish');
      if (target == null) return;

      const blocker = await federateBlocker(strapi, target.documentId, target.locale);
      if (blocker != null) {
        sendProblem(
          ctx,
          409,
          blocker,
          blocker === 'locale-not-federated'
            ? 'Only the default locale is federated.'
            : 'Only a published version with a title and slug can be federated.'
        );
        return;
      }

      let outcome;
      try {
        outcome = await federateArticle(strapi, target.documentId);
      } catch (error) {
        // The activity could not be queued (e.g. the queue's database is down).
        strapi.log.error(
          `[fediverse] "Federate now" for ${target.documentId} failed: ${error instanceof Error ? error.name : 'unknown error'}`
        );
        sendProblem(
          ctx,
          503,
          'queue-unavailable',
          'The activity could not be queued; try again in a moment.'
        );
        return;
      }
      if (outcome.status === 'not-federable') {
        // Unpublished between the check above and the send.
        sendProblem(
          ctx,
          409,
          'article-not-published',
          'Only a published version with a title and slug can be federated.'
        );
        return;
      }
      const result: FederateResult = {
        activity: outcome.type,
        queued: outcome.fanOut.queued,
        skipped: outcome.fanOut.skipped,
      };
      ctx.status = 202;
      ctx.body = result;
    },
  };
};
