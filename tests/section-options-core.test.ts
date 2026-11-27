import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { setupStrapi, cleanupStrapi } from './strapi'
import pageSchema from '../src/api/page/content-types/page/schema'
import catalogue from '@micelio/strapi-plugin-core/blocks.schema.json'
import { defaultSiteRelation } from '../src/utils/default-site'

// A page saved from the admin sends the default of every option its section stores, and the
// installed `@micelio/strapi-plugin-core` refuses an option its catalogue does not expose
// (`server/src/block-options/rules.ts` there). `tests/section-options.test.ts` reads only the
// component files, so a pin of the core that lags behind the sections passed it (#500). This suite
// asks the installed core: the sections come from the `sections` zone of the page, the catalogue
// from the package, and neither list is copied here.

const PAGE_UID = 'api::page.page'

interface Attribute {
  type: string
  enum?: string[]
  default?: string
}

interface CatalogueBlock {
  properties: Record<string, unknown>
  'x-strapi': { component: string }
}

type Data = Record<string, unknown>

/** The components of the page's `sections` zone. */
const zone = (pageSchema.attributes as unknown as Record<string, { components: string[] }>).sections
  .components

/** The catalogue's block of each component it lists, keyed by the component's UID. */
const blocks = new Map<string, CatalogueBlock>(
  Object.values(catalogue.$defs as unknown as Record<string, CatalogueBlock>).map((block) => [
    block['x-strapi'].component,
    block,
  ])
)

/** The values a catalogue property offers: its `enum`, or the one of the non-null branch of `anyOf`. */
function offered(property: unknown): string[] | null {
  if (!property) {
    return null
  }
  const { enum: values, anyOf } = property as { enum?: string[]; anyOf?: { enum?: string[] }[] }
  return values ?? anyOf?.find((branch) => branch.enum)?.enum ?? null
}

/** The sections of the zone that the installed catalogue lists; the core's rule skips the others. */
const listed = zone.filter((uid) => blocks.has(uid))

/** The enumerations a component stores, as Strapi loaded them. */
function enumerations(uid: string): [string, Attribute][] {
  const { attributes } = strapi.components[uid as keyof typeof strapi.components] as unknown as {
    attributes: Record<string, Attribute>
  }
  return Object.entries(attributes).filter(([, attribute]) => attribute.type === 'enumeration')
}

/** A value no block offers for any option. */
const UNOFFERED = 'not-an-offered-value'

describe('options of the page sections against the installed core (#500)', () => {
  const pages = () =>
    strapi.documents(PAGE_UID) as unknown as {
      create(params: Data): Promise<Data & { documentId: string }>
    }
  let counter = 0
  const save = async (sections: Data[]) =>
    pages().create({
      data: {
        title: 'Options',
        slug: `section-options-core-${++counter}`,
        sections,
        site: await defaultSiteRelation(strapi),
      },
    })

  /**
   * Whether the installed core's rule reads `option`: it refuses a value no block offers. The
   * vocabulary is not exported, so the rule itself is asked. An enumeration outside it (`sort` of
   * `section.post-list`, which the catalogue lists too) is left to Strapi's own validation.
   */
  const readByRule = async (uid: string, option: string): Promise<boolean> => {
    try {
      await save([{ __component: uid, [option]: UNOFFERED }])
    } catch (error) {
      const { name, details } = error as { name?: string; details?: { code?: string } }
      if (details?.code === 'blockOptionInvalid') {
        return true
      }
      if (name !== 'ValidationError') {
        throw error
      }
    }
    return false
  }

  beforeAll(async () => {
    await setupStrapi()
  })

  afterAll(async () => {
    await cleanupStrapi()
  })

  it('lists sections of the zone in the installed catalogue', () => {
    expect(listed.length).toBeGreaterThan(0)
  })

  it('the catalogue of the installed core offers every option value each section of the page zone stores', async () => {
    const checked: string[] = []
    const missing: string[] = []
    for (const uid of listed) {
      const block = blocks.get(uid) as CatalogueBlock
      for (const [option, attribute] of enumerations(uid)) {
        if (!(await readByRule(uid, option))) {
          continue
        }
        checked.push(`${uid}.${option}`)
        const values = offered(block.properties[option])
        if (!values) {
          missing.push(`${uid}: option ${option} is not exposed`)
          continue
        }
        for (const value of attribute.enum ?? []) {
          if (!values.includes(value)) {
            missing.push(`${uid}: ${option} value ${value} is not offered`)
          }
        }
      }
    }
    // With no option read by the rule, the list below would be empty for the wrong reason.
    expect(checked.length).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it('saves a page with each section of the zone sending its default tone and align', async () => {
    const refused: string[] = []
    for (const uid of listed) {
      const stored = Object.fromEntries(enumerations(uid))
      const options: Data = {}
      for (const name of ['tone', 'align']) {
        if (stored[name]) {
          options[name] = stored[name].default
        }
      }
      try {
        await save([{ __component: uid, ...options }])
      } catch (error) {
        refused.push(`${uid}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    expect(refused).toEqual([])
  })

  it('refuses an option value the catalogue does not offer, naming the block and the option', async () => {
    await expect(save([{ __component: 'section.hero', tone: 'not-a-tone' }])).rejects.toThrow(
      /hero block does not allow that value for tone/
    )
  })
})
