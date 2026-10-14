import type { Core } from '@strapi/strapi';

// Secrets are required: Strapi refuses to start without them (npm run generate:keys).
const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Admin => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET') as string,
    // Explicit, though it is the default. `secure` stays on Strapi's rule (production
    // over https); the refresh cookie's name is fixed upstream, so it cannot take a
    // `__Host-` prefix (docs/security/asvs.md, V3.3.3).
    cookie: { sameSite: 'lax' },
  },
  apiToken: {
    salt: env('API_TOKEN_SALT') as string,
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
});

export default config;
