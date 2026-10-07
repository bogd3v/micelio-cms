import { describe, it, expect } from '@jest/globals';
import {
  expandIPv6,
  ipBucket,
  normalizeIp,
  parseTrustProxy,
  resolveClientIp,
} from '../src/utils/client-ip';
import { classifyRequest, isAuthEmailRoute, normalizePath } from '../src/utils/rate-limit/groups';
import { emailKey, groupKey, tokenKey } from '../src/utils/rate-limit/keys';
import { parseRule } from '../src/utils/rate-limit/rule';
import { assertRateLimitConfig } from '../src/utils/rate-limit/runtime';
import type { RateLimitConfig } from '../src/types/rate-limit';

const PUBLIC_PEER = '198.51.100.20';

describe('client IP helpers', () => {
  describe('normalizeIp', () => {
    it.each([
      ['203.0.113.9', '203.0.113.9'],
      ['203.0.113.9:51234', '203.0.113.9'],
      ['  203.0.113.9  ', '203.0.113.9'],
      ['::ffff:203.0.113.9', '203.0.113.9'],
      ['::FFFF:cb00:7109', '203.0.113.9'],
      ['[2001:db8::1]:443', '2001:db8::1'],
      ['[2001:db8::1]', '2001:db8::1'],
      ['2001:DB8:0:0:0:0:0:1', '2001:db8::1'],
      ['fe80::1%eth0', 'fe80::1'],
      ['::1', '::1'],
    ])('%s -> %s', (raw, expected) => {
      expect(normalizeIp(raw)).toBe(expected);
    });

    it.each(['', 'unknown', 'not-an-ip', '999.1.1.1', '[::1', '[::1]x', '1.2.3.4:abc'])(
      'rejects %j',
      (raw) => {
        expect(normalizeIp(raw)).toBeNull();
      }
    );

    it('rejects non-strings', () => {
      expect(normalizeIp(undefined)).toBeNull();
      expect(normalizeIp(null)).toBeNull();
      // @ts-expect-error a number is not an address string
      expect(normalizeIp(42)).toBeNull();
    });
  });

  describe('expandIPv6 and ipBucket', () => {
    it('expands :: and embedded IPv4', () => {
      expect(expandIPv6('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
      expect(expandIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
      expect(expandIPv6('1.2.3.4')).toBeNull();
    });

    it('keeps IPv4 as is', () => {
      expect(ipBucket('203.0.113.9')).toBe('203.0.113.9');
    });

    it('groups IPv6 by its /64', () => {
      const a = ipBucket('2001:db8:1:2:aaaa::1');
      expect(a).toBe('2001:db8:1:2::/64');
      expect(ipBucket('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe(a);
      expect(ipBucket('2001:db8:1:3::1')).not.toBe(a);
    });
  });

  describe('parseTrustProxy', () => {
    it('defaults to private peers', () => {
      expect(parseTrustProxy(undefined).kind).toBe('peers');
      expect(parseTrustProxy('').kind).toBe('peers');
      expect(parseTrustProxy('private').kind).toBe('peers');
    });

    it.each(['false', '0', 'FALSE', 'none'])('%s turns trust off', (value) => {
      expect(parseTrustProxy(value)).toEqual({ kind: 'none' });
    });

    it('reads a number of hops', () => {
      expect(parseTrustProxy('2')).toEqual({ kind: 'hops', hops: 2 });
    });

    it.each(['true', 'TRUE', ' true '])('refuses %j', (value) => {
      expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY=true is not allowed/);
    });

    it.each([
      'not-an-ip',
      '10.0.0.0/',
      '0.0.0.0/0',
      '::/0',
      '10.0.0.0/0',
      '10.0.0.0/33',
      '10.0.0.0/8/1',
      '::1/129',
      '10.0.0.0/x',
      '1.2.3',
    ])('refuses the invalid entry %j', (value) => {
      expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
    });
  });

  describe('resolveClientIp', () => {
    const priv = parseTrustProxy('private');

    it('ignores X-Forwarded-For from a public peer (spoofing)', () => {
      expect(resolveClientIp(priv, PUBLIC_PEER, '1.2.3.4')).toEqual({
        ip: PUBLIC_PEER,
        shortChain: false,
      });
    });

    it('ignores the header with TRUST_PROXY=false even from loopback', () => {
      expect(resolveClientIp(parseTrustProxy('false'), '127.0.0.1', '1.2.3.4').ip).toBe(
        '127.0.0.1'
      );
    });

    it('takes the rightmost untrusted entry, not the leftmost', () => {
      const header = '1.1.1.1, 203.0.113.9, 198.51.100.7';
      expect(resolveClientIp(priv, '127.0.0.1', header).ip).toBe('198.51.100.7');
    });

    it('walks through trusted hops from the right', () => {
      expect(
        resolveClientIp(priv, '10.0.0.5', '1.1.1.1, 203.0.113.9, 10.0.0.9, 172.16.0.3').ip
      ).toBe('203.0.113.9');
    });

    it('uses the socket when a trusted peer sends no header or an unparsable entry', () => {
      expect(resolveClientIp(priv, '127.0.0.1', undefined).ip).toBe('127.0.0.1');
      expect(resolveClientIp(priv, '127.0.0.1', '203.0.113.9, garbage').ip).toBe('127.0.0.1');
    });

    it('treats ::ffff: peers like IPv4', () => {
      expect(resolveClientIp(priv, '::ffff:127.0.0.1', '203.0.113.9').ip).toBe('203.0.113.9');
      expect(resolveClientIp(priv, '::ffff:198.51.100.20', '1.2.3.4').ip).toBe(PUBLIC_PEER);
    });

    it('normalises ports and brackets in entries', () => {
      expect(resolveClientIp(priv, '127.0.0.1', '203.0.113.9:4444').ip).toBe('203.0.113.9');
      expect(resolveClientIp(priv, '127.0.0.1', '[2001:db8::7]:99').ip).toBe('2001:db8::7');
    });

    it('answers unknown when the socket has no address', () => {
      expect(resolveClientIp(priv, undefined, '1.2.3.4').ip).toBe('unknown');
    });

    describe('hops', () => {
      const hops1 = parseTrustProxy('1');
      const hops2 = parseTrustProxy('2');

      it('takes the Nth entry from the right', () => {
        expect(resolveClientIp(hops1, PUBLIC_PEER, '9.9.9.9, 203.0.113.9').ip).toBe('203.0.113.9');
        expect(resolveClientIp(hops2, PUBLIC_PEER, '9.9.9.9, 203.0.113.9, 10.0.0.1').ip).toBe(
          '203.0.113.9'
        );
      });

      it('falls back to the socket address on a chain shorter than the hops', () => {
        expect(resolveClientIp(hops2, PUBLIC_PEER, '9.9.9.9')).toEqual({
          ip: PUBLIC_PEER,
          shortChain: true,
        });
        expect(resolveClientIp(hops1, PUBLIC_PEER, undefined)).toEqual({
          ip: PUBLIC_PEER,
          shortChain: true,
        });
      });

      it('falls back to the socket when the selected entry is not an address', () => {
        expect(resolveClientIp(hops1, PUBLIC_PEER, '9.9.9.9, nope').ip).toBe(PUBLIC_PEER);
      });
    });

    describe('CIDR list', () => {
      const cidr = parseTrustProxy('192.0.2.0/24, 2001:db8::/32');

      it('trusts only the listed ranges', () => {
        expect(resolveClientIp(cidr, '192.0.2.7', '203.0.113.9').ip).toBe('203.0.113.9');
        // 127.0.0.1 is not in this list.
        expect(resolveClientIp(cidr, '127.0.0.1', '203.0.113.9').ip).toBe('127.0.0.1');
      });

      it('walks right to left, skipping trusted entries', () => {
        expect(resolveClientIp(cidr, '192.0.2.7', '203.0.113.9, 192.0.2.200, 192.0.2.99').ip).toBe(
          '203.0.113.9'
        );
        expect(resolveClientIp(cidr, '192.0.2.7', '203.0.113.9, 198.51.100.7, 192.0.2.99').ip).toBe(
          '198.51.100.7'
        );
      });

      it('supports IPv6 ranges and the private keyword', () => {
        expect(resolveClientIp(cidr, '2001:db8::1', '203.0.113.9').ip).toBe('203.0.113.9');
        const mixed = parseTrustProxy('private, 192.0.2.1');
        expect(resolveClientIp(mixed, '192.0.2.1', '203.0.113.9').ip).toBe('203.0.113.9');
        expect(resolveClientIp(mixed, '10.1.1.1', '203.0.113.9').ip).toBe('203.0.113.9');
      });

      it('a single address entry is a /32', () => {
        const one = parseTrustProxy('192.0.2.1');
        expect(resolveClientIp(one, '192.0.2.1', '203.0.113.9').ip).toBe('203.0.113.9');
        expect(resolveClientIp(one, '192.0.2.2', '203.0.113.9').ip).toBe('192.0.2.2');
      });
    });
  });
});

describe('route groups', () => {
  describe('normalizePath', () => {
    it.each([
      ['/API/AUTH/LOCAL', '/api/auth/local'],
      ['/api/auth/local/', '/api/auth/local'],
      ['/api//auth/./local', '/api/auth/local'],
      ['/api/x/../auth/local', '/api/auth/local'],
      ['/api/auth/local///', '/api/auth/local'],
      ['', '/'],
      ['/', '/'],
      ['api/comments', '/api/comments'],
    ])('%j -> %j', (raw, expected) => {
      expect(normalizePath(raw)).toBe(expected);
    });

    it('handles non-strings', () => {
      expect(normalizePath(undefined)).toBe('/');
    });
  });

  const groupOf = (method: string, path: string) => {
    const route = classifyRequest(method, normalizePath(path));
    return route.kind === 'exempt' ? 'exempt' : route.group;
  };

  describe('classifyRequest', () => {
    it.each([
      ['GET', '/_health', 'exempt'],
      ['GET', '/favicon.ico', 'exempt'],
      ['GET', '/uploads/a.png', 'exempt'],
      ['GET', '/admin/content-manager/x', 'exempt'],
      ['POST', '/admin/login', 'admin-auth'],
      ['POST', '/ADMIN/Login/', 'admin-auth'],
      ['POST', '/admin/forgot-password', 'admin-auth'],
      ['GET', '/admin/login', 'exempt'],
      ['POST', '/api/auth/local', 'auth'],
      ['POST', '/API/AUTH/LOCAL', 'auth'],
      ['POST', '/api/auth/local/', 'auth'],
      ['GET', '/api/auth/email-confirmation', 'auth'],
      ['GET', '/api/connect/github', 'auth'],
      ['GET', '/api/auth/github/callback', 'auth'],
      ['POST', '/api/auth/random-thing', 'auth'],
      ['POST', '/admin/register', 'admin-auth'],
      ['POST', '/content-manager/collection-types/x', 'exempt'],
      ['GET', '/upload/files', 'exempt'],
      ['GET', '/i18n/locales', 'exempt'],
      ['POST', '/comments/moderate', 'exempt'],
      ['DELETE', '/api/users/me', 'auth'],
      ['GET', '/api/users/me', 'api'],
      ['POST', '/api/comments/api::article.article:abc', 'comments'],
      ['POST', '/api/COMMENTS/x/', 'comments'],
      ['GET', '/api/comments/x', 'api'],
      ['POST', '/api/upload', 'upload'],
      ['GET', '/api/upload/files', 'api'],
      ['GET', '/api/articles', 'api'],
      ['GET', '/mcp', 'api'],
      ['GET', '/', 'api'],
    ])('%s %s -> %s', (method, path, expected) => {
      expect(groupOf(method, path)).toBe(expected);
    });

    it('keys auth by path and marks mcp', () => {
      expect(classifyRequest('POST', '/api/auth/local')).toMatchObject({ keyByPath: true });
      expect(classifyRequest('POST', '/api/comments/x')).toMatchObject({ keyByPath: false });
      expect(classifyRequest('POST', '/mcp')).toMatchObject({ group: 'api', mcp: true });
    });

    it('keys auth routes by path family, never by a client-chosen segment', () => {
      const key = (method: string, path: string) => {
        const route = classifyRequest(method, path);
        return route.kind === 'group' ? route.pathKey : null;
      };
      expect(key('GET', '/api/connect/a')).toBe(key('GET', '/api/connect/b'));
      expect(key('GET', '/api/auth/a/callback')).toBe(key('GET', '/api/auth/b/callback'));
      expect(key('POST', '/api/auth/x1')).toBe(key('POST', '/api/auth/x2'));
      expect(key('POST', '/api/auth/local')).toBe('/api/auth/local');
      expect(key('POST', '/api/auth/local')).not.toBe(key('POST', '/api/auth/x1'));
    });

    it('does not treat a lookalike prefix as a group', () => {
      expect(groupOf('POST', '/api/authx/local')).toBe('api');
      expect(groupOf('POST', '/administrator')).toBe('api');
    });
  });

  describe('isAuthEmailRoute', () => {
    it('matches the email-sending POST routes only', () => {
      expect(isAuthEmailRoute('POST', '/api/auth/forgot-password')).toBe(true);
      expect(isAuthEmailRoute('post', '/api/auth/send-email-confirmation')).toBe(true);
      expect(isAuthEmailRoute('POST', '/api/auth/local/register')).toBe(true);
      expect(isAuthEmailRoute('GET', '/api/auth/forgot-password')).toBe(false);
      expect(isAuthEmailRoute('POST', '/api/auth/local')).toBe(false);
    });
  });
});

describe('parseRule', () => {
  const fallback = { points: 10, duration: 60 };

  it('parses points/seconds', () => {
    expect(parseRule('5/30', fallback)).toEqual({ points: 5, duration: 30 });
    expect(parseRule(' 5 / 30 ', fallback)).toEqual({ points: 5, duration: 30 });
  });

  it('keeps the fallback duration when only points are given', () => {
    expect(parseRule('7', fallback)).toEqual({ points: 7, duration: 60 });
  });

  it('0 turns the group off', () => {
    expect(parseRule('0', fallback)).toBeNull();
    expect(parseRule('0/60', fallback)).toBeNull();
  });

  it.each([undefined, '', '   ', 'abc', '-1/5', '1/2/3', '5/x', '5/0', '1.5/60'])(
    'a typo (%j) keeps the default',
    (value) => {
      expect(parseRule(value, fallback)).toEqual(fallback);
    }
  );
});

describe('keys', () => {
  const secret = Buffer.from('s'.repeat(32));

  it('groupKey groups IPv6 by /64 and adds the path only when asked', () => {
    expect(groupKey('203.0.113.9', '/api/auth/local', false)).toBe('203.0.113.9');
    expect(groupKey('203.0.113.9', '/api/auth/local', true)).toBe('203.0.113.9|/api/auth/local');
    expect(groupKey('2001:db8:1:2::5', '', false)).toBe(groupKey('2001:db8:1:2::9', '', false));
  });

  it('emailKey is case and space insensitive and does not hold the address', () => {
    const a = emailKey(secret, 'Ana@Example.com ', '1.1.1.1');
    expect(a).toBe(emailKey(secret, 'ana@example.com', '2.2.2.2'));
    expect(a).not.toContain('ana');
    expect(emailKey(Buffer.from('other'.repeat(8)), 'ana@example.com', '1.1.1.1')).not.toBe(a);
  });

  it('emailKey puts every non-string email in one bucket per client', () => {
    const one = emailKey(secret, undefined, '1.1.1.1');
    expect(emailKey(secret, 42, '1.1.1.1')).toBe(one);
    expect(emailKey(secret, { a: 1 }, '1.1.1.1')).toBe(one);
    expect(emailKey(secret, null, '2.2.2.2')).not.toBe(one);
    expect(one.startsWith('invalid:')).toBe(true);
  });

  it('tokenKey', () => {
    expect(tokenKey(7)).toBe('token:7');
  });
});

describe('assertRateLimitConfig', () => {
  const config = (overrides: Partial<RateLimitConfig>): RateLimitConfig => ({
    enabled: true,
    store: 'memory',
    trustProxy: 'private',
    proxyIpHeader: 'X-Forwarded-For',
    forwarderSecret: '',
    groups: {
      auth: null,
      'auth-identifier': null,
      'admin-auth': null,
      'auth-email': null,
      comments: null,
      upload: null,
      'fediverse-inbox': null,
      api: null,
    },
    token: null,
    ...overrides,
  });

  it('refuses a forwarder secret shorter than 32 characters', () => {
    expect(() => assertRateLimitConfig(config({ forwarderSecret: 'x'.repeat(31) }))).toThrow(
      /at least 32 characters/
    );
  });

  it('accepts 32 characters or none', () => {
    expect(assertRateLimitConfig(config({ forwarderSecret: 'x'.repeat(32) })).kind).toBe('peers');
    expect(assertRateLimitConfig(config({})).kind).toBe('peers');
  });

  it('refuses TRUST_PROXY=true', () => {
    expect(() => assertRateLimitConfig(config({ trustProxy: 'true' }))).toThrow(
      /TRUST_PROXY=true is not allowed/
    );
  });
});
