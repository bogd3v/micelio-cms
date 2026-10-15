// Type and audience claims on reader JWTs (ASVS V9.2.2, V9.2.3). The plugin
// signs `{ id }` only, so a token signed with the same secret for another
// purpose would pass. Both claims are added on issue and required on verify.
import { READER_JWT_AUDIENCE, READER_JWT_TYPE } from '../../constants/jwt';

type Service = Record<string, (...args: never[]) => unknown>;
type ServiceFactory = (args: { strapi: unknown }) => Service;
type Claims = { id?: number; aud?: unknown; type?: unknown };

/**
 * Wraps the users-permissions `jwt` service so `issue` adds the reader `type`
 * and `aud`, and `verify` refuses a token without them.
 *
 * @remarks
 * Tokens issued before this change have neither claim and stop working: the
 * reader signs in again. In `refresh` mode the plugin mints and checks its own
 * session tokens, so `verify` leaves them alone.
 *
 * @throws `Error` `Invalid token.` from `verify`, the plugin's own message, so the strategy answers 401.
 */
export function wrapJwtClaims(factory: ServiceFactory): ServiceFactory {
  return (args) => {
    const service = factory(args) as Record<string, unknown> & {
      issue: (payload: Claims, options?: object) => string;
      verify: (token: string) => Promise<Claims>;
    };
    const { issue, verify } = service;
    service.issue = (payload, options) =>
      issue.call(service, { ...payload, type: READER_JWT_TYPE }, options);
    service.verify = async (token) => {
      const payload = await verify.call(service, token);
      const mode: string = strapi.config.get(
        'plugin::users-permissions.jwtManagement',
        'legacy-support'
      );
      if (mode === 'refresh') return payload;
      if (payload?.type !== READER_JWT_TYPE || payload.aud !== READER_JWT_AUDIENCE) {
        throw new Error('Invalid token.');
      }
      return payload;
    };
    return service as unknown as Service;
  };
}
