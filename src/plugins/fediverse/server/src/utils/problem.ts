import type { FederationProblemCode } from '../types/federation-panel';

/** Media type of an RFC 9457 problem detail. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** The RFC 9457 body the admin routes answer an error with; a client branches on `code`. */
export interface ProblemBody {
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
  code: FederationProblemCode;
}

/** Builds a problem detail body (RFC 9457) with a stable `code` extension member. */
export function problemBody(
  status: number,
  code: FederationProblemCode,
  title: string,
  detail: string
): ProblemBody {
  return { type: 'about:blank', title, status, detail, code };
}
