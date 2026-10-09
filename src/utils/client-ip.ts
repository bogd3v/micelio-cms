import { BlockList, isIP } from 'node:net';
import type { TrustProxy } from '../types/rate-limit';

/**
 * Client address resolution (issue #100). Koa's own `ctx.ip` takes the
 * leftmost `X-Forwarded-For` entry, which the client writes; this reads the
 * header only as far as the operator's `TRUST_PROXY` says. Pure functions, no
 * Strapi: the fediverse guard and the middlewares share them.
 */

/** Longest chain read from the header: more entries than any real proxy path. */
const MAX_CHAIN = 64;

/** Groups of an IPv6 address (eight 16-bit numbers), or null if it isn't one. */
export function expandIPv6(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let text = address;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const [head, rest] = text.split('::');
  const first = head ? head.split(':') : [];
  const last = rest === undefined ? [] : rest ? rest.split(':') : [];
  const fill = rest === undefined ? 0 : 8 - first.length - last.length;
  if (fill < 0) return null;
  const groups = [...first, ...Array<string>(fill).fill('0'), ...last].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

/** Shortest textual form: lowercase hex, longest run of zero groups as `::`. */
function compressIPv6(groups: number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] !== 0) continue;
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLength < 2) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

/**
 * One textual form per address: no port, brackets or zone, lowercase, and
 * `::ffff:a.b.c.d` as plain IPv4. Null when it isn't an IP address.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end < 0 || !/^(:\d+)?$/.test(text.slice(end + 1))) return null;
    text = text.slice(1, end);
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(text)) {
    text = text.slice(0, text.lastIndexOf(':'));
  }
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);

  if (isIP(text) === 4) return text;
  const groups = expandIPv6(text);
  if (!groups) return null;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return compressIPv6(groups);
}

/** Loopback, RFC 1918, link-local and unique-local (IPv6) ranges. */
const PRIVATE_RANGES: [string, number, 'ipv4' | 'ipv6'][] = [
  ['127.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
];

function privateRanges(): BlockList {
  const list = new BlockList();
  for (const rule of PRIVATE_RANGES) list.addSubnet(...rule);
  return list;
}

/**
 * Parses `TRUST_PROXY`: `private` (default, also the empty value), `false`
 * (or `0`), a number of proxy hops, or a comma separated list of addresses and
 * CIDR ranges where `private` stands for the private ranges. `true` is
 * refused: it would trust whatever the client writes.
 */
export function parseTrustProxy(raw: string | null | undefined): TrustProxy {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'private') return { kind: 'peers', trusted: privateRanges() };
  if (value === 'false' || value === '0' || value === 'none') return { kind: 'none' };
  if (value === 'true') {
    throw new Error(
      'TRUST_PROXY=true is not allowed: it trusts any X-Forwarded-For. Use "private", a number of proxy hops, a list of proxy CIDR ranges, or "false"'
    );
  }
  if (/^\d+$/.test(value)) return { kind: 'hops', hops: Number(value) };

  const trusted = new BlockList();
  for (const entry of value.split(',')) {
    const item = entry.trim();
    if (item === 'private') {
      for (const rule of PRIVATE_RANGES) trusted.addSubnet(...rule);
      continue;
    }
    const [address, prefixText, ...extra] = item.split('/');
    const normalized = normalizeIp(address);
    const family = normalized ? (isIP(normalized) === 4 ? 'ipv4' : 'ipv6') : null;
    const max = family === 'ipv4' ? 32 : 128;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (
      !normalized ||
      !family ||
      extra.length > 0 ||
      (prefixText !== undefined && !/^\d+$/.test(prefixText)) ||
      // A /0 range trusts every address: the same as TRUST_PROXY=true.
      prefix < 1 ||
      prefix > max
    ) {
      throw new Error(
        `TRUST_PROXY has an entry that is not an IP address or CIDR range: "${item}"`
      );
    }
    trusted.addSubnet(normalized, prefix, family);
  }
  return { kind: 'peers', trusted };
}

function isTrusted(list: BlockList, ip: string): boolean {
  return list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}

/** The client address of a request and how it was found. */
export interface ResolvedIp {
  /** Normalised address, never empty (`unknown` when the socket has none). */
  ip: string;
  /** `TRUST_PROXY=N` found fewer than N entries: the app is reached directly. */
  shortChain: boolean;
}

/**
 * The client address for one request. `peer` is the socket's remote address
 * and `header` the value of the proxy header (`PROXY_IP_HEADER`).
 */
export function resolveClientIp(
  trust: TrustProxy,
  peer: string | null | undefined,
  header: string | null | undefined
): ResolvedIp {
  const socket = normalizeIp(peer) ?? 'unknown';
  if (trust.kind === 'none') return { ip: socket, shortChain: false };

  const chain = (header ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(-MAX_CHAIN);

  if (trust.kind === 'hops') {
    if (chain.length < trust.hops) return { ip: socket, shortChain: true };
    const entry = normalizeIp(chain[chain.length - trust.hops]);
    return { ip: entry ?? socket, shortChain: false };
  }

  // Walk from the connection outwards while each hop is a trusted proxy.
  if (socket === 'unknown' || !isTrusted(trust.trusted, socket) || chain.length === 0) {
    return { ip: socket, shortChain: false };
  }
  let candidate = socket;
  for (let i = chain.length - 1; i >= 0; i--) {
    const entry = normalizeIp(chain[i]);
    if (!entry) return { ip: socket, shortChain: false };
    candidate = entry;
    if (!isTrusted(trust.trusted, entry)) break;
  }
  return { ip: candidate, shortChain: false };
}

/**
 * Bucket key of an address: IPv4 as is, IPv6 by its /64, since one subscriber
 * controls the whole prefix. Only for limiter keys; the full address stays in
 * `ctx.request.ip`.
 */
export function ipBucket(ip: string): string {
  const groups = expandIPv6(ip);
  if (!groups) return ip;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}
