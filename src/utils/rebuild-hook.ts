/**
 * Rebuild hook for static and landing sites (#75, micelio ADR 0006 section
 * 7). Strapi's own webhooks cannot send the body GitHub's
 * `repository_dispatch` requires, so the CMS calls `REBUILD_HOOK_URL` itself
 * when published content changes.
 */

import type { Core } from '@strapi/strapi';
import { ARTICLE_UID, PAGE_UID, SITE_SETTING_UID } from '../constants/uids';

/** The `event_type` sent in the `repository_dispatch` body of every rebuild call. */
export const REBUILD_EVENT_TYPE = 'micelio-content';

/** Settings of the rebuild hook, read from the `REBUILD_HOOK_*` environment variables. */
export interface RebuildHookConfig {
  url: string;
  /** Sent as `Authorization: Bearer` (a GitHub token for `repository_dispatch`). */
  token?: string;
  /** Changes within this window produce one call. */
  debounceMs: number;
  /** Attempts after the first one fails, with doubling delays. */
  retries: number;
  retryDelayMs: number;
}

/** What changed since the last call, for the receiver's logs. */
export interface RebuildChange {
  uid: string;
  event: string;
  documentId?: string;
  locale?: string | null;
}

interface RebuildHook {
  schedule(change: RebuildChange): void;
  flush(): Promise<void>;
  stop(): void;
}

interface EntryEvent {
  uid?: string;
  entry?: { documentId?: string; locale?: string | null };
}

/** The hook's settings, or null when `REBUILD_HOOK_URL` is not set. */
export function rebuildHookConfig(env: NodeJS.ProcessEnv = process.env): RebuildHookConfig | null {
  const url = env.REBUILD_HOOK_URL?.trim();
  if (!url) return null;
  const integer = (value: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    url,
    token: env.REBUILD_HOOK_TOKEN?.trim() || undefined,
    debounceMs: integer(env.REBUILD_HOOK_DEBOUNCE_MS, 60_000),
    retries: integer(env.REBUILD_HOOK_RETRIES, 3),
    retryDelayMs: integer(env.REBUILD_HOOK_RETRY_DELAY_MS, 5_000),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Collects changes and calls the hook once per debounce window, retrying on
 * network errors and non-2xx answers. It never throws: a failing hook is
 * logged, and publishing is never blocked or failed by it.
 */
export function createRebuildHook(strapi: Core.Strapi, config: RebuildHookConfig): RebuildHook {
  let pending: RebuildChange[] = [];
  let timer: NodeJS.Timeout | null = null;
  let sending: Promise<void> = Promise.resolve();
  let stopped = false;

  async function send(changes: RebuildChange[]): Promise<void> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/vnd.github+json',
    };
    if (config.token) headers.authorization = `Bearer ${config.token}`;
    const body = JSON.stringify({
      event_type: REBUILD_EVENT_TYPE,
      client_payload: { changes: changes.slice(0, 50), count: changes.length },
    });

    for (let attempt = 0; attempt <= config.retries; attempt += 1) {
      if (stopped) return;
      try {
        const response = await fetch(config.url, { method: 'POST', headers, body });
        if (response.ok) {
          strapi.log.info(`[rebuild] requested a rebuild for ${changes.length} change(s)`);
          return;
        }
        strapi.log.warn(`[rebuild] the hook answered ${response.status}`);
      } catch (error) {
        strapi.log.warn(`[rebuild] the hook failed: ${error}`);
      }
      if (attempt < config.retries) await sleep(config.retryDelayMs * 2 ** attempt);
    }
    strapi.log.error(`[rebuild] gave up after ${config.retries + 1} attempts`);
  }

  /** Sends after the previous call settled, so calls go out in order. */
  async function sendAfter(previous: Promise<void>, changes: RebuildChange[]): Promise<void> {
    await previous;
    await send(changes);
  }

  function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending.length === 0) return sending;
    const changes = pending;
    pending = [];
    sending = sendAfter(sending, changes);
    return sending;
  }

  return {
    schedule(change: RebuildChange): void {
      if (stopped) return;
      pending.push(change);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), config.debounceMs);
    },
    flush,
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = [];
    },
  };
}

/**
 * The changes that rebuild a static site: publish, unpublish and delete of
 * articles and pages (saving a draft emits none of them), and every save of
 * the site settings, which have no drafts.
 */
const TRIGGERS: [event: string, uids: string[]][] = [
  ['entry.publish', [ARTICLE_UID, PAGE_UID]],
  ['entry.unpublish', [ARTICLE_UID, PAGE_UID]],
  ['entry.delete', [ARTICLE_UID, PAGE_UID, SITE_SETTING_UID]],
  ['entry.create', [SITE_SETTING_UID]],
  ['entry.update', [SITE_SETTING_UID]],
];

/**
 * Subscribes the hook to the content events when `REBUILD_HOOK_URL` is set.
 * Returns a function that unsubscribes it and drops what is pending.
 */
export function registerRebuildHook(strapi: Core.Strapi): (() => void) | null {
  const config = rebuildHookConfig();
  if (!config) return null;
  const hook = createRebuildHook(strapi, config);

  const unsubscribers = TRIGGERS.map(([event, uids]) =>
    strapi.eventHub.on(event, async (payload: EntryEvent) => {
      if (!payload?.uid || !uids.includes(payload.uid)) return;
      hook.schedule({
        uid: payload.uid,
        event,
        documentId: payload.entry?.documentId,
        locale: payload.entry?.locale ?? null,
      });
    })
  );
  return () => {
    for (const off of unsubscribers) off();
    hook.stop();
  };
}
