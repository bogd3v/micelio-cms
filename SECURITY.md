# Security Policy

This repository is the Strapi 5 backend of Micelio. Anyone can run it, so this policy covers the code and configuration published here, not any particular deployment.

## Supported versions

Only the latest release line receives security fixes. Until a release exists, that is `main`. Older releases, other branches and older commits don't. If you run an older version, upgrade before reporting.

## Reporting a vulnerability

Report it privately through **GitHub → Security → [Report a vulnerability](https://github.com/bogd3v/micelio-cms/security/advisories/new)**. Don't open a public issue, pull request or discussion.

Please include the affected endpoint or file, steps to reproduce, the impact you expect, and whether you need an account or token (public, reader, editor, admin).

| Step                             | Target               |
| -------------------------------- | -------------------- |
| Acknowledge the report           | 3 days               |
| Triage and severity              | 7 days               |
| Fix for critical / high severity | 14 days after triage |
| Fix for medium / low severity    | next planned release |

## What to expect

- **Acknowledgement** within 3 days of the report, in the advisory thread.
- **First assessment** within 7 days: whether we can reproduce it, the severity and the plan. If we decide it is not a vulnerability, we say why.
- **Updates** in the same thread at least every 14 days until the report is closed.
- **Disclosure**: the fix is prepared in a private fork of the advisory and released first. The advisory is then published with the affected and fixed versions, and the release notes point to it under "Security". Details stay private until a fix is available, or until 90 days after the report if none can be made, whichever comes first.
- **Credit**: you are named in the advisory unless you prefer otherwise. Tell us in the report how you want to appear.
- **Accepted risks**: a known weakness we cannot fix yet is written down with the reason in [`docs/DEPENDENCY_RISKS.md`](docs/DEPENDENCY_RISKS.md).

## Scope

In scope: code and configuration in this repository, including:

- Custom API routes, controllers and services (`src/api`), such as search, popular articles and the drafts list
- Access control: drafts restricted to editors, site settings and subscribers readable only with the frontend's API token ([`docs/API_TOKENS.md`](docs/API_TOKENS.md)), `DELETE /api/users/me`, the Editor role, comment visibility middlewares
- The `fediverse` plugin (ActivityPub inbox, HTTP signatures, federated replies)
- Configuration (`config/`), the Docker image and the CI/CD workflows

Report these upstream instead:

- Strapi core, admin panel and official plugins: [Strapi security policy](https://github.com/strapi/strapi/security/policy)
- `strapi-plugin-comments`, `@notum-cz/strapi-plugin-seo`, Fedify and other dependencies: their own repositories

If you are unsure whether the issue lives in our code or upstream, report it here and we'll forward it.

Out of scope: volumetric denial of service, social engineering, reports from automated scanners without a demonstrated impact, missing headers with no exploit, self-XSS, and anything that requires an admin account unless it escalates privileges.

## Testing rules

- Test against your own instance (`npm run develop`, see `README.md`), never against a site you do not run.
- Don't run automated scanners or load tests against anyone else's instance.
- Don't access, change or delete data that isn't yours. If you reach real user data, stop and report.

Good-faith research that follows these rules won't be pursued.

## How security is verified

Security review follows the OWASP Application Security Verification Standard, version 5.0.0. [`docs/security/asvs.md`](docs/security/asvs.md) maps every level 1 and level 2 requirement to where it is enforced, what Strapi guarantees upstream, or why it does not apply. An open requirement that is not exploitable is tracked in an issue with the `security` label; one that is exploitable is tracked only in a private security advisory, so the mapping says "Private advisory" and nothing more.

## The frontend's API token

How the frontend reads content with a custom API token, and the permissions that token carries, is documented in [`docs/API_TOKENS.md`](docs/API_TOKENS.md). Give each token only the permissions it needs, and rotate it if it leaks.

## How dependencies are handled

- Dependabot opens grouped minor and patch updates weekly. Major versions (Strapi, Node, nodemailer, etc.) are upgraded by hand after testing.
- Dependabot security alerts and `npm audit` findings are triaged as they arrive. Patches within the same major go in through `overrides` in `package.json` when the parent package pins an older version.
- CI fails on a critical `npm audit` finding (`npm audit --audit-level=critical`), so a critical alert in a production dependency blocks merging until it is fixed or written down.
- Alerts that can't be fixed without a major upgrade, and why the risk is accepted, are listed in [`docs/DEPENDENCY_RISKS.md`](docs/DEPENDENCY_RISKS.md).

### Remediation time frames

The time runs from the day the advisory appears in Dependabot or `npm audit`, as the severity those tools report. These are targets for a small maintainer team, not guarantees. They match the times for reported vulnerabilities above where the two overlap.

| Severity | A fix exists within the same major | The fix needs a major upgrade or a parent that pins the package              |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| Critical | 7 days                             | Mitigation or a written decision in `docs/DEPENDENCY_RISKS.md` within 7 days |
| High     | 14 days                            | Written decision within 14 days                                              |
| Moderate | 30 days                            | Written decision within 30 days                                              |
| Low      | Next planned release               | Written decision at the next review                                          |

- "Fix" means a patched version installed, through a Dependabot pull request or an `overrides` entry, and released in the next image. "Written decision" means an entry in [`docs/DEPENDENCY_RISKS.md`](docs/DEPENDENCY_RISKS.md) with the advisory, why it is accepted (for example the vulnerable code is never reached) and what would close it. Accepting a risk does not stop the clock on the upgrade that would close it: the entry is reviewed on every Strapi upgrade and at least every 90 days.
- A finding that is exploitable in a way the advisory does not describe goes through a private security advisory instead, and the faster time of the reporting table applies.
- Packages that only run in development, tests or the image build follow the same table, but their findings are listed in `docs/DEPENDENCY_RISKS.md` as not shipped.
- Only the latest release line is fixed. An operator on an older line upgrades first.
