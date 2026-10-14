import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { setupStrapi, cleanupStrapi } from './strapi';
import { corsAllowsCredentials, corsOrigins } from '../src/utils/cors-origins';

describe('corsOrigins', () => {
  it('uses CORS_ORIGINS when it is set', () => {
    expect(corsOrigins([' https://a.example.test ', ''], 'https://blog.example.test')).toEqual([
      'https://a.example.test',
    ]);
  });

  it('falls back to the origin of FRONTEND_URL, dropping its path', () => {
    expect(corsOrigins([], 'https://blog.example.test/en/')).toEqual(['https://blog.example.test']);
    expect(corsOrigins(undefined, 'https://blog.example.test')).toEqual([
      'https://blog.example.test',
    ]);
  });

  it('allows the local frontend outside production and nothing in production', () => {
    const saved = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      expect(corsOrigins([], undefined)).toEqual(['http://localhost:3000']);
      process.env.NODE_ENV = 'production';
      expect(corsOrigins([], undefined)).toEqual([]);
      expect(corsOrigins([], 'not a url')).toEqual([]);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});

describe('corsAllowsCredentials', () => {
  it('is true for a list of origins and false for a wildcard or nothing', () => {
    expect(corsAllowsCredentials(['https://blog.example.test'])).toBe(true);
    expect(corsAllowsCredentials(['https://blog.example.test', '*'])).toBe(false);
    expect(corsAllowsCredentials([])).toBe(false);
  });
});

describe('CORS without CORS_ORIGINS', () => {
  const FRONTEND = 'https://blog.example.test';
  const preflight = (origin: string) =>
    request(strapi.server.httpServer)
      .options('/api/articles')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET');

  beforeAll(async () => {
    delete process.env.CORS_ORIGINS;
    process.env.FRONTEND_URL = FRONTEND;
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('allows the frontend, with credentials', async () => {
    const res = await preflight(FRONTEND);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('gives any other origin neither the origin nor credentials', async () => {
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
