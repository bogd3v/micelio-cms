// Runs one existence check of the Release workflow and tells "not found" apart from a failed
// check, so a network error, an expired token or a rate limit never reads as "free" (ADR 0010).
//
//   node scripts/release/lookup.mjs <tag|image> -- <command> [args...]
//
// Exit code: 0 = found (the command's stdout is printed), 1 = not found, 2 = the check itself
// failed (the command's error text goes to stderr).
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// `gh api` prints "gh: Not Found (HTTP 404)"; the registry says "manifest unknown" or "name unknown"
// and buildx adds "<ref>: not found".
const NOT_FOUND = {
  tag: /\(HTTP 404\)|\bHTTP 404\b/,
  image: /manifest unknown|name unknown|: not found\s*$/im,
};

/**
 * Classifies the result of an existence check.
 * @param {'tag' | 'image'} kind what was looked up
 * @param {number | null} status exit status of the command; `null` when it could not start
 * @param {string} stderr error text of the command
 * @returns {'found' | 'missing' | 'error'}
 */
export function classifyLookup(kind, status, stderr) {
  if (status === 0) return 'found';
  return NOT_FOUND[kind].test(stderr) ? 'missing' : 'error';
}

function main() {
  const [kind, separator, command, ...args] = process.argv.slice(2);
  if (!(kind in NOT_FOUND) || separator !== '--' || !command) {
    console.error('usage: lookup.mjs <tag|image> -- <command> [args...]');
    process.exit(2);
  }
  const result = spawnSync(command, args, { encoding: 'utf8' });
  const stderr = result.error ? String(result.error) : result.stderr;
  const state = classifyLookup(kind, result.status, stderr);
  if (state === 'found') process.stdout.write(result.stdout);
  if (state === 'error') console.error(stderr.trim() || `${command} exited with ${result.status}`);
  process.exit({ found: 0, missing: 1, error: 2 }[state]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
