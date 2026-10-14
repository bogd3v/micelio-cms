import type { Core } from '@strapi/strapi';
import { corsAllowsCredentials, corsOrigins as corsOriginsFrom } from '../src/utils/cors-origins';

/** Origin of the public media host (R2), so the admin can show uploads. */
function mediaOriginsFrom(baseUrl: string | undefined): string[] {
  if (!baseUrl) return [];
  try {
    return [new URL(baseUrl).origin];
  } catch {
    return [];
  }
}

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => {
  const mediaOrigins = mediaOriginsFrom(env('R2_BASE_URL'));
  const corsOrigins = corsOriginsFrom(env.array('CORS_ORIGINS', []), env('FRONTEND_URL'));
  return [
    // Not strapi::logger: it logs the query string (emails, tokens).
    'global::request-logger',
    'strapi::errors',
    // Sets the client address for everything below (TRUST_PROXY).
    'global::client-ip',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            // No <base> element is needed; 'none' blocks the tag-injection route.
            'base-uri': ["'none'"],
            'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            'img-src': [
              "'self'",
              'data:',
              'blob:',
              'https://market-assets.strapi.io',
              ...mediaOrigins,
            ],
            'media-src': [
              "'self'",
              'data:',
              'blob:',
              'https://market-assets.strapi.io',
              ...mediaOrigins,
            ],
          },
        },
      },
    },
    {
      name: 'strapi::cors',
      // Browser origins allowed to call the API: CORS_ORIGINS, or the frontend's
      // origin when it is unset (src/utils/cors-origins.ts). Credentials go only
      // to listed origins, never to `*`. Server-to-server calls ignore CORS.
      config: {
        origin: corsOrigins,
        credentials: corsAllowsCredentials(corsOrigins),
      },
    },
    // Uploads come from the admin origin with the local provider; see upload-headers.ts.
    'global::upload-headers',
    // Per-user and token-only answers must not be cached; see cache-control.ts.
    'global::cache-control',
    'strapi::poweredBy',
    // Before the body is read, so a flood is refused without parsing it.
    'global::rate-limit',
    'strapi::query',
    // Needs the parsed query. Strapi has no populate depth limit.
    { name: 'global::populate-depth', config: { maxDepth: env.int('POPULATE_MAX_DEPTH', 3) } },
    {
      name: 'strapi::body',
      // DELETE too: DELETE /api/users/me takes the current password in its body.
      config: { parsedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'] },
    },
    // Needs the parsed body (the email of the account routes).
    'global::rate-limit-identifier',
    // Nothing in the app sends this cookie cross-site; Lax is Koa's strict-enough default.
    { name: 'strapi::session', config: { sameSite: 'lax' } },
    'strapi::favicon',
    'strapi::public',
    // Outer to hide-unapproved-comments, so it only enriches what survives pruning.
    'global::fediverse-comment-fields',
    'global::hide-unapproved-comments',
    'global::strip-comment-author-email',
  ];
};

export default config;
