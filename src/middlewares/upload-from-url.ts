import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import type { Context, Next } from 'koa';
import { isUploadFromUrlEnabled, isUploadFromUrlRequest } from '../utils/upload-from-url';

/**
 * Answers 403 to `POST /upload/actions/upload-from-urls`, the Media Library
 * "From URL" import, unless `UPLOAD_FROM_URL_ENABLED` is exactly `true`.
 *
 * @remarks
 * The feature is off by default and is an operator opt-in. The variable is
 * read on each request. Only that route is gated; every other upload route is
 * untouched. Sits inside `strapi::errors`, so the refusal has Strapi's error
 * shape, and `global::forbidden-log` writes the `access.forbidden` event for
 * it. See `docs/security/uploads.md`.
 */
export default (_config: unknown, _: { strapi: Core.Strapi }) =>
  async (ctx: Context, next: Next): Promise<void> => {
    if (
      isUploadFromUrlRequest(ctx.method, ctx.path) &&
      !isUploadFromUrlEnabled(process.env.UPLOAD_FROM_URL_ENABLED)
    ) {
      throw new errors.ForbiddenError('Importing files from a URL is turned off');
    }
    return next();
  };
