async function getRole(type: string) {
  return strapi.query('plugin::users-permissions.role').findOne({ where: { type } })
}

async function getPublicRole() {
  return getRole('public')
}

// Spike: category and tag live in the micelio plugin, the rest under `api::`.
const PLUGIN_TYPES = ['category', 'tag']

function uidOf(contentType: string) {
  return PLUGIN_TYPES.includes(contentType)
    ? `plugin::micelio.${contentType}`
    : `api::${contentType}.${contentType}`
}

async function setRolePermissions(roleType: string, contentType: string, actions: string[]) {
  const role = await getRole(roleType)

  if (!role) {
    throw new Error(`Role ${roleType} not found`)
  }

  const permissionQueries = actions.map((action) =>
    strapi.query('plugin::users-permissions.permission').create({
      data: {
        action: `${uidOf(contentType)}.${action}`,
        role: role.id,
      },
    })
  )

  await Promise.all(permissionQueries)

  // Reload the users-permissions cache so new permissions take effect immediately
  await strapi.service('plugin::users-permissions.users-permissions').initialize()
}

async function setPublicPermissions(contentType: string, actions: string[]) {
  return setRolePermissions('public', contentType, actions)
}

export { getRole, getPublicRole, setRolePermissions, setPublicPermissions }
