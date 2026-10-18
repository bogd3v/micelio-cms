import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { classifyLookup } from '../scripts/release/lookup.mjs';

describe('classifyLookup', () => {
  it.each([
    ['tag', 0, '', 'found'],
    ['image', 0, '', 'found'],
    ['tag', 1, 'gh: Not Found (HTTP 404)', 'missing'],
    ['tag', 1, 'gh: Bad credentials (HTTP 401)', 'error'],
    ['tag', 1, 'gh: API rate limit exceeded (HTTP 403)', 'error'],
    ['tag', 1, 'error connecting to api.github.com', 'error'],
    ['image', 1, 'ERROR: ghcr.io/example/cms:abc1234: not found', 'missing'],
    ['image', 1, 'ERROR: manifest unknown: manifest unknown', 'missing'],
    ['image', 1, 'ERROR: unauthorized: authentication required', 'error'],
    ['image', 1, 'ERROR: dial tcp: lookup ghcr.io: no such host', 'error'],
    ['image', null, 'spawn docker ENOENT', 'error'],
  ])('%s, status %s, %j is %s', (kind, status, stderr, state) => {
    expect(classifyLookup(kind, status, stderr)).toBe(state);
  });
});

describe('lookup.mjs', () => {
  const run = (...args) =>
    spawnSync('node', ['scripts/release/lookup.mjs', ...args], { encoding: 'utf8' });

  it('prints the output of a found lookup', () => {
    const result = run('image', '--', 'node', '-e', 'process.stdout.write("sha256:abc")');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('sha256:abc');
  });

  it('exits 1 for a missing tag', () => {
    const result = run(
      'tag',
      '--',
      'node',
      '-e',
      'console.error("gh: Not Found (HTTP 404)"); process.exit(1)'
    );
    expect(result.status).toBe(1);
  });

  it('exits 2 with the real error for any other failure', () => {
    const result = run(
      'tag',
      '--',
      'node',
      '-e',
      'console.error("gh: Bad credentials (HTTP 401)"); process.exit(1)'
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Bad credentials');
  });
});
