<!-- Title: conventional prefix and optional scope, in English. Example: fix(check): fail when the lockfile is missing -->

## Problem

<!-- What is wrong or missing, with evidence: an error, a measurement, an issue. -->

Refs #

## What changes

-

## For review

<!-- Risks, behaviour changes, contract changes (docs/engineering-standard.md, section 6), published package versions, manual steps after merging. Write "None" when there are none. -->

## Tests

<!-- For each command: the command, its real output with the numbers, and the Docker (or the run AGENTS.md names instead) it ran on. Say what was not verified. -->

```
npm run check
```

Docker used:

## Instructions that were wrong or missing

<!-- What in AGENTS.md, a skill or the issue failed you, and the commit that fixed it. A wrong `AGENTS.md` or a skill of this repository is fixed on this branch; a wrong standard, a synced file (the `files` of `.github/standard-sync.json`) or a wrong issue is reported to the master, say so here (in `micelio-engineering`, fix a synced file under `template/`). "Nothing" is a valid answer; an absent section is not. -->

## Checklist

- [ ] One concern, and the commits are signed off (`git commit -s`)
- [ ] New behaviour has tests
- [ ] New and changed exports have their TSDoc comment
- [ ] The documents this change made false are updated (`docs/`, README, `AGENTS.md`)
- [ ] A contract change follows sections 6 and 7 of the standard (`!` in the title, a `BREAKING CHANGE:` paragraph above), and an expensive decision has an ADR
- [ ] A change to the standard raises its version and adds a line to the table of section 16
- [ ] The issue's Progress section is updated
