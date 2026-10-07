'use strict';

/**
 * Generates the demo instance's secrets once (compose.demo.yml, #74), into the
 * directory given as the first argument (a volume shared with the other
 * services):
 *
 * - cms.env       Strapi's keys and salts, the database password,
 *                 FRONTEND_API_TOKEN and BUILD_API_TOKEN, which the CMS turns
 *                 into the frontend's and the read-only build API tokens on
 *                 boot (src/migrations/api-tokens.ts)
 *                 and RATE_LIMIT_FORWARDER_SECRET (rate limiting, #100)
 * - frontend.env  the frontend token as NUXT_STRAPI_API_TOKEN, and the same
 *                 forwarder secret as NUXT_STRAPI_FORWARDER_SECRET, so the
 *                 frontend can pass its visitors' addresses to the CMS
 * - build.env     the build token as NUXT_STRAPI_API_TOKEN, for the static build
 *                 of micelio (ADR 0006); compose.demo.yml does not use it yet
 * - db_password   for Postgres' POSTGRES_PASSWORD_FILE
 *
 * Each file is created only when missing, and a volume from before build.env
 * or the forwarder secret gets the missing key appended without touching the
 * other keys (if only one side has the secret, the other gets a copy), so
 * restarting the stack keeps sessions, tokens and the database password.
 * Values are base64 or hex, so single quotes are safe.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || '/secrets';
const files = {
  cms: path.join(dir, 'cms.env'),
  frontend: path.join(dir, 'frontend.env'),
  build: path.join(dir, 'build.env'),
  db: path.join(dir, 'db_password'),
};

const key = (bytes = 32) => crypto.randomBytes(bytes).toString('base64');
const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

const envFile = (values) =>
  Object.entries(values)
    .map(([name, value]) => `${name}='${value}'`)
    .join('\n') + '\n';

// Reads the `NAME='value'` lines this script writes.
const parseEnv = (file) => {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
};

// Readable by the CMS (node) and the frontend (distroless nonroot) users; the
// volume is local to this demo stack.
const write = (file, content) => fs.writeFileSync(file, content, { mode: 0o644 });

fs.mkdirSync(dir, { recursive: true });
const changed = [];

// A new cms.env means new tokens and password, so the files derived from it
// are rewritten too.
const fresh = !fs.existsSync(files.cms);
let cms;
if (!fresh) {
  cms = parseEnv(files.cms);
  for (const name of ['FRONTEND_API_TOKEN', 'DATABASE_PASSWORD']) {
    if (!cms[name]) {
      console.error(`[demo-secrets] ${files.cms} has no ${name}; delete the volume to start over`);
      process.exit(1);
    }
  }
} else {
  cms = {
    APP_KEYS: [key(), key(), key(), key()].join(','),
    API_TOKEN_SALT: key(),
    ADMIN_JWT_SECRET: key(),
    TRANSFER_TOKEN_SALT: key(),
    JWT_SECRET: key(),
    ENCRYPTION_KEY: key(),
    DATABASE_PASSWORD: hex(24),
    FRONTEND_API_TOKEN: hex(64),
    BUILD_API_TOKEN: hex(64),
    RATE_LIMIT_FORWARDER_SECRET: hex(32),
  };
  write(files.cms, envFile(cms));
  changed.push('cms.env');
}

// Appends missing keys to an env file, keeping what it has.
const append = (file, values, label) => {
  const current = fs.readFileSync(file, 'utf8');
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${separator}${envFile(values)}`);
  changed.push(label);
};

const newBuildToken = !cms.BUILD_API_TOKEN;
if (newBuildToken) {
  cms.BUILD_API_TOKEN = hex(64);
  append(files.cms, { BUILD_API_TOKEN: cms.BUILD_API_TOKEN }, 'cms.env');
}

// The forwarder secret is shared by cms.env and frontend.env: an existing
// value on either side wins over a new one.
const frontendExists = !fresh && fs.existsSync(files.frontend);
const frontend = frontendExists ? parseEnv(files.frontend) : {};
const secret = cms.RATE_LIMIT_FORWARDER_SECRET || frontend.NUXT_STRAPI_FORWARDER_SECRET || hex(32);
if (!cms.RATE_LIMIT_FORWARDER_SECRET) {
  cms.RATE_LIMIT_FORWARDER_SECRET = secret;
  append(files.cms, { RATE_LIMIT_FORWARDER_SECRET: secret }, 'cms.env');
}

if (!frontendExists) {
  write(
    files.frontend,
    envFile({ NUXT_STRAPI_API_TOKEN: cms.FRONTEND_API_TOKEN, NUXT_STRAPI_FORWARDER_SECRET: secret })
  );
  changed.push('frontend.env');
} else if (!frontend.NUXT_STRAPI_FORWARDER_SECRET) {
  append(files.frontend, { NUXT_STRAPI_FORWARDER_SECRET: secret }, 'frontend.env');
}
if (fresh || newBuildToken || !fs.existsSync(files.build)) {
  write(files.build, envFile({ NUXT_STRAPI_API_TOKEN: cms.BUILD_API_TOKEN }));
  changed.push('build.env');
}
if (fresh || !fs.existsSync(files.db)) {
  write(files.db, cms.DATABASE_PASSWORD);
  changed.push('db_password');
}

console.log(
  changed.length > 0
    ? `[demo-secrets] wrote ${[...new Set(changed)].join(', ')} in ${dir}`
    : `[demo-secrets] keeping the secrets in ${dir}`
);
