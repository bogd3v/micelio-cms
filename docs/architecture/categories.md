# Categories

**Kind:** explanation. The decision is ADR 0016 in `bogd3v/micelio` ("Categories come from the CMS").

`api::category.category` has no draft and publish and is i18n-localized for `name` and `description`; `slug` and every field below are shared across locales. The frontend lists the categories from the CMS, so a site is not tied to any slug: the core names none.

| Field      | Type             | What it does                                                                                                                                                                                                                                                                                                        |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order`    | integer          | Position in every category list. It also ranks the categories for the color when `color` is empty.                                                                                                                                                                                                                  |
| `featured` | boolean, `false` | Marks the main categories: the home page's field guide and the About topics block highlight them (ADR 0016 section 5).                                                                                                                                                                                              |
| `color`    | integer 1 to 5   | Pins the color role of the category. Empty: the frontend picks one by the rank of `order`, then `slug`, so adding a category can shift the colors of later ones; a pinned color keeps its slot. Categories without an `order` rank last, and the rank counts the whole list, including categories with no articles. |

An editor sets these in the admin panel (Content Manager, Category). Strapi rejects a `color` outside 1 to 5. The five roles are the theme contract's category roles; a theme decides what each looks like.

`key` (an enumeration of one site's five slugs), `bird` and `pillar` are the previous model and stay for now: removing an attribute is a breaking schema change for stored data and for API consumers, so it ships as its own `!` release, with a boot migration that first copies `pillar` to `featured` (ADR 0016 section 10, issue #462 item 7). New sites leave them empty.

The demo seed (`src/migrations/demo-seed.ts`) gives its two categories an `order`, one `featured` and one pinned `color`, so the frontend's contract suite exercises them.
