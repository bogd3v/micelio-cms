import { describe, expect, it } from '@jest/globals';
import { errors } from '@strapi/utils';
import { ADMIN_AUTH_PATHS } from '../src/constants/rate-limit';
import {
  ADMIN_AUTH_ROUTES,
  adminLoginRefusal,
  isRefusedStatus,
} from '../src/utils/admin-auth-routes';
import { normalizePath } from '../src/utils/rate-limit/groups';

describe('admin login log: which answers are a refused sign-in', () => {
  it.each([
    [400, true],
    [401, true],
    [403, true],
    [501, true],
    [200, false],
    [429, false],
    [500, false],
    [502, false],
  ])('status %i is refused: %s', (status, refused) => {
    expect(isRefusedStatus(status)).toBe(refused);
  });

  it('gives invalid-credentials only for the login strategy message', () => {
    expect(adminLoginRefusal(new errors.ApplicationError('Invalid credentials'))).toEqual({
      reason: 'invalid-credentials',
    });
    expect(adminLoginRefusal(new errors.ApplicationError('Something else'))).toEqual({});
    // A malformed body is a ValidationError: refused, but no reason.
    expect(adminLoginRefusal(new errors.ValidationError('Invalid credentials'))).toEqual({});
  });

  it('maps an inactive user to blocked-account', () => {
    expect(adminLoginRefusal(new errors.ApplicationError('User not active'))).toEqual({
      reason: 'blocked-account',
    });
  });

  it('does not log the rate limiter or an unexpected error', () => {
    expect(adminLoginRefusal(new errors.RateLimitError('Too many requests'))).toBeNull();
    expect(adminLoginRefusal(new Error('boom'))).toBeNull();
    expect(adminLoginRefusal(undefined)).toBeNull();
    expect(adminLoginRefusal('Invalid credentials')).toBeNull();
  });
});

describe('admin auth route table', () => {
  it('lists each credential route once, with a normalised path', () => {
    const keys = ADMIN_AUTH_ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const route of ADMIN_AUTH_ROUTES) expect(route.path).toBe(normalizePath(route.path));
  });

  it('covers every admin route the rate limiter treats as taking credentials', () => {
    const paths = ADMIN_AUTH_ROUTES.map((route) => route.path);
    for (const path of ADMIN_AUTH_PATHS) expect(paths).toContain(path);
  });

  it('gives a failure event to every route but the account-blind password reset request', () => {
    const without = ADMIN_AUTH_ROUTES.filter((route) => route.failure === null);
    expect(without.map((route) => route.path)).toEqual(['/admin/forgot-password']);
  });
});
