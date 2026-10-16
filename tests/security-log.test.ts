import { describe, expect, it } from '@jest/globals';
import { SECURITY_EVENTS, SECURITY_EVENT_OUTCOMES } from '../src/constants/security-events';
import {
  hashIdentifier,
  logSecurityEvent,
  securityLogSecret,
  type SecurityLogHost,
} from '../src/utils/security-log';

type Line = { level: 'info' | 'warn'; message: string; meta: Record<string, unknown> | undefined };

function fakeStrapi(): { host: SecurityLogHost; lines: Line[] } {
  const lines: Line[] = [];
  const host: SecurityLogHost = {
    log: {
      info: (message, meta) => lines.push({ level: 'info', message, meta }),
      warn: (message, meta) => lines.push({ level: 'warn', message, meta }),
    },
    config: { get: <T>() => ['app-key-for-tests-only'] as unknown as T },
  };
  return { host, lines };
}

const EMAIL = 'reader@example.com';
const IP = '203.0.113.7';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';
const PASSWORD = 'correct-horse-battery';

describe('logSecurityEvent', () => {
  it('writes `security: <event>` with the event, outcome and fields as metadata', () => {
    const { host, lines } = fakeStrapi();
    logSecurityEvent(host, SECURITY_EVENTS.authLoginFailure, {
      requestId: 'req-1',
      actor: 42,
      client: hashIdentifier(IP, securityLogSecret(host)),
      path: '/api/auth/local',
      reason: 'invalid-credentials',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].message).toBe('security: auth.login.failure');
    expect(lines[0].meta).toEqual({
      event: 'auth.login.failure',
      outcome: 'failure',
      requestId: 'req-1',
      actor: '42',
      client: expect.stringMatching(/^[0-9a-f]{16}$/),
      path: '/api/auth/local',
      reason: 'invalid-credentials',
    });
  });

  it('uses info for successes and warn for failures and refusals', () => {
    const { host, lines } = fakeStrapi();
    for (const event of Object.values(SECURITY_EVENTS)) logSecurityEvent(host, event);
    expect(lines).toHaveLength(Object.values(SECURITY_EVENTS).length);
    for (const line of lines) {
      const event = line.meta?.event as keyof typeof SECURITY_EVENT_OUTCOMES;
      expect(line.level).toBe(SECURITY_EVENT_OUTCOMES[event] === 'success' ? 'info' : 'warn');
    }
    expect(lines.find((l) => l.meta?.event === 'auth.login.success')?.level).toBe('info');
    expect(lines.find((l) => l.meta?.event === 'access.forbidden')?.level).toBe('warn');
  });

  it('never writes a raw email, address, token or password, even if passed by mistake', () => {
    const { host, lines } = fakeStrapi();
    const resetCode = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    logSecurityEvent(host, SECURITY_EVENTS.authLoginFailure, {
      actor: EMAIL,
      client: IP,
      requestId: TOKEN,
      path: `/api/users/${EMAIL}?identifier=${EMAIL}&password=${PASSWORD}&jwt=${TOKEN}`,
      reason: `bad login for ${EMAIL}`,
    });
    logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, {
      path: `/from/${IP}/reader%40example.com/reset/${resetCode}/x/2001:db8::1/${TOKEN}`,
    });
    const output = JSON.stringify(lines);
    for (const secret of [EMAIL, 'reader%40', 'reader', IP, 'db8', PASSWORD, TOKEN, resetCode]) {
      expect(output).not.toContain(secret);
    }
    expect(lines[0].meta).not.toHaveProperty('actor');
    expect(lines[0].meta).not.toHaveProperty('client');
    expect(lines[0].meta).not.toHaveProperty('requestId');
    expect(lines[0].meta).not.toHaveProperty('reason');
    expect(lines[1].meta?.path).toContain('/reset/[redacted]/x/');
  });

  it('keeps only a server-style request id', () => {
    const { host, lines } = fakeStrapi();
    logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, { requestId: 'a.b' });
    logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, { requestId: 'x'.repeat(65) });
    logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, {
      requestId: '3f2c1a9e-0b7d-4c55-9e1a-aa01cb47086f',
    });
    expect(lines.map((l) => l.meta?.requestId)).toEqual([
      undefined,
      undefined,
      '3f2c1a9e-0b7d-4c55-9e1a-aa01cb47086f',
    ]);
  });

  it('keeps only a reason from the closed set', () => {
    const { host, lines } = fakeStrapi();
    logSecurityEvent(host, SECURITY_EVENTS.authLoginFailure, { reason: 'made-up-reason' });
    logSecurityEvent(host, SECURITY_EVENTS.authLoginFailure, { reason: 'invalid-signature' });
    expect(lines.map((l) => l.meta?.reason)).toEqual([undefined, 'invalid-signature']);
  });

  it('keeps a client only if it is exactly a 16-character hex hash', () => {
    const { host, lines } = fakeStrapi();
    for (const client of ['42', 'a'.repeat(40), 'a'.repeat(16)]) {
      logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, { client });
    }
    expect(lines.map((l) => l.meta?.client)).toEqual([undefined, undefined, 'a'.repeat(16)]);
  });

  it('fails with a named error when the app keys are missing or empty', () => {
    const { host } = fakeStrapi();
    for (const keys of [undefined, [], [''], ['  '], 'not-a-list']) {
      const broken: SecurityLogHost = { ...host, config: { get: <T>() => keys as unknown as T } };
      expect(() => securityLogSecret(broken)).toThrow(/APP_KEYS/);
    }
  });

  it('strips the query string and fragment from the path', () => {
    const { host, lines } = fakeStrapi();
    logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, {
      path: '/api/articles?status=draft&token=abc#frag',
    });
    expect(lines[0].meta?.path).toBe('/api/articles');
  });

  it('removes control characters and caps the length of the path', () => {
    const { host, lines } = fakeStrapi();
    logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, { path: '/a\r\nwarn: forged\u0000b' });
    logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, { path: '\n\t' });
    logSecurityEvent(host, SECURITY_EVENTS.accessForbidden, { path: '/x'.repeat(500) });
    expect(lines[0].meta?.path).toBe('/a warn: forged b');
    expect(lines[1].meta).not.toHaveProperty('path');
    expect((lines[2].meta?.path as string).length).toBe(200);
  });

  it('omits fields that are not given', () => {
    const { host, lines } = fakeStrapi();
    logSecurityEvent(host, SECURITY_EVENTS.rateLimitRejected);
    expect(lines[0].meta).toEqual({ event: 'rate-limit.rejected', outcome: 'failure' });
  });
});

describe('hashIdentifier', () => {
  const secret = Buffer.from('test-secret');

  it('is stable, short hex, and case and whitespace insensitive', () => {
    const hash = hashIdentifier(EMAIL, secret);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hashIdentifier(` ${EMAIL.toUpperCase()} `, secret)).toBe(hash);
    expect(hashIdentifier(EMAIL, secret)).toBe(hash);
  });

  it('differs per value and per key, and does not contain the value', () => {
    const hash = hashIdentifier(EMAIL, secret);
    expect(hashIdentifier('other@example.com', secret)).not.toBe(hash);
    expect(hashIdentifier(EMAIL, Buffer.from('another-secret'))).not.toBe(hash);
    expect(hash).not.toContain('reader');
    expect(hash).not.toContain('example');
  });
});
