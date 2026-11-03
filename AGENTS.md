# Tawassul V2 — Project Rules (English)

This is the standalone OpenCode v2 (Plugin API v2) implementation of Tawassul.
It is the only runnable plugin copy after the 2026-10-24 cutover; the v1 tree
is a retired, read-only reference.

## Mandatory rules

1. **English is canonical.** All code, strings, tool descriptions, and docs are
   English. Arabic is forbidden in code and docs with one exemption: the runtime
   translation tables `src/i18n/<lang>.json` for a non-English language (for
   example `src/i18n/ar.json`). `src/i18n/en.json` stays English, and no `.ts`
   file may carry Arabic even under `src/i18n/`. Documentation translations live
   under `docs/i18n/` and are outside this gate. Enforced by
   `scripts/check-v2-rules.mjs` (`npm run check:rules`); every `.ts`, `.mjs`, and
   `.json` file under `src/`, `scripts/`, and `tests/` is scanned and this is the
   only exemption. A global word allow-list is forbidden.
2. **No comments in scanned code.** Comments are forbidden in `.ts`, `.mjs`,
   and `.json` under the gate paths below, including JSDoc and empty comments.
   Only these exact directive shapes are permitted: `// @ts-expect-error`,
   `// @ts-ignore`, `/* eslint-disable ... */`, `// eslint-disable-next-line ... */`,
   and `/* eslint-enable ... */` (an optional `:` or `--` reason may follow a
   TypeScript directive; a glued prefix such as `@ts-ignore-everything` is
   rejected). Enforced by the same checker and proven by `scripts/prove-rule-gate.ts`.
3. **Gate scope.** The checker parses `.ts`, `.mjs`, and `.json` under `src/`,
   `scripts/`, `tests/`, plus two root files. Shell, Markdown, and YAML are
   outside its reach. Shell comments are allowed for operational notes and must
   be English; Markdown and YAML may document behaviour. Everything outside the
   scanned extensions is reviewed, not gated.

## Before any work

1. Read `RULES.md` (memory cap 1.5GB, sequential heavy ops).
2. Run `npm run verify` after changes: fast gate + build (`npm run ci` for
   proofs and smoke).

## Shared issues log (frozen)

`SHARED.md` is frozen at the 2026-10-24 cutover. It is a historical record;
no new `S-###` entries are accepted and its anchors are not gated. Do not
re-open the v1 transfer channel.

## Ownership boundary

1. **v1 is retired permanently.** Its tree is read-only reference. It must not
   load in any project, and any v1 plugin entry or v1 host is a defect, not a
   compatibility target. No transfers, no code edits, no cross-tree commits.
2. **v2 owns this tree.** Only agents working in this folder implement,
   verify (`npm run verify`), and commit code changes.
3. **One plugin copy.** This tree is the only runnable Tawassul plugin.
   v2 must not import from, build with, or execute the v1 tree. The only
   permitted v1-era reads are the existing HMAC key file and a one-time legacy
   state import gated behind `TAWASSUL_V2_LEGACY_READS=1` (default off);
   `npm run prove:independence` enforces this.
4. **One host in production.** The Desktop and its sidecar are the supported
   host. Two hosts run only in isolated tests (`XDG_*`, `OPENCODE_DB`, and
   state separated), never on the same workspace at the same time.

## Porting from v1

- Never copy non-English code, strings, or comments.
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
- `npm run build` — `dist/index.js` plus the self-contained `dist/global.js` (bun, no splitting)
- `npm run install:global` — opt-in flat-file global install (build first)
- `npm run verify:global` — hashes, host pin, scope, wasm integrity
- `npm run uninstall:global` — remove the global file and runtime (`-- --purge` for state)
- `npm run prove:independence` — no v1 tree reference; one host entry
- `npm run gate:fast` — rules, shell syntax, typecheck, config, facts, contract, shared parity, catalog, generated proof count
- `npm run gate:proofs` — <!-- generated:proof-steps -->152<!-- /generated --> proofs, one isolated child process each (the full CI run)
- `npm run gate:proofs:1` … `gate:proofs:4` — the four balanced shards of the proof stage, about one minute each
- `npm run gate:proofs:bg` — the four shards sequentially in a detached worker (`:status`, `:wait`, `:stop`)
- `npm run gate:smoke` — build + release smoke
- `npm run ci` — all three stages sequentially, each in its own process
- `npm run verify` — `gate:fast` plus the build
- `npm run host:refresh` — reload the live host after a build and verify a fresh plugin init
  (`-- --verify-only` checks without touching the host, `-- --restart` schedules a detached service restart)
