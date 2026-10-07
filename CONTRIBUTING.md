# Contributing to Micelio CMS

Thanks for helping. Conventions, commands and project structure are in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md); the roadmap is the epic [bogd3v/micelio#240](https://github.com/bogd3v/micelio/issues/240).

## License of your contribution

Micelio CMS is licensed under the [GNU AGPL-3.0-only](LICENSE). By contributing you agree that your contribution is licensed under the same terms. You keep your copyright; there is no CLA. The reasons are in [ADR 0007](https://github.com/bogd3v/micelio/blob/main/docs/adr/0007-license.md) of the frontend.

Only contribute work you have the right to contribute. Third-party material (code, images, data) keeps its own license: add it only if that license allows it, keep its license file next to it, and list it in [THIRD-PARTY.md](THIRD-PARTY.md). New production dependencies must pass `npm run lint:licenses`, and Strapi Enterprise code must stay disabled (`npm run lint:ee`).

## Developer Certificate of Origin

Every commit must be signed off, certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "fix(comments): …"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line that must match the commit's author. The `DCO` check fails a pull request with a commit that lacks it; to fix the last commits, run `git rebase --signoff main` and force-push the branch.

## Pull requests

- Commits, PR titles and descriptions in English, with a conventional prefix (`feat`, `fix`, `docs`, `refactor`, `style`, `test`, `ci`, `perf`, `chore`).
- Run `npm run lint`, `npm run typecheck`, `npm run format:check` and `npm run test` before opening the PR.
