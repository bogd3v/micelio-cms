import type { ResponseRoute } from './types'

/** The public counters of the fediverse plugin (`src/plugins/fediverse/server/src/routes/index.ts`). */
export const FEDIVERSE_ROUTES: readonly ResponseRoute[] = [
  {
    id: 'fediverse.stats-batch',
    auth: 'none (`auth: false`)',
    method: 'GET',
    path: '/api/fediverse/articles/stats?documentIds=:ids',
    callers: ['public'],
    reader: 'server/api/fediverse/stats/index.get.ts, server/api/posts/index.get.ts',
    kind: 'map',
    note: 'Aggregates only, never who interacted. Keyed by `documentId`; each value has these keys.',
    body: { likes: 'required', boosts: 'required', replies: 'required' },
  },
  {
    id: 'fediverse.stats-one',
    auth: 'none (`auth: false`)',
    method: 'GET',
    path: '/api/fediverse/articles/:documentId/stats',
    callers: ['public'],
    reader: 'server/api/fediverse/stats/[documentId].get.ts',
    note: 'Published articles only; any other id is a 404.',
    body: { likes: 'required', boosts: 'required' },
  },
  {
    id: 'fediverse.ranking',
    auth: 'none (`auth: false`)',
    method: 'GET',
    path: '/api/fediverse/articles/ranking',
    callers: ['public'],
    reader: 'server/api/posts/index.get.ts',
    note: 'The frontend takes the order from `documentId` and passes `meta` through; the counters are not read.',
    body: {
      data: {
        use: 'required',
        of: {
          documentId: 'required',
          likes: 'surplus',
          boosts: 'surplus',
          replies: 'surplus',
        },
      },
      meta: { use: 'required', of: { pagination: { use: 'required', of: 'pagination' } } },
    },
  },
]
