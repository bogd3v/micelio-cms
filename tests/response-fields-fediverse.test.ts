import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { assertShape, routeById as route, unexercisedCallers } from './helpers/response-fields'
import { seedContent, type SeededContent } from './helpers/response-fields-seed'
import { RESPONSE_ROUTES } from '../src/constants/response-fields'

// ASVS V15.3.1 for the public counters of the fediverse plugin: aggregates
// only, never who interacted.

const ARTICLE_UID = 'api::article.article'
const COMMENT_UID = 'plugin::comments.comment'
const ACTOR = 'https://remote.example/users/ana'

describe('Response fields of the fediverse counters (ASVS V15.3.1)', () => {
  const saved = { ...process.env }
  const get = (path: string, query: Record<string, string> = {}) =>
    request(strapi.server.httpServer).get(path).query(query)
  let seeded: SeededContent

  beforeAll(async () => {
    // Read when the plugin registers, so it must be set before Strapi boots.
    process.env.FEDIVERSE_ENABLED = 'true'
    process.env.FEDIVERSE_ACTOR_IDENTIFIER = 'site'
    process.env.FEDIVERSE_ACTOR_USERNAME = 'site'
    await setupStrapi()
    seeded = await seedContent()

    const interactions = strapi.plugin('fediverse').service('interactions')
    for (const [type, actorId] of [
      ['like', `${ACTOR}1`],
      ['boost', `${ACTOR}2`],
    ] as const) {
      await interactions.recordInteraction(strapi, {
        type,
        actorId,
        articleDocumentId: seeded.articleDocumentId,
      })
    }
    await strapi.documents(COMMENT_UID).create({
      data: {
        content: 'A reply from the fediverse',
        related: `${ARTICLE_UID}:${seeded.articleDocumentId}`,
        approvalStatus: 'APPROVED',
        authorId: `${ACTOR}3`,
        authorName: 'Ana',
        fediverseActorHandle: '@ana@remote.example',
        fediverseUri: `${ACTOR}3/notes/1`,
      },
    })
  })

  afterAll(async () => {
    await cleanupStrapi()
    process.env = { ...saved }
  })

  it('fediverse.stats-batch returns only listed fields and every required one', async () => {
    const res = await get('/api/fediverse/articles/stats', {
      documentIds: `${seeded.articleDocumentId},${seeded.secondArticleDocumentId}`,
    })
    expect(res.status).toBe(200)
    expect(res.body[seeded.articleDocumentId]).toEqual({ likes: 1, boosts: 1, replies: 1 })
    assertShape(route('fediverse.stats-batch'), 'public', [res.body])
  })

  it('fediverse.stats-one returns only listed fields and every required one', async () => {
    const res = await get(`/api/fediverse/articles/${seeded.articleDocumentId}/stats`)
    expect(res.status).toBe(200)
    assertShape(route('fediverse.stats-one'), 'public', [res.body])
  })

  it('fediverse.ranking returns only listed fields and every required one', async () => {
    const res = await get('/api/fediverse/articles/ranking')
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    assertShape(route('fediverse.ranking'), 'public', [res.body])
    expect(JSON.stringify(res.body)).not.toContain(ACTOR)
  })

  it('fediverse.stats-one does not confirm that an unpublished id exists', async () => {
    const res = await get('/api/fediverse/articles/not-a-document/stats')
    expect(res.status).toBe(404)
  })

  it('read every route as every caller that may', () => {
    const ids = RESPONSE_ROUTES.map((candidate) => candidate.id).filter((id) =>
      id.startsWith('fediverse.')
    )
    expect(unexercisedCallers(ids)).toEqual([])
  })
})
