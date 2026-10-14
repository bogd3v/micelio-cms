/** Strapi variables that sign or encrypt something; `APP_KEYS` holds several, comma separated. */
const SECRET_VARIABLES = [
  'APP_KEYS',
  'API_TOKEN_SALT',
  'ADMIN_JWT_SECRET',
  'TRANSFER_TOKEN_SALT',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
] as const;

/** A secret shorter than this is refused in production (`npm run generate:keys` makes 44). */
const MIN_SECRET_LENGTH = 32;

/** Values copied from an example file: `tobemodified`, `toBeModified1`, `changeme`. */
const PLACEHOLDER = /^(tobemodified|changeme|change-me)\d*$/i;

/** The database password the Strapi and Compose examples used to ship. */
const EXAMPLE_DATABASE_PASSWORD = 'strapi';

type Env = Record<string, string | undefined>;

function weakness(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  if (text === '') return 'not set';
  if (PLACEHOLDER.test(text)) return 'a placeholder';
  if (text.length < MIN_SECRET_LENGTH) return `shorter than ${MIN_SECRET_LENGTH} characters`;
  return null;
}

/**
 * Fails the boot in production when a Strapi secret is missing, a placeholder
 * or too short, or when the PostgreSQL password is unset or the example one.
 *
 * @remarks
 * A key copied from `.env.example` is public, so anyone could sign a reader
 * JWT, an admin token or decrypt the stored API tokens. Outside production
 * nothing is checked, so a local `.env` or a test can use short values. The
 * message names the variables, never their values.
 *
 * @param env - The environment to read, `process.env` by default.
 * @throws `Error` listing every offending variable.
 */
export function assertSecretsConfigured(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  for (const name of SECRET_VARIABLES) {
    const values = name === 'APP_KEYS' ? (env[name] ?? '').split(',') : [env[name]];
    const reason = values.map(weakness).find((found) => found !== null);
    if (reason) problems.push(`${name} is ${reason}`);
  }

  // A connection string carries its own credentials.
  if (env.DATABASE_CLIENT === 'postgres' && !env.DATABASE_URL?.trim()) {
    const password = env.DATABASE_PASSWORD?.trim() ?? '';
    if (password === '') problems.push('DATABASE_PASSWORD is not set');
    else if (password === EXAMPLE_DATABASE_PASSWORD) {
      problems.push('DATABASE_PASSWORD is the example password');
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Insecure configuration in production: ${problems.join('; ')}. ` +
        'Generate the keys with `npm run generate:keys` and set a database password of your own.'
    );
  }
}
