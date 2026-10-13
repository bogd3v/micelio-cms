import { COMMENTS_API_PREFIX } from '../constants/comments';
import { normalizePath } from './rate-limit/groups';

/**
 * Whether a request path is under the comments plugin's public REST prefix.
 *
 * @remarks
 * Strapi's router ignores letter case, so the path is normalised (lower case,
 * no repeated slashes) before it is compared with the prefix.
 */
export function isCommentsApiPath(path: string): boolean {
  return `${normalizePath(path)}/`.startsWith(COMMENTS_API_PREFIX);
}
