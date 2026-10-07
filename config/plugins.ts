import type { Core } from '@strapi/strapi';
import { limitsAuth } from '../src/utils/rate-limit/rule';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const r2Bucket = env('R2_BUCKET');

  const uploadConfig = r2Bucket
    ? {
        provider: '@strapi/provider-upload-aws-s3',
        providerOptions: {
          baseUrl: env('R2_BASE_URL'),
          s3Options: {
            credentials: {
              accessKeyId: env('R2_ACCESS_KEY_ID'),
              secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
            },
            endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
            region: 'auto',
            params: {
              Bucket: r2Bucket,
              ACL: undefined,
            },
          },
        },
        breakpoints: {
          xlarge: 1920,
          large: 1000,
          medium: 750,
          small: 500,
        },
      }
    : {
        provider: 'local',
        providerOptions: {},
        sizeLimit: 250 * 1024 * 1024,
      };

  // Without SMTP_HOST Strapi keeps its default `sendmail` provider, which can't
  // deliver from a container: account confirmation and reset emails need SMTP.
  const smtpHost = env('SMTP_HOST');
  const smtpPort = env.int('SMTP_PORT', 587);
  // EMAIL_FROM has no site-specific default: without it, emails go out from
  // no-reply@ the frontend's host, and register() warns when SMTP is on.
  const emailFrom = env('EMAIL_FROM') || `no-reply@${frontendHost(env('FRONTEND_URL'))}`;
  const emailConfig = smtpHost
    ? {
        provider: 'nodemailer',
        providerOptions: {
          host: smtpHost,
          port: smtpPort,
          // 465 is implicit TLS; other ports upgrade with STARTTLS.
          secure: smtpPort === 465,
          auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
        },
        settings: { defaultFrom: emailFrom, defaultReplyTo: emailFrom },
      }
    : { settings: { defaultFrom: emailFrom, defaultReplyTo: emailFrom } };

  // Our limiter replaces the users-permissions one, but only while it limits
  // the auth group: with RATE_LIMIT_AUTH=0 the plugin's own stays, so auth is never open.
  const ownAuthLimit = limitsAuth(env);

  return {
    fediverse: {
      enabled: env.bool('FEDIVERSE_ENABLED', false),
      resolve: './src/plugins/fediverse',
    },
    upload: {
      config: uploadConfig,
    },
    email: {
      config: emailConfig,
    },
    // Accounts (issue #52): sessions last 7 days. Registration accepts only
    // username, email and password (no `register.allowedFields`), so a `role`
    // in the body is rejected. Sign-up, confirmation and reset URLs live in the
    // plugin store (src/migrations/account-settings.ts).
    'users-permissions': {
      config: {
        jwt: { expiresIn: '7d' },
        // Left unset, the plugin keeps its own limiter.
        ...(ownAuthLimit ? { ratelimit: { enabled: false } } : {}),
      },
    },
    seo: {
      enabled: true,
    },
    comments: {
      enabled: true,
      config: {
        enabledCollections: ['api::article.article'],
        approvalScores: {
          enabled: true,
          thresholds: {
            new: 0,
            approved: 1,
            rejected: -1,
            blocked: -10,
          },
        },
        moderation: {
          enabled: true,
          removeBlocked: false,
        },
        nested: {
          enabled: true,
          depth: 10,
          maxDepth: 10,
        },
        glow: {
          enabled: false,
          emailNotifications: false,
        },
        autopopulate: {
          populate: {
            author: {
              fields: ['name', 'email', 'avatar'],
            },
          },
        },
        entryRelation: {
          contentTypes: [
            {
              name: 'api::article.article',
              field: 'comments',
            },
          ],
        },
      },
    },
  };
};

/** Host of the frontend for the fallback sender, `localhost` when unknown. */
function frontendHost(frontendUrl: string | undefined): string {
  try {
    return new URL(frontendUrl ?? '').hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

export default config;
