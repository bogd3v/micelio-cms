# Contributing to Micelio CMS

Thanks for helping. The terms of a contribution are Micelio's, shared by every repository, and live in
[`micelio-engineering`](https://github.com/bogd3v/micelio-engineering/blob/main/docs/contributing.md): the
license of your contribution (AGPL-3.0-only), the Developer
Certificate of Origin and the pull request template. Governance and the Micelio name and logo are in its
[governance.md](https://github.com/bogd3v/micelio-engineering/blob/main/docs/governance.md) and
[trademarks.md](https://github.com/bogd3v/micelio-engineering/blob/main/docs/trademarks.md). The rules for the
work are the [engineering standard](docs/engineering-standard.md).

## What is specific to this repository

- Commands, structure and conventions are in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md); the roadmap is the epic [bogd3v/micelio#240](https://github.com/bogd3v/micelio/issues/240).
- Run `npm run check` (typecheck, lint, format check and tests) before opening the pull request.
- Third-party material goes in [THIRD-PARTY.md](THIRD-PARTY.md) and [REUSE.toml](REUSE.toml); `reuse lint`
  checks it in CI.
- Strapi Enterprise code must stay disabled (`npm run lint:ee`).
- Decisions that are expensive to undo are ADRs; product decisions are recorded in
  [`micelio`](https://github.com/bogd3v/micelio/blob/main/docs/adr/README.md), written from the
  [template](https://github.com/bogd3v/micelio-engineering/blob/main/docs/adr-template.md).
- Report a vulnerability privately, as [SECURITY.md](SECURITY.md) explains.
