import type { Core } from '@strapi/strapi';

/** Upload provider Strapi falls back to; `config/plugins.ts` keeps it when `R2_BUCKET` is unset. */
const LOCAL_PROVIDER = 'local';

/**
 * True when the resolved upload config uses the local provider, which serves
 * files from the CMS (admin) origin.
 *
 * @remarks
 * Reads the config `config/plugins.ts` produced, so the rule stays in one place:
 * an S3-compatible bucket (`R2_BUCKET`) sets another provider. An unset
 * provider is Strapi's default, the local one.
 *
 * @param config - `strapi.config.get('plugin::upload')`, possibly undefined.
 */
export function usesLocalUploadProvider(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return true;
  const provider = (config as { provider?: unknown }).provider;
  return provider === undefined || provider === LOCAL_PROVIDER;
}

/**
 * Logs one warning at boot when production serves uploads from the admin origin.
 *
 * @remarks
 * Warning only: the boot goes on and there is no setting to silence it.
 * Outside production nothing is logged. See `docs/operate/configure.md`.
 *
 * @param strapi - The running instance, for its logger and upload config.
 * @param env - The environment to read, `process.env` by default.
 */
export function warnLocalUploadsInProduction(
  strapi: Pick<Core.Strapi, 'log' | 'config'>,
  env: Record<string, string | undefined> = process.env
): void {
  if (env.NODE_ENV !== 'production') return;
  if (!usesLocalUploadProvider(strapi.config.get('plugin::upload'))) return;
  strapi.log.warn(
    '[uploads] the local provider serves uploads from the admin origin; ' +
      'use object storage (R2_BUCKET) or another hostname in production'
  );
}
