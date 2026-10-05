import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setupStrapi, cleanupStrapi } from './strapi';
import { waitUntil } from './helpers/wait-until';
import {
  createRebuildHook,
  rebuildHookConfig,
  REBUILD_EVENT_TYPE,
} from '../src/utils/rebuild-hook';

// Static and landing sites rebuild when published content changes (#75,
// micelio ADR 0006 section 7). A local server stands in for GitHub's
// repository_dispatch or a host's deploy hook.

const PAGE_UID = 'api::page.page';
const ARTICLE_UID = 'api::article.article';
const SITE_SETTING_UID = 'api::site-setting.site-setting';
const DEBOUNCE_MS = 300;

interface Received {
  authorization?: string;
  body: { event_type: string; client_payload: { changes: { uid: string; event: string }[] } };
}

type Data = Record<string, unknown>;

describe('Rebuild hook', () => {
  const saved = { ...process.env };
  const received: Received[] = [];
  /** Status codes to answer with, in order; 200 once they run out. */
  let answers: number[] = [];
  let server: Server;
  let url: string;

  const documents = (uid: string) =>
    strapi.documents(uid as typeof PAGE_UID) as unknown as {
      create(params: Data): Promise<{ documentId: string }>;
      update(params: Data): Promise<unknown>;
      publish(params: Data): Promise<unknown>;
      unpublish(params: Data): Promise<unknown>;
      delete(params: Data): Promise<unknown>;
      findFirst(params?: Data): Promise<{ documentId: string } | null>;
    };
  const quiet = () => new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 2));

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        received.push({ authorization: req.headers.authorization, body: JSON.parse(raw) });
        res.statusCode = answers.shift() ?? 200;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dispatch`;

    process.env.REBUILD_HOOK_URL = url;
    process.env.REBUILD_HOOK_TOKEN = 'gh-token';
    process.env.REBUILD_HOOK_DEBOUNCE_MS = String(DEBOUNCE_MS);
    process.env.REBUILD_HOOK_RETRY_DELAY_MS = '20';
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    await new Promise((resolve) => server.close(resolve));
    process.env = { ...saved };
  });

  beforeEach(async () => {
    // Lets anything still in a debounce window arrive before the next test.
    await quiet();
    received.length = 0;
    answers = [];
  });

  it('does not fire when a draft is saved', async () => {
    const draft = await documents(PAGE_UID).create({ data: { title: 'Draft', slug: 'draft' } });
    await documents(PAGE_UID).update({ documentId: draft.documentId, data: { title: 'Draft 2' } });
    await quiet();
    expect(received).toHaveLength(0);
  });

  it('fires once for changes published within the debounce window', async () => {
    const page = await documents(PAGE_UID).create({ data: { title: 'Landing', slug: 'landing' } });
    const article = await documents(ARTICLE_UID).create({
      data: { title: 'Post', slug: 'post' },
    });
    await documents(PAGE_UID).publish({ documentId: page.documentId });
    await documents(ARTICLE_UID).publish({ documentId: article.documentId });

    await waitUntil(() => received.length > 0);
    await quiet();
    expect(received).toHaveLength(1);
    expect(received[0].authorization).toBe('Bearer gh-token');
    expect(received[0].body.event_type).toBe(REBUILD_EVENT_TYPE);
    expect(received[0].body.client_payload.changes.map(({ uid, event }) => [uid, event])).toEqual([
      [PAGE_UID, 'entry.publish'],
      [ARTICLE_UID, 'entry.publish'],
    ]);
  });

  it('fires on unpublish and on delete', async () => {
    const page = await documents(PAGE_UID).create({
      status: 'published',
      data: { title: 'Gone', slug: 'gone' },
    });
    await waitUntil(() => received.length > 0);
    received.length = 0;

    await documents(PAGE_UID).unpublish({ documentId: page.documentId });
    await waitUntil(() => received.length > 0);
    expect(received[0].body.client_payload.changes[0].event).toBe('entry.unpublish');

    received.length = 0;
    await documents(PAGE_UID).delete({ documentId: page.documentId });
    await waitUntil(() => received.length > 0);
    expect(received[0].body.client_payload.changes[0].event).toBe('entry.delete');
  });

  it('fires when the site settings are saved, which have no drafts', async () => {
    const settings = await documents(SITE_SETTING_UID).findFirst();
    await documents(SITE_SETTING_UID).update({
      documentId: settings!.documentId,
      locale: 'en',
      data: { description: 'Changed' },
    });
    await waitUntil(() => received.length > 0);
    expect(received[0].body.client_payload.changes[0]).toMatchObject({
      uid: SITE_SETTING_UID,
      event: 'entry.update',
    });
  });

  it('retries a failing hook and never fails the publish', async () => {
    answers = [500, 503];
    await expect(
      documents(PAGE_UID).create({ status: 'published', data: { title: 'Retry', slug: 'retry' } })
    ).resolves.toBeTruthy();

    await waitUntil(() => received.length === 3);
    await quiet();
    expect(received).toHaveLength(3);
  });

  it('gives up quietly when the hook cannot be reached', async () => {
    const hook = createRebuildHook(strapi, {
      url: 'http://127.0.0.1:9/unreachable',
      debounceMs: 10_000,
      retries: 1,
      retryDelayMs: 10,
    });
    hook.schedule({ uid: PAGE_UID, event: 'entry.publish' });
    await expect(hook.flush()).resolves.toBeUndefined();
    hook.stop();
  });

  it('reads its settings from the environment, off without a URL', () => {
    expect(rebuildHookConfig({})).toBeNull();
    expect(rebuildHookConfig({ REBUILD_HOOK_URL: 'https://example.com/hook' })).toEqual({
      url: 'https://example.com/hook',
      token: undefined,
      debounceMs: 60_000,
      retries: 3,
      retryDelayMs: 5_000,
    });
  });
});
