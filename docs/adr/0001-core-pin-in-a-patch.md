# ADR-0001: Raise the core plugin to the release that declares 0.7 in a 0.7.z patch

**Status:** Proposed
**Date:** 2026-11-11
**Deciders:** Micelio maintainer

## Context

The engineering standard (version 2.0, section 7, "The release line") says: "The distribution `micelio-cms` raises a MINOR when it raises the plugins it installs, and a MAJOR when one of them does." [ADR-0017](https://github.com/bogd3v/micelio/blob/main/docs/adr/0017-distribution-plugins-multisite-editorial.md) of `micelio` says the same, and its amendment of 2026-10-26 (D3) has `@micelio/strapi-plugin-core` declare `"micelio": "0.6"` for release line `0.6` and raise it to `"0.7"` with the `0.7` part.

Release line `0.7` of `micelio-cms` (epic bogd3v/micelio-cms#360) is ready before the core is:

- The core release that declares `"micelio": "0.7"` (and exports `withPageSettings`, which bogd3v/micelio-cms#414 needs) is cut when the core's milestone "Micelio · Builder, fase 2 — Componer" closes. On 2026-11-11 npm has the core `0.1.0` to `0.3.0`, and every one of them declares `"0.6"`.
- `@micelio/strapi-plugin-fediverse` `0.7.0`, which `micelio-cms` 0.7.0 installs, declares the peer `@micelio/strapi-plugin-core` `^0.2.0` (bogd3v/micelio-plugin-fediverse#6, decision B). On `0.x`, that range admits only `0.2.z`.

On 2026-11-11 the maintainer decided that `micelio-cms` 0.7.0 ships on core `0.2.0` (bogd3v/micelio-cms#418). The core that declares `0.7` is raised in a later `0.7.z` patch, followed by bogd3v/micelio-cms#414 (decision D-414-1 (a) on that issue). Read literally, the standard makes that raise a MINOR. This record is the exception the standard requires for one repository (section 16).

## Decision

1. `micelio-cms` 0.7.0 installs `@micelio/strapi-plugin-core` `0.2.0`. Its upgrade notes say that the core still reports release line `0.6`, and that the core's optional `frontend-release-line` check fails for a `0.7` frontend.
2. One `0.7.z` patch of `micelio-cms` raises the core to the first release that declares `"micelio": "0.7"`. In the same patch, the fediverse package is raised to a `0.7.z` whose core peer range admits that release. The patch's title is `chore(deps)`.
3. The exception applies to that one raise, and only while no breaking change of the core since `v0.2.0` reaches a `micelio-cms` operator, an editor, the content API or stored data. The core's release notes are read for each `!` change, and the pull request names each one with the reason it does not reach `micelio-cms`. If one does reach it, the raise is `0.8.0`, as the standard says, and this record does not apply.
4. Every other raise of a plugin follows section 7 as written.

## Options considered

### A. A `0.7.z` patch under this exception (chosen)

The core's `0.7` declaration catches up with the line `micelio-cms` already ships, so the distribution's line does not move. Page settings (bogd3v/micelio-cms#414) reach sites within line `0.7`, which ADR-0017 says carries the first builder phase. The frontend `0.7` keeps working, because nothing in the content API is removed.

### B. Change the standard's rule

The rule would apply only when a plugin's declared line moves away from the distribution's line. That is a wider change to every repository's rules, decided in `micelio-engineering`, for a case that has happened once.

### C. Raise the core in `micelio-cms` 0.8.0

This is consistent with the standard as written. But it holds page settings back by one minor, which goes against ADR-0017's line `0.7` and the maintainer's decision D-414-1 (a).

### D. Hold `micelio-cms` 0.7.0 until the core declares 0.7

This was the plan of bogd3v/micelio-cms#418 until 2026-11-11. It ties the site settings and fediverse cut-over, both ready, to an unrelated core milestone.

## Trade-offs

- Between `0.7.0` and the patch, operators see the core report line `0.6`, and a failing optional check if their frontend is on `0.7`. This is documented, and it never stops a boot.
- A `0.7.z` patch changes the core's code more than a patch usually does. Point 3 is the guard: the reviewer and the verifier check that guard in the pull request.
- The fediverse package needs a `0.7.z` of its own (a wider peer range) before the patch can install.

## Consequences

- bogd3v/micelio-cms#418 ships 0.7.0 on core `0.2.0`, with the "Known limitation" paragraph in `docs/operate/upgrade.md`.
- The issue that raises the core pin (epic bogd3v/micelio-cms#360, "Release 0.7.z") depends on this record being `Proposed` or `Accepted`. bogd3v/micelio-cms#414 depends on that issue.
- This is the first record in `micelio-cms`. `docs/adr/README.md` is created with its table, and the "Whoever asks why" row of `docs/README.md` names both places: the decisions that span repositories in `micelio`, and this repository's own exceptions here.
