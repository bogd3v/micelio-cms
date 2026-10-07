# Dependency risks

Dependabot alerts that stay open because the fix needs a major version that a parent package pins. Each entry says why the risk is accepted and what would close it. Review this list on every Strapi upgrade. Patches within the same major go in through `overrides` in `package.json` instead (see `SECURITY.md`).

Last reviewed: 2026-10-07, Strapi 5.56.0. `npm audit --omit=dev` reports 46 vulnerabilities (38 high, 8 moderate); every one is covered below.

## Fixed through overrides

The parent pins an older patch of the same major, so `overrides` lifts it:

| Package               | Pinned by                                        | Override   | Alerts closed |
| --------------------- | ------------------------------------------------ | ---------- | ------------- |
| `nodemailer`          | `@strapi/provider-email-nodemailer` (9.0.1)      | `^10.0.14` | npm audit     |
| `sharp`               | `@strapi/upload` (0.35.4, exact pin)             | `^0.35.5`  | 1             |
| `postcss`             | `styled-components` (8.4.31, 8.4.49)             | `^8.5.28`  | 4             |
| `markdown-it`         | `@strapi/content-manager` (14.3.0)               | `^14.3.2`  | 1             |
| `dompurify`           | `@strapi/content-manager` (3.4.13)               | `^3.4.16`  | 1             |
| `@opentelemetry/core` | `@opentelemetry/sdk-metrics` (2.7.1, via Fedify) | `^2.8.0`   | 1             |
| `axios`               | `@strapi/*` (1.19.0)                             | `^1.20.0`  | npm audit     |

Drop an override once the parent ships the patched version, so it doesn't hold back later updates.

`nodemailer` 10 is a major above what the provider declares (9.x). `npm audit` reports no advisory on 10.0.14. Compatibility with the provider is not verified beyond that, and no test sends mail through SMTP, so re-check the override on each Strapi upgrade and when changing the email setup.

`sharp` 0.35.5 closes GHSA-wq5f-xc86-pv6w (a librsvg vulnerability, fixed by the librsvg 2.63.2 that 0.35.5 bundles). `@strapi/upload` pins the exact version 0.35.4, so only an override lifts it, and Strapi 5.57.0 still pins 0.35.4.

## Pinned direct dependencies

- `knex` 3.0.1 is a direct dependency only so the rate limiting store (`src/utils/rate-limit/stores.ts`) can import it. It must stay on the exact version `@strapi/database` pins: bump it together with Strapi, never alone (close Dependabot PRs that bump only `knex`).
- `rate-limiter-flexible` 11.2.1 (ISC, no runtime dependencies) is pinned exactly; see `docs/RATE_LIMITING.md`.

## Accepted

Direct advisories on packages that stay on a vulnerable version:

| Package                  | Installed  | Fix                        | Pinned by                                                | Why it's accepted                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ---------- | -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite` (3 alerts)        | 5.4.21     | 6.4.3 (major)              | `@strapi/strapi`, `@strapi/pack-up`, `@tailwindcss/vite` | Dev server issues (`server.fs.deny` bypass on Windows, path traversal in optimized deps `.map` handling, `launch-editor` NTLM hash disclosure on Windows). Vite only runs in `strapi develop` and at image build time. Production serves the prebuilt admin. 5.4.21 is the last 5.x release; Strapi 5.57.0 moves to vite 6.4.3, so a Strapi upgrade closes it.                                                                            |
| `webpack-dev-middleware` | 6.1.3      | 7.4.5 (major)              | `@strapi/strapi`                                         | Path traversal via a non-slash-terminated `publicPath` in the dev middleware, only used by `strapi develop` with the webpack bundler, which this project doesn't use. 6.1.3 is the last 6.x release, and Strapi 5.57.0 still pins it.                                                                                                                                                                                                     |
| `esbuild`                | 0.20, 0.21 | >0.24.2 (breaking pre-1.0) | `@strapi/pack-up` (0.20), `vite` 5 (0.21)                | GHSA-67mh-4wv8-2f99: a website can send requests to the esbuild dev server (`esbuild --serve`) and read the response. That server is never started. Our own build runs esbuild 0.28. Closes with the vite upgrade; `@strapi/pack-up` is only reached through `strapi-plugin-comments`.                                                                                                                                                    |
| `react-router`           | 6.30.6     | 7.18.0 (major)             | `react-router-dom` 6, required by the Strapi 5 admin     | Open redirect via `\` in `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6), and `deserializeErrors` in data-router SSR hydration (GHSA-337j-9hxr-rhxg). Only the authenticated admin panel uses it, client-side, with its own routes. The Strapi 5 admin doesn't support React Router 7.                                                                                                                                                       |
| `stream-json` (3 alerts) | 1.9.1      | 3.6.0 (major)              | `@strapi/data-transfer`                                  | Filter DoS (GHSA-528h-pc64-c93x), JSONC re-scan DoS (GHSA-hqr4-qq8f-hg3x) and prototype pollution in `Assembler` (GHSA-mjw6-4jj6-33hc). `@strapi/data-transfer` only requires `stream-json/jsonl/Parser` and `Stringer`, which call `JSON.parse` per line; the filters, JSONC and `Assembler` code is never loaded. Still pinned to 1.9.1 in Strapi 5.57.0.                                                                               |
| `braces`                 | 3.0.3      | none (3.0.3 is latest)     | `chokidar`, `micromatch` (Strapi dev tooling)            | Stack exhaustion with crafted brace patterns (GHSA-vfj7-8cjw-p6xm). The patterns are file globs in our own config, never user input.                                                                                                                                                                                                                                                                                                      |
| `showdown` (3 alerts)    | 2.1.0      | none (2.1.0 is latest)     | `@notum-cz/strapi-plugin-seo`                            | ReDoS in link parsing (GHSA-rmmh-p597-ppvv), XSS through metadata title handling (GHSA-cr32-g25g-vxjj) and table header ID injection (GHSA-22g5-r2x5-97cx). The SEO plugin converts markdown to HTML only to count words for keyword density; the HTML is never rendered, so the XSS can't run. The ReDoS needs an editor's own content and freezes only their browser tab. Closes if the plugin drops showdown or we replace the plugin. |

### Reported only through their dependencies

`npm audit` also lists these packages, each with no advisory of its own. They inherit the accepted entries above, and closing those closes them:

- Through `vite`/`esbuild`: `@vitejs/plugin-react-swc`, `@strapi/pack-up`, `@strapi/sdk-plugin`.
- Through `braces`: `micromatch`, `chokidar`, `fork-ts-checker-webpack-plugin`, `nodemon`, `fast-glob`, `globby`, `findup-sync`, `liftoff`, `plop`, `jscodeshift`, `find-yarn-workspace-root2`, `preferred-pm`, `sort-package-json`, `prettier-plugin-packagejson`, `@strapi/generators`.
- Through `react-router-dom`: `@notum-cz/strapi-plugin-seo`, `@strapi/admin`, `@strapi/content-manager`, `@strapi/content-releases`, `@strapi/content-type-builder`, `@strapi/email`, `@strapi/review-workflows`, `@strapi/upload`, `@strapi/plugin-users-permissions`, `@strapi/i18n`, `strapi-plugin-comments`.
- Through `@strapi/utils` and `@strapi/data-transfer` (themselves flagged via `preferred-pm` and `stream-json`): `@strapi/core`, `@strapi/database`, `@strapi/permissions`, `@strapi/types`, `@strapi/cloud-cli`, `@strapi/provider-upload-local`, `@strapi/strapi`.

The `fixAvailable` that npm suggests for these is a downgrade (`@strapi/plugin-users-permissions` 4.26.2, `@strapi/i18n` 0.0.0, `strapi-plugin-comments` 1.0.4). Never apply it, and never run `npm audit fix --force`.

`npm audit` without `--omit=dev` adds 19 moderate findings on the `jest` toolchain (`js-yaml` through `argparse`/`sprintf-js`, GHSA-hp3w-g68c-fv3c on `sprintf-js`). They only run in tests, never in the image. npm's suggested fix is a `jest` 25 downgrade; not verified beyond the audit output.

To dismiss these alerts on GitHub, use the reason `tolerable_risk` for `react-router` and `stream-json`, and `vulnerable_code_not_actually_used` for the rest.
