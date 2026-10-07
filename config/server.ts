import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // `koa` only decides whether ctx.protocol and ctx.host follow X-Forwarded-Proto
  // and -Host (ActivityPub URLs need that behind a proxy); who the client is comes
  // from TRUST_PROXY (src/utils/client-ip.ts), not from here. `ipHeader` is the
  // header both read.
  proxy: {
    koa: env.bool('TRUST_PROXY_PROTOCOL', true),
    ipHeader: env('PROXY_IP_HEADER', 'X-Forwarded-For'),
  },
  url: env('URL', 'http://localhost:1337'),
  app: {
    // Required: Strapi refuses to start without them (npm run generate:keys).
    keys: env.array('APP_KEYS') as string[],
  },
  // Admin MCP endpoint (/mcp), authenticated with admin API tokens; anyone
  // holding one can read and write content. Set to false where it isn't used.
  mcp: {
    enabled: env.bool('STRAPI_MCP_ENABLED', true),
  },
  // Tasks are added in bootstrap (src/index.ts), each gated by its own config.
  cron: {
    enabled: !env.bool('STRAPI_DISABLE_CRON', false),
  },
});

export default config;
