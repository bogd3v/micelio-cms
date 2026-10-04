# Agent team (micelio-cms)

The main session acts as **tech lead / orchestrator**. It splits the work, hands each piece to the cheapest subagent that can do it well, integrates the results and owns the final quality. Subagents live in `.claude/agents/`; their model is fixed in each file's frontmatter.

## Roster

| Agent | Model | Use it for |
|---|---|---|
| `explorer` | haiku | Find files, map an area, answer "where is X?" (also reads `../micelio`) |
| `architect` | opus | Plans for content models, permissions, fediverse phases, cross-repo contract |
| `senior-engineer` | sonnet | Services, controllers, routes, Document Service middlewares, extensions |
| `content-modeler` | sonnet | Content types, components, dynamic zones, i18n, boot migrations, seeding, Postgres vs SQLite |
| `fediverse` | opus | `src/plugins/fediverse/`, Fedify, comments extension, `FEDIVERSE_*` |
| `junior-engineer` | haiku | Mechanical changes: renames, UIDs to `constants/uids.ts`, formatting, repetitive edits |
| `qa-tester` | sonnet | Jest suites against a real Strapi on SQLite |
| `code-reviewer` | opus | Review every diff before it is called done |
| `security` | opus | Permissions, API tokens, drafts access, accounts, CORS, admin CSP, uploads, secrets |
| `devops` | sonnet | Dockerfile, CI/deploy/staging workflows, Dokploy config, demo compose, dependencies |
| `docs-writer` | haiku | `CLAUDE.md`/`AGENTS.md` architecture notes, `docs/*.md`, skills, issue Progress drafts |

**Escalation:** if an agent fails the same task twice, or the problem is exceptionally hard (concurrency, a subtle regression, a contract that touches both repos), relaunch it with `model: opus`; `model: fable` only as a last resort, and say in the summary why. Never start with the most expensive model.

## Where the plan lives

- Work is tracked in GitHub issues; fediverse work in the `fediverse-federation` milestone (phases 0–5) with `docs/FEDIVERSE.md` as the living tracker. Frontend-wide planning is micelio's epic #240.
- `CLAUDE.md` holds the architecture notes and non-obvious findings; read the relevant section before changing an area.
- Deployment and pipeline details are in `docs/CI_CD.md`; `main` → production, `develop` → staging.

## Cross-repo contract (`micelio-cms` ↔ `micelio`)

- Content types, components and dynamic-zone blocks are defined in **micelio-cms** (`src/components/`, `src/api/*/content-types/`) and rendered here (`strapi-block` skill).
- Token permissions: micelio's `docs/security.md` must match what `micelio-cms/src/migrations/api-tokens.ts` grants.
- `site.modules` and `site.theme` come from the CMS `api::site-setting`; theme rules are ADR 0005 here, enforced by `src/utils/site-theme.ts` there.
- Order for a change that crosses the contract: CMS schema/permissions first (behind a default that keeps the old frontend working), frontend second, each in its own PR referencing the same issue.

Clone both repos side by side (`../micelio`) so agents can read the other side of the contract. Agents only **read** the other repo; changes there happen in a session opened in that repo.

## Workflow

1. **Understand** — read the issue and its Progress section. Unknown area → `explorer` first. Ambiguous scope that is expensive to redo → ask the user.
2. **Design** — anything that touches several modules, a data contract, auth, caching, security headers or deployment → `architect`. Small changes skip this.
3. **Implement** — assign each step to the cheapest capable agent. Independent steps in parallel; never two agents on the same files at once.
4. **Verify** — `qa-tester` runs the relevant suites. Auth, permissions, tokens, user input, CSP, new dependencies → also `security`.
5. **Review** — `code-reviewer` reviews the full diff. Blocking findings go back to the implementer; after two rounds, escalate or ask the user.
6. **Document** — `docs-writer` updates the docs listed for this repo and the issue's Progress section draft.
7. **Ship** — the orchestrator itself prepares branch, commits and PR following the repo's skill, and asks the user before pushing.
8. **Close** — summary for the user: what changed, what was tested (real numbers), risks, decisions pending.

## Delegation rules

- Subagents start with no context. Every delegation includes: goal, issue number, relevant paths, the project skill to load, constraints, definition of done and expected report format.
- Point agents to the project skill instead of re-explaining conventions: they read `.claude/skills/<name>/SKILL.md` before starting.
- Don't delegate trivia (a one-line edit, a question one file read answers).
- If two agents disagree, decide with arguments; product decisions go to the user.

## Hard limits (every agent)

- Never push, merge, tag, release, deploy, or run anything against production or staging. The orchestrator prepares; the user approves.
- Never call the `strapi` MCP server (it points at production, `api.bogdev.com.co/mcp`) or the `dokploy` MCP server. Subagents do not list MCP tools on purpose; if a task seems to need them, stop and report.
- Never read or print `~/.claude/secrets/`, `.env` or tokens. Use `.env.example` to learn variable names.
- Code, identifiers, commits, PR titles and descriptions in English (see `AGENTS.md`).

## Cost guide

- Reading and mapping → haiku. Writing code and tests → sonnet. Judgment (design, review, security) → opus. Fable only for justified escalation.
