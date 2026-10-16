/** Whether a security event happened (`success`) or was refused or failed (`failure`). */
export type SecurityOutcome = 'success' | 'failure';

/** The part of a Koa context (or a policy context wrapping one) that a refusal log reads. */
export interface AccessLogContext {
  state?: { user?: { id?: unknown } } & Record<string, unknown>;
  request?: { ip?: string; path?: string };
}
