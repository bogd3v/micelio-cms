// Building blocks of the seed for the response field suites (ASVS V15.3.1,
// docs/security/response-fields.md): the Document Service without generated
// types, a file row with every column filled, and the data several records share.

const FILE_UID = 'plugin::upload.file'

/** Values of the seed that the suites refer to. */
export const SEEDED = {
  /** A private attribute: no response may carry it. */
  authorEmail: 'author-private@example.test',
  articleSlug: 'fields-article',
  categorySlug: 'fields-category',
  tagSlug: 'fields-tag',
  pageSlug: 'fields-page',
  subscriberEmail: 'subscriber@example.test',
} as const

/** Plain data, as the seed stores it. */
export type Data = Record<string, unknown>

/** The Document Service without the generated types: the seed stores plain data. */
export interface Documents {
  create(params: { data: Data }): Promise<{ documentId: string }>
  update(params: { documentId: string; locale?: string; data: Data }): Promise<unknown>
  publish(params: { documentId: string; locale?: string }): Promise<unknown>
  findFirst(): Promise<{ documentId: string } | null>
}

export const documents = (uid: string): Documents =>
  strapi.documents(uid as never) as unknown as Documents

/** Creates a file row with every column of `plugin::upload.file` filled. */
export async function createImage(name: string, ext = '.png', mime = 'image/png'): Promise<number> {
  const row = await strapi.db.query(FILE_UID).create({
    data: {
      name,
      alternativeText: `Alt of ${name}`,
      caption: `Caption of ${name}`,
      width: 640,
      height: 480,
      formats: {
        thumbnail: {
          name: `thumbnail_${name}`,
          hash: `thumbnail_${name}_hash`,
          ext,
          mime,
          path: null,
          width: 208,
          height: 156,
          size: 1.5,
          sizeInBytes: 1500,
          url: `/uploads/thumbnail_${name}`,
        },
      },
      hash: `${name.replace(/\W/g, '_')}_hash`,
      ext,
      mime,
      size: 12.5,
      url: `/uploads/${name}`,
      previewUrl: `/uploads/preview_${name}`,
      provider: 'local',
      provider_metadata: { note: 'provider-note' },
    },
  })
  return row.id as number
}

/** An image credit with every field filled. */
export const credit: Data = {
  kind: 'photo',
  author: 'Ana Example',
  authorUrl: 'https://example.test/ana',
  source: 'Example Source',
  sourceUrl: 'https://example.test/source',
  license: 'cc-by-4.0',
  licenseUrl: 'https://example.test/license',
  modifications: 'cropped',
}

/** A link of the About page. */
export const link = { label: 'Read more', url: '/blog', variant: 'primary' }

/** The ids of the files the seed creates. */
export interface SeededImages {
  cover: number
  avatar: number
  metaImage: number
  slide: number
  poster: number
  model: number
}

/** Creates the files that the records of the seed point to. */
export async function createImages(): Promise<SeededImages> {
  return {
    cover: await createImage('cover.png'),
    avatar: await createImage('avatar.png'),
    metaImage: await createImage('meta.png'),
    slide: await createImage('slide.png'),
    poster: await createImage('poster.png'),
    model: await createImage('model.glb', '.glb', 'model/gltf-binary'),
  }
}

/** A `shared.seo` component with every field filled. */
export function seoOf(metaImage: number): Data {
  return {
    metaTitle: 'Meta title',
    metaDescription: 'A meta description that is long enough to pass the minimum length rule.',
    metaImage,
    metaSocial: [
      {
        socialNetwork: 'Twitter',
        title: 'Social title',
        description: 'Social description',
        image: metaImage,
      },
    ],
    keywords: 'one, two',
    metaRobots: 'index, follow',
    structuredData: { '@type': 'Article' },
    metaViewport: 'width=device-width',
    canonicalURL: 'https://example.test/canonical',
  }
}
