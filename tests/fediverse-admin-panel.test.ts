import { describe, it, expect } from '@jest/globals';
import {
  blockedMessageId,
  classifyFailure,
  federateHintId,
  interpretResponse,
  problemMessageId,
  statusView,
  type ArticleFederation,
  type FederateResult,
} from '../src/plugins/fediverse/admin/src/state';
import type {
  ArticleFederation as ServerArticleFederation,
  FederateResult as ServerFederateResult,
} from '../src/plugins/fediverse/server/src/types/federation-panel';
import { classifyRequest } from '../src/utils/rate-limit/groups';
import en from '../src/plugins/fediverse/admin/src/translations/en.json';
import es from '../src/plugins/fediverse/admin/src/translations/es.json';

const base: ArticleFederation = {
  documentId: 'a1',
  state: 'never',
  lastActivityType: null,
  lastActivityAt: null,
  createSentAt: null,
  attempts: 0,
  lastError: null,
  counts: { likes: 0, boosts: 0, repliesApproved: 0, repliesPending: 0 },
  canFederate: { allowed: true },
};

describe('Fediverse admin panel: what it says about each state', () => {
  it('has a headline for each of the four states and the retraction, and none claims a delivery succeeded', () => {
    const states = ['never', 'created', 'updated', 'deleted', 'failed'] as const;
    for (const state of states) {
      const view = statusView({ ...base, state });
      expect(Object.keys(en)).toContain(view.messageId);
      expect(en[view.messageId as keyof typeof en]).not.toMatch(/delivered/i);
      expect(es[view.messageId as keyof typeof es]).not.toMatch(/entregad/i);
    }
    expect(statusView({ ...base, state: 'never' }).tone).toBe('neutral');
    expect(statusView({ ...base, state: 'created' }).tone).toBe('success');
    expect(statusView({ ...base, state: 'failed' }).tone).toBe('danger');
  });

  it('shows the time of a queued activity but not of an article never federated', () => {
    expect(statusView({ ...base, state: 'never' }).showTime).toBe(false);
    expect(
      statusView({ ...base, state: 'created', lastActivityAt: '2026-01-01T00:00:00Z' }).showTime
    ).toBe(true);
  });

  it('shows the last error only when there is one, and keeps it on a queued activity that retried', () => {
    expect(statusView({ ...base, state: 'failed', lastError: null }).showError).toBe(false);
    expect(statusView({ ...base, state: 'failed', lastError: 'HTTP 500' }).showError).toBe(true);
    expect(statusView({ ...base, state: 'created', lastError: 'HTTP 500' }).showError).toBe(true);
    expect(statusView({ ...base, state: 'deleted', lastError: 'HTTP 500' }).showError).toBe(false);
  });

  it('says which activity the button sends', () => {
    expect(federateHintId({ ...base, state: 'never' })).toBe('fediverse.panel.federate.create');
    expect(federateHintId({ ...base, state: 'deleted' })).toBe('fediverse.panel.federate.create');
    expect(federateHintId({ ...base, state: 'created' })).toBe('fediverse.panel.federate.update');
    expect(federateHintId({ ...base, state: 'failed' })).toBe('fediverse.panel.federate.update');
  });

  it('gives the reason the button is disabled, in both languages', () => {
    expect(blockedMessageId(base)).toBeNull();
    for (const code of ['article-not-published', 'locale-not-federated'] as const) {
      const id = blockedMessageId({ ...base, canFederate: { allowed: false, code } });
      expect(id).toBe(`fediverse.panel.blocked.${code}`);
      expect(Object.keys(en)).toContain(id);
      expect(Object.keys(es)).toContain(id);
    }
  });

  it('keeps the admin copy of the response types the same as the server type', () => {
    // A drift in either direction fails the type check of this file.
    const toAdmin = (value: ServerArticleFederation): ArticleFederation => value;
    const toServer = (value: ArticleFederation): ServerArticleFederation => value;
    const resultToAdmin = (value: ServerFederateResult): FederateResult => value;
    const resultToServer = (value: FederateResult): ServerFederateResult => value;
    expect([toAdmin, toServer, resultToAdmin, resultToServer]).toHaveLength(4);
  });

  describe('reads the responses the way the admin fetch client leaves them', () => {
    it('takes a 2xx JSON body as the data', () => {
      expect(interpretResponse<{ a: number }>(200, '{"a":1}')).toEqual({
        ok: true,
        data: { a: 1 },
      });
      expect(interpretResponse<{ a: number }>(202, '{"a":1}')).toEqual({
        ok: true,
        data: { a: 1 },
      });
    });

    it('reads the code of a problem detail, which the fetch client would drop', () => {
      const body = JSON.stringify({
        type: 'about:blank',
        status: 409,
        code: 'article-not-published',
      });
      expect(interpretResponse(409, body)).toEqual({
        ok: false,
        status: 409,
        problem: { code: 'article-not-published' },
      });
    });

    it('reads a plain "Not Found" and a Strapi error body, both with no code, as federation off', () => {
      const plain = interpretResponse(404, 'Not Found');
      const strapi = interpretResponse(
        404,
        '{"data":null,"error":{"status":404,"name":"NotFoundError"}}'
      );
      for (const result of [plain, strapi]) {
        expect(result).toMatchObject({ ok: false, status: 404, problem: undefined });
        if (!result.ok) expect(classifyFailure(result.problem, result.status)).toBe('off');
      }
    });

    it('does not treat an unreadable success body as data', () => {
      expect(interpretResponse(200, '<html>')).toEqual({
        ok: false,
        status: 200,
        problem: undefined,
      });
    });

    it('has a translated message for every code the routes answer, and a generic one', () => {
      for (const code of [
        'forbidden',
        'article-not-found',
        'article-not-published',
        'locale-not-federated',
        'queue-unavailable',
      ]) {
        const id = problemMessageId(code);
        expect(Object.keys(en)).toContain(id);
        expect(Object.keys(es)).toContain(id);
      }
      expect(problemMessageId('something-new')).toBe('fediverse.panel.problem.unknown');
      expect(problemMessageId(undefined)).toBe('fediverse.panel.problem.unknown');
    });
  });

  it('tells a missing route (federation off) from a missing article and a forbidden one', () => {
    expect(classifyFailure(undefined, 404)).toBe('off');
    expect(classifyFailure({ code: 'article-not-found' }, 404)).toBe('hidden');
    expect(classifyFailure({ code: 'forbidden' }, 403)).toBe('hidden');
    expect(classifyFailure(undefined, 500)).toBe('error');
    expect(classifyFailure({ code: 'article-not-published' }, 409)).toBe('error');
  });
});

describe('Fediverse admin panel: translations', () => {
  /** The ICU argument names of a message: `{name}` and `{name, plural, …}`. */
  const argumentsOf = (message: string) =>
    [...message.matchAll(/\{(\w+)[,}]/g)].map((match) => match[1]).sort();

  it('has every string in English and Spanish, with the same arguments', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const [id, message] of Object.entries(en)) {
      expect(argumentsOf(es[id as keyof typeof es])).toEqual(argumentsOf(message));
    }
  });

  it('prefixes every id, so it cannot clash with the admin or another plugin', () => {
    for (const id of Object.keys(en)) expect(id.startsWith('fediverse.panel.')).toBe(true);
  });
});

describe('Fediverse admin panel: rate limiting', () => {
  it('counts the panel routes in the api group, not as an exempt admin prefix', () => {
    const route = classifyRequest('POST', '/fediverse-panel/articles/a1/federate');

    expect(route.kind).not.toBe('exempt');
    expect(route).toEqual(classifyRequest('POST', '/api/articles'));
  });
});
