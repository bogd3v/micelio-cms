import { isIP } from 'node:net';
import { isPrivateAddress } from './client-ip';

/** Variables that hold a URL the CMS calls with a credential. */
const UPSTREAM_VARIABLES = ['UMAMI_URL', 'REBUILD_HOOK_URL'] as const;

/** Name suffixes that only resolve inside a private network. */
const PRIVATE_SUFFIXES = ['.internal', '.local', '.localhost'];

/**
 * True when a URL host name stays inside a private network: a loopback or
 * private address, `localhost`, a dotless service name, or a name ending in
 * `.internal`, `.local` or `.localhost`. Same rule as the frontend's
 * (micelio ADR 0011).
 *
 * @param hostname - `URL.hostname`, with the brackets of an IPv6 address.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIP(bare) !== 0 || bare.includes(':')) return isPrivateAddress(bare);
  if (!bare.includes('.')) return true;
  return PRIVATE_SUFFIXES.some((suffix) => bare.endsWith(suffix));
}

/**
 * Fails the boot in production when `UMAMI_URL` or `REBUILD_HOOK_URL` is a
 * plain `http://` URL on a public host (ASVS V12.3.3).
 *
 * @remarks
 * `https` is always accepted, and so is `http` on a private network (a
 * container name, a private address). There is no way to switch it off. The
 * message names the variables and never the URL, which may hold credentials.
 * Outside production nothing is checked. A value that is not a URL is left to
 * the code that uses it.
 *
 * @param env - The environment to read, `process.env` by default.
 * @throws `Error` naming every offending variable.
 */
export function assertUpstreamsUseTls(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const offenders = UPSTREAM_VARIABLES.filter((name) => {
    const value = env[name]?.trim();
    if (!value) return false;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return url.protocol === 'http:' && !isPrivateHost(url.hostname);
  });

  if (offenders.length > 0) {
    throw new Error(
      `Insecure configuration in production: ${offenders.join(', ')} uses plain http:// towards a public host, ` +
        'which would send its credential in the clear. Use an https:// URL, or the private address or ' +
        'service name the container reaches.'
    );
  }
}
