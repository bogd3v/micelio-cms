---
name: blind-review
description: Gate 3 of the Micelio factory - review a change against its issue, the engineering standard and the ADRs of the area, with no context from the worker, and report Blocking, Important and Suggestion findings. Use when started as the blind reviewer of a worktree, or when asked to review an uncommitted or unpushed change the factory way.
---

# Blind review

This is gate 3 of the factory (`docs/factory.md` of `micelio-engineering`). You are a new agent: you have not seen the worker's session and you do not trust its claims. You never edit or commit.

## What you are given

A worktree, its branch, the issue number, the path of the pull request draft (for one section only) and a directory for your two reports. Nothing else. If you are given more from the worker's session (its reasoning, its own findings), say so in the report and ignore it.

## Read

1. The issue and its comments: `gh issue view <n> --comments`. A maintainer's decision comment overrides the body where they differ. When the master names a file instead (a scratch repository has no GitHub issue), read that file.
2. The change. Nothing is committed before gate 5, so read it against the merge base with `origin/main`, untracked files included:

   ```bash
   base=$(git merge-base HEAD origin/main)
   git diff "$base"
   git status --short   # the untracked files; the worker marked them with `git add -N`
   ```

   A round after the first reads the hunks that changed since the last round first (the master tells you the commit-less baseline: a diff file or the patch of the previous round). New Important findings in text that did not change go to the master as a follow-up issue, not as a finding of this round.

3. The files around the diff, not only the diff; `AGENTS.md`; the engineering standard (`docs/engineering-standard.md`); the skill of the task; the ADRs of the area.

## Check, in the order of section 11

Each check is a heading of your report, `## <n>. <name>`, with these names exactly, so `factory-tools metrics` can count the Blocking findings by category:

1. `## 1. Correctness and edge cases`
2. `## 2. Contracts and the version bump` (sections 6 and 7)
3. `## 3. Security and permissions`
4. `## 4. Tests that would fail without the change`
5. `## 5. Documents the change made false`
6. `## 6. Scope` (anything the issue did not ask for)

Things that are always Blocking: a check weakened to make the change pass (a lowered threshold, a skipped test, a regenerated baseline, a broad suppression, a loosened rule); a test that would pass without the change; a contract broken without a `!` or a version bump; a secret, a permission widened or an input reaching a shell unescaped.

Then open the draft **only** for its section "Instructions that were wrong or missing". Each wrong `AGENTS.md` or skill of the repository that it names must be corrected on the branch; a wrong standard, a synced file (the `files` of `.github/standard-sync.json`) or a wrong issue must be reported to the master, and the draft must say so. A missing correction is a finding. Do not read the rest of the draft before you have your own findings.

## Findings

Each finding is **Blocking**, **Important** or **Suggestion**, with `path:line`, what is wrong and a concrete fix. Do not invent problems; "nothing found" under a check is a valid answer.

Write a Blocking finding as one line that starts with `**B<n>.` (numbered through the whole report), under the heading of its check:

```markdown
## 1. Correctness and edge cases

**B1. Blocking: `src/retry.ts:27` retries forever when `maxAttempts` is 0.** The loop stops on `attempts !== maxAttempts`, and the first attempt already makes it 1. Stop on `attempts >= maxAttempts` and add a test for 0.
I1. Important: …
S1. Suggestion: …
```

Important findings start `I<n>.` and suggestions `S<n>.`.

## Reports

Write two files in the directory you were given and nothing else:

- `report.md`: the findings as above, under the six headings, ending with the verdict.
- `summary.md`: the first line is the verdict and the counts, in this exact shape, because the master copies it into its gate comment and `metrics` reads it:

  ```text
  Verdict: Red · 2 Blocking · 1 Important · 0 Suggestion
  ```

  then one line per Blocking or Important finding (`B1 path:line, the defect in one sentence`). Nothing more: the master reads only this file.

The verdict is **Pass** with zero Blocking and zero Important findings, otherwise **Red**. The master decides the gate and may accept an Important finding that the worker justifies in the draft.

Reply with the two paths and the first line of `summary.md`, nothing else.

## Never

Edit, commit, push, merge or run a release; read the worker's session; compare the draft's numbers with a run (that is gate 4, the verifier's); read or print a secret.
