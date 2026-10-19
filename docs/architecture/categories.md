# Categories

**Kind:** explanation. The decision is ADR 0016 in `bogd3v/micelio` ("Categories come from the CMS").

`api::category.category` has no draft and publish and is i18n-localized for `name` and `description`; `slug` and every field below are shared across locales. The frontend lists the categories from the CMS, so a site is not tied to any slug: the core names none.

| Field      | Type             | What it does                                                                                                                                                                                                                                                                                                        |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order`    | integer          | Position in every category list. It also ranks the categories for the color when `color` is empty.                                                                                                                                                                                                                  |
| `featured` | boolean, `false` | Marks the main categories: the home page's field guide and the About topics block highlight them (ADR 0016 section 5).                                                                                                                                                                                              |
| `color`    | integer 1 to 5   | Pins the color role of the category. Empty: the frontend picks one by the rank of `order`, then `slug`, so adding a category can shift the colors of later ones; a pinned color keeps its slot. Categories without an `order` rank last, and the rank counts the whole list, including categories with no articles. |

An editor sets these in the admin panel (Content Manager, Category). Strapi rejects a `color` outside 1 to 5. The five roles are the theme contract's category roles; a theme decides what each looks like.

## Removed fields: `key`, `bird` and `pillar`

The previous model carried `key` (an enumeration of one site's five slugs), `bird` and `pillar`. They are gone from the schema and from the Content API (ADR 0016 section 10, issue #462 item 7). This is a breaking change, shipped with a `!`:

- A request whose `fields`, `filters` or `sort` name `key`, `bird` or `pillar` is answered with 400. A frontend must be on the release line that no longer asks for them (micelio 0.4).
- `database/migrations/2026.10.19T00.00.00.category-pillar-to-featured.js` copies `pillar` to `featured` before the column is dropped. Strapi runs the files of `database/migrations/` (shipped in the image, plain JavaScript) inside `db.schema.sync()`, before it syncs the schema, so the `pillar` column still exists; `bootstrap()` would be too late. A category whose document has any row with `pillar` true becomes featured in every locale; a category already featured is never touched and `featured` is never turned off. The file is self-contained, a no-op on a new database or once the column is gone, and safe to run twice. `tests/category-pillar-migration.test.ts` starts from a database with the old column and checks the order.
- `consolidateCategories` (BogDev's instance only) no longer writes the three fields; it features `privacidad` and `diy` only when it creates them or consolidates them for the first time (their `order` is still empty). After that `featured` is the editor's: a boot never turns it on or off again.

**Upgrade note:** upgrade the CMS, let it boot once (the copy runs on that boot), then deploy a frontend that does not request the removed fields. Back up the database first, as for any upgrade: going back needs the old image and a restore, because the dropped data does not return.

The demo seed (`src/migrations/demo-seed.ts`) gives its two categories an `order`, one `featured` and one pinned `color`, so the frontend's contract suite exercises them.
