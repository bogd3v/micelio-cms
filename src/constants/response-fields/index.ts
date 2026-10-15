import { FEDIVERSE_ROUTES } from './fediverse';
import type { ResponseRoute, ResponseSurface } from './types';

export { SHARED_SHAPES } from './shared';
export type { Caller, FieldSpec, NestedField, ResponseRoute, Shape } from './types';

/** The routes grouped by surface, in the order of the documentation. */
export const RESPONSE_SURFACES: readonly ResponseSurface[] = [
  { title: 'Fediverse counters', routes: FEDIVERSE_ROUTES },
];

/**
 * The routes the frontend calls, read as each caller that may call them; the
 * ones that are not covered are listed in `docs/security/response-fields.md`.
 * The document lists the same routes and
 * `tests/response-fields-docs.test.ts` keeps both in step.
 */
export const RESPONSE_ROUTES: readonly ResponseRoute[] = RESPONSE_SURFACES.flatMap(
  (surface) => surface.routes
);
