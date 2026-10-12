import { describe, expect, it } from '@jest/globals';
import { applyBump, bumpFor, lastStableTag, planRelease } from '../scripts/release/version.mjs';

describe('bumpFor', () => {
  it.each([
    [['fix: a', 'docs: b'], 'patch'],
    [['fix: a', 'feat(theme): b'], 'minor'],
    [['feat: a', 'fix(api)!: b', 'docs: c'], 'major'],
    [['feat!: a'], 'major'],
    [['Bump @strapi/strapi from 1 to 2'], 'patch'],
    [[], null],
  ])('%j asks for %s', (titles, bump) => {
    expect(bumpFor(titles)).toBe(bump);
  });
});

describe('applyBump', () => {
  it.each([
    ['0.1.0', 'patch', '0.1.1'],
    ['0.1.4', 'minor', '0.1.5'],
    ['0.1.4', 'major', '0.2.0'],
    ['1.2.3', 'patch', '1.2.4'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'major', '2.0.0'],
  ])('%s + %s = %s', (version, bump, next) => {
    expect(applyBump(version, bump)).toBe(next);
  });
});

describe('lastStableTag', () => {
  it('ignores dated snapshots, release candidates and other tags', () => {
    expect(
      lastStableTag([
        'v2026.10.02',
        'v0.2.0-rc.1',
        'snapshot-2026-10-02',
        'v0.1.0',
        'v0.10.0',
        'v0.9.0',
      ])
    ).toBe('v0.10.0');
  });

  it('is null without a release', () => {
    expect(lastStableTag(['v2026.10.02'])).toBeNull();
  });
});

describe('planRelease', () => {
  it('rejects a package version that is not X.Y.Z', () => {
    expect(() => planRelease({ packageVersion: '0.1.0\nx=1', tags: [], titles: [] })).toThrow(
      'is not X.Y.Z'
    );
  });

  it('releases the version of package.json when nothing was released yet', () => {
    expect(planRelease({ packageVersion: '0.1.0', tags: ['v2026.10.02'], titles: [] })).toEqual({
      previous: null,
      bump: null,
      version: '0.1.0',
      tag: 'v0.1.0',
      prerelease: false,
    });
  });

  it('raises the previous release by the highest bump', () => {
    const plan = planRelease({
      packageVersion: '0.1.0',
      tags: ['v0.1.0'],
      titles: ['feat: a', 'fix!: b'],
    });
    expect(plan).toMatchObject({
      previous: 'v0.1.0',
      bump: 'major',
      version: '0.2.0',
      tag: 'v0.2.0',
    });
  });

  it('fails when nothing was merged since the last release', () => {
    expect(() => planRelease({ packageVersion: '0.1.0', tags: ['v0.1.0'], titles: [] })).toThrow(
      'Nothing merged since v0.1.0'
    );
  });

  it('numbers release candidates of the next version', () => {
    const tags = ['v0.1.0', 'v0.1.1-rc.1', 'v0.1.1-rc.2', 'v0.2.0-rc.7'];
    const plan = planRelease({ packageVersion: '0.1.0', tags, titles: ['fix: a'], rc: true });
    expect(plan).toMatchObject({ version: '0.1.1-rc.3', tag: 'v0.1.1-rc.3', prerelease: true });
  });

  it('plans the first release candidate of the first release', () => {
    const plan = planRelease({ packageVersion: '0.1.0', tags: [], titles: [], rc: true });
    expect(plan.tag).toBe('v0.1.0-rc.1');
  });

  it('starts the first release candidate of a bumped version', () => {
    const plan = planRelease({
      packageVersion: '0.1.0',
      tags: ['v0.1.0'],
      titles: ['feat: a'],
      rc: true,
    });
    expect(plan.tag).toBe('v0.1.1-rc.1');
  });

  it('ignores dated snapshots for the first release', () => {
    const plan = planRelease({
      packageVersion: '0.1.0',
      tags: ['v2026.10.02', 'v2026.10.09'],
      titles: ['feat!: a'],
    });
    expect(plan).toMatchObject({ previous: null, tag: 'v0.1.0' });
  });
});
