import { SEEDED, createImages } from './response-fields-seed-base'
import { seedArticles, type SeededArticles } from './response-fields-seed-articles'
import { seedSite } from './response-fields-seed-site'

// One fully populated record per content type, private attributes filled with
// neutral data, for the response field suites (ASVS V15.3.1,
// docs/security/response-fields.md). Every optional field has a value, so a
// field the CMS returns shows up in the response.

export { SEEDED }

/** Access key of the frontend token; a suite sets `FRONTEND_API_TOKEN` to it before `setupStrapi()`. */
export const FRONTEND_KEY = 'fields-frontend-token-0123456789abcdef0123'
/** Access key of the read-only build token, for `BUILD_API_TOKEN`. */
export const BUILD_KEY = 'fields-build-token-0123456789abcdef012345'

/** Ids of what `seedContent` created. */
export interface SeededContent extends SeededArticles {
  pageDocumentId: string
}

/** Creates one fully populated record of every content type and publishes the ones with a draft state. */
export async function seedContent(): Promise<SeededContent> {
  const locales = strapi.plugin('i18n').service('locales')
  if (!(await locales.findByCode('es'))) {
    await locales.create({ code: 'es', name: 'Spanish (es)' })
  }
  const images = await createImages()
  const articles = await seedArticles(images)
  const site = await seedSite(images, articles)
  return { ...articles, ...site }
}

/** Creates a confirmed user with the role of `roleType` and returns its id and a JWT. */
export async function signIn(
  username: string,
  roleType: string
): Promise<{ id: string | number; jwt: string }> {
  const role = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: roleType } })
  const user = await strapi
    .plugin('users-permissions')
    .service('user')
    .add({
      username,
      email: `${username}@example.test`,
      password: 'Password123!',
      provider: 'local',
      confirmed: true,
      role: role.id,
    })
  const jwt = await strapi.plugin('users-permissions').service('jwt').issue({ id: user.id })
  return { id: user.id, jwt }
}
