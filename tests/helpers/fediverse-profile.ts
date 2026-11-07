const SITE_SETTING_UID = 'api::site-setting.site-setting'

/**
 * Sets the handle's `@user` in the site settings' `fediverse` component (default locale), where
 * `FEDIVERSE_ACTOR_USERNAME` used to put it. Call it after `setupStrapi()`.
 */
export async function setFediverseUsername(username: string): Promise<void> {
  const site = await strapi.documents(SITE_SETTING_UID).findFirst()
  await strapi.documents(SITE_SETTING_UID).update({
    documentId: site!.documentId,
    data: { fediverse: { username } } as never,
  })
}
