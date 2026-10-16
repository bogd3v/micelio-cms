import type { AppKeyHost } from '../utils/app-key-secret';

/** Whether a security event happened (`success`) or was refused or failed (`failure`). */
export type SecurityOutcome = 'success' | 'failure';

/** The part of a Koa context (or a policy context wrapping one) that a refusal log reads. */
export interface AccessLogContext {
  state?: { user?: { id?: unknown } } & Record<string, unknown>;
  request?: { ip?: string; path?: string };
}

interface SecurityLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** The part of Strapi the security log reads: the logger and the app keys. */
export interface SecurityLogHost extends AppKeyHost {
  log: SecurityLogger;
}
