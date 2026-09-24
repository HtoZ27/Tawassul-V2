# Tawassul V2 — Decoupling Plan (independence from v1)

Goal: within two weeks of 2026-09-24, this tree builds, installs, and runs
with zero references to the v1 tree (`/home/htoz/Desktop/tawassyl`).
After the cutover the v1 tree becomes a read-only reference; no new
`SHARED.md` entries are expected after S-018.

## Recorded decisions

1. Runtime files (agent `.md` prompts, `deleted-agents.json`, `opencode.json`):
   document-only until cutover. No seed/track implementation yet.
2. State paths: rename to a v2-specific namespace (see below).
3. `check-shared-anchors` keeps running until cutover; retirement happens then.

## Required-files inventory

| File | Producer | Status |
| --- | --- | --- |
| `dist/index.js` | `npm run build` (bun) | gitignored, built locally |
| `opencode.json` (44 agents) | `bun src/scripts/gen-opencode-config.ts` | untracked; needs `.md` + deleted list |
| `.opencode/agents/*.md` (8 bases) | `generateAgentMd` from `ALL_AGENTS` (`src/core/render-agent.ts`) | untracked; regenerable from source (carries R-011 clause) |
| `.opencode/deleted-agents.json` (21 names) | seed step (to be implemented at cutover) | untracked; static data, no in-source copy yet |
| `.opencode/tawassul-state.json` | runtime (HMAC-signed envelope) | untracked; created on first boot |
| HMAC key | runtime (`src/utils/crypto.ts` key code) | machine-local; fresh key per machine |

## Namespace renames (decision 2)

`~/.config/tawassyl/state/...` defaults in `src/services/trust-score/types.ts`,
`src/services/background-coordinator/types.ts`, `src/services/spec-driven/types.ts`,
`src/services/collective-memory/types.ts`, `src/services/cost-transparency/types.ts`,
`src/services/failure-autopsy/types.ts` move to a v2-specific path.
Audit at implementation time: HMAC key dir, FS-lock dir, `tawassul-*` tmp prefixes.

## In-tree docs needed before cut

- `RULES.md` (memory cap 1.5GB, sequential heavy ops) so `AGENTS.md` stops
  pointing outside this tree.
- `README.md` (install + operator guide): prerequisites (bun, node 24,
  opencode >= 1.18.30), bootstrap order
  (`npm install` → `npm run build` → seed → generator `--check`).

## Cutover checklist

1. Implement seed step (or track files) per the inventory above.
2. Fresh-clone validation: install → build → seed → `--check` →
   sandboxed live boot → `npm run ci` green.
3. Retire the channel: freeze `SHARED.md`, drop `check-shared-anchors`
   from `verify`, delete `scripts/port-from-v1.mjs` + `test-utils.ts`,
   remove remaining v1 path references.
4. Final commit.

## Transfer protocol until cutover

Per the v1 atomic review (2026-09-24): anything touching v2 arrives as a
`SHARED.md` `S-###` entry with valid v1/v2 anchors. No new entries pending.
