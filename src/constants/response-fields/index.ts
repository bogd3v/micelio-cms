import { ACCOUNT_ROUTES } from './accounts';
import { ARTICLE_ROUTES } from './articles';
import { FEDIVERSE_ROUTES } from './fediverse';
import { PAGE_ROUTES } from './pages';
import { SITE_ROUTES } from './site';
import { TAXONOMY_ROUTES } from './taxonomy';
import type { ResponseRoute, ResponseSurface } from './types';

export { SHARED_SHAPES } from './shared';
export type { Caller, FieldSpec, NestedField, ResponseRoute, Shape } from './types';

/** The routes grouped by surface, in the order of the documentation. */
export const RESPONSE_SURFACES: readonly ResponseSurface[] = [
  { title: 'Articles', routes: ARTICLE_ROUTES },
  { title: 'Categories and tags', routes: TAXONOMY_ROUTES },
  { title: 'About and pages', routes: PAGE_ROUTES },
  { title: 'Authors, global and site settings', routes: SITE_ROUTES },
  { title: 'Comments, sign in, the signed-in user and subscribers', routes: ACCOUNT_ROUTES },
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
