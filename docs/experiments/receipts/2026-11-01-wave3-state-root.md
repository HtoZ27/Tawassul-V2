# Wave 3 — state-root key, boot-time sync and rollback

- Date: 2026-11-01
- Host: OpenCode 2.2.5; the supported host calls `setup(ctx)` and exposes `location.project`
- Build under test: HEAD `9d9e36c` plus the uncommitted Wave 3 tree
- Runtime: bun 1.3.14
- Isolation: every boot ran in a temp workspace with `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OPENCODE_DB` and `TAWASSUL_HMAC_KEY_DIR` redirected under the same root. The live host, the live state root and the global install were not touched.

## Question

The first draft proposed deriving the project key from a normalized git remote. The owner steered the design to the host's own project identity, and the config split was fixed as a hard rule: project configuration stays in the workspace (`opencode.json(c)`, `.opencode/tawassul.json(c)`, agents, skills, pins), and only persistence moves.

## Host-identity probe

| Case | Observation |
| --- | --- |
| Main checkout | `project.id` = `ba50b1a3…`, canonical = the checkout |
| `git worktree` of the same repo | same `project.id`, canonical = the main checkout |
| Separate clone of the same remote | same `project.id` |
| Directory with no git repository | a distinct path-derived id |
| Symlinked directory | resolves to the real repository, same `project.id` |

Verdict: the host id already survives worktrees, clones and symlinks, so a self-computed remote hash is rejected as a second source of truth. The resolver uses `project.id` first, then `project.canonical`, then `project.directory`, then the working directory. A safe id is lowercased and used directly; an unsafe id or a path fallback is hashed to a fixed-length key.

## Implementation

| Area | Change |
| --- | --- |
| Identity | `src/utils/project-identity.ts`: `resolveProjectIdentity`, `sanitizeProjectKey`, `canonicalPathKey`, `usableProjectID`, `stateRootMode`, `projectRootFor`, `resolveProjectRoot`, `TAWASSUL_STATE_ROOT` (`auto`, `legacy`, `project`) |
| Migration | `src/utils/project-state-migration.ts`: boot-time sync, backup and manifest, per-file index, `migration.jsonl` journal, conflict archive, idempotent re-runs |
| Wiring | `src/v2/client-shim.ts` computes the identity and root; `src/bootstrap/plugin-init.ts` runs the migration before the context; `src/plugin-types.ts` and `src/v2/types.ts` carry the fields |
| Context split | `src/context-class.ts` keeps `stateDir` as the workspace and adds `persistDir`; `config-facade` keeps every config path on `stateDir` and routes only the state file through `persistDir` |
| Persistence | `StateManager`, `SessionManager`, metrics, state persistence, state loader, handoff ledger, tool-run log, timeline, goals, checkpoints, mission board, service index, saga, panic and health now use `persistDir` |
| Guard | `getWorktreeBlockReason(stateDir, projectRoot?)` accepts exactly the worktree root and the resolved project root |
| Lock | no new lock: the existing `StateManager` FS lock is keyed by `persistDir`, with the existing TTL, owner and PID checks |

## Proofs

`scripts/prove-state-root-survival.ts` — 44 assertions, PASS:

- two working directories with one host project id resolve one key and one project root;
- the host id is the primary source; the `global` sentinel falls back to the canonical path;
- a host without project data falls back to the working directory, stably, and a symlink shares the real path key;
- the ledger is written under the project root and the workspace keeps no project ledger;
- a different project id resolves a different root and never reads the shared ledger;
- `TAWASSUL_STATE_ROOT=legacy` reads and writes the workspace ledger and never touches the project root;
- the worktree guard accepts the project root and still blocks a stray directory.

`scripts/prove-state-root-rollback.ts` — 74 assertions, PASS:

- a direct migration copies the ledger byte-for-byte, backs it up, and an idempotent second run copies nothing and rewrites nothing;
- the top-level `goals/` tree is scanned under a `state:` key, copied byte-for-byte, and backed up under `state/`;
- the host boot migrates the ledger, the top-level goal ledger and every non-ledger artifact, the migrated record ledger keeps a valid HMAC signature, and the goal tool lists the migrated goal in project scope;
- a mid-window change to an untouched artifact refreshes it, in `.opencode/` and at the top level; a mid-window change to either ledger conflicts, the project copy wins, the legacy bytes are archived, and the journal records `winner: project`;
- the conflict settles: the next boot appends nothing, for the record ledger and the goal ledger;
- the manifest version, per-file digest and union digest verify, including `state:goals/goals.jsonl`;
- rollback reads the legacy record and leaves the project root and goal digests unchanged;
- a two-sided change never admits the losing legacy record or the losing legacy goal into the project ledger.

Measured duration in this environment: survival 7.1 s, rollback 12.3 s. Both were added to `gate-manifest.json` and `proof-shards.json`.

## Gap found after the first live boot

The first live host boot after the migration ran with the new project root, and the goal and handoff tools reported empty ledgers. The cause was a scope gap in the migration: `goals/`, `timeline/`, `mission-board/`, `sagas/`, `handoff-ledger.jsonl`, `checkpoints.json` and `metrics.json` live at the workspace root, not under `.opencode/`, so the first migration never copied them. The legacy data was intact in the workspace.

The fix extends `collectEntries` to scan both legacy locations. `.opencode/` files keep their old index keys, and top-level stores use a `state:<relative path>` key, so the two key spaces never collide. A legacy artifact discovered after the first run is backed up before its first copy. `prove-state-root-rollback.ts` now seeds a top-level `goals/goals.jsonl`, asserts the migration, the backup layout, the project-scope load through the goal tool, the refresh path, the conflict archive and the settled boot. The proof grew from 49 to 74 assertions.

## Gates

| Command | Result |
| --- | --- |
| `npm run gate:fast` | PASS, 10 steps, 15,925 ms (post-fix run) |
| `npm run gate:proofs` | PASS, 147 steps, 305,699 ms (post-fix run) |
| `npm run build` | PASS, `dist/index.js` and `dist/global.js`; the live entry reloaded and the host init is newer than the entry (`host:refresh --verify-only`) |

The proof-count docs were regenerated: 150 proof files, 147 proof steps, 79.8 s per shard estimate, 319 s total estimate.

The live host migrated the top-level stores after the fix: `migration.json` now carries 14 `state:` keys, the project `handoff-ledger.jsonl`, `sagas/*.json` and `metrics.json` are byte-identical to the legacy files, `backup/2026-11-01T03-06-41-192Z/state/goals/goals.jsonl` preserves the pre-migration copy, and the project goal ledger is a superset of the legacy one (192 events against 188, all seven goal ids present). The goal tool lists G-001 through G-007 again, including G-005.

Two stores already existed in the project root when the fix ran: the timeline and the mission board. The conflict rule kept the project copies and archived the legacy ones. The mission board was empty in both, so nothing was lost. The legacy timeline (2,944 events, 411,303 bytes) is byte-identical in the workspace and in `backup/conflicts/2026-11-01T03-06-41-539Z/state/timeline/events.jsonl`; the live timeline shows the 11 post-migration events, and rollback reads the full legacy timeline. No merge is implemented, by design.

## Semantics recorded

- Configuration never moves. The project root carries persistence only.
- The plan's dual-read window is implemented as a boot-time sync because the ledger loads once at boot; a per-read fallback cannot surface a change to an already-loaded ledger.
- The project ledger is never replaced by a legacy ledger once it has post-migration writes. Legacy changes are archived as conflicts, not merged; rollback is explicit.
- Legacy files are never deleted, moved or rewritten by the migration.
- HMAC continuity is proven by a signature produced before migration that verifies after it; the key file does not move.

## Limits

- No merge: a mid-window legacy ledger write is preserved but not merged into the project ledger.
- No automatic promotion of a path-keyed root when a host id appears later; adoption is manual.
- The migration window closes after two minor releases or 30 days, whichever is later, with the exit criteria in `docs/STATE-ROOT-DESIGN.md` section 4.10.
- The id collision branch is an audit record, not a fail-closed guard; the host id is the authoritative source.
