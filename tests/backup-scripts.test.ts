import { describe, it, expect } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// The backup scripts carry no site: BACKUP_DIR and COMPOSE_PROJECT are
// required (standard section 5, principle 2).

const SCRIPTS = join(__dirname, '..', 'scripts');

function run(script: string, args: string[], env: Record<string, string>) {
  return spawnSync('sh', [join(SCRIPTS, script), ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });
}

describe('backup scripts', () => {
  it.each([
    ['backup-volumes.sh', []],
    ['restore-volumes.sh', ['latest']],
  ])('%s stops and names BACKUP_DIR when it is missing', (script, args) => {
    const result = run(script, args, { COMPOSE_PROJECT: 'example' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('BACKUP_DIR is required');
  });

  it.each([
    ['backup-volumes.sh', []],
    ['restore-volumes.sh', ['latest']],
  ])('%s stops and names COMPOSE_PROJECT when it is missing', (script, args) => {
    const result = run(script, args, { BACKUP_DIR: '/nonexistent/example' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('COMPOSE_PROJECT is required');
  });

  it('restore-volumes.sh prints its usage without arguments', () => {
    const result = run('restore-volumes.sh', [], {});
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('Usage:');
  });
});
