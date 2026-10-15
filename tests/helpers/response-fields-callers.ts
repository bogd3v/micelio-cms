import request from 'supertest';
import qs from 'qs';
import type { Caller } from '../../src/constants/response-fields';
import { BUILD_KEY, FRONTEND_KEY } from './response-fields-seed';

// How the response field suites call the content API as each caller.

/** Reads a path as one caller and returns the JSON body; throws on any status but 200. */
export type Get = (path: string, query?: object) => Promise<unknown>;

/** The JWTs of the signed-in callers of a suite. */
export interface Jwts {
  user?: string;
  editor?: string;
}

/** A supertest request as `caller`: the public role sends nothing, a token or a user sends its credential. */
export function authorize(caller: Caller, req: request.Test, jwts: Jwts = {}): request.Test {
  if (caller === 'frontend') return req.set('Authorization', `Bearer ${FRONTEND_KEY}`);
  if (caller === 'build') return req.set('Authorization', `Bearer ${BUILD_KEY}`);
  if (caller === 'editor' && jwts.editor) return req.set('Authorization', `Bearer ${jwts.editor}`);
  if (caller === 'user' && jwts.user) return req.set('Authorization', `Bearer ${jwts.user}`);
  return req;
}

/** The test server, as supertest drives it. */
export const http = (): ReturnType<typeof request> => request(strapi.server.httpServer);

/** A `Get` as `caller`. */
export function getAs(caller: Caller, jwts: Jwts = {}): Get {
  return async (path, query = {}) => {
    const res = await authorize(caller, http().get(`${path}?${qs.stringify(query)}`), jwts);
    if (res.status !== 200) {
      throw new Error(`GET ${path} as ${caller} answered ${res.status}: ${res.text}`);
    }
    return res.body;
  };
}
