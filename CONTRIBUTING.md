# Contributing to Micelio CMS

Thanks for helping. Conventions, commands and project structure are in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md); the rules every Micelio repository shares are in the [engineering standard](docs/engineering-standard.md); the roadmap is the epic [bogd3v/micelio#240](https://github.com/bogd3v/micelio/issues/240).

## License of your contribution

Micelio CMS is licensed under the [GNU AGPL-3.0-only](LICENSE). By contributing you license your contribution under the same terms, and also:

- under any **additional permission** under section 7 of the AGPL that Micelio's maintainer (the section 14 proxy named in [LICENSE](LICENSE)) publishes later for Micelio, as the frontend does for themes. Such a permission can only give everyone more rights over Micelio, never restrict them, and Micelio itself stays under the AGPL;
- under any later version of the GNU AGPL that the same proxy accepts for Micelio (section 14). This covers later versions of the AGPL only, never another license.

You keep your copyright; there is no CLA. The reasons are in [ADR 0007](https://github.com/bogd3v/micelio/blob/main/docs/adr/0007-license.md) of the frontend.

Only contribute work you have the right to contribute. Third-party material (code, images, data) keeps its own license: add it only if that license allows it, keep its license file next to it, list it in [THIRD-PARTY.md](THIRD-PARTY.md) and annotate its path in [REUSE.toml](REUSE.toml) (`reuse lint` checks it in CI). New production dependencies must pass `npm run lint:licenses`, and Strapi Enterprise code must stay disabled (`npm run lint:ee`).

## Developer Certificate of Origin

Every commit must be signed off, certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```bash
git commit -s -m "fix(comments): …"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line that must match the commit's author. The `DCO` check fails a pull request with a commit that lacks it; to fix the last commits, run `git rebase --signoff main` and force-push the branch.

## Pull requests

- Commits, PR titles and descriptions in English, with a conventional prefix (`feat`, `fix`, `docs`, `refactor`, `style`, `test`, `ci`, `perf`, `chore`).
- Run `npm run lint`, `npm run typecheck`, `npm run format:check` and `npm run test` before opening the PR.
