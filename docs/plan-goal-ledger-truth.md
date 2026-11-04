# Plan — Goal Ledger Truth

Status: DRAFT (rev. 8, three-agent final review of rev. 7 applied). Do not implement until the owner approves.
Date: 2026-11-04. Extracted from `docs/plan-intelligence-continuity.md` rev. 9, section 26.1 (section 22.1 in rev. 8).

This plan changes no code. It records one live defect in the goal ledger and the approved repair. The owner decided three things on 2026-11-04: extract this track from the main plan, adopt the G6 migration contract with a quarantine copy, a quiesced host and a byte-identical restore path, and keep G3 (the history split) out of scope.

## 1. Problem

The live store has six terminal goals that are no longer active, but the `all` filter and the board do not report them as dropped.

Evidence (read 2026-11-04 from the live project state root, not from the stale repository copy):

- `goal(list: true)` returns only `G-006` (open).
- `goal(list: true, filter: "all")` returns `G-001..G-007`.
- `goal(list: true, filter: "dropped")` returns no goals.
- `goal(board: true)` prints `1 open · 1 completed · 5 verified · 0 dropped`.
- The live ledger `~/.local/share/tawassul-v2/projects/<project-hash>/goals/goals.jsonl` has five records with `status: "dropped"` and no `closedAs`, and `G-005` with `closedAs: "verified"`.
- The repository copy `goals/goals.jsonl` is stale (mtime 2026-11-01) and is not the live ledger.

## 2. Root causes

1. `load()` (`src/services/goal-store.ts:294-305`) backfills `closedAs` from the prior live status when a dropped record has no `closedAs`, and `effectiveStatus()` (`:130-132`) prefers `closedAs` over `status`. For the five legacy records the prior live status is `completed` or `verified`, so the backfill writes that status into `closedAs` and the goal is reported as completed or verified, not dropped.
2. The writers are not fully correct, and this is the correction to revision 6. `finishLocked()` writes the terminal event and then removes the goal through `commit(tomb, { remove: true })`, so `deleteGoal()` and `update()` only ever see live goals in normal operation. For a live non-terminal goal `bumpTerminal(fresh.status)` (`:418-422`) takes the `else` branch and increments `dropped`, and `commit()` writes `closedAs: "dropped"` for the tombstone (`:356-357`), so writer and replay agree. The crash window is different: `finishLocked` increments `completed`/`verified` at `:765-766` before the tombstone at `:771`, so a failed write leaves a live terminal goal; deleting it then calls `bumpTerminal("completed")` and increments `completed` while `closedAs` becomes `"dropped"`. Counting from `closedAs` without fixing that call site would make the writer and the replay disagree, so both dropped-write paths call `bumpTerminal("dropped")`. The revision-4 writer edit was therefore correct, and the revision-6 withdrawal of it was wrong. The five `closedAs`-less records are legacy data, not current writer output. The live counts stay wrong because `load()` replays on every load but discards the replay when `goals-meta.json` matches on hash, sequence and count (`:325-336`); the meta is trusted, so the repaired counts never reach the board until G6 rebuilds it.
3. `markStale()` (`:845-871`) runs inside `mutate("sweep", ...)`, which acquires the store lock; it does not take an outer lock. It is the tail of the first `load()`, which `src/bootstrap/service-factory.ts:564` starts fire-and-forget, so it never blocks `initPlugin`. It skips goals with incomplete items and converts fully complete goals to `stale` after 14 days. `ACTIVE_STATUSES` (`:107`) includes `stale`, and the three consumers are `activeCount()` (`:402-408`), `list("active")` (`:835-840`) and `pickCaptureGoal` (`:1000-1001`); `markStale` hardcodes `open|in_progress|partial` and does not read the constant. It also skips `pinned` goals and does not stale `blocked` goals. A finished but unclosed goal therefore remains active and consumes the `maxGoals` cap, while a genuinely stalled goal is never marked.
4. `goal(board: true)` (`src/tools/goal.ts:179-186`) appends the host goal even when `status === "complete"`.
5. `compactDigest()` (`:875-879`) is injected into the session context at `src/bootstrap/hooks-registration.ts:276` and carries terminal counts, so agents see finished goals even when the active roster is one goal. Two further channels write goal text without going through the tool: `goal-auto.ts:62` calls `buildDigest()` with no options, and `message-updated.ts:726-734` forwards the digest. The digest change must cover all three.
6. The live counts are read from `goals-meta.json` when `load()` trusts the meta hash, sequence and count (`:325-336`). A replay-only fix (G1) does not change the live board until the meta is rebuilt from a full replay (G6).

## 3. Decisions

- **G1 — truth in `load` only. Adopted.** Treat a missing `closedAs` on a dropped record as `dropped`; never backfill it from the prior live status. The replay branch at `src/services/goal-store.ts:294-305` is rewritten: `goal.closedAs ??= "dropped"` replaces the prior-status backfill, the counter reads `closedAs`, and `lastLive` (`:269`), `prior` (`:294`) and both `lastLive` uses (`:302`, `:304`) are deleted, because the repository compiles with `noUnusedLocals`. Counts replay from `closedAs`. The prior status is recoverable from the event stream, so this plan omits `priorStatus` and adds no writer for it; keeping it would be a separate writer change and is open question 1. No schema break: no `priorStatus` field is added, and the event stream is the audit source.
- **G2 — truth in replay and in the two dropped-write paths. Adopted.** G1 plus the writer fix: `deleteGoal` (`:788`) and `update` with `patch.status: "dropped"` (`:713`) call `bumpTerminal("dropped")` instead of `bumpTerminal(fresh.status)`, so a dropped write always counts `dropped` and always writes `closedAs: "dropped"` (`:356-357`). `finishLocked` keeps incrementing `completed`/`verified` on the success path. The crash window is the reason for the writer fix: `finishLocked` increments at `:765-766` before the tombstone at `:771`, so a failed tombstone write leaves a live `completed`/`verified` goal; deleting it later must not count `completed` while `closedAs` says `dropped`. No load normalization is added: `buildDigest` already counts a live terminal goal once through `countStatus` (`:926-927`), and folding it into `lifecycleCounts` would double count it. This is future-correctness only; it does not change the live board because the trusted meta short-circuits replay.
- **G3 — history split. Deferred.** Keep `closedAs` as the final action and add a `history` filter; `all` returns only live goals (open/in_progress/partial/blocked/stale) and terminal goals live under `history`. This removes terminal goals from the default `all` view but changes the meaning of `all` for existing callers. The owner kept it out of scope; if the UI later needs a hard separation, a `history` filter is the only safe half and `all` must not shrink.
- **G4 — stale lifecycle. Adopted, behind `TAWASSUL_GOAL_AUTOCLOSE`.** The G4 sweep runs only when the flag is `1`; with the flag off, today's `markStale` runs unchanged, per the main plan's decision 8. With the flag on: auto-close a goal that has no incomplete items (as `completed`, not `verified`) only after `checkCloseInvariant` passes; an empty goal or an unmet DoD must not be auto-closed. Mark `stale` only when items or DoD remain incomplete and the goal is older than the threshold. Preserve the `pinned` exemption. Exclude `stale` from the active roster and the `maxGoals` cap; it remains visible through `goal(list: true, filter: "stale")`, a bounded `Stale` section in `goal(board: true)` and the `all` filter. `filter: "stale"` already exists in `GoalListFilterSchema` (`src/validation.ts:415-425`), so the only new surface is the board's `Stale` section. An empty goal is never auto-closed and never counted active; it enters the attention bucket with reason `empty`. The sweep is the tail of the first `load()`; `markStale` already runs inside `mutate("sweep", ...)`, which acquires the existing file lock (`src/infra/file-lock.ts`), so no outer lock is taken. If the lock is held, `mutate` returns `{ ok: false, reason: "locked" }` and the sweep is skipped for that process; the next process start retries. It never appends during a concurrent write.
- **G5 — board and digest. Adopted.** `buildDigest({ terminalCounts })` gains one option, default `false`, and the two line shapes are pinned. With `false`, line 0 is `🎯 N open` only. With `true`, line 0 is today's full line, `🎯 N open · ✅ N completed · ✔ N verified · 🗑 N dropped`. `goal(board: true)` passes `true`; `compactDigest()` and `goal-auto.ts:62` inherit `false` and carry no terminal counts. The earlier "labelled history footer" wording is withdrawn: the counts stay on line 0, which is the line the capture proof reads. Append the host goal only when `status !== "complete"`.
- **G6 — repair and migration. Adopted with the full safety contract in section 4.** Repair the live ledger through the store write path (the meta file is HMAC-protected), not by hand-editing JSONL. Force a full replay, recompute `lifecycleCounts` and rewrite the meta; a JSONL rewrite alone changes the fold hash and can re-enter the same inverted rule. Expected post-repair counts: `1 open · 0 completed · 1 verified · 5 dropped`.

## 4. G6 migration contract

The migration is the only step that touches the live state root. It runs as a one-shot command with the host quiesced. The entry point is `scripts/goal-migrate.ts`; it calls the store's new `rebuildMeta()`, which runs inside `mutate("migrate", ...)` and therefore acquires the existing file lock (`src/infra/file-lock.ts`). The script does not acquire a second lock. If the lock is held, `mutate` returns `{ ok: false, reason: "locked" }` and the migration refuses. It does not replace `src/scripts/migrate-goals.ts`, which migrates boards into goals; `goal-migrate.ts` only rebuilds the meta.

Preconditions:

1. The owner stops the desktop host and its sidecar, so no other process can append to `goals.jsonl` or `goals-meta.json` during the run. A live host is not an accepted alternative to stopping it: a host that is merely idle can append after the copy and before the meta write, and a host that holds the lock makes the script refuse.
2. The expected pre-state hash is captured independently before the copy, by a read-only probe of the live ledger, and passed as `--expect-hash <sha256>`. The migration refuses to run when the live ledger hash differs from that value; comparing the live file to a hash derived from its own copy would be circular.
3. The store resolves the ledger directory from `--state-dir`, the same convention as `src/scripts/migrate-goals.ts:13-20` (which constructs `GoalStore(stateDir)`), or from its configured `persistDir` when the script runs inside the host; it records the resolved path in the manifest. It copies `goals.jsonl` and `goals-meta.json` to `goals/quarantine/<UTC timestamp>/` before any write, and records the sha256 of both copies next to the independently captured pre-state hash.

Steps:

1. Full replay of `goals.jsonl` with the G1 rules through `load({ replay: true, persist: false })`, a new option pair that ignores the trusted meta counts, takes the replay branch even when the hash, sequence and count match, and does not write the meta. The replay runs inside the `mutate("migrate", ...)` callback, so it never writes `goals-meta.json` outside the lock.
2. Recompute `lifecycleCounts` and the fold hash; compare the new counts with the replay.
3. Write a diff report: per goal, the old `effectiveStatus` and the new one. Persist it next to the quarantine manifest as the review artifact: the JSONL is never rewritten and the ledger is append-only, so the prior `effectiveStatus` is still recoverable from the event stream, but the owner signs off on the diff, not on a replay.
4. Write the meta through `persistMeta()` inside `rebuildMeta()`, which is inside `mutate("migrate", ...)`, atomically (temp file plus rename). Because `hmacWriteFile` returns without writing and without throwing when the file is signed by a foreign key or the session is isolated (`src/services/persist-utils.ts:86-95`), `rebuildMeta()` re-reads `goals-meta.json` with `hmacReadFile` and asserts `seq`, `ledgerHash` and the three counts equal the replay; a mismatch is a hard failure that triggers the restore path. The script never writes the meta file itself and never calls the private method directly.
5. Run a second read-only `load({ replay: true, persist: false })` on a fresh `GoalStore` instance, because `load()` does not clear `goals`, `tombstones` or `seq` and re-runs the sweep, and assert the same `ledgerHash` **and** the same `lifecycleSnapshot()` (fixpoint). `ledgerHash` folds only `(id, seq, updatedAt)`, so it is blind to counts; the count equality is a separate assertion. A second run of the whole migration is a no-op in counts and hash, not necessarily in meta bytes: `persistMeta()` refreshes `createdAt`/`updatedAt`, so the proof compares the fixpoint, not the bytes.

Failure handling:

- Any hash mismatch, parse error, invariant failure or write error aborts the run and restores both files byte-for-byte from the quarantine copy.
- The restore is verified by comparing the restored sha256 with the quarantine manifest; a failed restore is reported as a hard error and leaves the quarantine in place.
- The migration never deletes the quarantine; the owner removes it after verification.

Properties:

- Idempotent: a second run produces the same counts and the same `ledgerHash`, asserted separately.
- Atomic: temp file plus rename for the meta; the ledger is not rewritten at all.
- Hash-gated: refuses on an unexpected pre-state through `--expect-hash`.
- Owner-gated forced mode for a deliberate re-run after a known manual edit: `--force` still requires `--expect-hash`, writes a second diff and never skips the quarantine or the restore check.

## 5. Data model

- `closedAs` is the final action on a goal and the only source of truth for a terminal goal. It is set by `deleteGoal` and by `update` with `patch.status: "dropped"` to `dropped`, and by `finishLocked` to `completed` or `verified`.
- No `priorStatus` field is added. The prior status is recovered from the event stream and never participates in `effectiveStatus`.
- `lifecycleCounts` is derived from `closedAs` only, and each writer increments the same value it writes: `finishLocked` writes `completed`/`verified` and increments that count, the two dropped-write paths write `dropped` and increment `dropped`. A dropped record with no `closedAs` counts as `dropped` (G1).
- `lifecycleSnapshot()` is a read-only accessor for the three lifecycle counts (`completed`, `verified`, `dropped`). It does not include live terminal goals: `buildDigest` adds those through `countStatus` (`:926-927`), so a proof that asserts the digest line passes `terminalCounts: true` and reads the line, not the snapshot. The migration fixpoint and the lifecycle assertions use the snapshot; it is the only new read-only accessor and it changes no writer.
- `isEmptyGoal(goal)` is defined once next to `checkCloseInvariant`: `items.length === 0 && completedItems.length === 0 && acceptance.length === 0`. It has exactly four consumers when the flag is on: `list("active")`, `activeCount()`, `pickCaptureGoal` and `buildDigest`'s attention scan. The sweep does not call it: `checkCloseInvariant` already returns an `empty:` reason as its first branch.
- `ACTIVE_STATUSES` becomes `activeStatuses()`: the same list with `stale` omitted when `TAWASSUL_GOAL_AUTOCLOSE=1`. Its consumers are `activeCount()` (`:402-408`), `list("active")` (`:835-840`) and `pickCaptureGoal` (`:1000-1001`). `markStale` does not read it; it hardcodes `open|in_progress|partial`. With the flag off, `stale` stays in the list exactly as today and consumes the cap.
- `buildDigest`'s attention scan keeps the active loop for `blocked`, `stale` and `pinned` goals, and when the flag is on it also reads `list("all")` for the two classes that leave the roster: empty goals (reason `empty`) and stale goals (reason `stale`). Without the stale class a ledger with one stale goal and nothing else returns an empty digest, because `active` is empty and the early return at `:877` fires.
- `compactDigest()`'s early return becomes `digest.open === 0 && digest.attention === 0`, so an empty or stale goal's attention line is not dropped when no goal is active.

## 6. Behaviour changes

| Site | Today | After |
|---|---|---|
| `load()` replay | Fills `closedAs` from the prior live status and counts by that status (`:295-301`) | Leaves a missing `closedAs` alone and counts from `closedAs ?? "dropped"` (`:295-298`); the backfill is deleted |
| `effectiveStatus()` | Prefers `closedAs` | Unchanged, but `closedAs` is now correct by construction |
| `deleteGoal()` | `bumpTerminal(fresh.status)` increments the prior status; for a live terminal goal that is `completed`/`verified` while `closedAs` becomes `dropped` | `bumpTerminal("dropped")`: the count always matches `closedAs`; asserted by the extended capture proof |
| `update()` with `patch.status: "dropped"` | Same prior-status increment | `bumpTerminal("dropped")`; asserted by the extended capture proof |
| `finishLocked()` | Increments `completed` or `verified`, then removes the goal | Unchanged |
| `markStale()` | Skips incomplete goals, stales fully complete ones | The G4 sweep runs only when `TAWASSUL_GOAL_AUTOCLOSE=1`, inside the existing `mutate("sweep")` critical section; auto-closes a complete goal as `completed` after `checkCloseInvariant`, writes `closedAs: "completed"` through the same commit path as `finishLocked` and increments `completed`; stales only incomplete goals past the threshold; keeps `pinned` exempt; empty goals go to the attention bucket, never auto-close |
| `goal(list: true)` | `stale` is active | `filter: "stale"` already exists and returns stale goals in both modes; with the flag on they leave the active roster and the cap; with the flag off they remain in `ACTIVE_STATUSES` as today |
| `goal(board: true)` | Appends the host goal unconditionally; no `Stale` section | Appends only when `status !== "complete"`; passes `terminalCounts: true`, so line 0 keeps its terminal segments; with the flag on a bounded `Stale` section lists stale goals |
| `compactDigest()` | Carries terminal counts; returns "" when `open === 0` | Inherits `terminalCounts: false` from `buildDigest`'s default, so line 0 is `🎯 N open` and carries no terminal counts; returns "" only when `open === 0` and `attention === 0`, so an empty or stale goal still surfaces |
| `goal-auto.ts:62` | Calls `buildDigest()` and carries terminal counts | Inherits `terminalCounts: false`; the board proof asserts the omission |
| `goals-meta.json` | Trusted counts can be stale | Rebuilt by G6 and by a full replay |

## 7. Acceptance

- On the current ledger, `goal(list: true, filter: "dropped")` returns the five dropped goals; `filter: "verified"` returns only `G-005`; `filter: "completed"` returns none. The invariant is that every tombstone's `effectiveStatus` equals its `closedAs`, not that a particular count is fixed forever.
- `goal(board: true)` prints `1 open · 0 completed · 1 verified · 5 dropped` after the repair.
- With `TAWASSUL_GOAL_AUTOCLOSE` unset or `0`, `markStale` behaves exactly as today; with `1`, the lifecycle below applies.
- A goal with all items done and all DoD met is closed as `completed` by the sweep, not moved to `stale`.
- With the flag on, a goal with incomplete items older than the threshold is reported as `stale` and is not counted as active work; with the flag off, `markStale` and the `ACTIVE_STATUSES` membership are unchanged.
- With the flag on, an empty goal is not auto-closed, not counted active, not returned by `pickCaptureGoal`, and appears in the attention bucket with reason `empty`; the four `isEmptyGoal` consumers agree.
- With the flag on, a stale goal is absent from the active roster and the cap, present in `filter: "stale"` and the board's `Stale` section, present in `all`, and surfaced by the digest attention scan even when it is the only goal and `active` is empty. With the flag off, no surface changes: `filter: "stale"` already exists and the board has no `Stale` section.
- The sweep runs inside `mutate("sweep")` and never takes an outer lock; a held lock skips it for that process and the next process start retries; it never appends during a concurrent write.
- `compactDigest()` and `goal-auto.ts:62` contain no terminal counts and their line 0 is `🎯 N open`; an empty or stale goal still surfaces when no goal is active, including the single-stale-goal case; `goal(board: true)` passes `terminalCounts: true` and line 0 keeps its terminal segments; `false` is the default.
- A host goal with `status: "complete"` is not appended to the board.
- The migration aborts and restores byte-identically when `--expect-hash` does not match or a write fails.
- A second migration run is a no-op in counts and hash: it produces the same `ledgerHash` and the same `lifecycleSnapshot()`; the meta bytes may change because `persistMeta()` refreshes `createdAt`/`updatedAt`, and the proof asserts the fixpoint, not byte equality.
- A crash between the terminal event and the tombstone leaves a live `completed`/`verified` goal. After a reload, `buildDigest` counts it once through `countStatus`, and a later delete moves it to `dropped` without double counting. Before the reload the in-process `lifecycleCounts` bump and `countStatus` can both carry it; that transient is pre-existing and unchanged by G2. The proof seeds the crash window and asserts the post-reload transition.
- Deleting a live `completed` goal leaves `0 completed` and `1 dropped` in the digest line, and a replay from `closedAs` produces the same counts. The same holds for `update({ status: "dropped" })` on a live terminal goal.

## 8. Proofs and gate impact

- Extend `scripts/prove-goal-resurrection.ts` (the resurrection/ghost proof over concurrent mutation, `:18-49`): keep its existing cases, and add the legacy case. Seed the JSONL directly with a `verified` record followed by a `status: "dropped"` record with no `closedAs` for the same id, reload, and assert `closedAs === "dropped"` (the constant backfill), `effectiveStatus === "dropped"`, the dropped filter returns the goal, and `lifecycleSnapshot().dropped` increased by one. The existing cases cannot catch the defect because `commit()` writes `closedAs` on the tombstone.
- New `scripts/prove-goal-migration.ts`: `--expect-hash` mismatch aborts before any write; the quarantine copy exists with matching hashes; a failed write restores byte-identically; a second run is a no-op in counts and hash; a second `load({ replay: true, persist: false })` on a fresh store produces the same `ledgerHash` and the same `lifecycleSnapshot()`. The proof also asserts that every meta write in the run happens inside `mutate("migrate")`, that the no-persist replay makes no write at all, and that `rebuildMeta` re-reads the meta and matches the replay, so a foreign-key or isolated-session block is a hard failure rather than a silent success.
- New `scripts/prove-goal-stale-lifecycle.ts`: with the flag off, `markStale` is unchanged, `stale` stays in `ACTIVE_STATUSES`, consumes the cap and the board has no `Stale` section; with the flag on, a complete-but-unclosed goal is auto-closed only when `checkCloseInvariant` passes; an incomplete old goal becomes `stale`; the single-stale-goal case surfaces through the digest attention scan while `active` is empty; an empty goal enters the attention bucket, is never auto-closed, is not returned by `pickCaptureGoal`, and the four `isEmptyGoal` consumers agree; neither stale nor empty is counted as active; `pinned` is preserved; a held lock skips the sweep without an outer acquisition.
- New `scripts/prove-goal-board-truth.ts`: board counts with `terminalCounts: true`, digest omission with the default `false`, the `Stale` section, `filter: "stale"`, `goal-auto.ts:62`'s digest, and host-goal `complete` omission.
- Extend `scripts/prove-goal-capture.ts`: it derives `countsLine` from `buildDigest().text.split("\n")[0]` (`:46-47`) and asserts literal terminal counts at `:95-97`, `:120-121`, `:162`, `:166`, `:167`, `:168`, `:172`, `:181`, `:182`, `:187` and `:195`. The proof reads line 0 through one `countsLine` helper (`:47`); pass `terminalCounts: true` there, which is mandatory, not an alternative. Re-derive the legacy expectations under G1 and the writer fix: after deleting a live `completed` goal the line reads `0 completed` and `1 dropped`, `:167` still forbids a double count, and the replay assertion at `:172` compares against that line. `lifecycleSnapshot()` is not a substitute, because it excludes the live terminal goals that `countStatus` adds to the digest line. Without this extension the existing gate turns red when the default changes.
- Add the crash-window fixture to `scripts/prove-goal-migration.ts`: a live goal with status `completed`/`verified` and no tombstone is counted once by `countStatus`; a later delete moves it to `dropped` once; and a replay from `closedAs` produces the same counts.

### 8.1 Files and gate registration

Modified: `src/services/goal-store.ts` (G1, G2, G4, G5, `rebuildMeta`, `load({ replay: true, persist: false })`, `activeStatuses()`, `isEmptyGoal`, `lifecycleSnapshot()`, and `bumpTerminal("dropped")` at `:713` and `:788`), `src/tools/goal.ts` (board passes `terminalCounts: true` and skips a complete host goal), `scripts/prove-goal-resurrection.ts` (extended), `scripts/prove-goal-capture.ts` (extended: `terminalCounts: true` plus the revised G1 expectations). `src/services/goal-auto.ts` and `src/bootstrap/hooks-registration.ts` need no change: both inherit the `false` default, and the proof asserts it.

New: `scripts/goal-migrate.ts`, `scripts/prove-goal-migration.ts`, `scripts/prove-goal-stale-lifecycle.ts`, `scripts/prove-goal-board-truth.ts`.

`src/scripts/migrate-goals.ts` is untouched: it migrates boards into goals, while `scripts/goal-migrate.ts` only rebuilds the meta. Both `scripts/goal-migrate.ts` and the new proof files fall under `scripts/check-v2-rules.mjs`, so they are English and comment-free like every other file under `scripts/`.

Registration, mirroring main plan section 10.2:

- Add each new proof file to `PINNED_PROOF_FILES` in `scripts/prove-proof-catalog.ts:70`.
- Bump `PINNED_PROOF_STEPS` by one per landed proof, from 171 to 174 when the main plan lands first; a standalone landing starts from 154 and ends at 157. The catalog asserts exact equality (`:269`), so a partial update (a file added without the pin, or the pin without the file) fails at the intermediate commit.
- Add one step per proof to `scripts/gate-manifest.json` under `proofs`, exactly one owner per step.
- Assign the steps in `scripts/proof-shards.json`; the shard estimates stay inside the 10% band.
- Run `bun scripts/generate-proof-count.ts`; the fast gate runs it with `--check`.

Gate impact: three new proof files plus two extensions. This plan adds three proof steps to the 171 of the main plan, for a combined 174. The exact number is fixed by `gate-manifest.json`, not by prose.

## 9. Phases and estimate

Standalone track, independent of the intelligence phases. One phase of 1.5-2 days for one engineer:

1. G1 in the store and the G2 regression assertion in the extended resurrection proof: the legacy seed, the replay rule and the writer assertion.
2. G4 and G5 in the sweep, the board and the digest, with their two proofs.
3. G6 as `scripts/goal-migrate.ts` and `rebuildMeta()`, with the migration proof, run by the owner against the live state root.

If the owner prefers a single release, this is Phase 7 of the main plan and adds its three proof steps to that release's gate.

## 10. Risks

| Risk | Mitigation |
|---|---|
| The migration corrupts the live ledger | Quiesced host, quarantine copy, hash gate, atomic meta write, byte-identical restore |
| A concurrent append lands during the migration | The host is stopped, the script owns the store lock through `mutate("migrate")`, and `--expect-hash` is re-checked before the write |
| A second run double-counts | Idempotent replay from `closedAs`; the fixpoint proof asserts the same `ledgerHash` and the same `lifecycleSnapshot()` |
| A crash leaves a live terminal goal | `countStatus` counts a live `completed`/`verified` goal once; the writer fix makes a later delete count `dropped`, and the migration proof seeds the crash window |
| Auto-close closes an empty or unmet goal | An empty goal is never auto-closed and enters the attention bucket with reason `empty`; an unmet DoD fails `checkCloseInvariant` |
| G4 auto-closes a live goal by mistake | The sweep runs only with `TAWASSUL_GOAL_AUTOCLOSE=1`, after `checkCloseInvariant`, and inside `mutate("sweep")`; the flag-off path is asserted unchanged |
| The G4 defect remains while the flag is off | The flag-off path is today's behaviour by design; the owner enables `TAWASSUL_GOAL_AUTOCLOSE=1` after the stale-lifecycle proof is green |
| The sweep races a concurrent writer | `markStale` runs inside the existing `mutate("sweep")` critical section; a held lock skips the pass and the next process start retries |
| `stale` still consumes the cap | `stale` leaves the roster and the cap, and stays visible through `filter: "stale"`, the board's `Stale` section and `all` |
| A legacy record has no `closedAs` | G1 treats it as `dropped`; the migration rewrites the meta, not the JSONL |
| The board still shows finished goals | G5 appends the host goal only when it is not complete, and the digest drops terminal counts |

## 11. Rollback

1. Restore `goals.jsonl` and `goals-meta.json` byte-for-byte from the quarantine copy.
2. Revert the store changes; the ledger is compatible with the old code because the JSONL was never rewritten.
3. Re-run the resurrection proof against the restored state.

## 12. Open questions

1. Resolved: omit `priorStatus`; the event stream recovers the prior status, and no writer is added.
2. Open: run G6 as part of the same release (Phase 7) or as an owner-run command after the code lands?

## 13. Revision 3 — blocking set closed

Revision 2 applied the corrections that this document owns from the second full-plan round (main plan section 27): the `compactDigest` injection citation, the third injection channel, the second `bumpTerminal` call site, the `persistDir` resolution, the independent pre-state hash, the persisted diff, the `--force` mechanism, the G4 tombstone write and the `ACTIVE_STATUSES` consumers.

Revision 3 closes the five companion blocking findings from main plan section 27.2:

- W42: stale goals stay visible through `filter: "stale"`, the board's `Stale` section and `all`, while leaving the active roster and the cap. Revision 4 pins the roster/cap exclusion to the flag-on path; with the flag off, `stale` stays in `ACTIVE_STATUSES` as today.
- W43: empty goals are never auto-closed and never counted active; they enter the attention bucket with reason `empty`.
- W44: the sweep runs at the tail of the first `load()` and inside the existing `mutate("sweep")` critical section; a held lock skips the pass and the next process start retries. Revision 5 corrects the earlier "after init / outer lock" wording.
- W47: G4 runs only when `TAWASSUL_GOAL_AUTOCLOSE=1`; the default off preserves today's `markStale`.
- W48: `buildDigest` gains `terminalCounts`; the board passes `true`, `compactDigest` passes `false`.

W49 (the G6 entry point and lock) is closed by naming `scripts/goal-migrate.ts` as the entry point and `src/infra/file-lock.ts` as the lock. W51 (the attention bucket surface) is closed by the `Stale` section and the `stale` filter. W39 (one normative cache description) remains open and is non-blocking.

## 14. Revision 4 — vote amendment on G4

Revision 4 applies the amendment that D2 received in the six-agent vote recorded in main plan section 29. D2 was approved 3-3 with three amendments, all on the same point: the companion described the `stale` roster/cap exclusion as unconditional, while today's unflagged `markStale` can already mark a goal `stale` and `stale` is in `ACTIVE_STATUSES`. Applying the exclusion with the flag off would have changed flag-off behaviour and contradicted decision 8.

Revision 4 pins the scope:

- The whole G4 lifecycle runs only with `TAWASSUL_GOAL_AUTOCLOSE=1`: auto-close, stale marking, the `stale` roster/cap exclusion, and the board's `Stale` section.
- With the flag off, `markStale` and `ACTIVE_STATUSES` membership are unchanged; a stale goal consumes the cap exactly as today and the board has no `Stale` section.
- `filter: "stale"` already exists and is available in both modes; it changes no existing filter.
- `prove-goal-stale-lifecycle` asserts the flag-off roster/cap parity, not only `markStale` parity.
- The §13 W42 bullet is read with this scope: the roster/cap exclusion is flag-on only.

The flag name stays `TAWASSUL_GOAL_AUTOCLOSE` even though it gates the whole lifecycle, because renaming it now would touch every reference in this document and the code for no behavioural gain; the section 3 text states the broader scope.

## 15. Revision 5 — six-agent review of revision 4 applied

Status: change record. The six-agent review of main plan revision 12 and this plan's revision 4 produced two NOT READY verdicts and four READY WITH CHANGES. This revision closes every blocking finding against the companion; the four non-blocking main-plan findings are closed in main plan section 30. No code has been changed.

Blocking findings closed:

| # | Finding | Fix |
|---|---|---|
| C1 | The resurrection proof only covers delete then reload, but `commit()` writes `closedAs` on the tombstone, so the test cannot catch the legacy backfill | Section 8 seeds a `verified` record followed by a `dropped` record with no `closedAs` for the same id |
| C2 | `isEmptyGoal` was named without a definition, and its consumers were not enumerated | Section 5 defines it next to `checkCloseInvariant` and names the four consumers; section 7 asserts they agree |
| C3 | The sweep was described as taking an outer file lock, but `markStale` already runs inside `mutate("sweep")`; a second acquisition with a different owner is refused | Section 3 states that no outer lock is taken; section 7 and section 10 assert the existing critical section |
| C4 | G6 named `persistMeta()` but it is private and unlocked; the script cannot call it directly | Section 4 step 4 routes the write through `rebuildMeta()` inside `mutate("migrate")` |
| C5 | The fixpoint asserted only `ledgerHash`, which folds `(id, seq, updatedAt)` and is blind to counts | Section 4 step 5 asserts `lifecycleCounts` separately; the proof does the same |
| C6 | G6 precondition 1 allowed "or holds the store lock", which is not a quiesce and would make the script refuse its own acquisition | Section 4 requires the host and sidecar stopped; a held lock is a refusal, not a precondition variant |
| C7 | Root cause 2 blamed `deleteGoal`/`update`, but `finishLocked` removes terminal goals first, so `bumpTerminal(fresh.status)` already increments `dropped` | Section 2 rewrites root cause 2; section 3 rewrites G2 as replay plus a regression assertion; the writer edits are withdrawn as no-ops. Superseded in revision 7, which restores the writer edit for the crash window (section 17) |
| C8 | `buildDigest` was written as `buildDigest(goals, { terminalCounts })`, but it takes only options; `goal-auto.ts:62` was not covered | Section 3 and section 6 use `buildDigest({ terminalCounts })`, default `false`, and cover `goal-auto.ts:62` in the board proof |

Non-blocking findings closed:

- W15 (probe timeout) and W17 (directory creation) are main-plan items; the companion does not depend on them.
- W18 (the 2 MB cap) and W20 (the live schema payload gate) are main-plan items and are closed in main plan section 30.
- The `filter: "stale"` wording is corrected: the filter already exists in `GoalListFilterSchema`; only the board's `Stale` section is new.
- The `ACTIVE_STATUSES` consumer list is corrected to `activeCount()`, `list("active")` and `pickCaptureGoal`; `markStale` does not read it.
- The `bumpTerminal` citation is corrected to `:418-422`.
- The extraction citation is corrected to main plan rev. 9, section 26.1.

The proof count is unchanged: this plan adds three proof steps to the main plan's 171, for a combined 174. `gate-manifest.json` remains authoritative.

## 16. Revision 6 — six-agent review of revision 5 applied

Status: change record. The six-agent review of main plan revision 13 and this plan's revision 5 produced five READY WITH CHANGES and one READY; no agent returned NOT READY. The blocking findings against this plan are R1, R2, R3 and R7 in main plan section 31.2; the main-plan findings are R4-R6. No code has been changed.

Blocking findings closed:

| # | Finding | Fix |
|---|---|---|
| R1 | `load({ replay: true })` wrote the meta at `goal-store.ts:333` outside `mutate("migrate")`, and step 5 wrote it again | Section 4 adds `persist: false`, runs the replay inside the callback, and makes step 5 read-only |
| R2 | `prove-goal-capture.ts` asserts the terminal-count line from `buildDigest()`, so the `terminalCounts: false` default turns an existing gate red | Section 8.1 adds the file and section 8 rewrites its assertions through `lifecycleSnapshot()` |
| R3 | `priorStatus` was described as an existing optional field that "stays optional and lenient" | Sections 3 and 5 state that no field is added and the event stream is the audit source |
| R7 | `finishLocked` increments the count before the tombstone write, so a failed write leaves a live terminal goal and a later delete double-counts | Section 3 scopes G2 to the success path and normalizes live terminal goals on load; section 8 seeds the crash window. The load normalization is withdrawn in revision 7 in favour of the writer fix (section 17) |

Non-blocking findings closed:

- `GoalListFilterSchema` is `:415-425`, not `:414-424`.
- `lifecycleSnapshot()` is the only new read-only accessor, not the only new public surface.
- A second migration run is a no-op in counts and hash, not necessarily in meta bytes; section 4 and section 7 say so.
- The `PINNED_PROOF_STEPS` warning is about a partial update, not about a single coordinated commit.
- This plan adds three proof steps, not three gate steps.
- `goal-auto.ts:62` is correct; the reported `:63` was rejected on inspection.

The proof count is unchanged: this plan adds three proof steps to the main plan's 171, for a combined 174. `gate-manifest.json` remains authoritative.

Revision 7 supersedes two fixes from revision 6: R2's `lifecycleSnapshot()` rewrite breaks the capture proof, and R7's load normalization is withdrawn in favour of the writer fix. Section 17 records both.

## 17. Revision 7 — three-agent review of revision 6 applied

Status: change record. Three agents reviewed main plan revision 14 and this plan's revision 6: deepseek NOT READY (54 calls, 2 blocking), pickle READY WITH CHANGES (41, 4), glm READY (54, 0). No code has been changed. The blocking findings converge on one defect that revision 6 introduced.

Blocking findings closed:

| # | Finding | Fix |
|---|---|---|
| D1 | G1 counts from `closedAs`, but `deleteGoal` increments the prior status while writing `closedAs: "dropped"`; for a live terminal goal the writer and the replay diverge | Section 3 G2 calls `bumpTerminal("dropped")` at `:713` and `:788`; section 2 root cause 2 and section 6 are rewritten |
| D2 | G2's load normalization either double counts against `countStatus` or is a no-op | Section 3 G2 adds no normalization; section 5 states that the snapshot excludes live terminal goals |
| P1 | The crash-window premise is contradicted by the passing assertions at `prove-goal-capture.ts:166-172` | Section 7 and section 8 update the expectations to `0 completed` and `1 dropped` |
| P2 | Rewriting the capture-proof assertions through `lifecycleSnapshot()` breaks them | Section 8 makes `terminalCounts: true` mandatory and reads the digest line |
| P3 | G1 did not name the replay-counter edit | Section 3 G1 names `:295-298` and `:299-301` |
| P4 | G2's normalization wording would either rewrite live records or leave the crash window unfixed | Section 3 G2 states counting only; a live record stays live and deletable |

Non-blocking findings closed:

- Root cause 6 said `load()` "never replays"; it replays on every load and discards the replay when the meta is trusted (`:325-336`).
- The capture-proof assertion list is extended to `:166`, `:167`, `:172`, `:182`, `:187` and `:195`.
- `scripts/goal-migrate.ts` is distinguished from the existing `src/scripts/migrate-goals.ts`, and adopts its `--state-dir` convention.
- `lifecycleSnapshot()` is defined as lifecycle counts only; the digest line is the surface for live terminal goals.
- The G2 heading changes from "writers unchanged" to "truth in replay and in the two dropped-write paths".

The proof count is unchanged: three proof steps, combined 174. `gate-manifest.json` remains authoritative.

## 18. Revision 8 — three-agent final review of revision 7

Status: change record. Three agents reviewed main plan revision 15 and this plan's revision 7: deepseek READY WITH CHANGES (42 calls, 4 blocking), pickle READY WITH CHANGES (58, 2), glm READY WITH CHANGES (43, 0). No code has been changed. Two of the deepseek findings and one pickle finding land in this document; the rest are main-plan text fixes recorded in main plan section 33.

Blocking findings closed:

| # | Agent | Finding | Fix |
|---|---|---|---|
| D1 | deepseek | G1 deleted the `closedAs` backfill while the resurrection proof asserts `closedAs === "dropped"` for a seeded record that has none, so the field stays `undefined` and the new assertion fails | Section 3 G1 keeps a constant backfill (`closedAs ??= "dropped"`) and reads the counter from `closedAs`; `lastLive` (`:269`), `prior` (`:294`) and both `lastLive` uses (`:302`, `:304`) are deleted so `noUnusedLocals` stays green. Section 8 states the assertion matches the backfill |
| D2 | deepseek | `terminalCounts: true` cannot both keep the counts on line 0 and move them to a labelled footer; the capture proof reads line 0 | Section 3 G5 pins the two shapes: `false` renders `🎯 N open`; `true` renders today's full counts line. The board passes `true`; the footer wording is withdrawn. Section 6 and the board proof follow |
| D3 | deepseek | `hmacWriteFile` returns without writing and without throwing on a foreign key or an isolated session, so `rebuildMeta` can report success with the meta unchanged | Section 4 step 4 has `rebuildMeta` re-read `goals-meta.json` with `hmacReadFile` and assert `seq`, `ledgerHash` and the three counts; a mismatch is a hard failure. Section 8 asserts the same read-back in the migration proof |
| D4 | deepseek | "counted once through `countStatus`" is false in-process: `finishLocked` bumps the counter before the tombstone write, so a failed write carries both | Section 7 scopes the claim to after a reload and states the in-process transient as pre-existing and unchanged by G2; section 8 asserts the post-reload transition |
| P1 | pickle | A stale goal never reaches `compactDigest` when the flag is on: the attention loop iterates `list("active")`, which excludes `stale`, and the `all` scan covered empty goals only | Section 5 extends the `list("all")` attention scan to empty and stale goals; the acceptance criteria and the stale-lifecycle proof add the single-stale-goal case |

Non-blocking findings closed:

- `activeCount()` is `:402-408`, corrected in both places that cite it.
- The migration diff report is a review artifact, not a data-loss guard: the ledger is append-only and the prior `effectiveStatus` is recoverable from the event stream.
- The second read-only load runs on a fresh `GoalStore`, because `load()` does not clear `goals`, `tombstones` or `seq`.
- `src/scripts/migrate-goals.ts` is untouched and distinguished from `scripts/goal-migrate.ts`.
- `scripts/goal-migrate.ts` falls under `scripts/check-v2-rules.mjs`, so it is English and comment-free.
- The capture proof has one `countsLine` helper (`:47`), not a call site per assertion.
- `prove-goal-resurrection.ts` is described as the resurrection/ghost proof, not a delete/reload proof.

The proof count is unchanged: three proof steps, combined 174. `gate-manifest.json` remains authoritative.

Methodology: the three agents used 42, 58 and 43 calls, all inside the 60-call cap; pickle used 58 of 60. The first deepseek invocation resolved to `nvidia/deepseek-ai/deepseek-v4.1-flash` because the runtime roster binds no model to `@analyst-deepseek`, even though `opencode.json:8785-8787` names the OpenCode model; that run was discarded and rerun with an explicit `model` argument. glm's five citation claims were checked and rejected on inspection: `accounting.ts` is `src/services/context-pack/accounting.ts:15-55` with `computeBudget` at `:55`, `tool-run-log.ts` is `src/services/tool-run-log.ts:59`, `ast-service.ts:230-237` is the exact cache-hit block, `dispatchToRoles` `:68-82` covers the method and its closing brace, and the handoff description range is `:207-215`. No change was made for those five.
