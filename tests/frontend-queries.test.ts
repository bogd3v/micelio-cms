import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import * as copied from './helpers/frontend-queries';

// The response field suites call the CMS with the populates of the frontend,
// copied into `tests/helpers/frontend-queries.ts`. When a micelio checkout sits
// next to this repository, this compares each copy with the constant it came from.
//
// It compares the populate constants only, evaluated from the text of micelio's
// files. It does not compare the queries that micelio writes inline in a route
// (`fields` of the reading path, the sitemap, the feed, the static slugs, the
// categories and tags lists, the search), which are copied into the suites, and
// it does not know whether micelio added a call that this repository never sees.

const MICELIO = path.join(process.cwd(), '..', 'micelio');
const describeWithMicelio = fs.existsSync(path.join(MICELIO, 'server', 'lib'))
  ? describe
  : describe.skip;

/** The constant `name` of a micelio file, evaluated; `scope` gives the names the literal refers to. */
function constantOf(file: string, name: string, scope: Record<string, unknown> = {}): unknown {
  const text = fs.readFileSync(path.join(MICELIO, file), 'utf8');
  const start = text.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`${file} has no const ${name}`);
  const open = text.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < text.length; end += 1) {
    if (text[end] === '{') depth += 1;
    if (text[end] === '}' && --depth === 0) break;
  }
  const names = Object.keys(scope);
  // The text is a constant of a sibling repository this project trusts, and holds no code but a literal.
  return new Function(...names, `return ${text.slice(open, end + 1)}`)(...Object.values(scope));
}

describeWithMicelio('tests/helpers/frontend-queries.ts against the micelio checkout', () => {
  it.each([
    ['POST_CARD_POPULATE', 'server/lib/constants.ts', copied.POST_CARD_POPULATE],
    ['ARTICLE_POPULATE', 'server/lib/constants.ts', copied.ARTICLE_POPULATE],
  ])('%s is the constant of micelio', (name, file, copy) => {
    // Read inside the test: the body of a skipped `describe` still runs, and the files may not exist.
    const image = constantOf('server/lib/constants.ts', 'IMAGE');
    expect(copy).toEqual(constantOf(file, name, { IMAGE: image }));
  });
});
