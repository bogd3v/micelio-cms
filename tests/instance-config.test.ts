import { describe, it, expect, afterEach } from '@jest/globals';
import {
  assertFrontendUrlConfigured,
  DEV_FRONTEND_URL,
  frontendBaseUrl,
} from '../src/utils/frontend-url';
import { frontendBaseUrl as pluginFrontendBaseUrl } from '../src/plugins/fediverse/server/src/utils/frontend-url';
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
    it('requires the identifier and the username, with no defaults', () => {
      expect(() => assertActorConfigured('', '')).toThrow(
        'FEDIVERSE_ACTOR_IDENTIFIER and FEDIVERSE_ACTOR_USERNAME must be set'
      );
      expect(() => assertActorConfigured('blog', '')).toThrow('FEDIVERSE_ACTOR_USERNAME');
      expect(() => assertActorConfigured('blog', 'blog')).not.toThrow();
    });
  });
});
