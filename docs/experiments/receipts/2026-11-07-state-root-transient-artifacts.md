# State-root migration: never journal transient artifacts

- Date: 2026-11-07 (UTC)
- Verdict: **fixed and proven.** A timing-dependent failure in
  `scripts/prove-state-root-rollback.ts` (`a settled conflict appends nothing on the next boot`) was
  traced to atomic-write backups being treated as legacy state artifacts. The migration now skips
  them, and the proof seeds one of each transient form before the settled boot.
- Base revision: `5e29a79` (pre-existing; not introduced by the P2 usage ledger work).
- Runtime: Bun 1.3.14 on Linux x64; every run uses a fresh `mkdtemp` workspace.
- Proof: `scripts/prove-state-root-rollback.ts`, 119 → 125 assertions, gate step `state-root-rollback`.
- Gate: `npm run verify` passed (`GATE PASS: fast (16 step(s), 18347ms)` plus the build).

## Symptom

`npm run ci` failed in shard 4:

```
| state-root-rollback | FAIL | 32792 ms |
PROOF FAIL: a settled conflict appends nothing on the next boot
```

The same proof passed standalone. It reproduced on two consecutive `nice -n 10` runs of the
unmodified proof (2/2), and it also reproduced at `5e29a79` in a clean worktree with none of the
uncommitted D12 or P2 changes, so it is a pre-existing scheduling race, not a ledger regression.

## Diagnosis

A temporary debug copy of the proof printed the appended journal line:

```json
{"at":"2026-11-07T02:28:07.836Z","action":"migrate","path":"state:timeline/timeline-meta.json.bak.1794018472517.da5ca9d7610f","sha256":"..."}
```

`src/utils/atomic.ts` writes its rotated copy as
`${filePath}.bak.${Date.now()}.${randomBytes(6).toString("hex")}` in the same directory as the
target. `src/infra/disk-utils.ts` writes `.<pid>-<hex12>.tmp`, and
`src/services/lifecycle-controller.ts` quarantines stale temp files as `.bak.orphan-<ts>`.

`prepareProjectState` collected **every file** under the legacy state tree, so a backup left by a
debounced timeline persist from an earlier legacy-mode boot was treated as a new legacy artifact
and migrated on the next boot, appending a `migrate` journal row. Under lighter scheduling the
write landed outside the proof window and the assertion passed; under `--nice 10` it landed inside.

## Change

| File | Change |
| --- | --- |
| `src/utils/project-state-migration.ts` | `TRANSIENT_ARTIFACT` pattern plus `isTransientArtifact`, applied in `listFiles` so atomic backups, temp files, and orphan quarantines are never migrated, journalled, or indexed |

The pattern is anchored to the exact shapes the writers produce:

- `.bak.<epoch-ms>.<12 hex>` (atomic rotation)
- `.bak.orphan-<epoch-ms>` (lifecycle quarantine)
- `.<pid>.tmp` (migration's own staging file)
- `.<pid>-<12 hex>.tmp` (disk-utils staging file)

StateManager's user-visible rotation names (`foo.json.bak.0`, `.bak.1`, ...) do not match, so they
keep migrating as before.

## Proof delta

Before the settled boot the proof now writes three transients into the legacy `timeline/` tree:
one atomic backup, one staged temp file, and one orphan backup. After the settled boot it asserts:

1. the journal did not grow (`a settled conflict appends nothing on the next boot`),
2. each transient still exists in the workspace (the boot does not delete it),
3. none of the three was copied into the project root.

That makes the race deterministic: without the filter the settled boot migrates all three and fails
the journal assertion even on a fast machine.

## Results

| Run | Result |
| --- | --- |
| `bun scripts/prove-state-root-rollback.ts` | PASS, 125 assertions |
| `nice -n 10 bun scripts/prove-state-root-rollback.ts` (before the fix) | FAIL 2/2 |
| `nice -n 10 bun scripts/prove-state-root-rollback.ts` (after the fix) | PASS 2/2 |
| `npm run verify` | PASS (16-step fast gate plus build) |

## Limits

The fix filters artifacts at the migration boundary. It does not stop the late debounced timeline
persist that creates a workspace backup after the plugin switched to project mode; that write is
still discarded by the next boot instead of being migrated. A follow-up could route late persists
through the active state root, but no data loss or journal growth remains.

Rollback is the single `listFiles` predicate plus the six proof assertions.
