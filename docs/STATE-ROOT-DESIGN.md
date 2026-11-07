# State-root naming key — design (approved and implemented)

- Status: approved by the owner on 2026-11-01 and implemented in the same wave.
- Date: 2026-11-01
- Scope: Wave 3 items 1 and 2 of `docs/FUTURE-WORK-PLAN.md`, decision gate E3 (section 11).
- Related: `docs/FUTURE-WORK-PLAN.md` section 11 (E3), section 5 (verification matrix), section 13.3.
- Evidence: `scripts/prove-state-root-survival.ts` (44 assertions), `scripts/prove-state-root-rollback.ts` (74 assertions).

## 1. Why this document exists

The plan requires the state-root naming key to be designed and approved before code, and it fixes what the design must cover: the project-scope key, a path fallback when the key is absent, a migration window, single-writer arbitration, a pre-migration backup, mid-window write handling, a rollback path, HMAC key continuity, and the window itself.

The first draft proposed deriving the key from a normalized git remote read locally with `git config`. That model was verified against a live host first and rejected: the host already computes and exposes a stable project identity, so a self-computed remote hash would be a second, weaker source of truth that can disagree with the host. This document records the verified model, the rejected alternatives, and the proof plan.

## 2. Verified host facts

The supported host (OpenCode 2.2.5) calls `setup(ctx)`, and only `setup(ctx)`. The plugin receives the host location through the context that the host hands to `createV2Setup` and `buildPluginInput`:

```
ctx.location = {
  directory: string,
  workspaceID?: string,
  project?: { id?: string, directory?: string, canonical?: string },
}
```

A live probe (2026-11-01, isolated clones under `/tmp/opencode/w3-id`) measured:

| Case | Observation |
| --- | --- |
| Main checkout | `project.id` = `ba50b1a3…`, canonical = the checkout path |
| `git worktree` of the same repo | same `project.id`, `canonical` = the main checkout |
| Separate clone of the same remote | same `project.id` |
| Directory with no git repository | a distinct path-derived id |
| Symlinked directory | resolves to the real repository, same `project.id` |

Consequences that drive the design:

1. The host project id already survives two working directories, a worktree, a separate clone, and a symlink, which is exactly the durability property E3 exists to earn.
2. The host reports the same id for two clones, so the repository is the unit of identity, not the clone.
3. `project.canonical` is the main checkout of a worktree, so a path fallback keyed on `canonical` also collapses worktrees of one clone.
4. Remote normalization, credential stripping, and remote-change detection are all unnecessary: the host owns that logic and the plugin never reads git.

## 3. Requirements carried from the plan

1. The project-scope key is the host project identity.
2. A canonical-path fallback exists when the host reports no project id.
3. A window lets the old workspace root and the new project root coexist during migration.
4. Single-writer arbitration covers project-scope writes.
5. A pre-migration backup exists and is verifiable.
6. Mid-window writes are handled without loss.
7. A rollback path exists and is proven.
8. HMAC key continuity is preserved across the migration.
9. The migration window has a defined opening, length, and exit criteria.
10. The state-schema guard stays a data-safety check; capabilities and host range are already withdrawn.

## 4. Design

### 4.1 Identity key

Identity is resolved from the host location only, never from git:

1. `location.project.id` when it is usable: non-empty after trim, not the `global` sentinel, at most 256 characters.
2. `location.project.canonical` when no usable id exists.
3. `location.project.directory` when no usable id or canonical exists.
4. The working directory when the host reports neither.

The key is the sanitized identity value:

- A value that is already filesystem-safe (lowercase `[a-z0-9]` then `[a-z0-9._-]`, at most 64 characters) is lowercased and used directly; the host project id is a lowercase hex string, so this is the normal path.
- Any other value is hashed: `h-` plus the first 16 hex characters of `sha256(value)`.
- The path fallback is `path-` plus the first 16 hex characters of `sha256(realpath)`; `realpath` resolves symlinks natively.

The project root records an `identity.json` audit file with the key, the identity source (`project-id`, `canonical`, `directory`, or `cwd`), the host project id when present, the working directory and the canonical path. The file is rewritten only when one of those fields changes. The host id is authoritative; a key derived from an unsafe value is a deterministic hash, and a mismatch is visible in `identity.json` rather than silently merged.

### 4.2 Root layout

| Root | Path | Purpose |
| --- | --- | --- |
| Project root (`persistDir`) | `v2DataRoot()/projects/<key>/` | every project-scope artifact after migration |
| Project state namespace | `<project root>/.opencode/` | the same relative layout the workspace used |
| Project top-level state | `<project root>/goals/`, `timeline/`, `mission-board/`, `sagas/`, `handoff-ledger.jsonl`, `checkpoints.json`, `metrics.json` | the stores that always lived at the workspace root |
| Project backup | `<project root>/backup/<ISO8601>/` | pre-migration copy plus `manifest.json` |
| Conflict archive | `<project root>/backup/conflicts/<ISO8601>/.opencode/` and `.../state/` | losing legacy copies |
| Migration journal | `<project root>/migration.jsonl` | one line per backup, migrate, refresh and conflict |
| Migration index | `<project root>/migration.json` | per-file digests recorded at the last sync |
| Global config root | `~/.config/opencode/` | unchanged; global roster and `agent/` |
| Global runtime root | `~/.config/opencode/tawassul-v2-state` | unchanged for global scope |

`v2DataRoot()` is `$XDG_DATA_HOME/tawassul-v2` when `XDG_DATA_HOME` is set and absolute, otherwise `~/.local/share/tawassul-v2`. When no home is resolvable, `v2DataRoot()` is empty and no project root is written; the boot falls back to the workspace root, unchanged.

The project root and its directories are created `0700`; files are written `0600`.

### 4.3 Config split — configuration never moves

This is a hard rule. The project root takes persistence only.

| Stays in the workspace (`stateDir`) | Moves to the project root (`persistDir`) |
| --- | --- |
| `opencode.json(c)` at the project root | `tawassul-state.json` |
| `.opencode/tawassul.json(c)` roster | `tawassul-sessions/` |
| `.opencode/agents/` | `tool-run-log.json`, `activity-metrics.json` |
| `.opencode/deleted-agents.json` | `handoff` ledger, `timeline`, goals, mission board |
| `.opencode/tawassul-pins.json` | `collective-memory-*`, `feature-index.json` |
| `.opencode/tawa-prefs.json` | `checkpoint`, `code-state` index, `cost-transparency.json` |
| `.opencode/skills/`, `.opencode/plugin(s)/` | `predictive-router.json`, `vector-index.json` |

The global scope is unchanged: `tawassul.json(c)` and `agent/` stay in `globalConfigDir()`, which is `~/.config/opencode` by default. A globally installed copy running inside a project still keyed its persistence by the host project identity, so two projects on one machine never share a ledger.

The implementation keeps two context fields: `stateDir` is the workspace and feeds every config, agent, skill and roster path unchanged; `persistDir` is the project root and feeds every state and store path.

### 4.4 Resolver precedence

Resolution runs once at boot in `buildPluginInput`:

1. `TAWASSUL_STATE_ROOT=legacy` returns no project root. `stateDir` and `persistDir` are both the workspace, and no migration runs (rollback).
2. `TAWASSUL_STATE_DIR` (used by isolated tests and proof boots) returns no project root, keeps `stateDir` and `persistDir` at that override, and runs no migration. Every existing proof is unaffected.
3. Otherwise the project root is used when it can be derived.
4. When `v2DataRoot()` is empty, no project root is used and the workspace root is kept.

`TAWASSUL_STATE_ROOT=project` is accepted as an explicit request for the project root; `auto` is the default.

### 4.5 Migration window — sync on boot

The plan asked for a dual-read window. The verified implementation is a boot-time sync instead, for one measured reason: the ledger is loaded once into memory at boot, so a per-read fallback cannot surface a legacy change to an already-loaded ledger. A boot-time sync is the truthful equivalent, and it is observable in `migration.jsonl`.

At every boot that resolves a project root, and only then, `prepareProjectState` runs before the context is constructed:

- It records `identity.json`.
- It scans both legacy locations: every file under `.opencode/` (index key is the path relative to `.opencode/`) and the top-level stores that were never inside `.opencode/` — `goals/`, `timeline/`, `mission-board/`, `sagas/`, `handoff-ledger.jsonl`, `checkpoints.json` and `metrics.json` (index key is `state:<relative path>`). The two key spaces never collide.
- It ignores transient writer artifacts instead of treating them as legacy state: atomic rotations (`<file>.bak.<epoch-ms>.<12 hex>`), quarantines (`<file>.bak.orphan-<epoch-ms>`), and staging files (`<file>.<pid>.tmp`, `<file>.<pid>-<12 hex>.tmp`). A debounced write that lands in the legacy tree after the mode switch therefore cannot add a `migrate` line on the next boot.
- On the first run with legacy artifacts it copies every legacy artifact that has no project copy, byte-for-byte, into the project namespace, after writing a backup and manifest. A legacy artifact discovered on a later boot (for example after an upgrade adds a top-level store) is also backed up before its first copy.
- On every later run it compares the legacy digest against the recorded digest, per file:
  - Legacy unchanged: nothing happens.
  - Legacy changed and the project copy is still byte-identical to what was copied: the project copy is refreshed and a `refresh` line is recorded. This is the normal outcome for auxiliary artifacts the running plugin does not rewrite.
  - Legacy changed and the project copy has its own writes: this is a conflict. The project copy wins because it is the single writer, the legacy copy is preserved under `backup/conflicts/`, and a `conflict` line records the loser. The recorded digest advances so the conflict settles and does not re-fire.
- Legacy files are never deleted, moved, or rewritten by the migration.

The ledger is deliberately never replaced by a legacy copy once the project ledger has its own writes: re-copying would drop post-migration records. Mid-window legacy ledger writes are preserved, not merged; the journal and the conflict archive make that explicit rather than silent.

### 4.6 Single-writer arbitration

No second lock was introduced. Project-scope writes reuse the existing `StateManager` filesystem lock, which is now keyed by `persistDir`: the lock name is `tawassul-state-lock-<sha1(persistDir)>` and the lock lives under `tmpdir/.tawassul-v2-file-locks-<uid>/`. The lock keeps its existing TTL, owner id and process-liveness checks. Every state write goes through `atomicWriteFile`, and every migration copy goes through a pid-suffixed temp file plus `rename`, so a concurrent boot either copies identical bytes or archives a conflict; both converge.

### 4.7 Pre-migration backup

Before the first copy, every legacy artifact that is about to be migrated is copied byte-for-byte into `backup/<ISO8601>/` with the relative path preserved: `.opencode/` files under `.opencode/`, and top-level state stores under `state/`. `manifest.json` records key, bytes, mode and `sha256` per file plus a union digest. The migration verifies each copied file against its source and aborts on any mismatch, and it refuses to reuse an existing backup directory. A file already present in the project root is not backed up again; it is handled by the conflict rule.

### 4.8 Rollback path

`TAWASSUL_STATE_ROOT=legacy` resolves no project root, so `stateDir` and `persistDir` are the workspace again and every read and write targets the legacy tree. The project root is not touched, and no migration runs. Rollback needs no data copy because the migration never mutated the legacy tree. It is proven by a boot that reads the pre-migration record, writes a rollback record to the legacy ledger, and asserts the project root digest is unchanged.

### 4.9 HMAC key continuity

The key file location does not change, no key is copied into a project root, and the migration copies signed bytes without re-signing them. A signature produced before the migration verifies after it, and the HMAC payload is unchanged. A per-project key was rejected: it would break cross-project record verification and invalidate the legacy import.

### 4.10 Migration window policy

- Opens at the release that ships the resolver.
- Closes after two minor releases or 30 days, whichever is later.
- Exit criteria: every legacy artifact has a project copy, `migration.jsonl` carries no `conflict` or `refresh` line in the last 14 days, the backup manifest verifies, and the survival and rollback proofs pass on the shipped build.
- On exit the legacy sync path is removed; the legacy tree and the backup stay untouched for one further release.
- Rollback stays available for as long as the legacy tree exists.

### 4.11 Worktree guard interplay

`getWorktreeBlockReason` stopped a state dir outside `TAWASSUL_WORKTREE_ROOT` from mutating. It now accepts exactly two scopes: the worktree root and the resolved project root. Anything else stays blocked, so a misconfigured boot still cannot write outside its isolated root. Isolated tests keep working because they set `TAWASSUL_WORKTREE_ROOT` and `TAWASSUL_STATE_DIR` together.

### 4.12 State-schema guard

The existing schema version in `tawassul-state.json` stays the data-safety check. A project root that holds a newer schema than the running build is read-only, and the boot reports the mismatch rather than rewriting it. The pre-migration backup doubles as the rollback artifact for a schema regression.

## 5. Migration exclusion set

The migration copies project state, not configuration. It skips top-level `opencode.json`, `opencode.jsonc`, `tawassul.json`, `tawassul.jsonc`, `agents/`, `skills/`, `commands/`, `plugin/`, `plugins/`, `deleted-agents.json`, `tawassul-pins.json`, `tawa-prefs.json`, `node_modules/`, `package.json`, `package-lock.json`, `bun.lock`, `bun.lockb`, `bunfig.toml`, `.git/` and `.gitignore`. Nested files inside a copied state directory are included, which is why the same relative layout is preserved.

## 6. Rejected alternatives

| Alternative | Why rejected |
| --- | --- |
| Normalized git remote read locally with `git config` | The host already exposes a project id that survives worktrees, clones and symlinks; a second derivation can disagree with the host and needs credential and remote-change handling the host does not need. |
| Any normalization of the remote (scp form, ports, `.git`, userinfo) | Unnecessary once the host id is the source; it was the only reason credentials could enter the key. |
| Key by the `.git` common directory | Loses all state on a fresh clone and hides user data inside a directory tools prune. |
| Key by the git root path | Closes worktrees of one clone only; two clones of one remote still diverge, which is the defect under repair. |
| Keep state in the workspace and require a shared checkout | Pushes a workflow constraint onto users and still fails for two clones. |
| Global root for every project | Collides across repositories and destroys project isolation. |
| Per-project HMAC key | Breaks cross-project record verification and the legacy import. |
| Automatic promotion of a path key when a host id appears | Two keys can then own the same artifacts with no audit trail; adoption stays manual. |
| Per-read dual-read fallback | The ledger is loaded once at boot; a read fallback cannot surface a change to an already-loaded ledger. |

## 7. E3 proof plan (implemented)

Both proofs boot the real plugin through `src/v2/client-shim.ts` and `src/bootstrap/plugin-init.ts`, in isolation: a temp workspace, separated `XDG_*` roots, a separate `OPENCODE_DB`, a separate HMAC key directory and no live host.

`scripts/prove-state-root-survival.ts` (44 assertions):

| Case | Assertion |
| --- | --- |
| Same project id, two directories | one key, one project root |
| Identity source | the host project id is the primary source |
| `global` sentinel | not a project id; falls back to canonical |
| No project data | falls back to the working directory and is stable |
| Symlink | resolves to the real path and shares the fallback key |
| Unsafe id | hashed, never used raw, fixed length |
| Root layout | `v2DataRoot()/projects/<key>`, under the isolated `XDG_DATA_HOME` |
| Two boots, one root | both resolve the same `persistDir`, `stateDir` stays the workspace |
| Shared ledger | the second directory reads the first ledger; the workspace keeps no ledger |
| Different project id | a different root and no cross-read |
| Rollback | `TAWASSUL_STATE_ROOT=legacy` keeps the workspace root and never touches the project root |
| Worktree guard | the project root is accepted; a stray directory stays blocked |

`scripts/prove-state-root-rollback.ts` (74 assertions):

| Case | Assertion |
| --- | --- |
| Legacy seed | the legacy boot writes and signs the workspace ledger and the top-level goal ledger |
| Direct migration | byte-identical copy, backup copy, idempotent second run |
| Top-level stores | `goals/` is scanned under a `state:` key, copied byte-identical, backed up under `state/` |
| Host migration | the project root is resolved, the legacy record survives and the goal tool lists the migrated goal |
| Non-ledger artifact | copied byte-identical, refreshed when the legacy copy changes, in `.opencode/` and at the top level |
| Ledger conflict | the project copy wins for the record ledger and the goal ledger, the legacy bytes are archived, the journal records `winner: project` |
| Settlement | the conflict boots once and appends nothing on the next boot |
| Backup | manifest version, per-file digest, union digest and immutable copy |
| Journal | `backup`, `migrate`, `refresh` and `conflict` lines |
| Rollback | the legacy record is readable, the project root and goal digests are unchanged |
| HMAC continuity | the migrated ledger keeps a valid signature |
| Two-sided change | the losing legacy record and the losing legacy goal never enter the project ledger |

The survival proof is the first and second rows together: two working directories against the same host project identity produce one ledger in project scope, and a different identity never reads it.

## 8. Decisions recorded

1. The project-scope key is the sanitized host project identity, with a canonical-path fallback.
2. The root location is `v2DataRoot()/projects/<key>/`; the global and user-level roots are unchanged.
3. Configuration never moves: `stateDir` stays the workspace, `persistDir` carries persistence only.
4. The dual-read window is implemented as a boot-time sync with a journal, because the ledger loads once.
5. Mid-window legacy ledger writes are archived as conflicts, not merged; rollback is explicit.
6. The migration window is two minor releases or 30 days, whichever is later, with the exit criteria in section 4.10.
7. The worktree guard accepts exactly the worktree root and the resolved project root.
8. The migration scans two legacy locations: `.opencode/` under its old relative keys, and the top-level state stores (`goals/`, `timeline/`, `mission-board/`, `sagas/`, `handoff-ledger.jsonl`, `checkpoints.json`, `metrics.json`) under `state:` keys. A legacy artifact discovered after the first run is backed up before its first copy.
