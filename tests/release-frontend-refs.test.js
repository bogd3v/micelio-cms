import { describe, expect, it } from '@jest/globals';
import { frontendRefs } from '../scripts/release/frontend-refs.mjs';

describe('frontendRefs', () => {
  it('takes the latest release and the newest patch of the previous MINOR', () => {
    expect(frontendRefs(['v0.1.0', 'v0.2.0', 'v0.2.1', 'v0.3.0', 'v0.3.1'])).toEqual([
      { label: 'latest', ref: 'v0.3.1' },
      { label: 'previous', ref: 'v0.2.1' },
    ]);
  });

  it('skips a missing MINOR and compares numbers, not text', () => {
    expect(frontendRefs(['v0.2.0', 'v0.10.0', 'v0.9.3'])).toEqual([
      { label: 'latest', ref: 'v0.10.0' },
      { label: 'previous', ref: 'v0.9.3' },
    ]);
  });

  it('has no previous line on the first one', () => {
    expect(frontendRefs(['v0.1.0', 'v0.1.1'])).toEqual([{ label: 'latest', ref: 'v0.1.1' }]);
  });

  it('ignores snapshots, dated tags and release candidates', () => {
    expect(
      frontendRefs(['v2026.10.02', 'snapshot-2026-10-02', 'v0.2.0', 'v0.3.0-rc.1', 'v0.1.0'])
    ).toEqual([
      { label: 'latest', ref: 'v0.2.0' },
      { label: 'previous', ref: 'v0.1.0' },
    ]);
  });

  it('is empty without a release', () => {
    expect(frontendRefs(['v2026.10.02'])).toEqual([]);
  });
});
