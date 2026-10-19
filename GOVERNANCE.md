# Governance

How decisions are made in Micelio today. It is a small project with one maintainer, and this document says so instead of pretending otherwise. It changes as the project does.

## Who decides

Micelio has one maintainer, Alejandro Ramirez Garcia, who decides what is merged, released and recorded as a decision. Everyone else contributes through issues and pull requests, under the terms of [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

The maintainer is also the proxy of section 14 of the AGPL named in [LICENSE](LICENSE): a public statement of acceptance by the proxy authorizes a later version of the AGPL for Micelio, and nothing else. The reasons are in [ADR 0007](https://github.com/bogd3v/micelio/blob/main/docs/adr/0007-license.md).

## How a decision is proposed and recorded

1. **Propose it** as an issue from the proposal template. Bugs and proposals are how anyone reports; tasks and epics are the plan, written by maintainers and agents.
2. **Discuss it** in the issue. Questions that are not proposals belong in Discussions; an answer given twice becomes documentation.
3. **Decide it.** The maintainer accepts, declines or asks for changes, and says why in the issue.
4. **Record it** when it is expensive to undo (caching, authentication, data model, a public contract, licensing, security headers, deployment, versioning) as an ADR in [`docs/adr/`](https://github.com/bogd3v/micelio/blob/main/docs/adr/README.md). Records are never rewritten; a new one supersedes the old one. Nothing normative lives only in an issue or a chat.

While the version is `0.y.z`, contracts may break without an ADR, as [ADR 0010](https://github.com/bogd3v/micelio/blob/main/docs/adr/0010-semantic-versioning.md) explains. An expensive decision still gets one.

## How the standard changes

The [engineering standard](docs/engineering-standard.md) is changed by a `docs(standard)` pull request to its canonical copy in this repository, with the reason and a new version number, as its section 16 says. The other Micelio repositories then copy it in their own pull request. An exception for one repository is an ADR there, not an edit to the standard.

## Becoming a maintainer

There is no fixed list of requirements. The maintainer invites someone after a sustained record of contributions that were merged with little rework, reviews of other people's pull requests, and conduct that follows the Code of Conduct. The invitation is recorded in an ADR, which also says what the new maintainer may merge or decide. A maintainer who is no longer active is thanked and moved to emeritus the same way.

If the maintainer stops working on the project, the section 14 proxy and the trademark in [TRADEMARKS.md](TRADEMARKS.md) pass to whoever the maintainer assigns them to. That succession is itself recorded in an ADR.

## Conduct

Reports under the [Code of Conduct](CODE_OF_CONDUCT.md) are handled by the maintainer. Anyone who is the subject of a report is not involved in deciding it.
