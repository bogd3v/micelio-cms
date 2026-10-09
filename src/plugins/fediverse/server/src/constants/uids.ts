/** Content type UIDs the plugin reads or writes. */

/** Articles, the objects the plugin federates. */
export const ARTICLE_UID = 'api::article.article';
/** Comments of `strapi-plugin-comments`, where fediverse replies are stored. */
export const COMMENT_UID = 'plugin::comments.comment';
/** The single type the actor's name, bio, avatar and header come from first. */
export const GLOBAL_UID = 'api::global.global';
/** Site settings, the fallback for the actor's name and bio when `global` has none. */
export const SITE_SETTING_UID = 'api::site-setting.site-setting';
/** The plugin's remote followers, one row per actor. */
export const FOLLOWER_UID = 'plugin::fediverse.follower';
/** The plugin's likes and boosts, one row per type, actor and article. */
export const INTERACTION_UID = 'plugin::fediverse.interaction';
