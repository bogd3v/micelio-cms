// Picks the frontend releases the contract suite runs against: the latest release and the newest
// release of the previous MINOR, because a CMS release line also serves the frontend of the
// previous MINOR (standard, section 7). Prints the JSON matrix `contract.yml` reads.
//
//   gh api --paginate repos/bogd3v/micelio/git/matching-refs/tags/v -q '.[].ref | ltrimstr("refs/tags/")' \
//     | node scripts/release/frontend-refs.mjs
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { lastStableTag } from './version.mjs';

/**
 * The frontend refs to test, newest first.
 * @param {string[]} tags every tag of the frontend repository
 * @returns {{ label: string, ref: string }[]} the latest release, then the newest patch of the previous MINOR; empty without a release
 */
export function frontendRefs(tags) {
  const latest = lastStableTag(tags);
  if (!latest) return [];
  const line = latest.slice(0, latest.lastIndexOf('.') + 1);
  const previous = lastStableTag(tags.filter((tag) => !tag.startsWith(line)));
  return [
    { label: 'latest', ref: latest },
    ...(previous ? [{ label: 'previous', ref: previous }] : []),
  ];
}

function main() {
  const tags = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const include = frontendRefs(tags);
  if (include.length === 0) {
    console.error('The frontend has no stable release to test against.');
    process.exit(1);
  }
  console.log(JSON.stringify({ include }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
