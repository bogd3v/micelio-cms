import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findMisplaced } from '../scripts/check-placement.mjs';

const roots = [];

/** Builds a throwaway `src/` tree from a `{ path: content }` map and returns its root. */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'placement-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const importing = (name, from) =>
  `import type { ${name} } from '${from}';\nexport const use = 1;\n`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('placement check', () => {
  it('flags a type imported by two files from a file that is not a shared place', () => {
    const root = project({
      'src/feature/shape.ts': 'export interface Shape { sides: number }\n',
      'src/feature/a.ts': importing('Shape', './shape'),
      'src/feature/b.ts': importing('Shape', './shape'),
    });
    expect(findMisplaced(root)).toEqual([
      { file: 'src/feature/shape.ts', line: 1, name: 'Shape', importers: 2 },
    ]);
  });

  it('flags a constant but not a function', () => {
    const root = project({
      'src/feature/limits.ts':
        'export const MAX = 5;\nexport const double = (n: number) => n * 2;\nexport function triple(n: number) { return n * 3 }\n',
      'src/feature/a.ts':
        "import { MAX, double, triple } from './limits';\nexport const a = [MAX, double, triple];\n",
      'src/feature/b.ts':
        "import { MAX, double, triple } from './limits';\nexport const b = [MAX, double, triple];\n",
    });
    expect(findMisplaced(root).map((m) => m.name)).toEqual(['MAX']);
  });

  it('accepts one importer', () => {
    const root = project({
      'src/feature/shape.ts': 'export interface Shape { sides: number }\n',
      'src/feature/a.ts': importing('Shape', './shape'),
    });
    expect(findMisplaced(root)).toEqual([]);
  });

  it.each([
    ['src/types/shape.ts', '../types/shape'],
    ['src/constants/shape.ts', '../constants/shape'],
    ['src/feature/types.ts', './types'],
    ['src/feature/constants.ts', './constants'],
  ])('accepts a declaration in %s', (path, specifier) => {
    const root = project({
      [path]: 'export interface Shape { sides: number }\n',
      'src/feature/a.ts': importing('Shape', specifier),
      'src/feature/b.ts': importing('Shape', specifier),
    });
    expect(findMisplaced(root)).toEqual([]);
  });

  it('flags the same layout when the declaration is in an ordinary file', () => {
    const root = project({
      'src/feature/shape.ts': 'export interface Shape { sides: number }\n',
      'src/feature/a.ts': importing('Shape', './shape'),
      'src/feature/b.ts': importing('Shape', './shape'),
    });
    expect(findMisplaced(root).map((m) => m.name)).toEqual(['Shape']);
  });

  it('follows an aliased import, a folder index and a .js suffix', () => {
    const root = project({
      'src/lib/index.ts': 'export interface Shape { sides: number }\n',
      'src/feature/a.ts': "import type { Shape as A } from '../lib';\nexport type X = A;\n",
      'src/feature/b.ts': "import type { Shape } from '../lib/index.js';\nexport type Y = Shape;\n",
    });
    expect(findMisplaced(root).map((m) => m.name)).toEqual(['Shape']);
  });

  it('sees declarations exported through a local export list', () => {
    const root = project({
      'src/feature/shape.ts':
        'interface Shape { sides: number }\nconst MAX = 1;\nexport type { Shape };\nexport { MAX };\n',
      'src/feature/a.ts':
        "import { MAX, type Shape } from './shape';\nexport const a: Shape | number = MAX;\n",
      'src/feature/b.ts':
        "import { MAX, type Shape } from './shape';\nexport const b: Shape | number = MAX;\n",
    });
    expect(findMisplaced(root).map((m) => m.name)).toEqual(['Shape', 'MAX']);
  });

  it('skips migrations and the fediverse plugin, as importers and as declarers', () => {
    const root = project({
      'src/migrations/m.ts': 'export const TABLE = "t";\n',
      'src/migrations/a.ts': "import { TABLE } from './m';\nexport const a = TABLE;\n",
      'src/migrations/b.ts': "import { TABLE } from './m';\nexport const b = TABLE;\n",
      'src/plugins/fediverse/server/src/x.ts': 'export type X = string;\n',
      'src/plugins/fediverse/server/src/a.ts': importing('X', './x'),
      'src/plugins/fediverse/server/src/b.ts': importing('X', './x'),
      'src/feature/s.ts': 'export type S = string;\n',
      'src/feature/a.ts': importing('S', './s'),
      'src/migrations/c.ts': importing('S', '../feature/s'),
    });
    expect(findMisplaced(root)).toEqual([]);
  });

  it('counts a re-export as an import', () => {
    const root = project({
      'src/feature/shape.ts': 'export interface Shape { sides: number }\n',
      'src/feature/a.ts': importing('Shape', './shape'),
      'src/feature/index.ts': "export type { Shape } from './shape';\n",
    });
    expect(findMisplaced(root).map((m) => m.name)).toEqual(['Shape']);
  });

  it('ignores packages and files outside src/', () => {
    const root = project({
      'src/feature/a.ts': "import type { Context } from 'koa';\nexport const a = 1;\n",
      'tests/shape.ts': 'export interface Shape { sides: number }\n',
    });
    expect(findMisplaced(root)).toEqual([]);
  });
});
