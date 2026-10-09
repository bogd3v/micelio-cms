# Playground blocks

Moved from `CLAUDE.md` (#113); the text is unchanged.

`shared.playground` in the article `blocks` dynamic zone is runnable code for micelio's heavy island (ADR 0006): `runtime` (`python`/`sql`/`javascript`), `code` (≤ 5,000 characters), optional `expectedOutput` (≤ 5,000), `setup` (≤ 20,000, hidden code that runs first) and `caption`. Only the caption reaches `plainText`. A fragment populate (`blocks.on`) drops components it does not name, so consumers must list `'shared.playground': true`.
