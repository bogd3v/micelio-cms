import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ADR 0010 section 3 (bogd3v/micelio): the Compose files for trying Micelio default to the `X.Y`
// of the release they ship with, never to `latest` or to a moving build of `main`. The release
// commit (`chore(release)`) moves `version` in `package.json`; this test then fails until the
// defaults follow it:
//   sed -i -E 's#(ghcr\.io/[^ "]*micelio[a-z-]*\}?):[0-9]+\.[0-9]+#\1:0.4#' <files below>
// (replace 0.4 with the new line). The frontend images must exist for that X.Y before the
// CMS line is released, or the trial files cannot pull them.

/** Micelio images each file names: a file that matches fewer fails, so the regex cannot go blind. */
const IMAGES_PER_FILE: Record<string, number> = {
  'compose.demo.yml': 3,
  'compose.static.yml': 2,
  'compose.landing.yml': 2,
  'docker-compose.yml': 1,
  'demo/static.env.example': 2,
  'demo/landing.env.example': 2,
};
const MICELIO_IMAGE = /ghcr\.io\/[^\s"']*?micelio[\w-]*\}?:([\w.-]+|\$\{[^}]+\})/g;

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');
const [, major, minor] = /^(\d+)\.(\d+)\.\d+/.exec(JSON.parse(read('package.json')).version) ?? [];
const releaseLine = `${major}.${minor}`;

describe('Default images of the demo and example files', () => {
  it('reads the release line from package.json', () => {
    expect(releaseLine).toMatch(/^\d+\.\d+$/);
  });

  it.each(Object.entries(IMAGES_PER_FILE))(
    '%s names its Micelio images only by the X.Y of package.json',
    (file, count) => {
      const tags = [...read(file).matchAll(MICELIO_IMAGE)].map((match) => match[1]);
      expect(tags).toHaveLength(count);
      for (const tag of tags) expect(tag).toBe(releaseLine);
    }
  );
});
