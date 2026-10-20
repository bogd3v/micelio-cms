import { describe, it, expect, afterEach } from '@jest/globals';
import {
  assertFrontendUrlConfigured,
  DEV_FRONTEND_URL,
  frontendBaseUrl,
} from '../src/utils/frontend-url';
import { frontendBaseUrl as pluginFrontendBaseUrl } from '../src/plugins/fediverse/server/src/utils/frontend-url';
import { assertSecretsConfigured } from '../src/utils/secrets';
import { assertActorConfigured } from '../src/plugins/fediverse/server/src/constants/actor';

// A new instance must not borrow BogDev's identity: what identifies a site
// comes from its environment, and production refuses to start without it.

describe('Instance configuration', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  describe('FRONTEND_URL', () => {
    it.each([
      ['the root', frontendBaseUrl],
      ['the fediverse plugin', pluginFrontendBaseUrl],
    ])('%s uses it when set', (_where, read) => {
      process.env.FRONTEND_URL = 'https://example.com';
      expect(read()).toBe('https://example.com');
    });

    it.each([
      ['the root', frontendBaseUrl],
      ['the fediverse plugin', pluginFrontendBaseUrl],
    ])('%s defaults to a local dev server outside production', (_where, read) => {
      delete process.env.FRONTEND_URL;
      process.env.NODE_ENV = 'development';
      expect(read()).toBe(DEV_FRONTEND_URL);
    });

    it.each([
      ['the root', frontendBaseUrl],
      ['the fediverse plugin', pluginFrontendBaseUrl],
    ])('%s is required in production', (_where, read) => {
      delete process.env.FRONTEND_URL;
      process.env.NODE_ENV = 'production';
      expect(() => read()).toThrow('FRONTEND_URL is required in production');
    });

    it('stops the boot when it is not a URL', () => {
      process.env.FRONTEND_URL = 'bogus';
      expect(() => assertFrontendUrlConfigured()).toThrow('FRONTEND_URL is not a valid URL');
    });
  });

  describe('fediverse actor', () => {
    it('requires the identifier, with no default; the username falls back to it (#303)', () => {
      expect(() => assertActorConfigured('')).toThrow(
        'FEDIVERSE_ACTOR_IDENTIFIER must be set while FEDIVERSE_ENABLED=true'
      );
      expect(() => assertActorConfigured('blog')).not.toThrow();
    });
  });

  describe('secrets in production', () => {
    const strong = (seed: string) => seed.repeat(32).slice(0, 44);
    const good = () => ({
      NODE_ENV: 'production',
      APP_KEYS: `${strong('a')},${strong('b')}`,
      API_TOKEN_SALT: strong('c'),
      ADMIN_JWT_SECRET: strong('d'),
      TRANSFER_TOKEN_SALT: strong('e'),
      JWT_SECRET: strong('f'),
      ENCRYPTION_KEY: strong('g'),
    });

    it('accepts generated keys', () => {
      expect(() => assertSecretsConfigured(good())).not.toThrow();
    });

    it('names each placeholder, empty and short secret, never its value', () => {
      const env = {
        ...good(),
        JWT_SECRET: 'tobemodified',
        ENCRYPTION_KEY: '',
        API_TOKEN_SALT: 'short-one',
        APP_KEYS: `${strong('a')},toBeModified2`,
      };
      expect(() => assertSecretsConfigured(env)).toThrow(
        /APP_KEYS is a placeholder.*API_TOKEN_SALT is shorter than 32 characters.*JWT_SECRET is a placeholder.*ENCRYPTION_KEY is not set/
      );
      expect(() => assertSecretsConfigured(env)).not.toThrow(/short-one/);
    });

    it('checks nothing outside production', () => {
      expect(() => assertSecretsConfigured({ NODE_ENV: 'development' })).not.toThrow();
      expect(() => assertSecretsConfigured({})).not.toThrow();
    });

    it('requires a database password of your own with postgres and no URL', () => {
      const postgres = { ...good(), DATABASE_CLIENT: 'postgres' };
      expect(() => assertSecretsConfigured(postgres)).toThrow('DATABASE_PASSWORD is not set');
      expect(() => assertSecretsConfigured({ ...postgres, DATABASE_PASSWORD: 'strapi' })).toThrow(
        'DATABASE_PASSWORD is the example password'
      );
      expect(() =>
        assertSecretsConfigured({ ...postgres, DATABASE_PASSWORD: 'Zk4-own-password' })
      ).not.toThrow();
      expect(() =>
        assertSecretsConfigured({ ...postgres, DATABASE_URL: 'postgres://u:p@db/strapi' })
      ).not.toThrow();
      expect(() => assertSecretsConfigured({ ...good(), DATABASE_CLIENT: 'sqlite' })).not.toThrow();
    });
  });
});
