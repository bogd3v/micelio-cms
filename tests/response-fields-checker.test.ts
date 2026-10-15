import { describe, it, expect } from '@jest/globals';
import type { ResponseRoute, Shape } from '../src/constants/response-fields';
import { assertShape, checkBodies, routeById } from './helpers/response-fields';

// The checker behind the response field suites. No Strapi: these run in
// milliseconds and prove that a field added to a response, or a required one
// dropped, fails the suites. The rules the constants keep are in
// response-fields-rules.test.ts.

const tree: ResponseRoute = {
  id: 'test.tree',
  auth: 'none',
  method: 'GET',
  path: '/test',
  callers: ['public'],
  reader: 'test',
  note: '',
  kind: 'list',
  body: {
    id: 'required',
    title: 'required',
    extra: 'surplus',
    author: { use: 'required', of: { name: 'required' } },
    children: { use: 'required', of: 'self' },
    blocks: {
      use: 'required',
      variants: { 'a.text': { id: 'required', __component: 'required', body: 'required' } },
    },
  },
};

/** A copy of `value` without `key`, as a response that does not carry it. */
const without = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

const node = {
  id: 1,
  title: 'T',
  extra: 'x',
  author: { name: 'N' },
  children: [{ id: 2, title: 'U', author: { name: 'M' }, children: [], blocks: [] }],
  blocks: [{ id: 3, __component: 'a.text', body: 'B' }],
};

describe('checkBodies', () => {
  it('accepts a body that has exactly the listed keys', () => {
    expect(checkBodies(tree, [[node]])).toEqual({ extra: [], missing: [], unseen: [] });
  });

  it.each([
    ['a key of the body', { ...node, plainText: 'x' }, 'plainText'],
    [
      'a key of a nested object',
      { ...node, author: { name: 'N', email: 'a@example.test' } },
      'author.email',
    ],
    [
      'a key of a variant',
      { ...node, blocks: [{ id: 3, __component: 'a.text', body: 'B', html: 'x' }] },
      'blocks[a.text].html',
    ],
    [
      'a key deep in the children',
      { ...node, children: [{ ...node, children: [{ ...node, secret: 1 }] }] },
      'children.children.secret',
    ],
    [
      'an unknown component',
      { ...node, blocks: [{ id: 3, __component: 'a.other' }] },
      'blocks[a.other]',
    ],
  ])('reports %s that is not listed', (_name, body, field) => {
    expect(checkBodies(tree, [[body]]).extra).toContain(field);
    expect(() => assertShape(tree, 'public', [[body]])).toThrow(
      `"${field}" is returned but is not listed`
    );
  });

  it('reports a required key that no body carries', () => {
    const withoutTitle = without(node, 'title');
    expect(checkBodies(tree, [[withoutTitle]]).missing).toContain('title');
    expect(() => assertShape(tree, 'public', [[withoutTitle]])).toThrow(
      'required "title" is not returned'
    );
  });

  it('takes a required key from any of the bodies', () => {
    const withoutTitle = without(node, 'title');
    expect(checkBodies(tree, [[withoutTitle], [node]]).missing).toEqual([]);
  });

  it('reports a listed object that no body returns', () => {
    expect(checkBodies(tree, [[{ ...node, blocks: [] }]]).unseen).toContain('blocks[a.text]');
  });

  it('reads a map body by its values', () => {
    const map: ResponseRoute = { ...tree, kind: 'map', body: { likes: 'required' } };
    expect(checkBodies(map, [{ a: { likes: 1 }, b: { likes: 2 } }])).toEqual({
      extra: [],
      missing: [],
      unseen: [],
    });
    expect(checkBodies(map, [{ a: { likes: 1, who: 'x' } }]).extra).toEqual(['who']);
  });

  it('does not read inside a field that holds a JSON value', () => {
    const json: ResponseRoute = { ...tree, kind: 'object', body: { structuredData: 'required' } };
    expect(checkBodies(json, [{ structuredData: { anything: { goes: true } } }]).extra).toEqual([]);
  });
});

describe('the constants against a response that grows', () => {
  const ranking = routeById('fediverse.ranking');
  const body = {
    data: [{ documentId: 'a', likes: 1, boosts: 2, replies: 3 }],
    meta: { pagination: { page: 1, pageSize: 6, pageCount: 1, total: 1 } },
  };

  it('fails when a field that identifies an actor appears next to the counters', () => {
    const grown = { ...body, data: [{ ...body.data[0], actorId: 'https://remote.example/ana' }] };
    expect(checkBodies(ranking, [body]).extra).toEqual([]);
    expect(checkBodies(ranking, [grown]).extra).toEqual(['data.actorId']);
  });

  it('fails when a key is removed from a copy of the listed set', () => {
    const data = ranking.body.data;
    if (typeof data === 'string' || data.of === undefined || typeof data.of === 'string') {
      throw new Error('fediverse.ranking has an inline shape');
    }
    const withoutLikes = without(data.of, 'likes') as Shape;
    const narrowed: ResponseRoute = {
      ...ranking,
      body: { ...ranking.body, data: { use: 'required', of: withoutLikes } },
    };
    expect(() => assertShape(narrowed, 'public', [body])).toThrow(
      '"data.likes" is returned but is not listed'
    );
  });

  it('names the command that regenerates the document', () => {
    expect(() => assertShape(ranking, 'public', [{ data: [{ x: 1 }] }])).toThrow(
      'UPDATE_RESPONSE_FIELDS_DOC=1 npx jest tests/response-fields-docs.test.ts'
    );
  });
});
