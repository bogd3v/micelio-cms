import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { cleanRemoteText } from '../src/plugins/fediverse/server/src/utils/remote-text';

describe('cleanRemoteText', () => {
  it('turns line breaks into spaces so a value cannot forge a log line', () => {
    expect(cleanRemoteText('eve\n[2026-01-01] info: follow accepted: admin')).toBe(
      'eve [2026-01-01] info: follow accepted: admin'
    );
    expect(cleanRemoteText('a\r\nb c d\te')).toBe('a b c d e');
  });

  it('drops invisible format characters such as bidi overrides', () => {
    expect(cleanRemoteText('ev‮il​')).toBe('evil');
  });

  it('caps the length by characters, not by UTF-16 units', () => {
    expect(cleanRemoteText('x'.repeat(300))).toHaveLength(255);
    expect(Array.from(cleanRemoteText('🍄'.repeat(300), 10) ?? '')).toHaveLength(10);
  });

  it.each([undefined, null, 42, '', ' \n\t '])('gives null for %j', (value) => {
    expect(cleanRemoteText(value)).toBeNull();
  });

  it('leaves an ordinary handle alone', () => {
    expect(cleanRemoteText('@ana@mastodon.example')).toBe('@ana@mastodon.example');
  });
});

describe('Request log', () => {
  let lines: string[];
  let spy: ReturnType<typeof jest.spyOn>;

  beforeAll(async () => {
    await setupStrapi();
    lines = [];
    spy = jest.spyOn(strapi.log, 'http').mockImplementation(((message: string) => {
      lines.push(String(message));
    }) as never);
  });

  afterAll(async () => {
    spy.mockRestore();
    await cleanupStrapi();
  });

  it('logs the path of a request, without its query string', async () => {
    await request(strapi.server.httpServer).get(
      '/api/auth/email-confirmation?confirmation=SECRET-TOKEN-123&email=ana%40example.com'
    );
    await request(strapi.server.httpServer).get('/api/articles?filters[slug]=hello');

    const log = lines.join('\n');
    expect(log).toMatch(/GET \/api\/auth\/email-confirmation \(\d+ ms\) \d{3}/);
    expect(log).toMatch(/GET \/api\/articles \(\d+ ms\) \d{3}/);
    expect(log).not.toContain('SECRET-TOKEN-123');
    expect(log).not.toContain('example.com');
    expect(log).not.toContain('?');
  });
});
