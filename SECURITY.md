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

You will be credited in the advisory unless you prefer otherwise.

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

## The frontend's API token

How the frontend reads content with a custom API token, and the permissions that token carries, is documented in [`docs/API_TOKENS.md`](docs/API_TOKENS.md). Give each token only the permissions it needs, and rotate it if it leaks.

## How dependencies are handled

- Dependabot opens grouped minor and patch updates weekly. Major versions (Strapi, Node, nodemailer, etc.) are upgraded by hand after testing.
- Dependabot security alerts are triaged as they arrive. Patches within the same major go in through `overrides` in `package.json` when the parent package pins an older version.
- Alerts that can't be fixed without a major upgrade, and why the risk is accepted, are listed in [`docs/DEPENDENCY_RISKS.md`](docs/DEPENDENCY_RISKS.md).
