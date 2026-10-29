# Security

The organisation's [security policy](https://github.com/bogd3v/.github/blob/main/SECURITY.md) says how to report a vulnerability privately, the response times and the testing rules. This page adds what is specific to Micelio CMS. The security model is in [`security/`](security/asvs.md), and the dependency policy and its remediation time frames in [`DEPENDENCY_RISKS.md`](DEPENDENCY_RISKS.md).

## Reporting a vulnerability and scope

Report it through **Security → [Report a vulnerability](https://github.com/bogd3v/micelio-cms/security/advisories/new)** on this repository. Say whether it needs an account or a token (public, reader, editor, admin).

In scope: the code and configuration of this repository, including:

- Custom API routes, controllers and services (`src/api`), such as search, popular articles and the drafts list
- Access control: drafts restricted to editors, site settings and subscribers readable only with the frontend's API token ([`API_TOKENS.md`](API_TOKENS.md)), `DELETE /api/users/me`, the Editor role, comment visibility middlewares
- The `fediverse` plugin (ActivityPub inbox, HTTP signatures, federated replies)
- Who may change the theme: only the Super Admin role. Editor, Author, any role created later and
  any API token cannot write `site-setting.theme`.
  - Stored permissions are narrowed on every boot (`src/migrations/theme-permissions.ts`, admin
    roles and admin API tokens).
  - Every write is checked while the request runs (`src/utils/theme-access.ts`): the theme is
    dropped from an admin session without the role, and a token that sends it gets 403.
  - The theme picker's admin route answers only the Super Admin, and the content API tokens have
    `find` only on the site settings (`src/migrations/api-tokens.ts`; micelio's `docs/security.md`
    must match).
  - Changing the theme decides what the frontend downloads and installs (micelio ADR 0009)
- Configuration (`config/`), the Docker image and the CI/CD workflows

Report these upstream instead:

- Strapi core, admin panel and official plugins: [Strapi security policy](https://github.com/strapi/strapi/security/policy)
- `strapi-plugin-comments`, `@notum-cz/strapi-plugin-seo`, Fedify and other dependencies: their own repositories

Out of scope, besides the organisation's list: anything that requires an admin account, unless it escalates privileges.

Test against your own instance (`npm run develop`, see the [README](../README.md)).

**Disclosure.** The fix is prepared in a private fork of the advisory and released first; the advisory is then published with the affected and fixed versions, and the release notes point to it under "Security". Details stay private until a fix is available, or until 90 days after the report if none can be made. A known weakness that cannot be fixed yet is written down with the reason in [`DEPENDENCY_RISKS.md`](DEPENDENCY_RISKS.md).

**Verification.** Security review follows OWASP ASVS 5.0.0: [`security/asvs.md`](security/asvs.md) maps every level 1 and level 2 requirement to where it is enforced. An open requirement that is exploitable is tracked only in a private security advisory, and its row says "Private advisory"; one that is not gets an issue with the `security` label.
