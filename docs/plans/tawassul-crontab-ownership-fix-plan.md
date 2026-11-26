# Tawassul V2 — Crontab Ownership Fix Plan

Status: implemented and verified in the working tree on 2026-11-26; no commit
Date: 2026-11-26
Scope: the two `prove-global-install` uninstall failures (A and B) under an
unreadable or unavailable crontab, without weakening the fail-closed refusal

## 1. Goal

Make these two uninstalls succeed without external intervention when the lane
provably never wrote a cron line, and keep refusing when a line may exist:

- A: `install.sh --db-maintenance --uninstall` on a manual/fresh lane while
  `crontab -l` cannot be read. The proof expects exit 0, `dbDir` removed, and
  the plugin bundle and `VERSION` kept (`scripts/prove-global-install.ts:277-281`).
- B: `install-global.ts --uninstall` on a fresh `off` lane while `crontab -l`
  cannot be read. The proof expects `TARGET`, `MARKER`, and `DB_DIR` gone
  (`scripts/prove-global-install.ts:2233-2240`).

The refusal must remain for any lane whose marker says, or cannot disprove,
that it owns a cron line. `--force` must not bypass that gate. No orphan cron
line may be left by a normal successful path.

## 2. Dependency on the memory-retention plan

The memory-retention plan is
[`tawassul-memory-retention-fix-plan.md`](tawassul-memory-retention-fix-plan.md).

The dependency is mutual and must be stated in both directions:

- This plan assumes the memory-retention implementation is present in the
  working tree: `StateManager.detach()`/`releaseLock()`, the `ToolSlot` path,
  `prove-state-manager-release.ts`, `prove-v2-tool-retention.ts`, and the proof
  catalog at 195 files / 192 steps. It does not modify that code or those
  proofs.
- The memory plan cannot claim a fully green gate while `prove-global-install`
  is red. The red step is the same `global-install` proof this plan repairs, so
  the memory plan's acceptance record depends on this plan landing.
- The memory plan's §13 currently calls the A/B failure "environmental". That
  wording is incomplete: the unreadable spool exposes a real product gap, a
  lane that never wrote cron cannot be uninstalled. When this plan is
  implemented, §13 must point here and state that the A/B refusal path is
  tracked by this plan, while the live three-reload heap slope remains
  unmeasured and unclaimed.
- The proof count stays 195 files / 192 steps. No new proof file is added and
  `scripts/prove-proof-catalog.ts` is not edited.

## 3. State model and trust rules

One optional marker field:

```json
"cron": "none" | "owned"
```

- `none`: positive evidence that this lane wrote no cron line. It is written
  only after a successful verification read found no owned line, or for a
  provably fresh lane where no cron write was attempted.
- `owned`: a cron write may have happened. It does not claim that a line
  exists.
- Missing field or any value other than `none`/`owned`: `unknown` (old
  marker, corrupt marker, or a foreign marker).

Trust rules:

- A `cron` field is trusted only when the marker belongs to this lane:
  `own_marker` for `install.sh` (package and lane match), and
  `marker.package === "tawassul-v2"` for `install-global`. A foreign marker's
  field is ignored and treated as `unknown`, including under `--force`.
- On Windows/non-POSIX, `install-global` writes `none` for a new marker and
  skips the crontab gate; there is no POSIX spool to inspect. Old markers are
  not blocked by a crontab that cannot exist on that platform.
- `none` is not blind trust. If the crontab is readable and contains an owned
  line, the line is removed before any file is deleted. If that rewrite fails,
  the uninstall stops before deleting files.
- `owned` and `unknown` never proceed on an unreadable or unavailable
  crontab. They proceed only after a successful read proves no owned line, or
  after the owned line was removed.

| Marker | Readable crontab | Unreadable or absent crontab |
| --- | --- | --- |
| `none` (ours) | Inspect; remove an owned line; failure stops before files | Proceed, best-effort reporting only |
| `owned` | Inspect; remove the owned line; no line is fine; failure stops before files | Refuse; keep every file and the line |
| `unknown` | Same as `owned`; a readable scan can correct the field | Refuse; keep every file and the line |

## 4. Write rules for `install.sh`

The current order is snapshot, staging, `register_db_timer`, marker write
(`install.sh:790-880`). The new order is:

1. Read `PREV_CRON` from the marker only when `own_marker` is true; otherwise
   leave it empty (unknown).
2. `FRESH_LANE=1` only when the marker and `DB_DIR` did not exist before
   staging. `snapshot_maintenance` already records `HAD_DB_DIR`; capture the
   marker existence before staging.
3. `MAY_WRITE_CRON=1` when the normalized opt-out is not
   `off`/`0`/`false`/`disabled` and the normalized register mode is `cron` or
   `auto`. This is the pre-call flag for the write-ahead; it may be
   conservative for a scratch prefix or a systemd success.
4. After `snapshot_maintenance` and staging, and before `register_db_timer`,
   when `MAY_WRITE_CRON=1`, write the full marker with the previous trigger
   (or `manual` for a fresh lane) and `"cron": "owned"`. This is the
   write-ahead. A write failure rolls back and fails the install.
5. Add a global `CRON_WRITE_ATTEMPTED=0`, reset before `register_db_timer`. In
   the cron branch of `register_db_timer`, set it to 1 immediately before the
   exact-line check and the `crontab -` rewrite. This is the accurate
   post-call flag; it stays 1 when a write fails, which is the conservative
   result.
6. After `register_db_timer` returns `TRIGGER_MODE`, resolve with the
   pre-install `PREV_CRON`, `FRESH_LANE`, and `CRON_WRITE_ATTEMPTED`:

```text
resolve_cron_state(previous, fresh, attempted):
  if cron_read succeeds:
    if any tagged line is ours or unproven: return owned
    return none
  if attempted: return owned
  if previous == none: return none
  if fresh: return none
  return owned
```

A readable scan writes `none` only when every tagged line is a known foreign
owner. An unproven tagged line is `owned`, not `none`, so a later unreadable
uninstall refuses instead of leaving it.

7. Write the final marker with `TRIGGER_MODE` and the resolved field. A write
   failure rolls back and fails the install.
8. `snapshot_maintenance` and `rollback_maintenance` keep their current
   responsibilities. The marker snapshot restores the old field. If the
   crontab snapshot was readable but the rollback rewrite fails, the old
   marker may say `none` while a line remains; this double-failure residual is
   recorded in §13, not hidden.

`register_db_timer` keeps its ownership checks, foreign-schedule refusal,
`--force` takeover, and the `off`/`systemd`/`cron`/`auto` branches. The only
production addition inside it is the `CRON_WRITE_ATTEMPTED=1` assignment.

## 5. Write rules for `scripts/install-global.ts`

- `Marker` (`:51-65`) gains `cron?: "none" | "owned"`. `writeMarker`
  (`:1074-1102`) gains a final `cron` parameter and writes it.
- `readMarker` and `upToDate` are unchanged. An old marker stays `unknown`; a
  no-op `upToDate` install does not force a migration.
- Normal lane: `freshLane = !existsSync(MARKER_FILE) && !existsSync(DB_DIR)`
  before any directory is created. Maintenance lane: `freshLane =
  !existsSync(MARKER_FILE)`, because `DB_DIR` belongs to `install.sh` and
  `install-global` never writes cron there.
- `mayWriteCron = posixDb && !maintenance && (triggerPlan === "cron" ||
  triggerPlan === "auto")`. Write the full marker with the pre-install trigger
  (or `manual` for a fresh lane) and `"cron": "owned"` before
  `registerTriggers`. A write failure fails the install.
- `cronAttempted` starts false at the top of `registerTriggers`. `tryCron`
  sets it true before its read and rewrite, so a failed read still resolves
  conservatively. No other registration path writes a new cron line.
- After `registerTriggers` returns `trigger`, resolve with the pre-install
  `existing` marker (not the write-ahead marker), `freshLane`, and
  `cronAttempted`:

```text
resolveCronState(previous, fresh, attempted):
  if readCrontab succeeds:
    if an install-global-owned or unproven tagged line exists: return owned
    return none
  if attempted: return owned
  if previous?.cron == "none": return none
  if fresh: return none
  return owned
```

The owned predicate is `owner === TRIGGER_OWNER`, or an unstamped line with
`markerProvesDb(previous) && !maintenanceLane()` and the expected shape. An
unproven tagged line also forces `owned`; only a scan whose tagged lines are
all known foreign owners yields `none`.
- `maintenance`: no write-ahead, `cronAttempted=false`, same resolver with the
  marker-only `freshLane`. A previous `owned` record is preserved until a
  readable scan proves the line is gone.
- Windows/non-POSIX: `"none"`; no crontab read or write.
- `removeOwnedCron` and `removeOwnedSchedule` treat `absent` (`ENOENT`) as
  unproven, not as proof of removal. They log honestly and return without
  claiming the line was removed.

## 6. Uninstall gates

### 6.1 `install.sh` `uninstall_maintenance`

1. Read `CRON_FIELD` with `marker_cron` only when `own_marker`; otherwise
   treat it as unknown.
2. If `CRON_FIELD=none`, attempt a best-effort `cron_read` when `crontab`
   exists. A read failure does not block: clear `CRON_OLD`, skip the scan, and
   continue to units and files. A successful read removes an owned line; a
   rewrite failure stops before any file is deleted.
3. If `CRON_FIELD` is `owned` or unknown, a successful `cron_read` is
   required. No `crontab` command, `ENOENT`, or a failed read means:
   `fail "crontab could not be read; the maintenance lane was not removed"`.
4. With a readable crontab, classify **before any unit or file deletion**:
   an owned line is dropped; a known foreign owner is reported and left; a
   tagged line with no owner and no proof of ownership sets
   `left_cron_unproven=1`. If that flag is set, fail before removing units or
   files.
5. `--force` does not bypass steps 2-4. `--dry-run` writes and deletes
   nothing; when the field is not `none` and the crontab cannot be read, it
   prints that a real uninstall would refuse.

### 6.2 `install-global` `uninstallTriggers`

1. Read the marker first; compute `cron` only when
   `marker.package === PLUGIN_ID`, and the POSIX lane from
   `usesPosixDatabaseLane(installLane(process.platform))`.
2. Non-POSIX: skip the crontab gate entirely; keep the existing unit logic.
3. POSIX, `cron === "none"`: if the read fails, report that the marker proves
   no owned line was written and continue with `lines=[]`. If the read
   succeeds, inspect and remove an owned line; a rewrite failure fails before
   files.
4. POSIX, `owned` or unknown: a successful read is required. A failed read or
   `ENOENT` fails with `crontab could not be read; the uninstall was not
   performed`. `--force` does not bypass it.
5. A successful read with an unproven tagged line (no owner and no proof)
   fails before units or files. A known foreign owner is reported and left.
   An owned line is removed; a rewrite failure fails before files.
6. `--dry-run` reports the refusal for the non-`none` unreadable case and
   exits 0 without claiming removals.
7. The unproven-line classification and the gate run before the unit-removal
   block. The current function removes units first; a refusing case must not
   leave a partially removed schedule behind.

## 7. Absent, unreadable, and Windows

The distinction that must not be collapsed:

| Case | Detection | Meaning | Gate on POSIX |
| --- | --- | --- | --- |
| No user table, known message | `cron_read` returns 0 with `no crontab for`; `readCrontab` status 0 | Readable empty table | Read succeeds; `none` or `owned` may proceed |
| `crontab` binary absent | `command -v crontab` false; `spawnSync` `ENOENT` | Not proof of no line | `none` proceeds; `owned`/unknown refuses |
| `crontab` present, read fails | `cron_read` returns 1; `readCrontab` reason `unreadable` | Not proof of no line | `none` proceeds; `owned`/unknown refuses |
| Windows/non-POSIX lane | `usesPosixDatabaseLane` false | No POSIX spool | Gate skipped; new markers are `none` |

The known-message case is the only failure-free empty read. `ENOENT` is a
failure, never a green light for `owned`/unknown. This keeps the Windows
exception platform-scoped and does not turn it into a POSIX bypass.

## 8. File changes

| File | Change |
| --- | --- |
| `install.sh` | `marker_cron`, `write_marker_file`, `resolve_cron_state`, `CRON_WRITE_ATTEMPTED`, write-ahead, uninstall gate, unproven-line refusal, honest absent handling, dry-run notice |
| `scripts/install-global.ts` | `Marker.cron`, `writeMarker(..., cron)`, `resolveCronState`, `cronAttempted`, write-ahead, uninstall gate, unproven-line refusal, honest absent handling, dry-run notice |
| `scripts/prove-global-install.ts` | `Marker.cron`, fixed `proofEnv` crontab shim, A/B unreadable cases, trap, `--force`, old marker, write failure, marker-versus-reality, proof-env isolation, foreign-marker trust |
| `docs/plans/tawassul-memory-retention-fix-plan.md` | One-line §13 correction: point the A/B failure here; keep the heap slope unclaims |
| `docs/plans/tawassul-crontab-ownership-fix-plan.md` | This plan |

No change to `scripts/prove-proof-catalog.ts` (195 files / 192 steps),
`scripts/proof-log-isolate.ts`, `scripts/prove-state-manager-release.ts`,
`scripts/prove-v2-tool-retention.ts`, or any `src/` memory-retention file.

## 9. Proof plan

### 9.1 A: `install.sh`

- Install the manual/fresh lane; assert the marker contains `"cron": "none"`.
- Run the uninstall with the unreadable shim; assert exit 0, `dbDir` gone,
  bundle and `VERSION` kept.
- Reinstall; parse the marker, set `cron=owned` while keeping
  `trigger=manual`; assert the unreadable uninstall refuses and keeps the
  marker and scripts. Restore `cron=none`; assert the readable uninstall
  succeeds.
- Add an unusable-crontab case (a shim that exists but exits nonzero even for
  `-l`) with `cron=owned`; assert refusal.
- Add a foreign-marker case with `cron=none` under `--force` and an unreadable
  crontab; assert refusal because the field is not ours.
- Fresh install with a readable crontab containing an unproven tagged line:
  the marker must be `owned`; the unreadable uninstall must refuse.

### 9.2 B: `install-global`

- Main install (`off`, fresh): assert `record.cron === "none"`; run the final
  uninstall with the unreadable shim; assert `TARGET`, `MARKER`, and `DB_DIR`
  gone and user files kept.
- Cron install: assert `record.cron === "owned"`; unreadable uninstall refuses
  (the existing `:1667-1688` behavior).
- Trap: install cron; reinstall manual with an unreadable crontab; assert
  `trigger=manual`, `cron=owned`, the line remains; unreadable uninstall
  refuses; readable uninstall removes the line and files.
- `--uninstall --force` with `owned` and an unreadable crontab: refuse.
- Old marker: delete the `cron` field from a cron lane; unreadable uninstall
  refuses; readable uninstall proceeds.
- Write failure: install cron; make the shim readable but refuse writes;
  uninstall fails, `TARGET` and the line remain; restore the shim; uninstall
  succeeds.
- Unproven tagged line: inject a tagged line with no owner and a foreign
  shape; uninstall fails before deleting `TARGET`.
- Marker-versus-reality: install `none`; inject an owned line into a dedicated
  lane shim, not the shared `proofEnv` shim; readable uninstall removes the
  line before files. With a write-failing shim, the uninstall fails and both
  `TARGET` and the line remain.
- Unproven-line resolution: a fresh install whose readable crontab holds an
  unproven tagged line records `owned`, and the unreadable uninstall refuses.
- Proof-environment isolation: assert `command -v crontab` under `proofEnv`
  resolves to the fixed shim, and that the shim refuses a write. No proof may
  reach the real crontab.
- Keep the existing install-global refusal tests at
  `scripts/prove-global-install.ts:1607-1628` and `:1667-1688` intact.

## 10. Execution stages

### Stage 0 — Freeze and baseline

1. Save `git status --porcelain` to `/tmp/opencode/tawassul-status-before.txt`.
2. Save the diffs of `install.sh` and `scripts/prove-global-install.ts` to
   `/tmp/opencode/tawassul-crontab-before.patch`.
3. Record the `crontab -l` exit status and the failure reason (for example,
   the first stderr line) for documentation only; do not store the table
   contents. Do not repair it and do not use it to change the proof.
4. No commit, no push, no touching the 228 pre-existing modified files.

### Stage 1 — Revert the unsafe edit

- Remove `marker_trigger` and the `manual|off` branch from `install.sh`.
- Remove the `trigger`-rewrite block from `prove-global-install.ts`; keep the
  `runUnreadableCron` shim and `proof-log-isolate`.
- Keep the `cron-shim` and the unreadable-shim helpers; they are proof
  infrastructure, not the unsafe gate.

### Stage 2 — Red baseline

- Add the fixed `proofEnv` crontab shim and the new A/B, trap, `--force`,
  old-marker, write-failure, marker-versus-reality, and isolation cases.
- Run `bun scripts/prove-global-install.ts` against HEAD production code.
- Expected and honest result: A fails at the maintenance-lane uninstall; the
  new `cron=none`/`owned` A assertions fail because the field does not exist;
  the new unreadable B case fails. The original B "uninstall removes the flat
  plugin file" assertion may pass once `proofEnv` is isolated from the real
  spool; that is a proof-environment fix, not a product fix. Record both
  facts separately.

### Stage 3 — Field, write-only

- Add the field, `write_marker_file`/`resolve_cron_state`,
  `resolveCronState`, `cronAttempted`, and the write-ahead. Do not add the
  uninstall gate yet.
- Assertions about the marker state pass; the unreadable A/B cases stay red.

### Stage 4 — Gate

- Add both uninstall gates, the fail-before-delete behavior, the unproven-line
  refusal, and the absent/unreadable strictness.
- Run `bun scripts/prove-global-install.ts`; expect green.
- Run `npm run gate:proofs:1`; expect 44/44.

### Stage 5 — Full gates, sequentially

`check:sh`, `check:rules`, `typecheck`, `gate:fast`, `gate:proofs:1`,
`gate:proofs:2`, `gate:proofs:3`, `gate:proofs:4`, `build`, `verify`. Run
them in that order, never in parallel (RULES.md: 1.5 GB cap).

### Stage 6 — Documentation and report

- Correct the memory plan's §13 wording and link this plan.
- Record gate results verbatim; separate inference from proof.
- No commit or push without an explicit order.

## 11. Final gates

- `npm run check:sh` — shell syntax.
- `npm run check:rules` — English-only and no-comments gate (666 files).
- `npm run typecheck` — strict TypeScript.
- `npm run gate:fast` — rules, config, facts, contract, parity, catalog.
- `npm run gate:proofs:1` — 44/44, including `global-install`.
- `npm run gate:proofs:2` — 49/49.
- `npm run gate:proofs:3` — 49/49.
- `npm run gate:proofs:4` — 50/50.
- `npm run build` — `dist/index.js` and `dist/global.js`.
- `npm run verify` — fast gate plus build.

Completion: 192/192 proof steps, shard 1 at 44/44, `verify` green, memory
proofs untouched, no new proof file.

## 12. Non-goals

- No `pending` state, no `reconcileCronOwnership`, no sidecar ownership file,
  no new state layer, no broad registration/rollback redesign.
- No change to `tryCron`'s rewrite policy, `remove_owned_schedule`'s ownership
  rules, `own_marker`, foreign-schedule takeover, or the systemd unit logic,
  beyond the honest `absent` handling and the `CRON_WRITE_ATTEMPTED` marker.
- No change to the memory-retention code, the two memory proofs, or
  `prove-proof-catalog.ts`.
- No Windows behavior change; the non-POSIX path skips the crontab gate.
- No `--force` bypass of the ownership gate; no reinstall requirement and no
  manual crontab repair as a condition for A/B.

## 13. Risks and residuals

1. **Information limit.** If every lane artifact (marker and `DB_DIR`) was
   deleted manually after a cron line was written, a later fresh install
   cannot prove that the old line is not its own. `none` records what this
   install wrote, not what the spool contains. This is the reason a marker
   field is the minimum record; a journal cannot solve it without a new
   lifecycle.
2. **External writer.** A concurrent crontab edit between the verification
   read and the delete/rewrite is undetectable. The read-before-write order
   and the refusal on doubt are the available evidence.
3. **Double-failure rollback.** If a cron write is attempted, the install
   fails, and the crontab becomes unwritable exactly during rollback, the old
   marker may be restored while the line remains. On a fresh lane the rollback
   can remove the lane directory and the write-ahead marker, leaving the line
   with no lane record. No journal-free design can guarantee removal across
   that double failure. It is a failure path, not a normal flow, and will be
   recorded in the implementation report.
4. **Old marker on a no-op install.** `upToDate` is intentionally unchanged,
   so an old `install-global` marker stays `unknown` until a real reinstall or
   a readable uninstall. On POSIX that means a conservative refusal while the
   crontab is unreadable. On Windows the gate is skipped.
5. **A line that appears after `none`.** If a tagged owned line is injected
   externally after a `none` install, an unreadable uninstall will not see it.
   A readable uninstall does see it and removes it. This is the same
   information limit as risk 1.
6. **Broken crontab implementation.** A binary that returns success on write
   but an empty read defeats the verification read. The proof uses a
   self-consistent shim; the design assumes the host crontab is not
   adversarial.
7. **Maintenance lane.** `install-global` records `none` only when it never
   owned a line; a previous `owned` record is preserved until a readable scan
   proves the line is gone. A fresh global install beside an `install.sh`
   maintenance lane is `none` because `install-global` wrote no line in that
   install.
8. **Dry-run cost.** The dry-run pre-check adds one read for the non-`none`
   case. It performs no writes and does not change the `none` dry-run output
   that the existing proof asserts.
9. **Proof shim write refusal.** The fixed `proofEnv` shim refuses writes. An
   accidental cron install in the isolated proof fails loudly instead of
   silently recording `none`; that is intentional.
10. **Memory heap slope.** The live three-reload heap slope remains
    unmeasured and unclaimed. This plan does not touch it.

## 14. Acceptance criteria

1. A: manual/fresh lane, `cron=none`, unreadable uninstall exits 0; `dbDir`
   gone; bundle and `VERSION` kept.
2. B: `off`/fresh lane, `cron=none`, unreadable uninstall exits 0; `TARGET`,
   `MARKER`, and `DB_DIR` gone; user files kept.
3. `owned` or unknown plus unreadable/absent on POSIX: refuse and keep
   everything; `--force` does not bypass.
4. Old marker with no field: unknown; unreadable refuses; readable uninstall
   scans, removes an owned line, and proceeds.
5. `none` plus a readable owned line: remove the line before deleting files;
   a rewrite failure stops before deleting files.
6. Trap: `manual` over a cron line under an unreadable crontab records
   `owned`; unreadable uninstall refuses; readable uninstall removes the line.
7. A tagged line with no proof of ownership fails before files; a known
   foreign owner is reported and left.
8. Windows/non-POSIX is unaffected and never blocks on a crontab.
9. The proof environment resolves `crontab` to the fixed shim and cannot fall
   back to the real spool; the shim refuses writes.
10. `npm run verify` is green; proof shards are 44/49/49/50; the catalog stays
    195 files / 192 steps; the memory proofs and code are untouched.

## 15. Review record

Reviewed against the tree at HEAD on 2026-11-26.

- Consistency: the `none`/`owned`/unknown table is identical in both scripts;
  the write rules and the uninstall gates use the same definitions; the
  write-ahead is always a full marker write; the final resolution uses the
  pre-install marker, not the write-ahead marker.
- Rule compliance: English only; no code comments; one field; no new engine,
  no sidecar, no new proof file; the memory-retention code and proofs are
  untouched (only the memory plan's §13 wording changes); the minimum
  production change is one field, one write-ahead, one resolver, and one gate
  per lane.
- Dependency: the memory plan path exists; §13 currently calls A/B
  environmental; this plan records the correction as a Stage 6 step; the
  195/192 count is preserved.
- Completeness: A, B, trap, `--force`, old marker, write failure, unproven
  line, marker-versus-reality, absent/unreadable, Windows, and proof isolation
  are covered.
- Verdict: safe to implement with the residuals in §13. No known defect path
  in a normal successful flow. The implementation must start with the red
  baseline; no green claim is made by this document.






## 16. Implementation record

Implemented on 2026-11-26 in the working tree; no commit or push was made.

Red baseline, executed with HEAD copies of the two production files beside the
new tests and the same unreadable-crontab shim:

- A: HEAD `install.sh` installed a fresh manual lane, then
  `--db-maintenance --uninstall` exited 2 with
  `install: crontab could not be read; the maintenance lane was not removed`.
- B: HEAD `scripts/install-global.ts` installed a fresh manual lane, then
  `--uninstall` exited 2 with
  `install-global: install-global: crontab could not be read; the uninstall was not performed`.
- The current files under the same scenarios exited 0 and removed the lane.
  The transcript is `/tmp/opencode/red-baseline.out`. The baseline was run
  after the code edits, against HEAD copies; it is a red/green differential,
  not a chronological pre-edit run.

Green results (final tree, after the isolated lab):

- `bun scripts/prove-global-install.ts`: 570 assertions, `PROOF PASS`.
- `npm run gate:fast` (final tree): `GATE PASS: fast (16 step(s), 21227ms)`.
- `npm run gate:proofs` (final tree): `GATE PASS: proofs (192 step(s),
  457405ms)`.
- `npm run gate:smoke` (final tree): `GATE PASS: smoke (6 step(s), 50240ms)`.
- `npm run verify` (final tree): `GATE PASS: fast (16 step(s), 20424ms)`;
  both builds complete (`dist/index.js`, `dist/global.js`).
- The proof catalog remains 195 files / 192 steps. The memory proofs
  `state-manager-release` (14 assertions) and `v2-tool-retention`
  (15 assertions) pass unchanged inside shards 3 and 4.

Isolated lab (2026-11-26, `/tmp/opencode/lab`, no real HOME or crontab
touched):

- `crontab-lab.sh` builds a synthetic release and runs 75 scenarios (A1-A33
  with A29b, B1-B36 with B28b) against `install.sh` and
  `scripts/install-global.ts` with a controllable crontab shim, isolated
  HOME/XDG/global dir/DB, and per-case state snapshots (crontab digest, line
  count, file-tree digest, marker field, invocation counts).
- Final run: 234 assertions pass, 0 fail, 2 behavioural defects recorded.
  The six locally fixable defects found by the first lab run are now fixed
  and pinned by the same scenarios: blank-line stripping by `sed '/^$/d'`
  in both lanes (A12/B11); the CRLF owner token (A13/B12); a comment merely
  mentioning the tag (A14/B13); `install.sh` `cron_read` merging stderr
  (A17); duplicate JSON `cron` keys read first by `install.sh` and last by
  `install-global` (A29/B28, plus the reverse order A29b/B28b); and the
  concurrent-uninstall race (B19). The install-side cases A32/A33 and
  B33/B34 pin blank-line and comment preservation plus stderr isolation.
  The two remaining defects are the lying-crontab residual in both lanes
  (A16/B15): the line lands in the hidden store, the marker resolves `none`
  for `install.sh` and `owned` for `install-global`, files are removed and
  the line remains.
- A single-quote lane path is refused closed before any cron line is
  written (A22/B21); it is not a quoting defect in the write path.
- Measured: 5001-line table removal 666 ms (`install.sh`) and 70 ms
  (`install-global`); Unicode paths pass; SIGKILL before file deletion keeps
  files and marker (A23/B22); read-only directories do not report a silent
  success; an absent `crontab` binary refuses owned/unknown and allows none.
- The A-side trap was verified separately: a cron install followed by a
  manual reinstall under an unreadable crontab records `trigger: manual` with
  `cron: owned` and keeps the line; the unreadable uninstall refuses and the
  readable one removes the line and the scripts.
- Two concurrent uninstalls: after the minimum fixes, both lanes are 20/20
  clean in each of three stress runs (60/60 per lane across the three runs).
  `removeEmptyTree` now catches the vanished directory; `readOwner` treats a
  concurrent `ENOENT` as no owner; `uninstallTriggers` receives the marker
  snapshot already read by the caller; the marker file is removed after
  every other recorded file; and the early "nothing installed" path treats a
  runtime tree with no files as absent, matching the sequential second
  uninstall. The fail-closed boundary is pinned: a missing marker with
  remaining runtime files still refuses an unreadable crontab (B35), while
  an empty runtime is the sequential nothing-installed state (B36).
- The lab exposed one defect inside this fix: a failed cron write during
  install left `cron: none` in the marker (B31). The minimum fix reorders
  `resolveCronState` so `attempted` wins before the evidence read, keeping
  the write-ahead `owned` marker after a failed write. A proof case in
  `prove-global-install.ts` pins the behaviour (570 assertions total).
- HEAD differential for the intentional tightenings, run with the same
  isolated shim: with a readable unproven tagged line, HEAD removed the files
  and left the line (both lanes, exit 0); the current tree refuses (exit 2)
  and keeps the files. With the `crontab` binary absent, HEAD removed the
  files and left the owned line; the current tree refuses. On a dry run with
  an unreadable crontab, HEAD claimed it would remove the scripts or the
  recorded files; the current tree reports that a real uninstall would
  refuse. These are deliberate fail-closed changes, not regressions.

Generated ledger:

- `bun scripts/check-shared-parity.ts --write` refreshed six anchors. Five
  were already stale from pre-existing uncommitted line drift
  (`src/services/proxy-fallback-chains.ts`, `src/scripts/gen-opencode-config.ts`,
  `scripts/boot-scorecard-v2.sh` twice, `src/tools/agent-add-helpers.ts`);
  one moved by the installer edits (`scripts/install-global.ts:203`).
  `--check` passes after the refresh.

Residuals carried from §13: old markers stay unknown; an external crontab
writer between the read and the write is undetectable; the double-failure
rollback can leave a line without a marker; a broken crontab implementation
that accepts writes but returns an empty read defeats the verification read.
The lab reproduces the last one for both lanes (A16/B15); it is the only
remaining lab defect and stays out of scope because no local logic can
distinguish a lying crontab from a genuinely empty table. The live three-reload heap slope remains unmeasured on the host;
component and context proxies are recorded in the memory-retention plan.
