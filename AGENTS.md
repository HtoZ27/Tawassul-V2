# Tawassul V2 — Project Rules (English)

This is the standalone OpenCode v2 (Plugin API v2) implementation of Tawassul.
It lives in its own folder and never overlaps with the v1 implementation.

## Mandatory rules

1. **English only.** All code, strings, tool descriptions, and docs are English.
   Arabic is forbidden. Enforced by `scripts/check-v2-rules.mjs` (`npm run check:rules`).
   Seven paths carry functional Arabic matchers or user-facing Arabic prompts and
   are exempt by exact path (`ARABIC_ALLOWED_FILES`): the three rejection/phrase
   matchers, `agent-add-helpers.ts`, `agent-management.ts`, `ask-channel-parse.ts`,
   `consent-gate-guard.ts`, and `i18n/en.json`. Any new file needs an explicit
   entry plus a reason; a global word allow-list is forbidden.
2. **No comments in code.** Comments are forbidden, including JSDoc and empty
   comments. Only these exact directive shapes are permitted: `// @ts-expect-error`,
   `// @ts-ignore`, `/* eslint-disable ... */`, `// eslint-disable-next-line ... */`,
   and `/* eslint-enable ... */` (an optional `:` or `--` reason may follow a
   TypeScript directive; a glued prefix such as `@ts-ignore-everything` is
   rejected). Enforced by the same checker and proven by `scripts/prove-rule-gate.ts`.
3. **Gate scope.** The checker parses `.ts`, `.mjs`, and `.json` under `src/`,
   `scripts/`, `tests/`, plus three root files. Shell, Markdown, and YAML are
   outside its reach, so keep those English and comment-free by review, not by gate.

## Before any work

1. Read `/home/htoz/Desktop/tawassyl/RULES.md` (memory cap 1.5GB, sequential heavy ops).
2. Run `npm run verify` after changes: rules + shared anchors + typecheck + build.

## Shared issues log

`SHARED.md` documents problems shared with v1 and their fixes, with code anchors
in both trees. Anchors are validated by `scripts/check-shared-anchors.mjs`
(`npm run check:shared`). Add an `S-###` entry whenever a problem recurs across
versions; do not duplicate the fix in both codebases.

## Ownership boundary (minimal overlap between the two projects)

1. **v1 side transfers, never edits here.** Problems and proven fix shapes from
   the v1 tree arrive only as `SHARED.md` entries (`S-###`) with valid v1/v2
   anchors. No direct code edits from outside this tree.
2. **v2 agents own this tree.** Only agents working in this folder implement,
   verify (`npm run verify`), and commit code changes derived from `SHARED.md`
   entries. Mark the entry implemented; do not edit v1.
3. **One channel.** `SHARED.md` is the single transfer channel between the
   projects. No side edits, no duplicated fixes, no cross-tree commits.

## Porting from v1

- Never copy Arabic code or comments.
- Strip all comments while porting.
- Tool executions run in the promise domain: wrap effect pipelines with
  `Effect.runPromise`.
- Entry point is `Plugin.define` on the `Plugin` namespace imported from
  `@opencode/plugin` (`Plugin.Plugin` is the config interface type, not a
  runtime member).
- Dependencies are external in the build (`import.meta.resolve` guard keeps
  `@opencode/plugin` and its transitive deps external when resolvable).

## Build & verify

- `npm run typecheck` — TypeScript strict
- `npm run check:rules` — English-only + no-comments
- `npm run check:shared` — SHARED.md anchors valid in both trees
- `npm run build` — single-file bundle to `dist/index.js` (bun, no splitting)
- `npm run verify` — all of the above sequentially