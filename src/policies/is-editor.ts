import type { Core } from '@strapi/strapi';
import { SECURITY_EVENTS } from '../constants/security-events';
import type { AccessLogContext } from '../types/security-events';
import { logAccessRefusal } from '../utils/access-log';
import { canReadDrafts } from '../utils/drafts-access';

type RequestState = Parameters<typeof canReadDrafts>[0];

/** Lets through only users-permissions users with the Editor role (403 otherwise, and the refusal is logged). */
const isEditor: Core.PolicyHandler = (policyContext, _config, { strapi }) => {
  // On content API routes the policy context wraps the Koa context, `state` included.
  const ctx = policyContext as unknown as AccessLogContext & { state: RequestState };
  const allowed = canReadDrafts(ctx.state);
  if (!allowed) logAccessRefusal(strapi, ctx, SECURITY_EVENTS.accessEditorRefused, 'not-editor');
  return allowed;
};

export default isEditor;
