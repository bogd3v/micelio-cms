# Third-party material

Micelio CMS's license ([LICENSE](LICENSE), AGPL-3.0-only) covers only the work of Micelio's contributors. **Third-party material is not part of that licensing**: Micelio's contributors do not relicense it, it is not offered under the AGPL, and it keeps the license its authors gave it. Whoever reuses it follows that license, not Micelio's. The decision is [ADR 0007](https://github.com/bogd3v/micelio/blob/main/docs/adr/0007-license.md) of the frontend, section 4.

This applies to everything below and to any third-party material added later, listed here or not. When you add some, list it here with its source and license, keep its license file next to it, and annotate its path in [REUSE.toml](REUSE.toml), the machine-readable version of this list (`reuse lint` checks it in CI; the license texts are in `LICENSES/`).

## Dependencies

npm packages (`package.json`, `package-lock.json`) are distributed under their own licenses, which each package carries. `npm run lint:licenses` (`scripts/check-licenses.mjs`, the same check as the frontend) fails when a production dependency has a license that cannot be combined with AGPL-3.0; the exceptions and their reasons are in `scripts/licenses-allow.json`.

## Strapi and its Enterprise code

Strapi is MIT, except the code under `ee/` directories and the packages `@strapi/review-workflows` and `@strapi/content-releases`, which are under the [Strapi Enterprise License](https://strapi.io/enterprise-terms). That code is installed with `@strapi/strapi` and is part of the Docker image, but it stays inactive without a Strapi license key, and Micelio never enables it:

- no file sets `STRAPI_LICENSE`, and no code imports Enterprise packages or `ee/` paths; `npm run lint:ee` (`scripts/check-no-ee.mjs`) fails otherwise;
- an operator who adds a Strapi license key to their instance does so under Strapi's terms, outside Micelio's license.

Plugins (`@notum-cz/strapi-plugin-seo`, `strapi-plugin-comments`, Strapi's own plugins and providers) keep their licenses and pass the dependency check.

## Strapi's project template

The project started from the example template of `create-strapi-app` (`templates/example` in the npm package, MIT, Copyright (c) 2015-present Strapi Solutions SAS; checked against version 5.57.0). Material from it keeps the MIT license and Strapi's copyright notice:

- **Unmodified**: `data/uploads/` (the example images), `favicon.png` (Strapi's default favicon), `public/robots.txt`, `src/admin/tsconfig.json`, `src/admin/vite.config.example.ts`, and the generated controllers, routes and services of `about`, `author`, `category` and `global`, plus the `shared.quote` and `shared.rich-text` components. MIT only.
- **Modified by Micelio**: `data/data.json`, `scripts/seed.js`, `src/admin/app.example.tsx`, the `config/` files, `src/index.ts`, `tsconfig.json`, the schemas of the template's content types (`about`, `article`, `author`, `category`, `global`), the `article` controller, route and service, and the `shared.media`, `shared.seo` and `shared.slider` components. Strapi's part stays MIT and Micelio's changes are under the AGPL (`AGPL-3.0-only AND MIT` in `REUSE.toml`).

## Example data

`data/data.json` and `data/uploads/` are the template's example blog, used only by `npm run seed:example`. They are not Micelio's (see above). The demo blog of `compose.demo.yml` (`src/migrations/demo/`) is Micelio's own work, with generated covers, and carries no third-party material.

## Names and marks of Micelio and BogDev

The names Micelio and BogDev and their logos (`public/bogdev-white.svg`, `public/favicon.png`) are the maintainer's own work. Their files are distributed with the code under the AGPL, but no trademark rights are granted (AGPL section 7(e)): a fork or another site may not present itself as BogDev or as the official Micelio.

## Site content

What a site stores in Micelio (articles, pages, images, comments, subscribers and settings, in the database and in uploads) belongs to its authors and is licensed by them. It is not part of Micelio, and running Micelio places no license on it.
