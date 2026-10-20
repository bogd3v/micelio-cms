// Adds the fields needed to store fediverse replies as comments.
//
// This is a `strapi-server` extension rather than an extension `schema.json`
// because Strapi merges schema files shallowly (`{ ...original, ...extension }`):
// a schema.json declaring `attributes` would replace every attribute of the
// comments plugin, silently breaking it on the next plugin upgrade.
type CommentsService = Record<string, unknown>;

interface CommentsPlugin {
  services: { client: (args: { strapi: unknown }) => CommentsService };
  contentTypes: {
    comment: { schema: { attributes: Record<string, unknown> } };
  };
}

export default (plugin: CommentsPlugin): CommentsPlugin => {
  // The plugin emails the author of the parent comment on every reply, to the
  // address a guest typed (never verified), with the reply's text unescaped
  // and the super admin's address as sender. It sends nothing instead.
  const clientFactory = plugin.services.client;
  plugin.services.client = (args) => {
    const client = clientFactory(args);
    client.sendResponseNotification = async () => undefined;
    return client;
  };

  const { schema } = plugin.contentTypes.comment;

  schema.attributes = {
    ...schema.attributes,
    // Remote Note id: dedupes redelivered activities and resolves reply threads.
    fediverseUri: { type: 'string', unique: true, configurable: false },
    // `@user@host` of the remote author, for a "from the fediverse" badge.
    fediverseActorHandle: { type: 'string', configurable: false },
    // Id of the `Note` this site published for a moderator's reply (`/fediverse/notes/<documentId>`).
    // Not `fediverseUri`: the public API and the frontend read that one as "a comment from a remote
    // server", and badge and link it as such. Not re-attached to the public API by
    // `src/middlewares/fediverse-comment-fields.ts`, so it stays server side.
    fediverseNoteUri: { type: 'string', configurable: false },
    // Whether that `Note` was last retracted (`Delete`) because the reply stopped being shown.
    fediverseNoteRetracted: { type: 'boolean', configurable: false },
  };

  return plugin;
};
