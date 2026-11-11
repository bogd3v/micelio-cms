import type { Core, UID } from '@strapi/strapi'
import { SITE_UID } from '@micelio/strapi-plugin-core/strapi-server'

const GLOBAL_UID = 'api::global.global'

/**
 * The relation table Strapi's upload plugin keeps for every media field. Removing an attribute
 * from a schema leaves its rows here, which is what this migration reads.
 */
const MEDIA_RELATIONS_TABLE = 'files_related_mph'

/** The `global` field that #307 removed from the schema. */
const REMOVED_FIELD = 'fediverseHeader'

interface Fediverse {
  id: number
  header?: { id: number } | null
}

/**
 * Copies the image that `global.fediverseHeader` held into the `header` of the default site's
 * `fediverse` component, the field that replaced it (#303), then drops the old relation.
 *
 * @remarks
 * The attribute is gone from `global`'s schema, so the image is read from the upload plugin's
 * relation table, where Strapi leaves it. The component belongs to the default locale of
 * the default site (it is not localized, so Strapi writes it to the others). Runs after
 * `copySiteSettingsToSite`, so an upgrade has the profile of the retired single type in the site
 * before the header is added to it. A `header` that
 * is already filled is never overwritten: the old relation is dropped and the editor's image
 * stays. The relation is dropped in both cases, so an editor who later clears the header does not
 * get the old image back at the next boot, and a second run changes nothing. Without a default
 * site in the default locale or without a file behind the relation nothing is touched, and
 * the next boot tries again.
 *
 * @returns `1` when an image was copied, otherwise `0`.
 */
export async function migrateFediverseHeader(strapi: Core.Strapi): Promise<number> {
  const global = (await strapi.db.query(GLOBAL_UID).findOne({ select: ['id'] })) as {
    id: number
  } | null
  if (!global) return 0

  const connection = strapi.db.connection
  const relation = (await connection(MEDIA_RELATIONS_TABLE)
    .where({ related_type: GLOBAL_UID, related_id: global.id, field: REMOVED_FIELD })
    .orderBy('order', 'asc')
    .first()) as { file_id: number } | undefined
  if (!relation) return 0

  const defaultLocale = (await (
    strapi.plugin('i18n').service('locales') as { getDefaultLocale: () => Promise<string> }
  ).getDefaultLocale()) as string
  const settings = strapi.documents(SITE_UID as UID.ContentType)
  // The host's types do not know the component's attributes.
  type Query = NonNullable<Parameters<typeof settings.findFirst>[0]>
  const site = (await settings.findFirst({
    filters: { isDefault: true },
    locale: defaultLocale,
    populate: { fediverse: { populate: { header: true } } },
  } as unknown as Query)) as { documentId: string; fediverse?: Fediverse | null } | null
  if (!site) return 0

  const file = await connection('files').where({ id: relation.file_id }).first('id')
  const drop = () =>
    connection(MEDIA_RELATIONS_TABLE)
      .where({ related_type: GLOBAL_UID, related_id: global.id, field: REMOVED_FIELD })
      .delete()

  // A relation whose file is gone is left as it is: there is nothing to copy, and the next boot
  // looks again.
  if (!file) return 0
  if (site.fediverse?.header) {
    await drop()
    return 0
  }

  // The component keeps its other fields: only `header` is given for an existing one.
  type Data = Parameters<typeof settings.update>[0]['data']
  const fediverse = site.fediverse
    ? { id: site.fediverse.id, header: file.id }
    : { header: file.id }
  await settings.update({
    documentId: site.documentId,
    locale: defaultLocale,
    data: { fediverse } as unknown as Data,
  })
  await drop()
  return 1
}
