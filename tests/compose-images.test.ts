import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ADR 0010 (bogd3v/micelio): a trial instance follows the newest stable release, not `main`
// (`edge`) and not one fixed version. The released images are pinned by the operator.

const FILES = [
  'compose.demo.yml',
  'compose.static.yml',
  'compose.landing.yml',
  'docker-compose.yml',
  'demo/static.env.example',
  'demo/landing.env.example',
];
const MICELIO_IMAGE = /ghcr\.io\/[^\s"'}]*micelio[^\s"'}]*:([\w.-]+|\$\{[^}]+\})/g;

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

describe('Default images of the demo and example files', () => {
  it.each(FILES)('%s names a Micelio image only by the tag latest', (file) => {
    const tags = [...read(file).matchAll(MICELIO_IMAGE)].map((match) => match[1]);
    for (const tag of tags) expect(tag).toBe('latest');
  });

  it('finds the images the compose files default to', () => {
    const tags = FILES.flatMap((file) => [...read(file).matchAll(MICELIO_IMAGE)]);
    expect(tags.length).toBeGreaterThanOrEqual(8);
  });
});
