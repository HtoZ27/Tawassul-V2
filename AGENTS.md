# Tawassul V2 — Project Rules (English)

This is the standalone OpenCode v2 (Plugin API v2) implementation of Tawassul.
It is the only runnable plugin copy after the 2026-10-24 cutover; the v1 tree
is a retired, read-only reference.

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
   `scripts/`, `tests/`, plus two root files. Shell, Markdown, and YAML are
   outside its reach, so keep those English and comment-free by review, not by gate.

## Before any work

1. Read `RULES.md` (memory cap 1.5GB, sequential heavy ops).
2. Run `npm run verify` after changes: rules + shell syntax + typecheck + build.

## Shared issues log (frozen)

`SHARED.md` is frozen at the 2026-10-24 cutover. It is a historical record;
no new `S-###` entries are accepted and its anchors are not gated. Do not
re-open the v1 transfer channel.

## Ownership boundary

1. **v1 is retired.** Its tree is read-only reference. No transfers, no code
   edits, no cross-tree commits.
2. **v2 owns this tree.** Only agents working in this folder implement,
   verify (`npm run verify`), and commit code changes.
3. **One plugin copy.** This tree is the only runnable Tawassul plugin.

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
- `npm run build` — single-file bundle to `dist/index.js` (bun, no splitting)
- `npm run verify` — all of the above sequentially