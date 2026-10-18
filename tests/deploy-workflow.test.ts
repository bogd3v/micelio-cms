import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Bogd3v/micelio-cms#267: a release copies the manifest of the image built for its commit, so
// the version label has to be right at build time, not `edge`.

const deploy = readFileSync(join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');

describe('deploy.yml image labels', () => {
  it('sets the OCI version label from package.json, not from the tags', () => {
    expect(deploy).toMatch(/require\('\.\/package\.json'\)\.version/);
    expect(deploy).toMatch(
      /labels: \|\s*\n\s*org\.opencontainers\.image\.version=\$\{\{ steps\.package\.outputs\.version \}\}/
    );
  });

  it('reads the version before the metadata step uses it', () => {
    expect(deploy.indexOf('id: package')).toBeGreaterThan(-1);
    expect(deploy.indexOf('id: package')).toBeLessThan(deploy.indexOf('id: meta'));
  });
});
