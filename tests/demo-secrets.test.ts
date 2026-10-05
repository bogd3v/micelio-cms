import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// scripts/demo-secrets.js (#84): generates the demo stack's secrets once, and
// upgrades a volume from before the build token without touching its keys.

const SCRIPT = path.join(__dirname, '..', 'scripts', 'demo-secrets.js');
const FILES = ['cms.env', 'frontend.env', 'build.env', 'db_password'];

describe('demo-secrets script', () => {
  let dir: string;
  const run = () => execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
  const env = (name: string) =>
    Object.fromEntries(
      read(name)
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^([A-Z_]+)='(.*)'$/);
          if (!match) throw new Error(`unexpected line: ${line}`);
          return [match[1], match[2]];
        })
    ) as Record<string, string>;
  const snapshot = () =>
    Object.fromEntries(
      FILES.filter((name) => fs.existsSync(path.join(dir, name))).map((name) => [name, read(name)])
    );
  const expectConsistent = () => {
    const cms = env('cms.env');
    expect(env('frontend.env')).toEqual({ NUXT_STRAPI_API_TOKEN: cms.FRONTEND_API_TOKEN });
    expect(env('build.env')).toEqual({ NUXT_STRAPI_API_TOKEN: cms.BUILD_API_TOKEN });
    expect(read('db_password')).toBe(cms.DATABASE_PASSWORD);
    expect(cms.BUILD_API_TOKEN).not.toBe(cms.FRONTEND_API_TOKEN);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-secrets-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates the four files, readable by other users, with consistent values', () => {
    expect(run()).toContain('[demo-secrets] wrote');
    for (const name of FILES) {
      expect(fs.statSync(path.join(dir, name)).mode & 0o777).toBe(0o644);
    }
    const cms = env('cms.env');
    expect(Object.keys(cms)).toEqual(
      expect.arrayContaining(['APP_KEYS', 'FRONTEND_API_TOKEN', 'BUILD_API_TOKEN'])
    );
    expect(cms.BUILD_API_TOKEN.length).toBeGreaterThanOrEqual(32);
    expectConsistent();
  });

  it('changes nothing on a second run', () => {
    run();
    const before = snapshot();
    expect(run()).toContain('[demo-secrets] keeping the secrets');
    expect(snapshot()).toEqual(before);
  });

  it('adds the build token to a volume from before it, keeping every other line', () => {
    run();
    const old = read('cms.env')
      .split('\n')
      .filter((line) => line && !line.startsWith('BUILD_API_TOKEN'))
      .join('\n');
    fs.writeFileSync(path.join(dir, 'cms.env'), `${old}\n`);
    fs.rmSync(path.join(dir, 'build.env'));
    const before = snapshot();

    expect(run()).toContain('[demo-secrets] wrote');
    const after = snapshot();
    expect(after['cms.env'].startsWith(before['cms.env'])).toBe(true);
    expect(after['cms.env'].slice(before['cms.env'].length)).toMatch(
      /^BUILD_API_TOKEN='[0-9a-f]{128}'\n$/
    );
    for (const name of ['frontend.env', 'db_password']) expect(after[name]).toBe(before[name]);
    expectConsistent();
  });

  it('appends on its own line when the old cms.env has no trailing newline', () => {
    run();
    const old = read('cms.env')
      .split('\n')
      .filter((line) => line && !line.startsWith('BUILD_API_TOKEN'))
      .join('\n');
    fs.writeFileSync(path.join(dir, 'cms.env'), old);
    fs.rmSync(path.join(dir, 'build.env'));
    run();
    expect(env('cms.env').FRONTEND_API_TOKEN).toBeDefined();
    expectConsistent();
  });

  it('reuses the build token already in cms.env when build.env is missing', () => {
    run();
    const token = env('cms.env').BUILD_API_TOKEN;
    const cmsBefore = read('cms.env');
    fs.rmSync(path.join(dir, 'build.env'));
    run();
    expect(read('cms.env')).toBe(cmsBefore);
    expect(env('build.env').NUXT_STRAPI_API_TOKEN).toBe(token);
  });

  it('regenerates every derived file when cms.env is missing', () => {
    run();
    const before = snapshot();
    fs.rmSync(path.join(dir, 'cms.env'));
    run();
    expectConsistent();
    expect(read('db_password')).not.toBe(before['db_password']);
    expect(read('frontend.env')).not.toBe(before['frontend.env']);
    expect(read('build.env')).not.toBe(before['build.env']);
  });
});
