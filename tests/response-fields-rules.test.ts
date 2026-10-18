import { describe, it, expect } from '@jest/globals';
import { RESPONSE_ROUTES, SHARED_SHAPES, type Shape } from '../src/constants/response-fields';
import { levelsOf, listedKeys } from './helpers/response-fields';

// Rules that `src/constants/response-fields` keeps whatever routes it lists, so
// adding a route needs no change here.

/** Attributes no response may list, on any route. */
const NEVER_LISTED = [
  'plainText',
  'password',
  'resetPasswordToken',
  'resetPasswordIssuedAt',
  'passwordChangedAt',
  'authorEmail',
  'reports',
];
/** Routes whose response is about the caller's own account or the subscribers, which may list an email. */
const EMAIL_ROUTES = ['users.me', 'auth.', 'subscribers.'];
/** Routes that may list the token of a subscriber. */
const TOKEN_ROUTES = ['subscribers.'];

const useOf = (spec: Shape[string]) => (typeof spec === 'string' ? spec : spec.use);
const startsWithAny = (id: string, prefixes: string[]) =>
  prefixes.some((prefix) => id.startsWith(prefix));

const everyKey = listedKeys();

describe('src/constants/response-fields', () => {
  it('gives every route a unique id', () => {
    const ids = RESPONSE_ROUTES.map((route) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every `of` to a shape that exists', () => {
    for (const route of RESPONSE_ROUTES) expect(() => levelsOf(route.body, true)).not.toThrow();
    for (const shape of Object.values(SHARED_SHAPES))
      expect(() => levelsOf(shape, true)).not.toThrow();
  });

  it('lists no required key inside an object the frontend does not read', () => {
    const offenders: string[] = [];
    const check = (shape: Shape, where: string, underSurplus: boolean) => {
      for (const [key, spec] of Object.entries(shape)) {
        const use = useOf(spec);
        if (underSurplus && use === 'required') offenders.push(`${where}.${key}`);
        if (typeof spec === 'string') continue;
        const inner =
          spec.of === undefined || spec.of === 'self'
            ? undefined
            : typeof spec.of === 'string'
              ? SHARED_SHAPES[spec.of]
              : spec.of;
        if (inner) check(inner, `${where}.${key}`, underSurplus || use === 'surplus');
        for (const [component, variant] of Object.entries(spec.variants ?? {})) {
          check(variant, `${where}.${key}[${component}]`, underSurplus || use === 'surplus');
        }
      }
    };
    for (const route of RESPONSE_ROUTES) check(route.body, route.id, false);
    expect(offenders).toEqual([]);
  });

  it('lists no required key on a route that no frontend file reads', () => {
    const unread = RESPONSE_ROUTES.filter((route) => route.reader === '');
    const required = everyKey.filter(
      (entry) => entry.use === 'required' && unread.some((route) => route.id === entry.id)
    );
    expect(required).toEqual([]);
  });

  it('lists no private attribute', () => {
    const listed = everyKey.filter((entry) => NEVER_LISTED.includes(entry.key));
    expect(listed.map((entry) => `${entry.where}.${entry.key}`)).toEqual([]);
  });

  it('lists an email only on the account and subscriber routes, so no author object has one', () => {
    const offenders = everyKey.filter(
      (entry) => entry.key === 'email' && !startsWithAny(entry.id, EMAIL_ROUTES)
    );
    expect(offenders.map((entry) => `${entry.where}.${entry.key}`)).toEqual([]);
    const authors = everyKey.filter(
      (entry) => entry.id === 'shared.author-card' || entry.id === 'authors.find'
    );
    expect(authors.filter((entry) => entry.key === 'email')).toEqual([]);
  });

  it('lists a subscriber token only on the subscriber routes, so no user object has one', () => {
    const offenders = everyKey.filter(
      (entry) => entry.key.endsWith('Token') && !startsWithAny(entry.id, TOKEN_ROUTES)
    );
    expect(offenders.map((entry) => `${entry.where}.${entry.key}`)).toEqual([]);
  });
});
