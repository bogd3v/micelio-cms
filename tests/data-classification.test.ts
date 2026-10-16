import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { setupStrapi, cleanupStrapi } from './strapi';
import { listedKeys } from './helpers/response-fields';
import {
  DATA_CLASSIFICATION,
  STRAPI_SYSTEM_ATTRIBUTES,
} from '../src/constants/data-classification';

// ASVS V14.2.4: the classification of `docs/security/data.md` is checked
// against the schemas Strapi loads, not against what someone remembers.

/** Routes that may list the token of a subscriber: the API token holder reads them. */
const TOKEN_ROUTES = ['subscribers.'];
const DATA_DOC = path.join(__dirname, '..', 'docs', 'security', 'data.md');

describe('Data classification (docs/security/data.md)', () => {
  const saved = { ...process.env };

  /** `[uid, attribute, level]` of every classified attribute. */
  const classified = Object.entries(DATA_CLASSIFICATION).flatMap(([uid, levels]) =>
    Object.entries(levels).map(([name, level]) => ({ uid, name, level }))
  );

  beforeAll(async () => {
    // The fediverse types exist only when the plugin is enabled at boot.
    process.env.FEDIVERSE_ENABLED = 'true';
    process.env.FEDIVERSE_ACTOR_IDENTIFIER = 'site';
    process.env.FEDIVERSE_ACTOR_USERNAME = 'site';
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
    process.env = { ...saved };
  });

  const attributesOf = (uid: string): Record<string, { private?: boolean }> => {
    const contentType = strapi.contentTypes[uid as keyof typeof strapi.contentTypes];
    if (!contentType) throw new Error(`${uid} is classified but Strapi has no such content type`);
    return contentType.attributes as Record<string, { private?: boolean }>;
  };

  it('gives every attribute of every classified content type a level', () => {
    const unclassified: string[] = [];
    const stale: string[] = [];
    for (const [uid, levels] of Object.entries(DATA_CLASSIFICATION)) {
      const attributes = Object.keys(attributesOf(uid));
      for (const name of attributes) {
        if (!STRAPI_SYSTEM_ATTRIBUTES.includes(name) && !(name in levels)) {
          unclassified.push(`${uid}.${name}`);
        }
      }
      for (const name of Object.keys(levels)) {
        if (!attributes.includes(name)) stale.push(`${uid}.${name}`);
      }
    }
    expect(unclassified).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('keeps every restricted attribute private or on a type no role may read, and out of the responses', async () => {
    const restricted = classified.filter((entry) => entry.level === 'restricted');
    expect(restricted.length).toBeGreaterThan(0);

    const exposed: string[] = [];
    const tokenOnlyNames = new Set<string>();
    for (const { uid, name } of restricted) {
      if (attributesOf(uid)[name]?.private) continue;
      const granted = await strapi.db
        .query('plugin::users-permissions.permission')
        .count({ where: { action: { $startsWith: `${uid}.` } } });
      if (granted > 0)
        exposed.push(`${uid}.${name}: not private and a role has ${granted} permission(s)`);
      else tokenOnlyNames.add(name);
    }
    expect(exposed).toEqual([]);

    // The response constants list a restricted name only where a token holder reads it.
    const leaked = listedKeys().filter(
      (entry) =>
        restricted.some((r) => r.name === entry.key) &&
        !(tokenOnlyNames.has(entry.key) && TOKEN_ROUTES.some((p) => entry.id.startsWith(p)))
    );
    expect(leaked.map((entry) => `${entry.where}.${entry.key}`)).toEqual([]);
  });

  it('names every restricted and personal attribute in the data.md row of its own type', () => {
    const doc = fs.readFileSync(DATA_DOC, 'utf8');
    // Attributes written in the "Where" cell of each row, bound to the UID before them.
    const documented = new Map<string, Set<string>>();
    for (const line of doc.split('\n')) {
      const cells = line.split(/(?<!\\)\|/);
      if (!line.startsWith('|') || cells.length < 5) continue;
      let current: string | null = null;
      for (const [, span] of cells[3].matchAll(/`([^`]+)`/g)) {
        if (span.includes('::')) {
          current = span;
          if (!documented.has(current)) documented.set(current, new Set());
        } else if (current) {
          documented.get(current)?.add(span);
        }
      }
    }
    const missing = classified
      .filter((entry) => entry.level !== 'public' && !documented.get(entry.uid)?.has(entry.name))
      .map((entry) => `${entry.uid}.${entry.name}`);
    expect(missing).toEqual([]);
  });
});
