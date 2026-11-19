import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import request from 'supertest'
import { setupStrapi, cleanupStrapi } from './strapi'
import { setPublicPermissions } from './helpers/permissions'
import { ARTICLE_POPULATE, FEED_POPULATE, POST_CARD_POPULATE } from './helpers/frontend-queries'
import type { Modules } from '@strapi/strapi'

// `translationCredits` of an article (ADR-0025 of micelio): who translated each
// locale, as fediverse actor URLs. Strapi applies `required`, `regex` and `max` when a
// locale is published, not to a draft (skill `strapi-content-type`); `maxLength` applies
// to a draft too.

const ARTICLE_UID = 'api::article.article'
const MAX_CREDITS = 10

type ArticleInput = Modules.Documents.Params.Data.Input<typeof ARTICLE_UID>
type Credits = NonNullable<ArticleInput['translationCredits']>

interface ApiCredit {
  actorUrl: string
}
interface ApiArticle {
  title: string
  locale: string
  translationCredits?: ApiCredit[]
}

const actor = (name: string) => `https://social.example.com/users/${name}`
const credits = (...names: string[]): Credits => names.map((name) => ({ actorUrl: actor(name) }))

describe('Translation credits (article.translationCredits)', () => {
  const documents = () => strapi.documents(ARTICLE_UID)
  const http = () => request(strapi.server.httpServer)

  /** A published `en` article with an `es` locale saved as a draft. */
  async function bilingual(slug: string, en: Credits, es: Credits) {
    const draft = await documents().create({
      data: { title: `${slug} en`, slug, translationCredits: en },
    })
    await documents().publish({ documentId: draft.documentId })
    await documents().update({
      documentId: draft.documentId,
      locale: 'es',
      data: { title: `${slug} es`, slug: `${slug}-es`, translationCredits: es },
    })
    return draft.documentId
  }

  const publishEs = (documentId: string) => documents().publish({ documentId, locale: 'es' })

  async function publicCredits(slug: string, locale: string): Promise<string[]> {
    const res = await http()
      .get('/api/articles')
      .query({ filters: { slug: { $eq: slug } }, locale, populate: { translationCredits: true } })
      .expect(200)
    const [article] = res.body.data as ApiArticle[]
    return (article.translationCredits ?? []).map((credit) => credit.actorUrl)
  }

  beforeAll(async () => {
    await setupStrapi()
    await setPublicPermissions('article', ['find', 'findOne'])
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('an article keeps different translation credits per locale', async () => {
    const documentId = await bilingual('per-locale', credits('ana'), credits('beto', 'deepl'))
    await publishEs(documentId)

    expect(await publicCredits('per-locale', 'en')).toEqual([actor('ana')])
    expect(await publicCredits('per-locale-es', 'es')).toEqual([actor('beto'), actor('deepl')])

    // A credit on es only leaves en without one, published and draft alike.
    const esOnly = await bilingual('es-only', [], credits('carla'))
    await publishEs(esOnly)
    expect(await publicCredits('es-only', 'en')).toEqual([])
    expect(await publicCredits('es-only-es', 'es')).toEqual([actor('carla')])
    const enDraft = await documents().findOne({
      documentId: esOnly,
      locale: 'en',
      status: 'draft',
      populate: { translationCredits: true },
    })
    expect(enDraft?.translationCredits).toEqual([])
  })

  it('refuses to publish an actorUrl that is not an https URL', async () => {
    const refused = [
      'http://social.example.com/users/ana',
      'social.example.com/users/ana',
      '@ana@social.example.com',
      'https://social.example.com/users/ana maria',
      'https://',
    ]
    for (const [i, actorUrl] of refused.entries()) {
      const documentId = await bilingual(`bad-${i}`, [], [{ actorUrl }])
      await expect(publishEs(documentId)).rejects.toThrow(
        /translationCredits\[0\]\.actorUrl must match the following/
      )
    }

    // The draft keeps what the editor typed; only publishing is refused.
    const draft = await documents().findFirst({
      locale: 'es',
      status: 'draft',
      filters: { slug: 'bad-0-es' },
      populate: { translationCredits: true },
    })
    expect(draft?.translationCredits).toMatchObject([{ actorUrl: refused[0] }])
  })

  it('refuses to save an actorUrl longer than 255 characters, even on a draft', async () => {
    const atLimit = `https://social.example.com/${'a'.repeat(255 - 'https://social.example.com/'.length)}`
    expect(atLimit).toHaveLength(255)

    const ok = await bilingual('long-ok', [], [{ actorUrl: atLimit }])
    await expect(publishEs(ok)).resolves.toBeTruthy()

    await expect(bilingual('long-bad', [], [{ actorUrl: `${atLimit}a` }])).rejects.toThrow(
      /translationCredits\[0\]\.actorUrl must be at most 255 characters/
    )
  })

  it('gives the admin form the 255-character limit of actorUrl', () => {
    // The server refuses a longer string even without `maxLength` (Strapi caps a `string`
    // at 255); the admin form limits the field only when the schema declares it.
    const { attributes } = strapi
      .plugin('content-manager')
      .service('components')
      .findComponent('shared.translation-credit')
    expect(attributes.actorUrl).toMatchObject({ type: 'string', maxLength: 255 })
  })

  it('refuses to publish a translation credit without an actorUrl', async () => {
    // @ts-expect-error: a credit left empty in the admin, which the type forbids
    const documentId = await bilingual('no-actor', [], [{}])
    await expect(publishEs(documentId)).rejects.toThrow(
      /translationCredits\[0\]\.actorUrl must be a `string` type, but the final value was: `null`/
    )
  })

  it('refuses to publish an eleventh translation credit on one locale', async () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `translator${i}`)

    // Ten on each locale: the limit is per locale, not per document.
    const ten = await bilingual(
      'ten',
      credits(...names(MAX_CREDITS)),
      credits(...names(MAX_CREDITS))
    )
    await expect(publishEs(ten)).resolves.toBeTruthy()
    expect(await publicCredits('ten-es', 'es')).toHaveLength(MAX_CREDITS)

    const eleven = await bilingual('eleven', [], credits(...names(MAX_CREDITS + 1)))
    await expect(publishEs(eleven)).rejects.toThrow(
      'translationCredits field must have less than or equal to 10 items'
    )
    expect(await publicCredits('eleven', 'en')).toEqual([])
  })

  it('an article without translation credits saves and publishes as before', async () => {
    const draft = await documents().create({ data: { title: 'No credits', slug: 'no-credits' } })
    await expect(documents().publish({ documentId: draft.documentId })).resolves.toBeTruthy()
    await documents().update({
      documentId: draft.documentId,
      locale: 'es',
      data: { title: 'Sin créditos', slug: 'sin-creditos' },
    })
    await expect(publishEs(draft.documentId)).resolves.toBeTruthy()

    const res = await http()
      .get('/api/articles')
      .query({ filters: { slug: { $eq: 'no-credits' } }, locale: 'en' })
      .expect(200)
    const [article] = res.body.data as ApiArticle[]
    expect(article.title).toBe('No credits')
    expect(article).not.toHaveProperty('translationCredits')
    expect(await publicCredits('sin-creditos', 'es')).toEqual([])
  })

  it('the public article routes do not return translationCredits to the queries the frontend sends', async () => {
    const documentId = await bilingual('frontend', credits('dana'), credits('elias'))
    await publishEs(documentId)

    const queries = [
      { populate: POST_CARD_POPULATE },
      { populate: ARTICLE_POPULATE, filters: { slug: { $eq: 'frontend' } } },
      { populate: FEED_POPULATE, sort: 'publishedAt:desc' },
      {},
    ]
    const bodies = []
    for (const locale of ['en', 'es']) {
      for (const query of queries) {
        bodies.push(
          (
            await http()
              .get('/api/articles')
              .query({ ...query, locale })
              .expect(200)
          ).body
        )
      }
      const one = await http()
        .get(`/api/articles/${documentId}`)
        .query({ populate: ARTICLE_POPULATE, locale })
        .expect(200)
      bodies.push(one.body)
    }

    for (const body of bodies) {
      const text = JSON.stringify(body)
      expect(text).not.toContain('translationCredits')
      expect(text).not.toContain('social.example.com')
    }
  })

  it('never requests a credited URL when saving or publishing', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    try {
      const documentId = await bilingual('offline', credits('fiona'), credits('gael'))
      await publishEs(documentId)
      const requested = fetchSpy.mock.calls.map(([input]) => String(input))
      expect(requested.filter((url) => url.includes('social.example.com'))).toEqual([])
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('describes the field in the admin', async () => {
    const { metadatas } = await strapi
      .plugin('content-manager')
      .service('content-types')
      .findConfiguration({ uid: ARTICLE_UID })

    const { description } = metadatas.translationCredits.edit
    expect(description).toMatch(/actor ActivityPub/)
    expect(description).toMatch(/no la página de su perfil/)
    expect(description).toMatch(/fediverso/)
    expect(description).toMatch(/traducción automática sin revisar acredita al actor del software/)
  })
})
