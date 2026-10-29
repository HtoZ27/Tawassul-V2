# Tawassul V2 — Decoupling Plan (independence from v1)

Goal: within two weeks of 2026-09-24, this tree builds, installs, and runs
with zero references to the v1 tree (`/home/htoz/Desktop/tawassyl`).
After the cutover the v1 tree becomes a read-only reference; no new
`SHARED.md` entries are expected after S-018.

## Recorded decisions

1. Runtime files (agent `.md` prompts, `deleted-agents.json`, `opencode.json`):
   the inventory below is now produced locally: `npm run seed:agents` writes
   the 8 base agents, `opencode.json` comes from `gen-opencode-config.ts`, and
   `deleted-agents.json` stays user state that no seed overwrites.
2. State paths: rename to a v2-specific namespace (see below).
3. `check-shared-anchors` keeps running until cutover; retirement happens then.

## Required-files inventory

| File | Producer | Status |
| --- | --- | --- |
| `dist/index.js` | `npm run build` (bun) | gitignored, built locally |
| `opencode.json` (34 agents) | `bun src/scripts/gen-opencode-config.ts` | untracked; `--check` runs in `gate:fast` |
| `.opencode/agents/*.md` (8 bases) | `npm run seed:agents` → `generateAgentMd` from `ALL_AGENTS` (`src/core/render-agent.ts`) | untracked; never overwrites an existing file, `--force` is explicit; 3 manually added variants sit beside the bases and are never touched |
| `.opencode/deleted-agents.json` (35 names) | user state; no seed writes it | untracked; the generator reads it and ignores non-variant names |
| `.opencode/tawassul-state.json` | runtime (HMAC-signed envelope) | untracked; created on first boot |
| HMAC key | runtime (`src/utils/crypto.ts` key code) | machine-local; fresh key per machine |
| `tawassul.jsonc` (global roster) | boot seed (`ensureGlobalRosterSeed`) and `opencode.json` edits | written once, only when neither `tawassul.jsonc` nor the legacy `tawassul.json` exists |

## Namespace renames (decision 2, implemented 2026-10-24)

State root: `src/utils/state-paths.ts` resolves `TAWASSUL_V2_STATE_DIR` first,
then `~/.config/tawassul-v2/state` (XDG-aware; when the launcher already pins
`XDG_CONFIG_HOME` to the v2 profile it uses `<profile>/state`, not a nested
copy). A read falls back to `~/.config/tawassyl/state/<file>` only while the
namespaced file is absent; legacy files are never deleted, rewritten, or
migrated automatically. `TAWASSUL_V2_LEGACY_STATE_DIR` overrides the legacy
root for relocated v1 trees and for the proof.

| Surface | v2 location | Legacy read |
| --- | --- | --- |
| six service defaults | `~/.config/tawassul-v2/state/*.json` | yes, via `hmacReadFile` / coordinator `load` |
| predictive router | `~/.config/tawassul-v2/state/predictive-router.json` | yes, via `stateReadPath` |
| HMAC prefix | `TAWASSUL_V2_HMAC_V1:` | verifies `TAWASSUL_HMAC_V1:` and `TAWASSULL_HMAC_V1:` |
| HMAC key file | unchanged `~/.config/tawassul/.tawassul-hmac-key` | shared for one release so legacy signatures verify |
| patch locks | `$TMPDIR/tawassul-v2-locks` | no |
| FS lock shards | `$TMPDIR/.tawassul-v2-file-locks-<uid>` | no |
| N2 log | `~/.local/share/tawassul-v2/n2-auto.jsonl` | no; old file untouched |
| plugin log sink | `~/.local/share/tawassul-v2/tawassul/tawassul.log` (`TAWASSUL_LOG_FILE` override, empty = off) | no; old v1 log untouched |
| code-state cache | `~/.cache/tawassul-v2/code-state` | copy-only migration in `migrateLegacy` |
| web fetch cache | `~/.cache/tawassul-v2/web-cache` | no; rebuildable cache |
| profile XDG roots | `v2NamespaceRoot` appends `tawassul-v2` once, including under the ISO launcher's pinned quad | — |
| global runtime state | `~/.config/opencode/tawassul-v2-state` | no; v2 was never globally installed with data |
| setup seat | `Symbol.for("tawassul.v2.setup")` | v1's registry is never read or written |
| plugin id | `tawassul` (unchanged) | host identity is the entry path; the id labels roster/permission keys (`tawassul.ask`), so renaming would break user configs |

Remaining shared surfaces, deferred with a reason: the HMAC key file (above),
the OS keyring service name `tawassul` (renaming would orphan stored secrets),
the per-project `.opencode/tawassul-sessions` registry (workspace-local; v1 is
disabled per workspace at cutover), and `db-isolation.ts`'s key-derived DB path
(unused at runtime while the ISO launcher pins `OPENCODE_DB`; revisit before
any boot that does not set it).

Proof: `npm run prove:state-namespace` (in `npm run ci`). Exit check: a boot
must not change mtimes under `~/.config/tawassyl` or `~/.config/tawassul`; the
HMAC key file is the only permitted legacy read.


## Independence gate (implemented 2026-10-24)

`scripts/prove-v2-independence.ts` (the 25th proof) fails the gate if `src/`,
the build script, or the launcher names the v1 tree. It also
asserts that the legacy state name is confined to `state-paths.ts`, that the
v2 path is checked before the legacy fallback, and that exactly one host
entry exists. v1 MCP entries are disabled in every workspace and the MCP
files are renamed `tawassul.mjs.retired-20261024`; v1 itself stays read-only.

## In-tree docs (delivered at cut)

- `RULES.md` (memory cap 1.5GB, sequential heavy ops) so `AGENTS.md` no
  longer points outside this tree.
- `README.md` (install + operator guide): delivered in Day 6. It carries the
  prerequisites, the install order (`npm install` → `npm run build` → host
  loads `.opencode/plugin/tawassul.js`), the state/HMAC table, the guard
  codes, and troubleshooting. `CUTOVER.md` keeps the cutover install method.

## Cutover checklist

1. Seed step: **done 2026-10-29.** `npm run seed:agents` writes the 8 bases,
   refuses to overwrite an existing file, and reports drift through
   `npm run check:agents`; `gen-opencode-config.ts --check` covers
   `opencode.json`; the global roster writes the canonical `tawassul.jsonc`
   only when no roster exists.
2. Fresh-clone validation: install → build → seed → `--check` →
   sandboxed live boot → `npm run ci` green. The seed and check halves run in
   `prove-seed-agents`; the sandbox boot and `ci` halves are covered by
   `gate:smoke` and the full gate.
3. Retire the channel: freeze `SHARED.md`, drop `check-shared-anchors`
   from `verify`, delete `scripts/port-from-v1.mjs` + `test-utils.ts`,
   remove remaining v1 path references. **Done 2026-10-24; see `CUTOVER.md`.**
4. Final commit.

## Transfer protocol after cutover

Closed. `SHARED.md` is frozen and v1 is read-only. New work is v2-only and
goes through `PLAN.md`; do not reopen the cross-tree channel.
