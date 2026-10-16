import { describe, expect, it } from '@jest/globals';
import { errors } from '@strapi/utils';
import { adminLoginRefusal, isRefusedStatus } from '../src/middlewares/admin-login-log';

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
