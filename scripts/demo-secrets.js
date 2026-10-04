'use strict';

/**
 * Generates the demo instance's secrets once (compose.demo.yml, #74), into the
 * directory given as the first argument (a volume shared with the other
 * services):
 *
 * - cms.env       Strapi's keys and salts, the database password and
 *                 FRONTEND_API_TOKEN, which the CMS turns into the frontend's
 *                 API token on boot (src/migrations/frontend-token.ts)
 * - frontend.env  the same token as NUXT_STRAPI_API_TOKEN
 * - db_password   for Postgres' POSTGRES_PASSWORD_FILE
 *
 * Existing files are kept, so restarting the stack keeps sessions, tokens and
 * the database password. Values are base64 or hex, so single quotes are safe.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || '/secrets';
const files = {
  cms: path.join(dir, 'cms.env'),
  frontend: path.join(dir, 'frontend.env'),
  db: path.join(dir, 'db_password'),
};

if (Object.values(files).every((file) => fs.existsSync(file))) {
  console.log(`[demo-secrets] keeping the secrets in ${dir}`);
  process.exit(0);
}

const key = (bytes = 32) => crypto.randomBytes(bytes).toString('base64');
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

const frontendToken = hex(64);
const dbPassword = hex(24);
const cms = {
  APP_KEYS: [key(), key(), key(), key()].join(','),
  API_TOKEN_SALT: key(),
  ADMIN_JWT_SECRET: key(),
  TRANSFER_TOKEN_SALT: key(),
  JWT_SECRET: key(),
  ENCRYPTION_KEY: key(),
  DATABASE_PASSWORD: dbPassword,
  FRONTEND_API_TOKEN: frontendToken,
};

const envFile = (values) =>
  Object.entries(values)
    .map(([name, value]) => `${name}='${value}'`)
    .join('\n') + '\n';

fs.mkdirSync(dir, { recursive: true });
// Readable by the CMS (node) and the frontend (distroless nonroot) users; the
// volume is local to this demo stack.
fs.writeFileSync(files.cms, envFile(cms), { mode: 0o644 });
fs.writeFileSync(files.frontend, envFile({ NUXT_STRAPI_API_TOKEN: frontendToken }), {
  mode: 0o644,
});
fs.writeFileSync(files.db, dbPassword, { mode: 0o644 });
console.log(`[demo-secrets] generated the secrets in ${dir}`);
