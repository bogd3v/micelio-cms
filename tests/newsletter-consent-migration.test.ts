import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import { reportNewsletterConsent } from '../src/migrations/newsletter-consent'

const UID = 'section.newsletter'

interface Row {
  id: number
  [field: string]: unknown
}

const rowsOf = async (): Promise<Row[]> =>
  (await strapi.db.query(UID).findMany({ orderBy: { id: 'asc' } })) as Row[]

describe('newsletter consent migration', () => {
  let withoutNull: number
  let withoutEmpty: number
  let withText: number

  beforeAll(async () => {
    await setupStrapi()
    const query = strapi.db.query(UID)
    withoutNull = (await query.create({ data: { variant: 'inline', title: 'A' } })).id
    withoutEmpty = (await query.create({ data: { variant: 'card', consentText: '' } })).id
    withText = (await query.create({ data: { variant: 'inline', consentText: 'Legal text' } })).id
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('reports each newsletter without consentText and writes nothing', async () => {
    const warn = jest.spyOn(strapi.log, 'warn')
    const before = await rowsOf()

    const first = await reportNewsletterConsent(strapi)
    const second = await reportNewsletterConsent(strapi)

    expect(first).toEqual([withoutNull, withoutEmpty])
    expect(second).toEqual(first)
    expect(first).not.toContain(withText)
    expect(warn).toHaveBeenCalledTimes(first.length * 2)
    const messages = warn.mock.calls.map(([message]) => String(message))
    for (const id of first) {
      expect(messages).toContain(`[newsletter] entry ${id} has no consentText`)
    }
    expect(await rowsOf()).toEqual(before)
    warn.mockRestore()
  })

  it('fills none of consentText, successMessage and placeholder', async () => {
    await reportNewsletterConsent(strapi)

    const rows = await rowsOf()
    expect(rows.find((row) => row.id === withoutNull)).toMatchObject({
      consentText: null,
      successMessage: null,
      placeholder: null,
    })
    expect(rows.find((row) => row.id === withText)?.consentText).toBe('Legal text')
  })
})
