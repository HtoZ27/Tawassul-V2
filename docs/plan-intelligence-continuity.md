# Plan — Shared Project Intelligence + Continuity

Status: DRAFT (rev. 16, three-agent final review of revision 15 recorded and amendments applied). Do not implement until the owner approves.
Date: 2026-11-04. Tree reviewed at commit `b98ca02`; current HEAD is `1883eaf`.
Baseline measured 2026-11-04 under zod 4.1.8: 154 proof steps (177 named gate steps: 16 fast + 154 proofs + 6 smoke + 1 eval), 44 tools, reachability 362/343 files, 60,436/58,698 LOC, description text 16,147 bytes against a frozen target of 16,213 bytes, schema payload archived at 13,868 bytes with no gate measuring the live value.

This document is a working plan. It is not a repository artifact until the owner decides to track it. No code changes belong to this document. Revision 2 applies the corrections in section 15; revision 3 adds the dependency maintenance in section 16; revision 4 makes the liveness probe explicitly cross-platform in section 19; revision 5 closes the contract, gate and invocation-path gaps recorded in sections 20 and 21; revision 6 adds the goal-ledger truth and handoff-context options in section 22; revision 7 records the first six-agent round and applies its corrections in sections 22 and 24; revision 8 records the full-plan round in section 25 and applies its mechanical corrections; revision 9 extracts the goal-ledger track to `docs/plan-goal-ledger-truth.md`, records the G6 decision and the indexRevision vote in section 26, and updates section 6.2; revision 10 records the second full-plan round in section 27 and applies its mechanical corrections; revision 11 closes the twelve blocking findings in section 28 and updates the phases and proof arithmetic; revision 12 records the six-agent vote on the five decisions and W39 in section 29 and applies its consensus amendments; revision 13 applies the six-agent review of revision 12: the H1 gate covers both handoff context sites, the `Checkpoint` addition drops to one field, and the open W15, W17, W18 and W20 findings close; revision 14 applies the six-agent review of revision 13: the migration replay no longer writes the meta outside the lock, the default-on context-pack suffix is scoped in the H1 acceptance, the eviction split names two listeners, the dispatch-guard narrative is corrected, and the rev-13 citation regressions are reverted; revision 15 applies the three-agent review of revision 14: the goal-ledger counting rule and the two dropped-write paths are made to agree, the crash window is re-derived without a load-time rewrite, and the residual citation drift is corrected; revision 16 applies the three-agent final review of revision 15: the single-file resurrection assertion and the constant `closedAs` backfill are reconciled, the digest's two line shapes are pinned, `rebuildMeta` gains a read-back assertion, and the stale-goal attention path is completed.

## 1. What the re-evaluation found

### 1.1 `docs/FUTURE-WORK-PLAN.md` versus `docs/continuity-brief-v1.md`

| # | Point | `FUTURE-WORK-PLAN.md` | `docs/continuity-brief-v1.md` | Code | Verdict |
|---|---|---|---|---|---|
| T1 | `HandoffEntry` carries `implementer` / `reviewer` | Says the schema carries no model field, so pre-run comparison is impossible (section 3) | Says the type carries 11 fields that `HandoffEntrySchema` drops on reload (section 2) | `src/context/types.ts:42-81` carries them; `src/tools/handoff.ts:677-678` writes them; `src/validation.ts:74-95` omits them | Real conflict. Continuity is correct. The plan row must be marked superseded. |
| T2 | Schema payload is measured | Says measured, not estimated; 13,868 bytes is the accepted baseline | Says `prove-context-diet.ts` prints a frozen literal with the word `unchanged`, and no gate measures the live schema | `scripts/prove-context-diet.ts:151` interpolates `baseline.schemaPayload.bytes`; `scripts/prove-context-baseline.ts:92-98` checks the archived file, not the live value; `src/v2/setup.ts:541-547` only logs the live number | Real evidential conflict. Continuity is correct. Measured once, then frozen. |
| T3 | Reachability counters | 358 files, 342 reachable, 58,697 / 60,231 LOC, 97.45% | 361 total files (section 10) | `docs/experiments/baselines/2026-11-01-reachability.json`: 362 / 343, 60,436 / 58,698 | Numeric drift. Continuity is closer. The archived artifact is the authority. |
| T4 | Status | Closed 2026-11-01, counters frozen at 156/153, G-005 verified | 153 -> 155 steps, two new files, regenerate the reachability baseline | `scripts/gate-manifest.json`: 154 steps. `PINNED_PROOF_STEPS = 154`. `scripts/prove-run-interrupt.ts` and `scripts/prove-record-search.ts` do not exist | Status conflict, not design conflict. Neither document describes the current tree. |

### 1.2 Points that agree (verified against code)

- 44 tools. `src/tool-names.ts` lists 44 names.
- Description text 20,267 -> 16,147 bytes. Frozen target 16,213 bytes. Headroom 66 bytes.
- The B offsets were recomputed byte-for-byte against the live strings in `src/tools/handoff.ts:207-215` and `src/tools/record.ts:18-29`; all eight deltas reproduce exactly and the net is +16 bytes (section 11).
- 103 pinned constraint phrases across 11 fixture tools; 18 in `handoff` and 5 in `record`, 23 together.
- 153 steps was the count when both documents were written; the tree now has 154.
- No new tool. Continuity adds two actions to existing tools only.
- English only, no comments in `.ts`, 1.5 GB memory cap, sequential heavy operations. Unchanged.
- A0's data loss is real on every successful load, not only on a failed validation: `StateManager.tryLoadFile` returns `validation.sanitized` (`src/context/managers/StateManager.ts:704`), `validateStateData` returns `{ ...result.data }` (`:491-499`), and a plain `z.object` strips unknown keys. The 11 fields are removed even when the parse succeeds.
- `droppedHandoffs === 0` cannot detect A0's bug: an unfixed build parses the handoff successfully and silently removes the fields. The discriminating gate is a field-presence round-trip, not a drop count.

### 1.3 Current tree state that neither document describes

- The tree has 154 proof steps (177 named gate steps: 16 fast + 154 proofs + 6 smoke + 1 eval), the base both documents assume.
- `scripts/prove-run-interrupt.ts` and `scripts/prove-record-search.ts` do not exist.
- Reachability has moved again: the brief says 361 total files; the archive records 362 total and 343 reachable.
- `docs/FUTURE-WORK-PLAN.md` and `docs/continuity-brief-v1.md` are both untracked by git.
- `docs/experiments/baselines/README.md` fixes the naming convention `YYYY-MM-DD-context-baseline.json`, one file per date, and `scripts/measure-context-baseline.ts` refuses to overwrite. A new exploration artifact cannot live there under that convention.

### 1.4 Gaps found in this review

1. `prove-state-root-rollback` is not named in the continuity rollout table. A0 changes the signed state schema. The proof runs automatically in the shards, but the plan must name it as a gate for A0.
2. `RecordEntrySchema` (`src/validation.ts:39-49`) drops `provenance` and `decision_kind`, which the type carries (`src/context/types.ts:31-32`). `record.ts:112` writes `provenance` on every create; `decision_kind` has a type and a schema but no writer in `src/` today, so A0b restores the field without claiming a live producer. Same defect class as A0, same silent loss, two lines to fix.
3. `prove-context-diet` never measures the live schema payload (T2). Any statement of the post-change schema size is an estimate until a gate measures it.
4. `smartgrep` cannot be keyed by "matching files from the index" (D1). The tool runs `rg` over a directory (`src/tools/search-and-diff.ts:13-58`); a new matching file changes the result without changing any previously stamped file.
5. The `depmap` cache row is wrong (D2). The contract is `dir + depth + useAst` with `MAX_FILES = 300` (`src/tools/dependency-map.ts:13`) and a directory walk (`collectTsFiles`, `:92-130`), not "file stamp + one hop".
6. `projectmap` has no root stamp and no file cap (D3). It walks directories with `readdir` and `stat` (`src/tools/project-map.ts:77-128`); adding or deleting a file changes the parent directory's mtime, not any file's mtime.
7. The index key `sha256(root)` contradicts the project identity the repo already settled (D4). `src/utils/project-identity.ts` resolves `project.id` -> `canonical` -> `directory` -> `cwd`, and `prove-state-root-survival` pins that behaviour.
8. A second parser would duplicate `AstService` (E5). `depmap` and `ast-tools` already call `getAstService()` (`src/tools/dependency-map.ts:9`, `src/tools/ast-tools.ts:7`), which caches by `mtimeMs` and `size` (`src/services/ast-service.ts:230-237`).
9. Decision 3 of the current list (decision 2 in revision 1) contradicts section 11: it says the work "never adds a schema argument", while B adds three optional arguments plus one checkpoint field (E6).
10. The plan modelled `handoff(create)` as a raw context pass-through. It is not: `buildAccumulatedContext` (`src/tools/handoff.ts:21-166`) injects a Goals block, chain context, decision memory, learned lessons and evaluations on every create (`:670-679`), the main entry stores the merged context (`:685`), and `parallelCopies` stores `contextToUse` (`:805`), which may differ from the main entry. Section 20.6 records the exact behavior; section 7 no longer claims a raw copy.
11. The plan modelled a task as one stable unit. It is not: `decompose` splits on `,`, `;` and newlines and assigns `@dev` to complex single tasks (`src/services/task-orchestrator.ts:37-90`); `selectMode` turns a task into `swarm` or `moa` from its dependencies, files and success criteria (`src/services/strategy-dispatcher.ts:23-31`); `budgetGuard` and `setupDynamicPipeline` also react to effort. Section 20.9 records the four sites, and the bundle is built per `SubTask` after the split.

## 2. Decisions

1. **A0 ships before the intelligence work.** It repairs a live data-loss bug in the state schema. It is small, reversible, and independent of every later item.
2. **A0 also repairs `RecordEntrySchema` (A0b).** `record.ts` writes `provenance` on every create and the schema strips it on every load. Two optional fields, same `lenient` treatment, same commit.
3. **The index, cache, and bundle add no tool and no description line.** Continuity B adds three optional arguments to two existing tools plus one `Checkpoint` field, and pays for them inside the description headroom (section 11).
4. **The project index is a by-product of work the tools already do.** `projectmap` walks the tree, `astquery` and `readsymbol` parse files, `depmap` builds imports, `batchread` reads files. No boot-time indexing, no full scan.
5. **Validity comes from file and directory stamps, not from TTL.** TTL is cleanup only.
6. **Task context is referential, not content-bearing.** No file content in the bundle. The bundle names files, symbols, edges and reasons.
7. **No distributed locks, no new database, no MemoryAdapter, no second store.**
8. **Every new behavior is behind an environment flag** and ships with a registered proof.
9. **`smartgrep` is neither cached nor an index producer.** Its result depends on the whole scanned directory, and `rg` is already fast.
10. **`projectmap` is an index producer only, not a cache consumer.** Validating its output requires re-statting the whole walk, which is the walk.
11. **`astquery` and `readsymbol` are index producers only, not cache consumers.** `AstService` already caches parse results by `mtimeMs` and `size`; a second cache above it adds memory without adding correctness.
12. **The index is keyed by the host project identity, not by the working directory.** It lives under the resolved project root and survives worktrees.
13. **Every module reuses an existing service.** `AstService` for parsing, `FeatureIndex.getByFile` for features, `computeBudget` / `resolveModelWindow` / `byteLength` for the budget, `computeTextRelevance` / `tokenize` for ranking.
14. **Flags off means today's behaviour**, and a proof asserts it rather than assuming it. One defect exception is recorded: `TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT` (H1, section 22.1) defaults off because today's behaviour is the defect it repairs; the exception is listed in section 22.1 and Phase 5b.
15. **The zod upgrade is a pre-phase, not a feature phase.** `zod` moves from 4.1.8 to 4.6.7 in one standalone maintenance commit before A0. It adds no tool, no description byte, no flag, and no proof; it exists so A0 and A0b validate against the final schema engine once.
16. **Liveness is cross-platform, not Linux-only.** The existence check reuses `isProcessAlive`; the identity check has Linux, macOS and Windows backends, and a backend that cannot answer returns `unknown`, never a guess.
17. **The task context bundle rides on the dispatch path only.** It is delivered where `StrategyDispatcher` converts a `SubTask` into a `DispatchTask` (`src/services/strategy-dispatcher.ts:47-58`). It is not delivered on a direct `task` call, on `handoff(create)`, or on any path that needs a new hook. Section 20 states the six paths and the exact coverage.
18. **A normal user request for agents is a dispatch request, not a direct task, and it does not go through tawa.** `ctx.userExplicitDispatch` and `ctx.directRoutingAgent` exist for this, and the guards block direct `edit` / `write` / `bash` once either is set (`src/hooks/guards/resource-guards.ts:82-105`). Tawa runs only on an explicit `@tawa`, and `handoff` refuses `to: tawa` from a non-tawa caller (`src/tools/handoff.ts:651-653`). The plan records the detection gap in section 20.4 and does not depend on it for any acceptance.
19. **`handoff(create)` wraps `context` and can prefix `task`.** `buildAccumulatedContext` injects a Goals block, chain context, decision memory, learned lessons and evaluations before the caller's text; it does not rewrite `task`. Rescue and help requests prefix `task`; `to: tawa` is refused. Path C bypasses the tool, which is why the bundle survives there. Section 20.6 states the exact behavior; section 22.1 proposes the context options.
20. **A "task" is not a stable unit.** `decompose` splits on `,`, `;` and newlines and assigns `@dev` to complex single tasks; `selectMode` turns a task into `swarm` or `moa` from its dependencies, files and success criteria; `budgetGuard` and `setupDynamicPipeline` also react to effort. The bundle is therefore built per `SubTask`, after the split. Section 20.9 records the four sites.

## 3. Scope

### 3.1 In scope

- Repair `HandoffEntrySchema` (11 fields) and `RecordEntrySchema` (2 fields) with a `lenient` wrapper.
- Add the liveness module (`src/services/continuity/owner.ts`, `src/services/continuity/detect.ts`).
- Add `handoff(resumeInterrupted)`, `record(search)` and `record(limit)`, plus the `unverified[]` checkpoint field, all gated on `continuityEnabled()`.
- Add a persistent, incremental project index recorded by five producers: `projectmap`, `astquery`, `readsymbol`, `depmap`, `batchread`.
- Replace the `depmap` TTL cache with a stamp-validated read cache, and add the same cache to `batchread`. Two consumers, not six.
- Add a referential task context bundle that rides in `HandoffEntry.context/files`.
- Add metrics to the existing `health` / `dashboard` / `report` surface.

### 3.2 Out of scope

- Any 45th tool.
- Any distributed lock, singleflight across processes, or cross-process coordination.
- Any new database or MemoryAdapter.
- Context injection through `addagent` (it is a user-only config writer).
- Any transparent cache for host tools `read` / `grep` / `glob` / `bash`.
- Boot-time full indexing.
- Semantic search before AST + dependency graph.
- Caching any tool outside the two named in section 6.1; the exclusions are decisions 9-11.
- A second parser or a second AST cache.
- Any change to shipped skill descriptions, shipped skill count, or the description diet.

## 4. Modules

### 4.1 `src/services/project-index/`

| File | Responsibility |
|---|---|
| `types.ts` | `FileStamp`, `DirStamp`, `FileRecord`, `SymbolRecord`, `ImportEdge`, `IndexSnapshot` |
| `store.ts` | Load and atomic save at `projectStatePath(ctx.persistDir, "project-index/snapshot.json")` (`src/utils/state-paths.ts:49-51`, the `.opencode/` convention every other project file already uses), creating `project-index/` with `mkdirSync(..., { recursive: true })` before the first save, 24 MB cap, corrupt file or `projectKey` mismatch -> empty index |
| `builder.ts` | `recordTree`, `recordFile`, `recordImports`, `recordStamps`; parsing goes through `getAstService()` |
| `query.ts` | `findSymbol`, `symbolsInFile`, `dependents`, `dependentsClosure`, `filesByLang` |
| `index.ts` | `ProjectIndexService`, one entry point |

- `ctx.persistDir` is already the resolved project root when project mode is on (`src/bootstrap/plugin-init.ts:560-575`), so no `sha256(root)` subdirectory is needed.
- The snapshot records `projectKey`; a file copied between projects is rejected, not merged.
- Writes are temp-file plus rename, never in place.

### 4.2 `src/services/read-cache/`

| File | Responsibility |
|---|---|
| `types.ts` | `CacheEntry`, `CacheStats`, `CacheDecision` |
| `key.ts` | `canonicalJson` + sha256 |
| `lru.ts` | Byte-capped LRU, about 60 lines, no external dependency |
| `policy.ts` | Two tools, explicit argument shapes, explicit bypass rules |
| `index.ts` | `ReadCacheService.getOrCompute` |

### 4.3 `src/services/task-context/`

| File | Responsibility |
|---|---|
| `types.ts` | `TaskContextBundle`, `ContextItem`, `MissingContext` |
| `planner.ts` | Rank candidates from the index, `FeatureIndex.getByFile`, and `computeTextRelevance`; stat each candidate before including it |
| `render.ts` | Render the bundle as handoff text, at most 16 KB |
| `index.ts` | `TaskContextService` |

### 4.4 `src/services/continuity/`

| File | Responsibility |
|---|---|
| `owner.ts` | `probeOwner`, `stampOwner`, `clearOwner`, `clearRunFlags`, `touch`, `startHeartbeat`, `stopHeartbeat`; three private platform backends |
| `detect.ts` | `detectInterrupted` |

Liveness is cross-platform, not Linux-only. The existence half already has a helper: `isProcessAlive(pid)` in `src/utils/process.ts:2-17` handles `ESRCH` and the win32 `ERR_UNKNOWN_SIGNAL` case, and is already used by `src/context/session-manager.ts:158`, `src/infra/file-lock.ts` and `src/services/apply-patch.ts`. The continuity probe reuses it for "does this pid exist" and adds only the identity half: a process start time and a boot id.

| Platform | Process start | Boot id | Zombie state |
|---|---|---|---|
| Linux | `/proc/<pid>/stat` field 22 | `/proc/stat` `btime` | field 3, `Z` |
| macOS | `ps -o lstart= -p <pid>` with `LC_ALL=C`, parsed with `Date.parse` | `sysctl -n kern.boottime` | `ps -o state=`, `Z` |
| Windows | PowerShell CIM `Win32_Process` -> `CreationDate` as ISO 8601 | PowerShell CIM `Win32_OperatingSystem` -> `LastBootUpTime` | none; an exited process is gone |

Probe rules:

- `execFile` with a fixed argv, no shell, a 2000 ms timeout on the POSIX backends and 5000 ms on the two PowerShell CIM calls, and `Number.isInteger(pid)` checked before any interpolation. A cold PowerShell CIM start regularly exceeds 2000 ms, and a shorter timeout would return `unknown` forever on Windows.
- `src/utils/secure-exec.ts` is not used and its `ALLOWED_BINARIES` is not widened; PowerShell must never enter a generic allow-list.
- A backend that is missing, unreadable, times out or returns an unparsable value yields `unknown`. `unknown` never sets `interrupted` or `stale`.
- The probe runs only at detection time, once per distinct `pid:startedAt:bootId` key, and the result is cached; it is never on a tool hot path.
- Detection runs at three triggers: after `initPlugin` resolves, on every `handoff(resumeInterrupted)` call, and on the host idle surface, debounced to one run per 60 s per `pid:startedAt:bootId` key. The idle surface is `session.idle` from `src/v2/event-adapter.ts:153-170` and the `experimental.idle` registration in `src/v2/setup.ts:714`; both are subscribed after `ensureReady`, never on a tool path. The earlier citation `src/bootstrap/plugin-init.ts:1259` was wrong: that line is a rate-limit condition gated on `errMsg && sessId`, and the underscore token `session_idle` never matches the adapter's `session.idle`.
- The probe is never on the boot path. `detectInterrupted` is scheduled after `initPlugin` resolves and is not awaited by it, so `prove-boot-budget` (`BOOT_BUDGET_MS = 2000`, `scripts/prove-boot-budget.ts:22`) is unaffected by the probe timeouts.
- On Windows the zombie state does not exist; an exited process fails the existence check and is `gone`.
- State paths: `projectStatePath` resolves a path but does not create it (`src/utils/state-paths.ts:49-51`). `owner.ts` creates `continuity/` with `mkdirSync(..., { recursive: true })` before the first write; `store.ts` does the same for `project-index/`. The read cache is in memory and writes no file.

The owner record is defined in section 5.2. `probeOwner` returns `{ state, pid, startedAt, bootId, heartbeatAt, sessionId }`; `state` is one of `live`, `stale`, `interrupted`, `unknown`. `stampOwner` writes the record at the accept transition; `touch` moves `heartbeatAt` (writers in section 5.2); `clearRunFlags` clears `runState`, `interruptedAt`, `interruptedReason` and `resumedAt` on a terminal transition and is followed by `clearOwner`, so a terminal run leaves no record and the heartbeat interval stops when the set empties; `clearOwner` also deletes the record on undo. `stale` requires a live pid whose `heartbeatAt` is older than 30 minutes; `interrupted` requires a definitive dead probe; `unknown` sets nothing.

## 5. Data model

```ts
export type FileStamp = { path: string; mtimeMs: number; size: number };

export type DirStamp = { path: string; mtimeMs: number };

export type SymbolRecord = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "method" | "variable";
  startLine: number;
  endLine: number;
  exported: boolean;
};

export type ImportEdge = { from: string; specifier: string; to: string | null };

export type FileRecord = {
  stamp: FileStamp;
  lang: string;
  lines: number;
  hash: string;
  symbols: SymbolRecord[];
  imports: ImportEdge[];
};

export type IndexSnapshot = {
  schemaVersion: 1;
  projectKey: string;
  projectRoot: string;
  revision: string;
  generatedAt: number;
  files: Record<string, FileRecord>;
  dirs: Record<string, DirStamp>;
  reverse: Record<string, string[]>;
  stats: { files: number; symbols: number; edges: number; bytes: number };
};
```

- `hash` is computed once at record time and is not used on the read path.
- `revision` is sha256 over the sorted `(path, mtimeMs, size)` file set plus the sorted `(path, mtimeMs)` directory set.
- `reverse` is updated incrementally when imports are recorded and rebuilt only if it is corrupt.
- The snapshot is not written into the HMAC-signed state file and not into `context-pack/`.
- The index is a hint, never an answer: every consumer that reads content stats the file first and drops missing candidates into `missing[]`.

### 5.1 Continuity fields (exact contract)

A0 restores 11 fields that `HandoffEntrySchema` drops today. Every one of them is optional and `lenient` (`s.optional().catch(undefined)`), so a malformed value becomes `undefined` for that field only and never rejects the handoff:

`implementer?: AgentModelRef`, `reviewer?: AgentModelRef`, `sessionId?: string`, `turn?: number`, `acceptanceCriteria?: string[]`, `acknowledgedBy?: string`, `acknowledgedAt?: string`, `senderErrorCleared?: boolean`, `sourceDiscussionId?: string`, `reroutedModel?: string`, `credentialScope?: "inherit" | "isolated"`.

`credentialScope` is not the only exception to the `lenient` rule: its schema is `z.string()` while the type stays the closed union. A0b restores `provenance?: string` and `decision_kind?: string` on `RecordEntrySchema` with the same treatment, and both types are closed unions (`src/context/types.ts:31-32`). The plan does not coerce any of the three to its enum, because the hostile fixture requires `"bogus"` to survive as a string (section 9, Phase 1) and a dropped field is worse than a wide one. The three lenient fields are `credentialScope`, `provenance` and `decision_kind`.

A adds exactly eight optional `HandoffEntry` fields, and the schema mirrors them one for one (31 + 8 = 39 type fields, 20 + 11 + 8 = 39 schema fields):

| Field | Type | Writer |
|---|---|---|
| `ownerPid` | `number` | `stampOwner` |
| `ownerStartedAt` | `number` | `stampOwner` |
| `ownerBootId` | `string` | `stampOwner` |
| `heartbeatAt` | `string` | `stampOwner`, `touch` |
| `runState` | `"live" \| "stale" \| "interrupted" \| "unknown"` | `detectInterrupted` |
| `interruptedAt` | `string` | `detectInterrupted` |
| `interruptedReason` | `"gone" \| "zombie" \| "rebooted" \| "unknown"` | `detectInterrupted` |
| `resumedAt` | `string` | `resumeInterrupted` |

B adds exactly one optional `Checkpoint` field (4 + 1 = 5):

| Field | Type | Source |
|---|---|---|
| `unverified` | `string[]`, clipped to 5 | `handoff(create)` |

`CheckpointSchema` already mirrors all four current fields (`src/validation.ts:51-63`), so `+1` is a new contract, not a repair. Revision 13 drops the earlier `missing` and `bundleDigest` fields: the bundle is not delivered on path D (`handoff(create)`), so both would be dead on the only writer, and `unverified` is the one field the caller can supply without the bundle. The earlier draft's `mirror Checkpoint +3` was wrong and is withdrawn. The Phase 1 hostile fixture stays scoped to the 13 A0/A0b fields; `unverified` is a B field and is covered by `prove-handoff-context-shape`, not by that fixture.

### 5.2 Owner record

```ts
export type OwnerState = "live" | "stale" | "interrupted" | "unknown";

export type OwnerRecord = {
  pid: number;
  startedAt: number;
  bootId: string;
  heartbeatAt: string;
  sessionId: string;
};
```

- Location: `projectStatePath(ctx.persistDir, "continuity/owners.json")`. `projectStatePath` only resolves the path (`src/utils/state-paths.ts:49-51`), so `owner.ts` creates `continuity/` with `mkdirSync(..., { recursive: true })` before the first write. One file, atomic temp-plus-rename, keyed by handoff id.
- Stale threshold: `heartbeatAt` older than 30 minutes while the probe reports the pid alive. Stale never sets `interrupted`.
- Heartbeat writer: `touch` runs on every accept transition and every resume, and a single unref'd 60 s interval refreshes `heartbeatAt` while at least one non-terminal owner record exists. The interval starts with the first `stampOwner` and is cleared when the last owner record is deleted or reaches a terminal state, or when the service is disposed. The writer is scoped to the current process: it refreshes only records whose `pid` equals `process.pid` and leaves a record owned by another live host process to that process. Writes are serialized in-process: at most one write in flight, at most one queued rewrite, and at most one atomic rewrite per 60 s tick; the writer never blocks a tool call. A terminal transition cancels any queued heartbeat rewrite for that record, calls `clearRunFlags`, then calls `clearOwner`, so the record is removed and the timer stops when the set empties; a queued write can never resurrect a terminal record. Without the interval, a live run older than 30 minutes would be reported `stale`.
- Non-owner: a resume whose `sessionId` differs from the record's `sessionId`. The record is the only authority; there is no ambient identity.
- The detection cache is keyed by `pid:startedAt:bootId` and capped at 64 entries.

### 5.3 Cache entry

```ts
export type CacheEntry = {
  key: string;
  tool: "depmap" | "batchread";
  value: unknown;
  bytes: number;
  createdAt: number;
  lastHitAt: number;
  files: FileStamp[];
  dirs: DirStamp[];
};
```

The entry stores the stamps it was built from. Section 6.3 cannot validate a lookup without them: the key is a hash and is not reversible.

## 6. Read cache

This section is the single normative description of the read cache. Section 2 items 5 and 9-11 record the decisions and their rationale; sections 3.2, 4.2, 5.3, 8, 9 (Phase 3), 12 and 13 record consequences and defer to this section for the rules rather than restating them.

### 6.1 Cacheable tools

| Tool | Fingerprint in the key | Exclusion |
|---|---|---|
| `depmap` | `dir`, `depth`, `useAst` + stamps of every walked file + stamps of every walked directory | Never cached above 300 files (the tool cap) or above 256 stamped paths |
| `batchread` | sorted stamps of every path + `limit` | Never cached above 50 paths (the tool cap) or above 2 MB summed across the returned file contents; the cap is on the entry payload, not on each file |

Never cached: `projectmap`, `astquery`, `readsymbol`, `smartgrep`, `read`, `grep`, `glob`, `bash`, `shell`, `edit`, `write`, `apply_patch`, `codestate`, `handoff`, `task_orchestrate`, and every write or execution tool.

The three exclusions are decision records in section 2 (items 9-11); their rationale is not restated here. `projectmap`, `astquery` and `readsymbol` are index producers only, and `smartgrep` is neither an index producer nor cacheable.

### 6.2 Key

```ts
key = sha256(canonicalJson({
  tool,
  args,
  projectKey,
  files: sortedFileStamps,
  dirs: sortedDirStamps,
}));
```

Option B, scoping the hash to the entry's own stamped paths, was rejected 6-0 in revision 9: those stamps are already in the key, so B re-hashes identical inputs and collapses into A. The rejected option is kept here for audit; section 26.3 records the vote.

### 6.3 Lookup

```
lookup(key):
  entry = lru.get(key)
  if entry is missing -> miss
  for each file stamp in entry.files:
    stat the path (mtimeMs + size only)
    if mtimeMs or size differs -> evict, miss
  for each directory stamp in entry.dirs:
    stat the path (mtimeMs only)
    if mtimeMs differs -> evict, miss
  -> hit
```

- One `stat` per stamped path, capped at 256 paths per key.
- Directory stamps are what catch file creation and deletion: the parent directory's `mtimeMs` changes, no file stamp does.
- No SHA-256 on the hot path.
- No central invalidation. A changed path turns the first lookup into a miss.

### 6.4 Limits

| Limit | Value | Override |
|---|---|---|
| Total memory | 48 MB | `TAWASSUL_READ_CACHE_MB` |
| Single entry (summed payload) | 2 MB | — |
| Stamped paths per key | 256 | — |
| Soft TTL | 10 minutes | — |
| Hard TTL | 60 minutes | — |
| Kill switch | — | `TAWASSUL_READ_CACHE=0` |

`depmap` walks up to `MAX_FILES = 300` (`src/tools/dependency-map.ts:13`), above the 256 stamped-path cap, and this repository has 362 files (reachability baseline). A root-level `depmap` run is therefore a permanent miss by design: the cap bounds the `stat` cost of a lookup, and the cache proofs use a fixture tree below the cap. The plan does not raise the cap to 300, because a 300-path `stat` sweep on every lookup costs more than the walk it replaces.

TTL is cleanup only. A lookup never rejects an entry because of age: if the stamps match, the entry is a hit even after the hard TTL. The soft TTL only makes an entry the first candidate for eviction, and the hard TTL only bounds how long an unused entry may occupy memory; both are enforced by the cleanup pass, not by `lookup` (section 6.3 has no time check). This is decision 5 and ledger row 9.

## 7. Task context bundle

```ts
export type ContextItem =
  | { kind: "file"; path: string; stamp: FileStamp; reason: string; score: number }
  | { kind: "symbol"; path: string; name: string; symbolKind: string;
      startLine: number; endLine: number; reason: string; score: number }
  | { kind: "edge"; from: string; to: string; reason: string; score: number };

export type TaskContextBundle = {
  schemaVersion: 1;
  taskId: string;
  task: string;
  projectKey: string;
  revision: string;
  items: ContextItem[];
  missing: string[];
  bytes: number;
  truncated: boolean;
};
```

- No `content` field. Every item carries a non-empty `reason`.
- Generation: `tokenize` + `computeTextRelevance` from `src/lib/classifier.ts:10-40`, `FeatureIndex.getByFile(file)` (`src/services/feature-index.ts:258`), and index queries. Rank, de-duplicate, stat-validate, cap at 40 items.
- Budget: reuse `computeBudget` / `resolveModelWindow` / `byteLength` from `src/services/context-pack/accounting.ts:15-55`.
- Delivery, corrected in rev. 5. The bundle is built in `TaskOrchestrator.decompose`, not in `execute`:
  - `SubTask` gains `context?: string` and `declaredFiles?: string[]` (`src/types/plan.types.ts:1-9`); `DispatchTask` gains `declaredFiles?: string[]` and `copyOf?: string` (`src/services/parallel-dispatcher.ts:8-17`).
  - `decompose` sets `declaredFiles` from the caller's declared files before the bundle is attached, for every `SubTask` it returns, including the unsplit and empty cases (`[]`), then fills `files` (the bundle's file items) and `context` (the rendered bundle, at most 16 KB) (`src/services/task-orchestrator.ts:37-90`). Today `decompose` hardcodes `files: []` at `:49` and `:73`, so `files` is empty before this phase; `declaredFiles` is captured first so the new `files` value cannot change the mode or the conflict map. `StrategyDispatcher.selectMode` reads `declaredFiles ?? files`, so the bundle's file list never selects `swarm` or `moa`. Because `decompose` writes `declaredFiles` on every task, the fallback never reaches bundle files. The bundle is built after the split, so a comma-separated task gets one bundle per part; a complex single task keeps `preferredRole: "@dev"` and gets one bundle (section 20.9).
  - `declaredFiles` is populated before the bundle by a path-token extractor over each `SubTask` description, because neither `task_orchestrate` nor `moa` takes a file argument today. A token qualifies when it contains `/` and matches `(?:\./)?[\w.@-]+(?:/[\w.@-]+)+`, or when it is a bare token ending in one of `.ts .tsx .js .jsx .mjs .cjs .json .md .css .html .py .go .rs .java .c .h .cpp .hpp .sh .yml .yaml .toml`. The list is de-duplicated, capped at 50, and `[]` when no token matches. It is not the bundle's ranked `files` list: the bundle may add files the text does not name, and `declaredFiles` never grows after the split.
  - `StrategyDispatcher.singleTaskToDispatchTask` forwards `task.context` instead of the hardcoded `context: ""`, and forwards `declaredFiles` (`src/services/strategy-dispatcher.ts:47-58`).
  - `ParallelDispatcher.buildPlan` derives `fileConflicts` from `declaredFiles ?? files`, not from the bundle's `files` (`src/services/parallel-dispatcher.ts:56-69`), and counts a conflict only when the colliding tasks belong to different `copyOf` groups (`copyOf ?? id`). `StrategyDispatcher.dispatchToRoles` sets `copyOf: task.id` on every role copy alongside `declaredFiles` (`src/services/strategy-dispatcher.ts:68-81`), so role copies of one `SubTask` are not self-conflicting and a dependency-driven swarm with a ten-file bundle still produces one parallel batch instead of serializing.
  - `ParallelDispatcher.createHandoff` already forwards `context` and `files` to the handoff (`src/services/parallel-dispatcher.ts:289-295`), so no change is needed there.
- `TaskOrchestrator.execute` (`:93`) is not the delivery point. It has no callers in `src/`; both live tools call `decompose` then `strategyDispatcher.dispatch` (`src/tools/tawa/task-orchestrate.ts:27-32`, `src/tools/tawa/moa.ts:31-41`). An earlier draft built the bundle inside `execute`, which would have shipped dead code and failed its own proof.
- `addagent` is not touched.
- `handoff(create)` is not a raw pass-through. The tool injects accumulated context before storing the entry: `buildAccumulatedContext` (`src/tools/handoff.ts:21-166`) prepends a Goals section, chain context (previous deliveries, decisions, changed files), decision memory, learned lessons and evaluation summaries, then appends the caller's text under `## 🆕 New Context (for <agent>)`. A context shorter than 5 words goes through the merge branch (`:495-505`); a longer context goes through the normal create path (`:670-679`). The main entry stores `accumulatedContext` (`:685`). `parallelCopies` stores `contextToUse` (`:805`): the merged block for a short input only when that block reaches 10 words, otherwise the caller's original text; for 5 words or more it is always the caller's original text. Copies may therefore not match the main entry. The bundle is therefore not delivered on path D, and this plan does not change that path.
- A direct `task` call from any agent is not touched: delivering there would need a new `tool.execute.before` hook, which section 8 excludes. Section 20 states the resulting coverage.
- Kill switch: `TAWASSUL_TASK_CONTEXT=0`.

## 8. Modified and new files

| File | Change | Size |
|---|---|---|
| `src/validation.ts` | 11 `HandoffEntry` fields + 2 `RecordEntry` fields + `AgentModelRefSchema` + `lenient`; the 8 continuity fields and the 1 `Checkpoint` field from section 5.1 | low |
| `src/context/types.ts` | The 8 continuity fields on `HandoffEntry`, the 1 `Checkpoint` field, `TawassulConfig.continuity` | none |
| `src/context/config-schema.ts` | `continuity` block | none |
| `src/context-class.ts` | `projectIdentity` and `intelligence` fields | ~4 lines |
| `src/context.ts` / `src/core/service-context.ts` | Service fields | ~6 lines |
| `src/tools/project-map.ts` | `recordTree` only, no cache | ~12 lines |
| `src/tools/ast-tools.ts` | `recordFile` only, no cache | ~20 lines |
| `src/tools/dependency-map.ts` | Replace the 5-entry / 30s cache with the read cache + `recordImports` | ~30 lines |
| `src/tools/search-and-diff.ts` | Wrap `batchread` only; `smartgrep` untouched | ~12 lines |
| `src/tools/handoff.ts` | `clearRunFlags` in fallback branches; `resumeInterrupted` action; `unverified` in the create checkpoint; the description offsets in section 11 | medium |
| `src/tools/record.ts` | `search`, `limit`, description offsets in section 11 | low |
| `src/types/plan.types.ts` | `SubTask.context?: string` and `SubTask.declaredFiles?: string[]` | 2 lines |
| `src/services/task-orchestrator.ts` | Fourth constructor parameter; a path-token extractor fills `declaredFiles` on every `SubTask` (including `[]`), then `decompose` fills `context` and `files` from the bundle; `execute` is untouched. `decompose` stays synchronous (`:37`) and the planner uses `statSync`, so neither call site changes (`src/tools/tawa/task-orchestrate.ts:27`, `src/tools/tawa/moa.ts:31`) | ~34 lines |
| `src/services/strategy-dispatcher.ts` | Forward `task.context` and `task.declaredFiles`; `selectMode` reads `task.declaredFiles ?? task.files`; `dispatchToRoles` sets `copyOf: task.id` on each role copy | ~7 lines |
| `src/services/parallel-dispatcher.ts` | `DispatchTask.declaredFiles?: string[]` and `copyOf?: string` (`:8-17`); `buildPlan` computes `fileConflicts` from `declaredFiles ?? files` and groups by `copyOf ?? id` so role copies are not self-conflicting | ~8 lines |
| `src/bootstrap/service-factory.ts` | Construct the three new services; pass the bundle builder to the orchestrator | ~12 lines |
| `src/bootstrap/plugin-init.ts` | `configureContinuity` + guarded, deferred `detectInterrupted` after the `try`/`catch`; pass `projectIdentity` into the context. The idle trigger is not here: it subscribes to `session.idle` in `src/v2/event-adapter.ts` and `experimental.idle` in `src/v2/setup.ts` | medium |
| `src/v2/event-adapter.ts` | Debounced `detectInterrupted` on the `session.idle` branch, one run per 60 s per `pid:startedAt:bootId` | ~6 lines |
| `src/v2/setup.ts` | The same debounced detection on the `experimental.idle` registration | ~6 lines |
| `src/bootstrap/memory-integrations.ts` | Two listeners, not one shared function: the `CACHE_CLEANUP_REQUESTED` listener stays cache-only, and a dedicated `MEMORY_EMERGENCY` listener also evicts the index. `runCleanup` (`:17-28`) is shared by both events (`:44-61`), so putting the index eviction inside it would drop the index on every ordinary flush | ~10 lines |
| `src/hooks/message-updated.ts` | Gated `stampOwner(h)` at the accept transition (`:306`) | medium |
| `src/services/handoff-service.ts` | `touch` on accept and resume; `clearRunFlags` + `clearOwner` on terminal transitions; `clearOwner` on undo; the resume transition + authorization; extends the existing `resumeInterruptedSagas` (`:293`) rather than adding a second recovery path | medium |
| `src/tools/tawa/health.ts` | `intelligence` block in the health output | ~20 lines |
| `src/tools/tawa/dashboard.ts` | One intelligence line | ~6 lines |
| `src/tools/diagnostics.ts` | `intelligence` block in `report` only | ~15 lines |
| `src/i18n/en.json` | About 10 keys for B; A logs through `logger` and needs none | none |
| `src/i18n/ar.json` | The same 10 keys with identical placeholders; `prove-feature-index-english.ts:158-172` enforces key and placeholder parity, so an English-only edit turns the gate red | none |
| `scripts/measure-context-baseline.ts` | `--out <path>`, landed in the zod pre-phase commit (section 16.3), so section 16.4 step 7 can write a receipt instead of the frozen archive | ~6 lines |
| `docs/continuity-detection.md` | New: the precedence table B depends on | new doc |
| `scripts/measure-exploration.ts` | New: Phase 0 measurement, not a proof | new script |

New source files: `src/services/continuity/` (2), `src/services/project-index/` (5), `src/services/read-cache/` (5), `src/services/task-context/` (4). No new hook. No new tool. `src/services/context-pack/*` untouched.

`handoff` rewrites the task text for rescue and help requests and refuses `to: tawa` from a non-tawa caller (section 20.6). The plan does not change that behaviour, and no bundle marker is ever written into `task`.

The zod maintenance in section 16 is outside this table: it touches `package.json`, `package-lock.json`, `THIRD-PARTY-NOTICES.md`, and the generated `tawassul.schema.json`, and it changes no source file.

## 9. Phases and acceptance

Pre-phase — Dependency maintenance (section 16, half a day). Land zod 4.6.7 before Phase 1. No flag, no proof, no feature behaviour.

### Phase 0 — Baseline (half a day)

- `scripts/measure-exploration.ts` (not a proof) reads `tool-run-log` and prints per-tool calls, repetition by `argsHash` within and between sessions, unique files from `input.path` / `input.files` / `input.paths`, and bytes.
- The log is persisted at `<stateDir>/.opencode/tool-run-log.json` and capped at `MAX_MEMORY_ENTRIES = 2000` (`src/services/tool-run-log.ts:59`). The receipt records the window it actually saw, so a rate computed from a truncated log is labelled as such.
- The output is saved as `docs/experiments/receipts/YYYY-MM-DD-exploration.json`. It does not go under `docs/experiments/baselines/`, whose README fixes a different filename and an immutability rule.
- The same phase records the live schema payload to `docs/experiments/receipts/YYYY-MM-DD-schema-payload.json`. That value is the golden file `prove-context-diet` asserts (section 10.3); it is updated only in the commit that changes a tool schema, so a silent drift turns the gate red.
- Acceptance: a real table, zero behavior change, zero new proofs.

### Phase 1 — Continuity A0 + A0b + A (2 days)

- A0: `HandoffEntrySchema` gains the 11 fields, each wrapped in `lenient` (`s.optional().catch(undefined)`).
- A0b: `RecordEntrySchema` gains `provenance` and `decision_kind`, both `lenient`.
- A: liveness module, 9 call sites, detection loop, config and the one-resolution gate.
- Include `prove-state-root-rollback` and `prove-tool-name-hash` as named gates.
- Acceptance:
  - Field-presence round-trip: every one of the 11 A0 fields and both A0b fields that is present before `validateStateData` is still present after write and reload. `droppedHandoffs === 0` is recorded but is not the gate; it passes on an unfixed build.
  - A hostile fixture (`turn: "3"`, `acceptanceCriteria: [null]`, `implementer: 42`, `null` in every one of the 13 restored fields) becomes `undefined` per field while `credentialScope: "bogus"` survives as the string `"bogus"`. Section 5.1 makes that field `z.string()` for exactly this reason. The fixture is scoped to the 13 fields; older optional fields keep plain `.optional()` and are not widened.
  - A `SIGKILL`ed handoff is `interrupted` with reason `gone`; a zombie and a rebooted owner are also `interrupted`; a live owner with an old heartbeat is `stale`, never `interrupted`.
  - A live owner whose run exceeds 30 minutes stays `live`, because the 60 s heartbeat writer refreshes `heartbeatAt`; a hung owner with no refresh for 30 minutes is `stale`. A terminal transition removes the record and stops the interval; a record owned by another live pid is not refreshed. A mid-session `session.idle` event pushed through the v2 adapter, and the `experimental.idle` registration, run the same debounced detection as boot; the proof pushes one event and observes exactly one run per 60 s, with the debounce key `pid:startedAt:bootId`.
  - The same fixture runs on all three backends: Linux `/proc`, macOS `ps` + `sysctl`, and Windows PowerShell CIM. The proof parses golden output fixtures for all three and runs the live backend of the host, so a Linux-only CI still covers the other two parsers.
  - A backend that is missing, unreadable, times out or returns an unparsable value yields `unknown` and sets neither flag; this is asserted for each backend.
  - The probe path adds zero state writes; the heartbeat performs at most one atomic rewrite of `owners.json` per 60 s while at least one non-terminal record owned by the current pid exists, with one in-flight write and one queued rewrite, and the write never blocks a tool call (W17). Read count equals the number of distinct `pid:startedAt:bootId` keys at the cap.
  - 44 tools still registered with continuity disabled; zero reads and zero writes while disabled. `prove-intelligence-off.ts` is created here with `TAWASSUL_CONTINUITY=0` and extended by Phases 2, 3, 4 and 5b; Phase 6 runs the full five-flag assertion.
  - `prove-boot-budget` stays green: `detectInterrupted` is scheduled after init resolves and is not awaited by it (section 4.4).
- Kill switch: `TAWASSUL_CONTINUITY=0`.

### Phase 2 — Project index (2-3 days)

- The five-file module plus recording in `projectmap`, `astquery`, `readsymbol`, `depmap`, `batchread`.
- Parsing goes through `getAstService()`; no second parser and no second AST cache.
- Acceptance:
  - `prove-project-index-byproduct.ts`: a `projectmap` call followed by an `astquery` records files, directories and symbols; the second call does not re-parse an unchanged file; two working directories that share one host project id read the same snapshot.
  - `prove-project-index-incremental.ts`: changing one file re-parses only that file; the other records keep their stamps; a new file appears after its parent directory is re-walked.
  - `prove-project-index-corrupt.ts`: a corrupt snapshot on disk yields an empty index, the tool still works, and the next write replaces it.
- Kill switch: `TAWASSUL_PROJECT_INDEX=0`.

### Phase 3 — Read cache (1-2 days)

- The five-file module plus policy and integration in two tools: `depmap` and `batchread`. The rules are section 6; this phase only sequences them.
- Acceptance:
  - `prove-read-cache-hit.ts`: two identical `depmap` calls run once, return identical output, and the hit counter increases.
  - `prove-read-cache-stamp-miss.ts`: editing a file forces recomputation; adding a file to a walked directory forces recomputation through the directory stamp; no stale result is returned.
  - `prove-read-cache-bypass.ts`: `batchread` with 51 paths (the tool cap is 50) and `smartgrep` over the project root write nothing to the cache.
  - `prove-read-cache-unrelated-edit.ts`: editing a file outside the entry's file stamps and outside every stamped directory does not evict the entry; the next call hits and returns identical output. This is the mitigation promised in section 26.3.
  - `prove-read-cache-byte-cap.ts`: exceeding the byte cap evicts under LRU and total bytes stay under the cap.
- Kill switch: `TAWASSUL_READ_CACHE=0`.

### Phase 4 — Task context bundle (2 days)

- Planner, renderer, budget, and the `decompose` -> `StrategyDispatcher` integration described in section 7. `TaskOrchestrator.execute` is not touched.
- Acceptance:
  - `prove-task-context-bundle.ts`: `task_orchestrate` produces handoffs whose `context` carries the bundle header and reasons and whose `files` match; every item has a non-empty `reason`; no item carries file content; a comma-separated task yields one bundle per `SubTask`, and a complex single task keeps `preferredRole: "@dev"` with its own bundle (section 20.9).
  - A bundle with more than five files does not change the dispatch mode: `selectMode` reads `declaredFiles`, so a task text naming one file (`src/a.ts`) with a ten-file bundle stays a single task and never becomes `swarm` or `moa`; a `SubTask` with `declaredFiles: []` also stays single, proving the fallback never reaches bundle files.
  - A bundle does not change the parallel shape either: a dependency-driven `swarm` whose `declaredFiles` are disjoint produces one parallel batch even when the bundle lists ten shared files, because `buildPlan` reads `declaredFiles ?? files` and groups by `copyOf ?? id`; `dispatchToRoles` sets `copyOf` on every role copy, so the copies are not self-conflicting.
  - The same proof asserts the negative: a direct `task` call is not rewritten, and `handoff(create)` keeps its existing `buildAccumulatedContext` injection unchanged in Phase 4; neither path receives the bundle, because no `tool.execute.before` hook is added (section 20.6). Phase 5b changes path D behind the H1 flag, so this acceptance is scoped to Phase 4, and `prove-intelligence-off` at Phase 4 asserts the same unchanged injection; its verbatim assertion is added in Phase 5b.
  - `prove-task-context-budget.ts`: a large task yields `truncated=true` with a non-empty `missing` list and no handoff above 16 KB.
  - `prove-task-context-distinct.ts`: two different tasks produce two different bundles; no bundle is shared across tasks; a deleted file moves from `items` to `missing`.
- Kill switch: `TAWASSUL_TASK_CONTEXT=0`.

### Phase 5 — Continuity B (1 day)

- `handoff(resumeInterrupted)`, `unverified[]`, `record(search)`, `record(limit)`.
- Acceptance:
  - `prove-continuity-resume.ts`: `SIGKILL` -> `detectInterrupted` -> `resumeInterrupted` -> complete, end to end.
  - A non-interrupted resume writes nothing. A stale resume and a disabled resume are refused. A non-owner is refused. All four cases are in `prove-continuity-resume.ts`.
  - `unverified` above 5 entries is clipped and the handoff survives `validateStateData`.
  - `record(search)` returns ranked hits, respects `limit`, caps at 20, and never mutates the record list. Search cost is asserted as an operation count, not wall-clock.
  - The description surface is re-measured, not assumed: it must read 16,163 bytes and `prove-constraint-retention` must be green.
- Kill switch: the B actions refuse while `continuityEnabled()` is false.

### Phase 5b — Handoff context (1-1.5 days)

- Dependencies: A0's restored `sessionId` from Phase 1 (H3 cannot scope without it) and path C's bundle from Phase 4 (H4 must keep it verbatim). It does not depend on Phase 5's resume/record work.
- H1-H6 from section 22.1: the `TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT` flag, current-first background, session/chain scope, one builder for the tool and `parallelCopies`, log-only observability, and the Goals-block removal.
- Acceptance: the section 22.1 acceptance list. With the flag off (the default, and the decision-14 defect exception in section 2) and `TAWASSUL_CONTEXT_HANDOFF=0`, `HandoffEntry.context` equals the caller's context after trim for both a short and a long input, because the two gated sites are separate; with the context pack enabled the stored context is the caller's text plus one labeled `## Portable Context Pack` suffix, which is pre-existing and default-on (`src/tools/handoff.ts:717-727`). With the flag on, the stored context starts with the caller's text, carries at most 4 KiB of background, and sets `truncated: true` when the cap is hit. Path C keeps the bundle verbatim.
- Proofs: `prove-handoff-context-shape.ts` and `prove-handoff-context-parity.ts`, plus the two extensions named in section 22.1. The verbatim assertion is added to `prove-intelligence-off` in this phase, not in Phase 4: before 5b the H1 flag does not exist, so Phase 4's "injection unchanged" acceptance and Phase 6's "verbatim" assertion are not in conflict.
- Sequencing: 5b is independent of Phase 5's content but is not optional within this plan. Dropping it requires the same change to edit Phase 6's five-flag assertion, the `prove-intelligence-off` verbatim line, and the 171 / 174 counters.
- Kill switch: `TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT=0` (the default).

### Phase 6 — Metrics and documentation (1-2 days)

- `intelligence` block in `health`: `cacheHits`, `cacheMisses`, `cacheBytes`, `indexFiles`, `indexSymbols`, `indexEdges`, `indexBytes`, `bundlesBuilt`, `bundleBytes`.
- Extend `dashboard` and `report`. No new metrics collector.
- `prove-intelligence-off.ts`: all five flags off, no `project-index/` or cache files written, `ctx.intelligence` undefined, `depmap` executes twice, `task_orchestrate` handoffs carry an empty `context`, `resumeInterrupted` refuses, and `handoff(create)` stores the caller's context verbatim.
- The same proof asserts the memory path: a `CACHE_CLEANUP_REQUESTED` event drops `cacheBytes` to zero and leaves the index readable, because that listener calls the cache eviction only; the index eviction runs on the dedicated `MEMORY_EMERGENCY` listener (section 8).
- One paragraph in `docs/architecture.md`, fields in `docs/monitoring.md`, the precedence table in `docs/continuity-detection.md`, regenerated counters.
- `npm run verify`, then `npm run gate:proofs:1..4`.

Total estimate: 10.5-14 working days for one engineer for Phases 0-6 plus Phase 5b (0.5 + 2 + 2-3 + 1-2 + 2 + 1 + 1-1.5 + 1-2); the half-day zod pre-phase is additional. The earlier 9-11 estimate understated the upper bound; the Phase 5b track is new in revision 11.

## 10. Proofs and gate impact

### 10.1 New proofs (15)

| Proof | Phase |
|---|---|
| `scripts/prove-run-interrupt.ts` | 1 |
| `scripts/prove-record-search.ts` | 5 |
| `scripts/prove-continuity-resume.ts` | 5 |
| `scripts/prove-project-index-byproduct.ts` | 2 |
| `scripts/prove-project-index-incremental.ts` | 2 |
| `scripts/prove-project-index-corrupt.ts` | 2 |
| `scripts/prove-read-cache-hit.ts` | 3 |
| `scripts/prove-read-cache-stamp-miss.ts` | 3 |
| `scripts/prove-read-cache-unrelated-edit.ts` | 3 |
| `scripts/prove-read-cache-bypass.ts` | 3 |
| `scripts/prove-read-cache-byte-cap.ts` | 3 |
| `scripts/prove-task-context-bundle.ts` | 4 |
| `scripts/prove-task-context-budget.ts` | 4 |
| `scripts/prove-task-context-distinct.ts` | 4 |
| `scripts/prove-intelligence-off.ts` | 1 (extended through 6) |

### 10.2 Registration steps for each proof

- Add the file to `PINNED_PROOF_FILES` in `scripts/prove-proof-catalog.ts:70`.
- Bump `PINNED_PROOF_STEPS` by one per landed proof (154 -> 155 -> ... -> 169 for the fifteen proofs in this section; the two Phase 5b handoff proofs bring the main plan to 171). The catalog asserts exact equality (`:269`), so a partial update (a file added without the pin, or the pin without the file) fails at the intermediate commit. Four assertions move together: the pinned file list (`:236-239`), the one-owner-per-proof check (`:241-254`), the proof-stage count (`:269`), and the shard coverage in `scripts/proof-shards.json` (`:271-285`), so a new proof must land in all four at once.
- Add the step to `scripts/gate-manifest.json` under `proofs`, exactly one owner per step.
- Assign the step in `scripts/proof-shards.json`; the shard estimates must stay inside the 10% band.
- Run `bun scripts/generate-proof-count.ts`; it rewrites the generated counters in `AGENTS.md`, `README.md`, `TRIAGE.md`, `docs/validation.md`, and `docs/portable-context-handoff.md`. The fast gate runs it with `--check`.
- Regenerate the reachability baseline with `bun scripts/prove-reachability-audit.ts --write` and confirm the file and LOC shares stay inside their +/-0.02 tolerances.

### 10.3 Named gates

| Change | Gate |
|---|---|
| Every phase | `prove-tool-name-hash` (44 names, unchanged name-set hash) |
| A0 / A0b | field-presence round-trip + hostile fixture + `prove-state-root-rollback` |
| A | `prove-run-interrupt` with three-backend fixtures, `prove-boot-budget` (no probe before init resolves), 44 tools still registered with continuity disabled, zero reads / zero writes while disabled |
| B | `prove-record-search`, `prove-continuity-resume`, `prove-context-diet` at or below 16,213 bytes, `prove-constraint-retention` |
| Index | the three `prove-project-index-*` proofs |
| Cache | the five `prove-read-cache-*` proofs, including the unrelated-edit hit |
| Bundle | the three `prove-task-context-*` proofs, including the negative assertion that a direct `task` call receives no bundle, that `handoff(create)` keeps its existing accumulated-context injection in Phase 4, and that a bundle over five files neither selects `swarm` nor serializes a parallel batch |
| Handoff context | `prove-handoff-context-shape`, `prove-handoff-context-parity`, plus the two extensions; the verbatim line in `prove-intelligence-off` is added here |
| Schema payload (W20) | `prove-context-diet` measures the live schema payload from the registered tool schemas, not the archived literal, and asserts it equals the golden value recorded in Phase 0 (`docs/experiments/receipts/YYYY-MM-DD-schema-payload.json`); the receipt is updated only in the commit that changes a schema, and the archived 13,868 B stays frozen. This is an extension of an existing step, so the step count does not change |
| Every phase from 1 | `prove-intelligence-off`, extended at each phase; Phase 6 runs the full five-flag assertion |

### 10.4 Impact table

| Item | Before | After |
|---|---|---|
| Tools | 44 | 44 (no tool-name hash regeneration) |
| Proof steps | 154 | 169 for the proofs in section 10.1; 171 with the two handoff proofs in section 22.1 |
| New proofs | — | 15 in section 10.1; 17 with section 22.1 |
| New source files | — | 16 |
| New docs / scripts | — | 1 doc, 1 measurement script |
| New dependencies | — | 0 |
| Dependency baseline | zod 4.1.8 | zod 4.6.7 before Phase 1 (section 16); no new dependency |
| Description surface | 16,147 B | 16,163 B (only if B ships) |
| Schema payload | 13,868 B in the archive, measured under zod 4.1.8; live value unmeasured by any gate | Archive unchanged; the live value is re-measured after the zod upgrade (section 16.4) and moves by an unmeasured amount for A0/A0b/A and by an unmeasured, smaller amount for B (one checkpoint field; the brief's 337 B assumed three and is withdrawn) |
| Memory | 1.5 GB cap | + at most 72 MB (index 24 MB, cache 48 MB), byte-capped |

## 11. Description offsets for B (section 8.4 of continuity-brief-v1)

The deltas below were recomputed byte-for-byte against the live strings in `src/tools/handoff.ts:207-215` and `src/tools/record.ts:18-29`. The em dash in the `parallelCopies` replacement is part of the measured string; an ASCII hyphen would make that delta -42 instead of -40.

| Tool | Change | Bytes |
|---|---|---|
| `handoff` | add `• resumeInterrupted — Required: resumeInterrupted (handoff ID); reopens an interrupted handoff.` and its newline | +100 |
| `handoff` | `  parallelCopies creates N copies to N different agents with the same task; each completes independently, results shown side by side.` -> `  parallelCopies — N copies to N different agents with the same task; results side by side.` | -40 |
| `handoff` | `Optional: result (summary of what was accomplished).` -> `Optional: result (summary).` | -25 |
| `handoff` | `reverts an accepted handoff back to pending.` -> `reverts accepted to pending.` | -16 |
| `handoff` | `checkpoint (create only, when your context runs low)` -> `checkpoint (create only, low context)` | -15 |
| **`handoff` net** | 1,122 -> 1,126 | **+4** |
| `record` | add `SEARCH: record(search: "text") → matches in title/detail, max 20` and a blank line | +68 |
| `record` | `READ-BACK (write-only gap fix): record(get: "R-001") → one record by id; record(list: true) → all session records` -> `READ-BACK: record(get: "R-001") → one by id; record(list: true) → all` | -44 |
| `record` | `To DELETE a record: record(delete: "R-001")` -> `DELETE: record(delete: "R-001")` | -12 |
| **`record` net** | 529 -> 541 | **+12** |
| **Surface** | 16,147 -> **16,163** | **+16, 50 bytes of headroom remain** |

`record.ts:38-40` are argument `.describe()` lines and are outside the measured surface; compressing them reclaims zero description bytes.

## 12. Risks

| Risk | Mitigation |
|---|---|
| A0 drops a handoff | Every field is `lenient`; hostile fixture; field-presence round-trip |
| A0's gate passes on an unfixed build | The gate asserts field presence, not `droppedHandoffs` |
| A0b regresses record parsing | Two optional `lenient` fields; the record round-trip is asserted in the same fixture |
| `ENOENT` read as `unknown` and the feature goes inert | Explicit `gone` classification; proof 1 |
| Zombie owner looks alive | Platform state check where the platform has one (`/proc` field 3 on Linux, `ps` state on macOS); on Windows an exited process is gone; proof 2 |
| PID reuse hides an interruption | Start time from the platform backend; no `pid === process.pid` shortcut |
| Tick collision across a reboot | The boot id must match: `btime` on Linux, `kern.boottime` on macOS, `LastBootUpTime` on Windows; proof 4 |
| A platform probe hangs, is absent or is unparsable | Fixed argv, no shell, 2000 ms on the POSIX backends and 5000 ms on the two PowerShell CIM calls, `unknown` on failure; cached and never on the hot path |
| False interrupt on a live owner | `interrupted` requires a definitive dead probe; `unknown` never acts |
| Writes or reads with the feature off | `stampOwner` gated at both sites; the clears are no-op deletes on writes that already happen |
| `resumeInterrupted` acts on a flag from an earlier enabled run | Gated on `continuityEnabled()` |
| A stray `return` aborts plugin init | Positive guard, extracted function, own `try`/`catch`, rollout asserts 44 tools |
| Stale cache result | File and directory stamps on every lookup; worst case is a miss, never a wrong answer |
| A new file is invisible to a cache key | Directory stamps cover creation and deletion in every walked directory |
| A stale index names a deleted file | The bundle planner stats each candidate and moves misses to `missing[]` |
| Index dies across worktrees | Snapshot keyed by `projectKey` under the resolved project root; proof asserts two working directories share it |
| A second parser drifts from `AstService` | `builder.ts` calls `getAstService()`; no new parser |
| Memory growth | Index 24 MB and cache 48 MB caps, `memory-watchdog`, counters in `health` |
| `stat` cost | 256 stamped paths per key; `projectmap`, `astquery`, `readsymbol`, `smartgrep` are not cached |
| New files break the reachability baseline | Regenerate with `--write`; verify the shares stay in tolerance |
| zod 4.6 changes the emitted JSON Schema | `schema` gate plus a line diff of `tawassul.schema.json`; re-measure the live tool schemas; section 16 |
| `z.record` type change breaks the build | `typecheck` over 35 record schemas; section 16 |
| zod supply chain | provenance and integrity check on install; single resolved version; section 16 |
| A direct `task` call never receives the bundle | Documented as the supported scope; the negative is asserted in `prove-task-context-bundle`; a `tool.execute.before` hook is out of scope (section 20) |
| Tawa is assumed to be the dispatcher and never runs | Section 20.2: tawa runs only on an explicit `@tawa`; no acceptance depends on it |
| A bundle marker is written into `task` and lost to the rescue or help prefix | The marker lives in `context` only (section 20.6) |
| `handoff(create)` injects accumulated context, so a bundle added there would be buried | Path D is out of scope; path C bypasses the tool via `createHandoffEntry`; the proof asserts the existing injection stays (section 20.6) |
| The bundle is built once per user message and mismatches the split subtasks | Built per `SubTask` after `decompose`; the proof asserts one bundle per part (sections 7, 20.9) |
| Difficulty silently changes the role or dispatch mode and the bundle describes the wrong task | Bundle built after the split and role assignment; the proof asserts `preferredRole` and per-subtask bundles (section 20.9) |
| `buildDispatchPlan` later attaches a bundle and turns every difficult task into an agent task | Section 20.7 keeps it out of scope; any change there needs its own decision, flag and proof |
| The bundle ships only on the `task_orchestrate` / `moa` path | Phase 0 measures the call rate of both tools; if the rate is low, the bundle's value is re-scoped before Phase 4 rather than assumed |
| A probe on the boot path blows the 2000 ms budget | `detectInterrupted` is deferred and not awaited; `prove-boot-budget` is a named gate (section 10.3) |
| A new state subdirectory does not exist | `owner.ts` and `store.ts` create `continuity/` and `project-index/` with `mkdirSync(..., { recursive: true })` before the first write (sections 4.1, 4.4, 5.2) |
| The live schema payload drifts unmeasured | `prove-context-diet` measures it against the Phase 0 receipt; the archived 13,868 B stays frozen (section 10.3) |
| An English-only i18n edit turns `prove-feature-index-english` red | `src/i18n/ar.json` is a named row in section 8; key and placeholder parity is enforced |
| Rolling back A0 after A lands drops the 8 continuity fields silently | Rollback order is B, then A, then A0b, then A0; the field-presence round-trip runs at every step |
| `credentialScope` is coerced to the enum and the hostile fixture fails | Section 5.1 pins `z.string()` for that one field |

## 13. Re-evaluation ledger

| # | Original point | Status | Reason |
|---|---|---|---|
| 1 | Distributed singleflight / locks | Rejected | One host process owns both sides of every handoff (`docs/architecture.md:3`) |
| 2 | New shared memory / MemoryAdapter | Rejected | `SharedMemoryManager`, `CollectiveMemoryStore`, `VectorStore` do not hold code knowledge; a project-root file is enough |
| 3 | Tool Broker intercepting host tools | Rejected | `tool.execute.before` / `after` cannot skip execution and return a cached result (`src/plugin-types.ts:70-77`) |
| 4 | Context injection via `addagent` | Rejected | User-only config writer (`src/tools/agent-management.ts:529-570`); use `HandoffEntry.context/files` |
| 5 | 16-folder layer | Rejected | 4 modules, 16 files, existing services reused |
| 6 | Boot-time full indexing | Rejected | 30-second init deadline; the index is built lazily as a by-product |
| 7 | Caching `read` / `grep` / `glob` / `bash` | Rejected | Not interceptable; only Tawassul read tools are cached |
| 8 | Central invalidation | Replaced | Validate stamps on read; no `invalidateFile` |
| 9 | TTL as the validity rule | Replaced | File and directory stamps are the rule; TTL is cleanup |
| 10 | `codestate` as the change source | Rejected | Opt-in only (`TAWASSUL_CODE_STATE_AUTO`) |
| 11 | `task_control` cancels exploration | Rejected | It only inspects / cancels subagent children |
| 12 | Content-bearing Context Package | Replaced | Referential bundle: files, symbols, edges, reasons, no content |
| 13 | 80% reduction target | Replaced | Measured baselines in Phase 0; targets are stated after measurement |
| 14 | `maxTokens` as budget | Replaced | Reuse `computeBudget` / `resolveModelWindow` / `byteLength` |
| 15 | New metrics collector | Replaced | Extend `health` / `dashboard` / `report` |
| 16 | `RecordEntrySchema` field loss | Fixed in A0b | Two optional `lenient` fields; `record.ts:112` writes `provenance` on every create |
| 17 | `smartgrep` in the read cache | Rejected | `rg` over a directory; a new matching file carries no stamp |
| 18 | Index keyed by `sha256(root)` | Replaced | Host project identity (`src/utils/project-identity.ts`), snapshot under `persistDir` |
| 19 | `projectmap` cached by "root stamp" | Replaced | No such stamp exists; projectmap is a producer only |
| 20 | A second parser in `builder.ts` | Rejected | `AstService` already caches by `mtimeMs` and `size` |
| 21 | `astquery` / `readsymbol` cached separately | Rejected | Duplicates the `AstService` cache without adding correctness |
| 22 | The bundle built in `TaskOrchestrator.execute` | Fixed in rev. 5 | `execute` has no callers; the bundle is built in `decompose` and forwarded by `StrategyDispatcher` (section 7) |
| 23 | `Checkpoint +3` and `HandoffEntry +8` unnamed | Fixed in rev. 5 | Enumerated in section 5.1; `Checkpoint` was already fully mirrored, so `+3` was a new contract, not a repair. Revision 13 reduces it to `+1` |
| 24 | `credentialScope: "bogus"` cannot survive an enum | Fixed in rev. 5 | `z.string()` for that one field (section 5.1) |
| 25 | An English-only i18n edit | Fixed in rev. 5 | `src/i18n/ar.json` is a named row in section 8; parity is enforced at `prove-feature-index-english.ts:158-172` |
| 26 | The snapshot lived outside `.opencode/` | Fixed in rev. 5 | `projectStatePath` (section 4.1) |
| 27 | `measure-context-baseline` has no `--out` | Fixed in rev. 5 | `--out` is a named change in section 8 and in step 7 of section 16.4 |
| 28 | The owner/interrupt contract was undefined | Fixed in rev. 5 | `OwnerRecord` and thresholds in sections 4.4 and 5.2 |
| 29 | Flag defaults unstated; the probe could collide with the boot budget | Fixed in rev. 5 | Deferred detection; `prove-boot-budget` is a named gate (sections 4.4, 9, 10.3) |
| 30 | Cache and index are absent from `memory-integrations.runCleanup` | Fixed in rev. 5 | Registered in `runCleanup`; Phase 6 |
| 31 | `depmap` walks 300 files, above the 256 stamped-path cap | Accepted | Documented in section 6.4; the cache proofs use fixture trees |
| 32 | `tool-run-log` is capped at 2000 entries | Accepted | The Phase 0 receipt records the window it saw (section 9) |
| 33 | Invocation was modelled as "tawa or a normal task" | Fixed in rev. 5 | Section 20 documents the six paths, the three flags and the detection gap |
| 34 | Tawa was treated as the automatic dispatcher for agent requests | Fixed in rev. 5 | Tawa runs only on an explicit `@tawa`; a dispatch command forces `task()` from the main agent; `handoff` refuses `to: tawa` (section 20.2) |
| 35 | `handoff` was assumed to pass `task` through unchanged | Fixed in rev. 5 | Rescue and help prefixes rewrite it (section 20.6); the bundle marker goes in `context` |
| 36 | The effort-driven dispatch plan was absent from the model | Documented in rev. 5 | `buildDispatchPlan` is inert today but is the latent auto-dispatch point (section 20.7) |
| 37 | `handoff` was assumed to pass `context` through unchanged | Fixed in rev. 5 | `buildAccumulatedContext` injects every create (section 20.6); path C bypasses the tool via `createHandoffEntry` |
| 38 | The bundle was assumed to be one per user message | Fixed in rev. 5 | Built per `SubTask` after the `decompose` split (sections 7 and 20.9) |
| 39 | Difficulty-driven role and mode changes were absent from the model | Documented in rev. 5 | `decompose`, `selectMode`, `budgetGuard` and `setupDynamicPipeline` (section 20.9) |
| 40 | Deleted goals were reported as verified/completed, and the board counted them as such | Resolved in rev. 13, corrected in rev. 15 | `load()` backfilled `closedAs` from the prior status, and the replay counter read the prior status rather than `closedAs`; the companion plan's G1 counts from `closedAs`, G2 makes the two dropped-write paths count `dropped`, and G6 rebuilds the live meta |
| 41 | `buildAccumulatedContext` places old task summaries before the caller's context and has no scope or cap | Resolved in rev. 13 | H1 gates both context sites (`:496-505`, `:670-674`) behind `TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT`, default off; Phase 5b |

## 14. Governance

1. This plan is a draft. Nothing in it is implemented.
2. `docs/FUTURE-WORK-PLAN.md` is a closed repair register; mark the handoff-schema and tool-run-model rows superseded before the code lands.
3. Both `docs/FUTURE-WORK-PLAN.md` and `docs/continuity-brief-v1.md` are currently untracked. Deciding which document is the plan of record is an owner decision.
4. Counters are read from generators (`gate-manifest.json`, `proof-shards.json`, the archived baselines), never from prose.
5. Implementation starts only after the owner approves this plan and names the phase order.
6. Revision 8 of this document is still a draft; it changes no code and no gate.

## 15. Revision 2 — corrections applied

| # | Correction | Evidence | Status |
|---|---|---|---|
| E1 | `health` is built in `src/tools/tawa/health.ts:57`, `dashboard` in `src/tools/tawa/dashboard.ts:89`, `report` in `src/tools/diagnostics.ts:87` | direct read | applied to section 8 |
| E2 | Description offsets live in section 11, not section 10.2 | this document | applied to section 8 |
| E3 | The schema payload is archived at 13,868 B; the live value is unmeasured and A0/A0b/A move it by an unmeasured amount | `scripts/prove-context-diet.ts:151`, `src/v2/setup.ts:541-547` | applied to sections 1.1, 10.4 |
| E4 | `FeatureIndex.getByFile(file)` is the public API; `byFile` is a snapshot field | `src/services/feature-index.ts:258`, `:289` | applied to section 7 |
| E5 | `builder.ts` reuses `getAstService()` | `src/services/ast-service.ts:230-237` | applied to sections 4.1, 9 |
| E6 | Decision 2 contradicted B's four new arguments | sections 2 and 11 | applied to section 2 |
| D1 | `smartgrep` leaves the cache and the index | `src/tools/search-and-diff.ts:13-58` | applied to sections 3.2, 6.1 |
| D2 | `depmap` is keyed by walked files plus walked directories | `src/tools/dependency-map.ts:13`, `:92-130` | applied to section 6.1 |
| D3 | `projectmap` has no root stamp; it becomes a producer only | `src/tools/project-map.ts:77-128` | applied to sections 2, 6.1 |
| D4 | The index uses the host project identity and `persistDir` | `src/utils/project-identity.ts:76-83` | applied to sections 4.1, 5 |
| D5 | `astquery` and `readsymbol` are not cached; `AstService` already validates | `src/services/ast-service.ts:230-237` | applied to sections 2, 6.1 |
| G1 | `docs/continuity-detection.md` is a named deliverable | file absent today | applied to section 8 |
| G2 | The exploration artifact goes to `docs/experiments/receipts/` | `docs/experiments/baselines/README.md` | applied to section 9 |
| G3 | `prove-tool-name-hash` is a gate for every phase | `scripts/prove-tool-name-hash.ts` exists | applied to section 10.3 |
| G4 | Flags-off parity is proven | new proof | applied to sections 9, 10.1 |
| G5 | Index 24 MB and cache 48 MB, 72 MB total | section 6.4 | applied to sections 6.4, 10.4 |
| G6 | The bundle gate asserts reasons and the absence of content | section 7 | applied to section 9 |
| G7 | The description surface is re-measured at B, not assumed | section 11 | applied to section 9 |
| G8 | The header and T2 now state the same thing about 13,868 | sections 1.1, 10.4 | applied |

## 16. Dependency maintenance — zod 4.6.7 (pre-phase)

### 16.1 Why this is a pre-phase

`package.json` declares `zod: ^4.1.8` and `package-lock.json` resolves 4.1.8; npm `latest` is 4.6.7. The range already admits 4.6.7, so the move is a lockfile bump plus a manifest floor, not a new dependency. It is recorded here because A0 and A0b edit `src/validation.ts`, the file every state schema is built from. Landing the engine first means the field-presence round-trip and the hostile fixture run once, against the final engine.

The upgrade is not a feature phase: no tool, no description byte, no flag, no proof, no phase estimate. It is one commit that must be green before Phase 1.

### 16.2 Delta 4.1.8 -> 4.6.7, filtered to this tree

Reviewed from the release notes for 4.2.0, 4.3.0, 4.4.0, 4.5.0, 4.6.0, 4.6.1 through 4.6.6, and the 4.6.7 tag; 4.6.7 itself is a version bump only.

| Release | Change | This tree | Action |
|---|---|---|---|
| 4.2.0 | `z.fromJSONSchema`, `z.xor`, `z.looseRecord`, `.toJSONSchema()` method | not used | none |
| 4.3.0 | `.pick()` / `.omit()` / overwriting `.extend()` throw on refined schemas | no call sites | none |
| 4.4.0 | `$defs` lose the redundant `id`; `.merge()` throws with refinements; `z.undefined()` keys become required | no `$defs`, no `.merge()`, no `z.undefined()` | none |
| 4.4.0 | `__proto__` hardening, own-property writes in JSON Schema, tree-shaking annotations | state parsing and schema emission | beneficial |
| 4.5.0 | string `.min` / `.max` / `.length` count code points, not UTF-16 units | `.min` / `.max` on 500, 2000 and 5000 byte fields | boundary probe |
| 4.5.0 | `z.iso.datetime()` requires seconds; `ipv6` / `ulid` / `httpUrl` / `base64` / `emoji` stricter | not used | none |
| 4.5.0 | record keys match TypeScript; `__proto__` always stripped | 35 record schemas (30 `z.record(`, 5 `tool.schema.record(`) | superset of today's behaviour |
| 4.5.0 | schema memory about 9x lower; lazy `ZodError` construction | all schemas | beneficial for the 1.5 GB cap |
| 4.6.0 | JSON Schema folds chained checks (#6554) | `tawassul.schema.json` and the live tool schemas | regenerate and diff |
| 4.6.0 | error maps run on first read of `result.error` (#6519) | no `z.config()`, no custom error maps | inert |
| 4.6.0 | metadata members materialize on first read | no `Object.keys` over a Zod schema | inert |
| 4.6.6 | `z.record` output and input declared as members (#6645) | 35 record schemas | `typecheck` |
| 4.6.6 | array, set and map size bounds checked before elements | no set or map arguments | inert |
| 4.6.6 | six malicious `main` commits reverted, never published; provenance names the pre-rewrite copy | install path | verify provenance |
| 4.6.7 | version bump | none | none |

### 16.3 What changes in this tree

| Artifact | Why | Command |
|---|---|---|
| `package.json` | floor moves to `^4.6.7`, matching the `^` style of every devDependency | manual |
| `package-lock.json` | resolves 4.6.7 and its integrity | `npm install zod@4.6.7` |
| `tawassul.schema.json` | `z.toJSONSchema(configSchema)` output may move under the 4.6 fold | `bun src/scripts/gen-schema.ts` |
| `THIRD-PARTY-NOTICES.md` | pins `zod 4.1.8` at line 314 | `bun scripts/gen-third-party-notices.ts` |
| `dist/sbom.cdx.json` | version, integrity and bundle hash | `bun scripts/gen-sbom.ts` |
| `dist/index.js` | imports `zod` externally at 11 sites | `npm run build` |
| `dist/global.js` | bundles `zod` (`ZodError` appears 18 times) | `npm run build` |
| `scripts/measure-context-baseline.ts` | `--out <path>` so step 7 writes a receipt instead of the frozen archive | ~6 lines, manual |

`dist/` is untracked, so the bundle diff never enters the commit. The four tracked artifacts are `package.json`, `package-lock.json`, `THIRD-PARTY-NOTICES.md` and `tawassul.schema.json`.

The npm tarball grows from 3,958,238 bytes and 656 files at 4.1.8 to 6,148,944 bytes and 840 files at 4.6.7. That is install cost, not shipped cost: the bundle carries only the imported subset, and step 3 measures it.

### 16.4 Sequence and gates

1. Install 4.6.7 and verify the registry signature or provenance (`npm audit signatures`, or compare `dist.integrity` against the registry).
2. `npm run typecheck` and `npm run check:rules`.
3. `npm run build`; record `dist/index.js` and `dist/global.js` bytes before and after.
4. Regenerate `tawassul.schema.json`, `THIRD-PARTY-NOTICES.md` and `dist/sbom.cdx.json`.
5. `npm run gate:fast` (covers `schema`, `sbom`, `notices`, `config`, `facts` and `proof-count`).
6. `npm run gate:proofs` (154 steps, unchanged).
7. Re-run `bun scripts/measure-context-baseline.ts --out docs/experiments/receipts/YYYY-MM-DD-zod-4.6.7.json` into a receipt, not the frozen archive, and compare the live schema bytes and fingerprint with the archived 13,868 B. `--out` is the small change named in section 8; without it the script writes only to `docs/experiments/baselines/<date>-context-baseline.json`.
8. Probe the 4.5 code-point change at the boundary: a 500-byte field at its limit with an astral character, before and after.

### 16.5 Acceptance

- `package-lock.json` resolves exactly 4.6.7 and `npm ls zod` reports a single version.
- `typecheck`, `check:rules`, `gate:fast` and all 154 proofs are green.
- The `tawassul.schema.json` diff is reviewed line by line; every change is explained by a named 4.6 fix.
- `THIRD-PARTY-NOTICES.md` names 4.6.7; the SBOM names 4.6.7 with a new integrity hash.
- The `dist/global.js` byte delta is recorded; a regression above 5% needs a note.
- The live schema payload is re-measured and recorded; the archived 13,868 B stays frozen.
- A0 and A0b then land on top with their field-presence round-trip unchanged.

### 16.6 Risks

| Risk | Mitigation |
|---|---|
| The emitted JSON Schema moves and the host sees a different tool contract | `schema` gate plus a line diff; the live tool schemas are re-measured |
| `z.record` types break the build | `typecheck` over 35 record schemas (30 `z.record(`, 5 `tool.schema.record(`) |
| String length semantics change at the boundary | explicit astral-character probe |
| Supply-chain compromise | provenance and integrity check; single resolved version |
| Bundle growth | measured before and after; `dist/` is untracked |
| Baseline drift | 13,868 B is labelled zod-version-specific; re-measure, never rewrite the archive |

### 16.7 Effect on this plan's numbers

- Tools: 44 before and after; no description byte moves.
- Gate steps: 154 before and after; no new proof.
- Schema payload: the archived 13,868 B was measured under 4.1.8. The live value after the upgrade is re-measured in step 7 and may move; the archive is not regenerated.
- Memory: 4.5 lowers per-schema memory; the +72 MB budget in section 10.4 is unchanged and is re-checked after the upgrade if the owner wants the RSS number enforced.
- Estimate: half a day to one day, dominated by the 154-proof run and artifact regeneration. It is not added to the 10.5-14 day feature estimate (section 9).

## 17. Open questions for the owner

1. `smartgrep`: exclude it from the cache and the index as recommended, or pay for full directory stamps?
2. Index identity: the host project id with `canonical` fallback as recommended, or the working-directory path?
3. A0 and A0b: ship them as one immediate commit before the rest of the plan is approved, or hold everything for one approval?
4. The plan file: keep it untracked, or add it to git as the plan of record?
5. `EXPLICIT_DISPATCH_REGEX` matches English keywords only (`src/hooks/message-updated.ts:54-55`). An Arabic request to invoke agents for analysis, comparison or planning does not set `userExplicitDispatch`, so nothing forces dispatch. Extend the regex with Arabic keywords as a small separate fix, or leave it out of this plan?
6. Direct `task` calls: accept that the bundle is not delivered there (section 20), or add a `tool.execute.before` hook in a later plan?
7. Flag defaults: ship all five off by default and let the owner enable them, or ship the index and the cache on?
8. `handoff(create)` injects `buildAccumulatedContext` into every create (section 20.6). Resolved: H1 gates the injection behind `TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT`, default off (section 22.1, decision 14). The flag-off path stores the caller's context verbatim.
9. `decompose` and `selectMode` turn difficulty into a role and a dispatch mode (section 20.9). Keep that implicit transformation, or make role and mode explicit tool arguments? This plan does not change it.

## 18. Revision 3 — changes applied

| # | Change | Evidence | Status |
|---|---|---|---|
| Z1 | zod 4.6.7 is a pre-phase before A0, not a feature phase | section 16, decision 15 | applied |
| Z2 | The 13,868 B schema baseline is labelled as measured under zod 4.1.8 | `package-lock.json`; header; section 10.4 | applied |
| Z3 | The 4.6 JSON Schema fold is the only expected output change; `schema` gate plus a diff | `src/scripts/gen-schema.ts:13`, `src/lib/tool-schema-injection.ts:17` | applied to 16.2, 16.4 |
| Z4 | The `z.record` type change is covered by `typecheck` | 35 record schemas | applied to 16.2, 16.6 |
| Z5 | Code-point string lengths get a boundary probe | `src/validation.ts:26-30` | applied to 16.4 |
| Z6 | Lazy error maps and metadata getters are inert here | no `z.config()`, no schema key iteration | applied to 16.2 |
| Z7 | Artifacts to regenerate: schema, notices, SBOM, both bundles | tracked files and build outputs | applied to 16.3 |
| Z8 | Supply-chain check for 4.6.6 | release note | applied to 16.2, 16.6 |

## 19. Revision 4 — cross-platform liveness

The liveness probe is not Linux-only. The existence half already has a cross-platform helper in this tree; only the identity half needs a platform backend.

| # | Change | Evidence | Status |
|---|---|---|---|
| P1 | `isProcessAlive(pid)` is reused for the existence check on every platform | `src/utils/process.ts:2-17`; used by `src/context/session-manager.ts:158`, `src/infra/file-lock.ts`, `src/services/apply-patch.ts` | applied to 4.4 |
| P2 | Three identity backends: Linux `/proc`, macOS `ps` + `sysctl`, Windows PowerShell CIM | platform commands; no new dependency | applied to 4.4 |
| P3 | Zombie detection is platform-specific; Windows has no zombie state | `/proc` field 3, `ps` state, Windows process exit | applied to 4.4, 12 |
| P4 | `btime` is generalized to a boot id | `btime`, `kern.boottime`, `LastBootUpTime` | applied to 9, 12 |
| P5 | A missing, unreadable, timed-out or unparsable backend returns `unknown`, and `unknown` never acts | section 9 acceptance, section 12 | applied to 4.4, 9, 12 |
| P6 | The probe uses `execFile` with a fixed argv, no shell, a 2000 ms timeout on the POSIX backends and 5000 ms on the PowerShell CIM calls, and an integer pid; `secure-exec.ts` and its allow-list are not widened | `src/utils/secure-exec.ts:6`; PowerShell must never enter a generic allow-list | applied to 4.4 |
| P7 | The proof parses golden fixtures for all three backends and runs the live backend of the host | CI may be Linux-only | applied to 9, 10.3 |

## 20. Invocation paths

The earlier draft modelled agent invocation as two paths: "via `tawa`" or "a normal user task". That model is wrong, and it changes what the task context bundle can claim. The tree has six paths, three session flags and two dispatch guards.

### 20.1 The six paths

| # | Trigger | Caller | What runs | Bundle |
|---|---|---|---|---|
| A | the user writes a normal task | main model | the main model does the work itself, or calls `task` with no `subagent` | no |
| B | the user writes `@tawa` | tawa (`mode: "all"`) | tawa calls `task` with `subagent`; `proxyAgentRoutingStage` selects the model | no |
| B2 | the user orders the task to the agents, without naming tawa | main model | the guards block direct `edit` / `write` / `bash`; the main model dispatches through `task()` or stops; **tawa is not involved** | no |
| C | any agent calls `task_orchestrate` or `moa` | that agent (the created entry is attributed to `@tawa`) | `decompose` -> `StrategyDispatcher.dispatch` -> `ParallelDispatcher` -> handoffs | yes |
| D | any agent calls `handoff(create)` | that agent | the tool injects accumulated context via `buildAccumulatedContext`, rewrites the task text for rescue and help, and refuses `to: tawa` | no |
| E | any root user message whose effort is `deep`, `analyze-first`, or structural > 0.6 | the message hook | `buildDispatchPlan` builds a `DispatchTask` list and calls `parallelDispatcher.buildPlan`; the plan is logged and discarded | no |

Evidence:

- `tawa` is the only agent with `mode: "all"` (`src/core/agent-data.ts:34-38`), and its own description is "routing only on explicit @tawa invocation".
- `task_orchestrate` calls `taskOrchestrator.decompose(task)` and then `strategyDispatcher.dispatch(...)` (`src/tools/tawa/task-orchestrate.ts:27-32`); `moa` does the same (`src/tools/tawa/moa.ts:31-41`).
- `TaskOrchestrator.execute` has no callers in `src/`.
- `handoff.ts:805` copies `args.context` unchanged. The same tool rewrites the task text: rescue prepends `🚑 RESCUE: ` (`:390`), a help request prepends `helpRequestPrefix` (`:649`, `src/i18n/en.json:246`), and `to: tawa` from any non-tawa caller is refused with `handoffTawaRedirect` (`:651-653`, `src/i18n/en.json:234`).

When the main model calls `task` with no `subagent`, `agentMatcherRoutingEffect` fills the target from `agentMatcher` if `routing.applyAgentMatcherSuggestion` is true (`src/hooks/guards/tawa-guards.ts:38-67`). That stays path A for bundle purposes: the guard rewrites the target, not the context.

### 20.2 The three session flags

`detectTawaMention` resets and sets three fields on every user message (`src/hooks/message-updated.ts:131-139`):

| Flag | Set by | Source |
|---|---|---|
| `userMentionedTawa` | `@tawa`, or the bare word `tawa` | `TAWA_MENTION_REGEX` (`:52`) |
| `userExplicitDispatch` | English dispatch words: dispatch, distribute, delegate, handoff, "send ... to agents", "assign ... to agents", "route ... to agents" | `EXPLICIT_DISPATCH_REGEX` (`:54-55`) |
| `directRoutingAgent` | an `@agent` mention other than tawa | `analyzeMessage` -> `isDirectRouting` (`src/services/routing-algorithm.ts:34-44`) |

The guards then constrain the path, but they never select an agent. Once `userMentionedTawa` or `userExplicitDispatch` is set, a non-tawa agent at call depth 0 is blocked from `edit`, `write` and `bash` (`src/hooks/guards/resource-guards.ts:82-88`). The message depends on guard order, and the order is fixed: `tawaRoutingEnforcementGuard` runs before `speculativeDispatchGuard` (`src/hooks/validation-pipeline.ts:189`). A tawa mention says "use task(desc: 'tawa')"; a bare dispatch command also says "use task(desc: 'tawa') for dispatch instead" (`:84-88`), because the enforcement guard fires first for `userExplicitDispatch`. The "use task() instead" branch (`:100-103`) is only reachable when the enforcement guard does not fire; `speculativeDispatchGuard` also covers `directRoutingAgent` (`:90-99`). Nothing in the tree invokes `tawa` on the user's behalf, and `handoff` refuses `to: tawa` from a non-tawa caller outright.

So the correct statement is: tawa is never auto-invoked. It runs only when the user names it, directly or through the guard's own instruction. A normal request to distribute work to the agents is path B2: the guards block the direct work tools and the enforcement guard tells the model to use `task(desc: 'tawa')`. The model still calls `task()`, and tawa runs only because that call names it; the harness never invokes tawa on its own. The original "tawa or normal task" wording, the first rev. 5 draft that folded B2 into B, and the revision 13 claim that B2 has "no tawa in the middle" were all wrong.

### 20.3 What the plan can claim

- The bundle (Phase 4) is delivered on path C only.
- Path B2 is the most common professional-request path, and it receives no bundle from this plan.
- Paths A, B, D and E receive no bundle from this plan. Path D still receives the pre-existing `buildAccumulatedContext` block, which this plan does not touch.
- The 80% reduction target is therefore not a plan-wide claim: it is measured per path in Phase 0, and the plan asserts no number for B2.

### 20.4 The detection gap

`EXPLICIT_DISPATCH_REGEX` is English-only. An Arabic request to invoke agents for analysis, comparison and planning matches none of its alternatives and contains no `@mention`, so:

- `userExplicitDispatch` stays false,
- `directRoutingAgent` stays null,
- no guard forces dispatch,
- the main model may do the work itself.

This is a live gap in the tree, not a defect in this plan. It is recorded as open question 5. Extending the regex is a separate small change with its own proof; it is not smuggled into this plan.

### 20.5 Consequence for the acceptance

`prove-task-context-bundle` asserts the positive on path C, including one bundle per `SubTask` after `decompose` splits, and the negative on paths B, B2 and D. Path D keeps its accumulated-context injection. `prove-intelligence-off` asserts that path C carries an empty context when the flag is off.

### 20.6 Task and context rewriting in `handoff`

The `handoff` tool does not pass `task` or `context` through unchanged. Section 22.1 evaluates whether the context injection should remain on by default.

Context injection:

- `buildAccumulatedContext` (`src/tools/handoff.ts:21-166`) builds a new context document: Goals (live), Chain Context (previous deliveries, decisions, changed files), Decision Memory for the target agent, Learned Lessons, Evaluation summaries, and finally the caller's text under `## 🆕 New Context`.
- It runs for a context shorter than 5 words via the merge branch (`:496-502`), and for a context of 5 words or more via the normal create path (`:670-679`). Every successful create therefore carries the injected block. The main entry stores `accumulatedContext` (`:685`).
- `parallelCopies` stores `args.context` (`:805`), which is `contextToUse` (`:505`): the merged block for a short input, but the caller's original text for an input of 5 words or more. The copies are therefore not guaranteed to match the main entry.

Task rewriting:

- rescue: ``task: `🚑 RESCUE: ${original.task}` `` (`src/tools/handoff.ts:390`)
- help request: `t("helpRequestPrefix", { task })`, which renders as `🆘 HELP: {task}` (`:649`, `src/i18n/en.json:246`)
- `to: tawa` from a non-tawa caller is refused with `handoffTawaRedirect` (`:651-653`, `src/i18n/en.json:234`)
- `parallelCopies` (`:771-820`) creates up to four additional handoffs to different agents with the same `task` and `contextToUse`, so one tool call can become five agent tasks. The copies are caller-driven, not difficulty-driven.

Consequence: the plan must not assume that `HandoffEntry.task` equals the user's task, and it must not assume that `HandoffEntry.context` is the caller's context. Any bundle marker belongs in `context`, never in `task`. Path C bypasses this tool: `ParallelDispatcher.createHandoff` calls `createHandoffEntry` directly with `params.context` (`src/bootstrap/service-factory.ts:715-732`), which is why the bundle survives on path C and not on path D.

### 20.7 The effort-driven dispatch plan

`buildDispatchPlan` (`src/hooks/message-updated.ts:190-212`) runs on every root user message whose effort is `deep`, `analyze-first`, or structural complexity above 0.6 (`isComplexEffort`, `src/services/effort-analyzer.ts:471-478`). It builds one `DispatchTask` whose `description` and `context` are the raw user content, calls `parallelDispatcher.buildPlan(...)`, and only logs the result (the call is `:205`, the log block `:207-211`). `buildPlan` is pure except for a sequence counter (`src/services/parallel-dispatcher.ts:55-140`), so today the plan is discarded and no agent is invoked.

That is the natural place a later change would attach a bundle, and it is also the place where an ordinary difficult task would silently become an agent task. This plan does not touch it. A later phase that wants to deliver the bundle there needs its own decision, its own flag and its own proof, because it changes what a normal task is.

### 20.8 Message injection

Two hooks append text to the model's message parts before it runs:

- `injectTawaGuidance` appends the model list and a predictive-routing suggestion, and runs only when the agent is tawa (`src/hooks/message-updated.ts:265`, `src/hooks/message-updated-tawa.ts:8-47`).
- `injectRoutingGuidance` appends security warnings and routing guidance when `userMentionedTawa`, `directRoutingAgent` or `userExplicitDispatch` is set (`src/hooks/message-updated.ts:167-188`).

Neither touches `HandoffEntry`. The plan adds no third injection point, and the bundle is delivered through `context`, not through message parts.

### 20.9 Difficulty-driven task transformation

Four places react to difficulty or effort and change a task's role, dispatch mode, budget or phase pipeline. None of them is changed by this plan, but Phase 4 must be correct in their presence.

- `TaskOrchestrator.decompose` (`src/services/task-orchestrator.ts:37-90`) computes `isComplexTask(task)`. A single complex task gets `preferredRole: "@dev"` and `estimatedComplexity: "complex"` (`:51-53`). A task containing `,`, `;` or a newline is split into parts, each a `SubTask`, with a sequential dependency on the previous part (`:40-43`, `:87`). The returned `agent` is `preferredRole ?? "dev"` (`:63`, `:86`).
- `StrategyDispatcher.selectMode` (`src/services/strategy-dispatcher.ts:23-31`) picks `moa` when `successCriteria.length > 5`, `swarm` when `dependencies.length > 3` or `files.length > 5`, and `parallel` otherwise. `task_orchestrate` defaults to `mode: "auto"`, so this selection runs on every call; `moa` forces `"moa"`. `dispatchToRoles` (`:68-82`) then creates one copy per role: three for `swarm` when `DEFAULT_SWARM_COPIES` is three, and one per requested role for `moa` (default `MOA_AGENTS`).
- `budgetGuard` (`src/hooks/guards/dispatch-guards.ts:204-212`) assigns each target agent a budget tier from `analyzeEffort(desc).thinking_effort`.
- `setupDynamicPipeline` (`src/hooks/message-updated.ts:214-240`) swaps the phase pipeline by `effort.thinking_effort`: `shallow` -> analysis/execution, `moderate` -> analysis/execution/testing, `deep` and `analyze-first` -> analysis/planning/execution/testing (`src/services/pipeline.ts:90-123`).

Consequence for Phase 4: the bundle is built per `SubTask` after `decompose` has split the task, not once for the whole user message. A bundle built before the split would describe a task that no agent receives. `prove-task-context-bundle` asserts that a comma-separated task yields one bundle per `SubTask`, and that a complex single task still carries `preferredRole: "@dev"` with its own bundle.

This plan does not change `decompose`, `selectMode`, `budgetGuard` or `setupDynamicPipeline`. It records them because they are the reason a "task" is not a stable unit.

## 21. Revision 5 — corrections applied

| # | Correction | Evidence | Status |
|---|---|---|---|
| R1 | The bundle is built in `decompose`, not in `execute`; `SubTask.context` and `StrategyDispatcher` are named | `src/services/task-orchestrator.ts:93`, `src/services/strategy-dispatcher.ts:47-58` | applied to 7, 8, 9 |
| R2 | The 8 continuity fields and the `Checkpoint` fields are enumerated with types and writers; the `mirror Checkpoint +3` wording is withdrawn. Revision 13 reduces the `Checkpoint` addition from 3 fields to 1 | `src/validation.ts:51-63`; section 5.1 | applied to 5.1, 8 |
| R3 | `credentialScope` is `z.string()` so `"bogus"` survives; the type stays the union | `src/context/types.ts:59` | applied to 5.1, 9 |
| R4 | `src/i18n/ar.json` is a named file; key and placeholder parity is enforced | `scripts/prove-feature-index-english.ts:158-172` | applied to 8, 12 |
| R5 | The snapshot uses `projectStatePath(ctx.persistDir, "project-index/snapshot.json")` | `src/utils/state-paths.ts:49-51` | applied to 4.1 |
| R6 | `OwnerRecord`, the stale threshold, the non-owner rule and the cache cap are defined | section 5.2 | applied to 4.4, 5.2 |
| R7 | `measure-context-baseline.ts --out` is a named change | `scripts/measure-context-baseline.ts:24-31` | applied to 8, 16.4 |
| R8 | The probe is deferred and not awaited, so `prove-boot-budget` stays green; the gate is named | `scripts/prove-boot-budget.ts:22` | applied to 4.4, 9, 10.3 |
| R9 | The index and the cache are registered in two separate listeners; `runCleanup` stays cache-only | `src/bootstrap/memory-integrations.ts:17-28`, `:44-61` | applied to 8, 9 |
| R10 | The estimate is 10.5-14 days (9.5-12.5 at rev. 5; raised by the Phase 5b track in rev. 11), not 9-11 | section 9 | applied |
| R11 | `decision_kind` has no writer today; A0b restores the field without claiming a producer | `src/tools/record.ts:112` | applied to 1.4 |
| R12 | The cache is a permanent miss above 256 stamped paths; `depmap` walks 300 | `src/tools/dependency-map.ts:13`, `:92-130` | applied to 6.4 |
| R13 | The Phase 0 receipt records the 2000-entry window of `tool-run-log` | `src/services/tool-run-log.ts:59` | applied to 9 |
| R14 | The six invocation paths, the three flags and the English-only dispatch regex are documented; tawa is never auto-invoked | `src/core/agent-data.ts:34-38`, `src/hooks/message-updated.ts:52-55`, `src/hooks/guards/resource-guards.ts:82-105`, `src/tools/handoff.ts:651-653` | applied to 20.1-20.4 |
| R15 | `handoff` rewrites the task text for rescue and help and refuses `to: tawa`; the bundle marker belongs in `context` | `src/tools/handoff.ts:390`, `:649`, `:651-653`; `src/i18n/en.json:234`, `:246` | applied to 20.6 |
| R16 | The effort-driven `buildDispatchPlan` path is documented as inert but latent | `src/hooks/message-updated.ts:190-212`; `src/services/effort-analyzer.ts:471-478` | applied to 20.7 |
| R17 | The two message-injection points are documented; the plan adds none | `src/hooks/message-updated.ts:167-188`, `:265`; `src/hooks/message-updated-tawa.ts:8-47` | applied to 20.8 |
| R18 | `handoff(create)` does not copy `context`; it injects `buildAccumulatedContext` on every create, while `parallelCopies` stores `contextToUse` and may not match the main entry | `src/tools/handoff.ts:21-166`, `:496-505`, `:670-685`, `:805`; `src/bootstrap/service-factory.ts:715-732` | applied to 7, 9, 20.1, 20.3, 20.5, 20.6 |
| R19 | The bundle is built per `SubTask` after `decompose` splits the task; a complex single task keeps `preferredRole: "@dev"` | `src/services/task-orchestrator.ts:37-90` | applied to 7, 9, 20.9 |
| R20 | Difficulty and effort also change dispatch mode, budget tier and pipeline phases | `src/services/strategy-dispatcher.ts:23-31`, `:68-82`; `src/hooks/guards/dispatch-guards.ts:204-212`; `src/hooks/message-updated.ts:214-240`; `src/services/pipeline.ts:90-123` | applied to 20.9 |

## 22. Revision 6 — handoff accumulated context

Status: DRAFT options for owner decision. This section changes no code. It records one live defect found after revision 5 and the options for repairing it. The goal-ledger defect that was section 22.1 now lives in `docs/plan-goal-ledger-truth.md` (revision 9). The rest of the plan is unchanged except where this section says so.

### 22.1 Handoff accumulated context

`buildAccumulatedContext` does not rewrite `task`; it wraps `context`. The task text is changed only by rescue (`src/tools/handoff.ts:390`) and help requests (`:649`). The perceived task change comes from the context block: previous task summaries are placed before the caller's text.

Evidence:

- `handoff(create)` wraps every context of 5 words or more (`:670-674`) and stores the result as `accumulatedContext` (`:685`).
- A context shorter than 5 words is replaced by the merged block only when the merged block reaches 10 words (`:496-505`); if it does not, the original short context is stored and the normal create path builds the block a second time (`:670-674`), so the first build is discarded.
- The block order is Goals, Chain Context (last five deliveries, each task truncated to 100 chars), decisions, changed files, decision memory, learned lessons, evaluations, then `## 🆕 New Context (for <agent>)`.
- Selection is global across `completed | accepted` handoffs, windows to the last 20 on the relevance path and the last 5 otherwise, scores `jaccard * 0.8 + recencyBoost * 0.2`, has no session/chain scope, no relevance floor, and no byte cap.
- `context` is mandatory at `:483`, so the tool never reaches the builder with an empty context; the "or context missing" branch is dead unless that gate is relaxed.
- `parallelCopies` stores `contextToUse` (`:805`), and `ParallelDispatcher` uses `createHandoffEntry` with the raw context (`src/bootstrap/service-factory.ts:715-732`); the main entry, the copies and path C can carry three different contexts.
- `context-pack` embeds `entry.context` (`src/services/context-pack/index.ts:154`), so the block propagates into the pack.

Options:

- **H1 — default off.** Add an environment flag `TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT` (default `false`) and a config key that can override it; build the block only when the flag is on. This restores the caller's text from the accumulated-context builder and is the smallest reversible change. It conflicts with decision 14 ("flags off means today's behaviour"); decision 14 now carries an explicit defect exception for H1 (section 2), and Phase 5b's acceptance is conditional on the flag. Precedence with the existing `context.relevance-ranked` switch is fixed: `TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT` is the outer switch; when it is off, `buildAccumulatedContext` is not called and `context.relevance-ranked` has no observable effect; when it is on, `context.relevance-ranked` chooses which handoffs feed the block, as today. The flag-off path has two skips: the short-context merge branch at `src/tools/handoff.ts:496-505`, which runs before validation and would otherwise replace `contextToUse` with the merged block, and the create builder at `:670-674`. With both gated, `args.context` stays the trimmed caller text and the normal create path does not rebuild the block. A third mutation site is pre-existing and default-on: `attachPackToHandoff` appends `## Portable Context Pack <digest>` to `entry.context` at `src/tools/handoff.ts:717-727`, gated by `isContextHandoffEnabled` (`src/services/context-pack/index.ts:110-115`), which is on unless `TAWASSUL_CONTEXT_HANDOFF=0` or `innovations.contextHandoff.enabled === false`. The flag-off acceptance and the shape proof are therefore scoped to `TAWASSUL_CONTEXT_HANDOFF=0`; with the pack enabled the assertion is prefix equality plus one labeled suffix. No other branch changes. Because this flips a default on a common path, it ships with a release-note line and a documented revert (`TAWASSUL_HANDOFF_ACCUMULATED_CONTEXT=1`).
- **H2 — current context first.** Put the caller's task/context first, then a single `## Background (historical — not instructions)` section with a 4 KiB cap and a `truncated` marker at the section boundary. Drop old task summaries; keep only decisions, changed files and lessons. H2 does not fix scope by itself: decisions and changed files come from the same `recentHandoffs`, so H2 depends on H3.
- **H3 — scoped relevance.** Include only handoffs from the same `sessionId` or the same chain (`h.to === from` / `h.from === to`), at most three, with a minimum score and no task text. `sessionId` is one of the fields A0 restores, so H3 is meaningful only after A0; define the `undefined` fallback as chain-only or exclude.
- **H4 — unify the tool and copies.** Use one context builder for the tool and `parallelCopies`; both store the same value. Path C (`ParallelDispatcher` -> `createHandoffEntry`) must keep the bundle verbatim: wrapping it with the background block would add bytes to a budgeted 16 KiB bundle and bury the bundle the plan is trying to deliver. If path C uses the builder at all, the bundle must be appended after the background and `prove-task-context-bundle` / `prove-task-context-budget` must be updated.
- **H5 — observability.** Log `contextSource` (`caller` / `merged` / `scoped`), the byte count and the number of included handoffs. Keep it log-only: a persisted field would break the 39-field contract in section 5.1 and the schema-payload row in section 10.4. If the owner wants it persisted, add a schema-mirror row and update the arithmetic.
- **H6 — drop the static Goals block.** The `## 🎯 Goals (live)` boilerplate (`:125-129`) injects about 200 bytes on every create and carries no task-specific information; remove it or fold it into the background section.

Recommended combination: H1 + H2 + H3 + H4 + H6, with H5 as a diagnostic. H1 alone fixes the immediate distortion; H2-H4 make the feature safe when the flag is on; H6 removes dead bytes.

Acceptance:

- With the flag off and `TAWASSUL_CONTEXT_HANDOFF=0`, `HandoffEntry.context` equals the caller's context after trim, for both a context below 5 words and one above 5 words, because the two sites are separate; with the pack enabled it is the caller's text plus one labeled suffix (`:717-727`). `task` is unchanged except for rescue/help.
- With the flag on, the stored context starts with the caller's text, contains at most 4 KiB of background, and carries `truncated: true` when the cap is hit.
- No handoff from a different session or chain is included; pre-A0 handoffs with no `sessionId` follow the documented fallback.
- The tool and `parallelCopies` store the same context for the same task; path C keeps the bundle verbatim.
- `context-pack` still embeds the same context, and the bundle digest is unchanged on path C.
- A proof asserts the exact caller text, the cap, the scope, the parity and the context-pack consistency.

Proofs:

- New `scripts/prove-handoff-context-shape.ts`: with the flag off and `TAWASSUL_CONTEXT_HANDOFF=0`, verbatim for a short and a long input; with the pack enabled, prefix equality plus one labeled suffix; flag on = current-first, cap, scope, `truncated`.
- Extend `scripts/prove-handoff-rescue.ts` and `prove-handoff-undo.ts` to assert that rescue/help prefixes are the only task changes.
- New `scripts/prove-handoff-context-parity.ts`: tool and copies produce the same context; path C keeps the bundle verbatim; `context-pack` embeds the same context.
- Gate impact: two new proof files plus two extensions, no new tool, no description byte.

### 22.2 Effect on the existing plan

- Decision 19 now says `handoff(create)` "wraps `context` and can prefix `task`"; the earlier wording "rewrites both task and context" is withdrawn.
- Open question 8 now points to H1 (flag off) instead of "keep as-is".
- Section 20.6 remains the description of today's behavior; section 22 is the proposed change.
- Path C is unaffected: it already bypasses the tool and receives the bundle. H4 must keep the bundle verbatim on path C; wrapping it would break the 16 KiB budget and bury the bundle.
- The goal-ledger track is extracted to `docs/plan-goal-ledger-truth.md` (revision 9). It touches `src/services/goal-store.ts` (G1, G2, G4, G5, `rebuildMeta`, `load({ replay: true, persist: false })`, `activeStatuses()`, `isEmptyGoal`, `lifecycleSnapshot()`, and `bumpTerminal("dropped")` at the two dropped-write sites) and `src/tools/goal.ts` (the board), plus two extended and three new proof scripts, the new `scripts/goal-migrate.ts`, and the gate registration. `goal-auto.ts` and `hooks-registration.ts` need no change: both inherit `buildDigest`'s `terminalCounts: false` default, and the board proof asserts it. None of these appear in the section 4 module list, section 8 file table or section 9 phases, so the companion carries its own phases, proofs, file table and estimate.
- The main plan's proof count is 171: 169 for the 15 base proofs (154 + 15) plus two handoff proofs. The companion goal-ledger plan adds three proof files and two extensions; the combined total is 174. The exact number is fixed by `gate-manifest.json`, not by prose; the earlier "157-158" line was wrong.

### 22.3 Open questions for the owner

10. Goal truth: resolved in `docs/plan-goal-ledger-truth.md`. G1, G2, G4, G5 and G6 are adopted; G3 is deferred.
11. Handoff context: resolved. H1 default-off is adopted as decision 14's one defect exception; H2, H3, H4 and H6 follow behind the flag. Section 29.2 records the 6-0 vote.
12. Repair: resolved in `docs/plan-goal-ledger-truth.md` section 4. The one-shot migration carries the quarantine, the quiesce precondition and the byte-identical restore.

## 23. Revision 6 — corrections applied

| # | Correction | Evidence | Status |
|---|---|---|---|
| R25 | `buildAccumulatedContext` wraps `context` only; rescue and help are the only task prefixes | `src/tools/handoff.ts:390`, `:649`, `:670-685` | applied to 2, 20.6, 22.1 |
| R26 | The context block must be current-first, scoped, capped and path-consistent | `src/tools/handoff.ts:21-166`, `:496-505`, `:805`; `src/bootstrap/service-factory.ts:715-732` | applied to 22.1 |

R21-R24 and R27 moved to `docs/plan-goal-ledger-truth.md` section 3 when the goal-ledger track was extracted in revision 9.

## 24. Revision 7 — six-agent evaluation

Status: evaluation record of the first round. This round asked four focused questions centred on section 22, so its coverage was narrow: it did not audit sections 1-21. It is kept as the record of that round only. Section 25 is the full-plan round, where every section was in scope and the verdicts differ (one reject).

| Agent | Verdict | Strongest finding |
|---|---|---|
| `@analyst-deepseek` | APPROVE WITH CHANGES | Proof arithmetic is 172, not 157-158; G3 changes the filter schema; H1 conflicts with decisions 8 and 14 |
| `@analyst-mimo` | APPROVE WITH CHANGES | G6 needs a named migration proof; H4 would bury the path C bundle; H3 needs the A0 `sessionId` |
| `@analyst-pickle` | APPROVE WITH CHANGES | G2 cannot fix the live counts while meta is trusted; G6 must rebuild meta; the five records are legacy data |
| `@analyst-beam-free` | APPROVE WITH CHANGES | G4 must pass `checkCloseInvariant`; H5 breaks the 39-field contract; context-pack has no proof |
| `@analyst-gemini` | APPROVE WITH CHANGES | Byte cap and session scope are mandatory; keep section 22 subordinate to the core phases |
| `@analyst-glm-5.3-flash-free` | APPROVE WITH CHANGES | Short-context double-build; `pinned` exemption; H1's "context missing" branch is dead; `all` semantics |

Consensus corrections applied in this revision:

| # | Correction | Where |
|---|---|---|
| V1 | Section 22.1 now separates the correct tombstone writer from the wrong counter; the five `closedAs`-less records are legacy data | 22.1 |
| V2 | Section 22.1 adds the meta-trust root cause and makes G6 the live-count repair; G2 is future-correctness only | 22.1 |
| V3 | G1 no longer requires `priorStatus`; it is optional and, if kept, written explicitly | 22.1 |
| V4 | G3 is optional and must not shrink `all`; a `history` filter is the only safe half | 22.1 |
| V5 | G4 requires `checkCloseInvariant`, preserves `pinned`, and names the sweep caller | 22.1 |
| V6 | G6 forces a replay plus meta rewrite, is atomic and hash-gated, and has a fixpoint proof | 22.1 |
| V7 | Section 22.1 now states `completed` or `accepted`, the 20/5 windows, the 80/20 score, the 10-word short-context threshold and the double-build | 22.1 |
| V8 | H1 is an environment flag with a config override, needs a decision-14 exception and a precedence rule with `context.relevance-ranked` | 22.1 |
| V9 | H2 depends on H3; H3 depends on the A0 `sessionId` and defines the undefined fallback | 22.1 |
| V10 | H4 keeps path C's bundle verbatim; only the tool and `parallelCopies` are unified | 22.1 |
| V11 | H5 is log-only; a persisted field would break the 39-field contract | 22.1 |
| V12 | H6 removes the static Goals boilerplate | 22.1 |
| V13 | Proof arithmetic corrected to 169 for the main plan and 172 combined; superseded in revision 11 by 171 and 174; the manifest is authoritative | 22.2 |
| V14 | Section 22.1 is extracted to `docs/plan-goal-ledger-truth.md`; the handoff track stays in section 22 | 22.2 |

Full-plan residual findings that are independent of section 22:

| # | Finding | Evidence | Recommendation |
|---|---|---|---|
| F1 | `measure-context-baseline.ts --out` is scheduled for the feature work, so the zod pre-phase cannot run section 16.4 step 7 | `scripts/measure-context-baseline.ts:24-31` | Land `--out` in the zod commit, or move step 7 after Phase 0 |
| F2 | `depmap` is a permanent cache miss at this repo's root (362 files > 256) | `src/tools/dependency-map.ts:13`, `:92-130`; section 6.4 | State the expected hit rate, or keep `batchread` only |
| F3 | The 24 MB snapshot has no flush/debounce policy, and `revision` re-hashes every file stamp on each write | section 4.1 | Add a debounce, a write-cost bound and a proof |
| F4 | The +337 B schema-payload estimate is unmeasured until a gate measures the live value; the figure is withdrawn in rev. 13 because B now adds one checkpoint field, not three | section 10.4 | Label it as a schema-payload estimate, not a description delta |
| F5 | `prove-intelligence-off` runs last (Phase 6), so a flag leak can ship through five phases | section 10.1 | Add a reduced off-parity proof per phase |
| F6 | `context-pack` embeds `entry.context` but no proof covers it after H2/H4 | `src/services/context-pack/index.ts:154` | Add the assertion to `prove-handoff-context-parity` |
| F7 | `compactDigest` carries terminal counts through `buildDigest`; the plan asserts the body path but does not show it | `src/services/goal-store.ts:926-931`, `:875-879` | Moved to `docs/plan-goal-ledger-truth.md` in revision 9 |

The base `@analyst` and `@analyst-gemini` both read "reclassifying deleted goals as verified/completed" as a proposal; it is the defect, not the fix. Their verdicts are recorded, but that finding is not adopted.

Open questions 10-12 remain. The review adds one:

13. Resolved in revision 9: section 22.1 is extracted to `docs/plan-goal-ledger-truth.md`; see section 26.5.

## 25. Revision 8 — full-plan evaluation

Status: evaluation record. Six agents were asked, one task each, to evaluate the complete plan (§1-§24) and its options, with a hard cap of 80 tool calls per agent. No output format was imposed. Four agents returned per-section verdicts and two returned narrative verdicts over the same material. The previous round (§24) was narrow; this round covers the whole document.

### 25.1 Verdicts

| Agent | Verdict | Basis of the verdict |
|---|---|---|
| `@analyst-deepseek` | APPROVE WITH CHANGES | Re-derived every number and citation; found four internal contradictions |
| `@analyst-mimo` | APPROVE WITH CHANGES | Phase sequencing; three defects block the stated order |
| `@analyst-pickle` | REJECT | Two blocking risk items: the G6 live-ledger rewrite and `indexRevision` in the cache key |
| `@analyst-beam-free` | APPROVE WITH CHANGES | Contracts and proofs; four major integration gaps |
| `@analyst-gemini` | APPROVE WITH CHANGES | Architecture; recommends extracting §22.1 |
| `@analyst-glm-5.3-flash-free` | APPROVE WITH CHANGES | Verified 11 load-bearing claims on disk; five required changes |

Five approve with changes, one rejects on two named items. No agent rejected the design itself; the reject is about two mechanisms.

### 25.2 Per-section verdicts

Legend: O = OK, Mn = minor, Mj = major, C = critical. The columns are the four agents that returned per-section verdicts. `@analyst-gemini` and `@analyst-glm-5.3-flash-free` returned narrative verdicts and are counted in 25.1 and 25.3.

| § | Section | deepseek | mimo | pickle | beam-free |
|---|---|---|---|---|---|
| 1 | What the re-evaluation found | Mn | O | O | O |
| 2 | Decisions | Mj | Mn | Mn | Mn |
| 3 | Scope | Mn | Mn | O | Mn |
| 4 | Modules | Mn | Mn | Mj | Mn |
| 5 | Data model | O | O | Mj | Mn |
| 6 | Read cache | Mn | Mn | Mj | Mn |
| 7 | Task context bundle | O | Mn | Mj | Mn |
| 8 | Modified and new files | Mn | Mn | Mn | Mn |
| 9 | Phases and acceptance | Mn | Mj | Mj | Mj |
| 10 | Proofs and gate impact | O | Mn | Mj | Mn |
| 11 | Description offsets | O | O | O | O |
| 12 | Risks | O | O | Mj | O |
| 13 | Re-evaluation ledger | Mn | O | O | O |
| 14 | Governance | Mn | O | Mn | O |
| 15 | Revision 2 corrections | O | O | O | O |
| 16 | Dependency maintenance | Mj | Mj | Mn | Mj |
| 17 | Open questions | O | O | Mn | O |
| 18 | Revision 3 changes | O | O | O | O |
| 19 | Revision 4 liveness | O | O | O | O |
| 20 | Invocation paths | Mj | O | Mn | O |
| 21 | Revision 5 corrections | O | O | O | O |
| 22 | Goal truth and handoff context | Mn | Mj | C | Mj |
| 23 | Revision 6 corrections | O | O | O | O |
| 24 | Revision 7 evaluation | Mj | Mn | Mn | O |
| Total | 24 sections | 11 O / 9 Mn / 4 Mj | 13 O / 8 Mn / 3 Mj | 9 O / 7 Mn / 7 Mj / 1 C | 13 O / 8 Mn / 3 Mj |

### 25.3 Blocking findings

| # | Finding | Severity | Agents | Section |
|---|---|---|---|---|
| W1 | G6 rewrites the live HMAC-signed goal ledger with no backup, no quiesce precondition and no restore path; a concurrent append or a key mismatch leaves a ledger that re-enters the inverted rule. Resolved in revision 9: quarantine, quiesce and byte-identical restore are now the G6 contract | critical | pickle | companion plan §4 |
| W2 | `indexRevision` is a hash of the whole file set and sits in the cache key, so any edit anywhere makes every entry unreachable; `prove-read-cache-hit` still passes on a frozen fixture | major | pickle | resolved in revision 9: option A, 6-0 |
| W3 | The zod pre-phase step 7 needs `measure-context-baseline.ts --out`, which did not exist and was scheduled with feature work | major | deepseek, mimo, beam-free, gemini, glm | 8, 16.4 |
| W4 | Phase 5's headline acceptance (SIGKILL -> resume -> complete) has no proof registered to Phase 5 | major | mimo, beam-free | 9, 10.1 |
| W5 | Section 22 is in no phase, no file row and no estimate; §22.1 touches four files outside the §4, §8 and §9 tables. Resolved in revision 9 by extraction | major | mimo, beam-free, gemini, glm | companion plan |
| W6 | H1 (default off) contradicts decision 14 and Phase 4's "injection unchanged" acceptance | major | deepseek, mimo, beam-free, pickle | 2, 9, 22.1 |

### 25.4 Major and minor findings

| # | Finding | Agents | Status in rev. 8 |
|---|---|---|---|
| W7 | "five paths" over a six-row table | deepseek, pickle | fixed: six paths in §2, §13, §20 and §24 |
| W8 | "four optional arguments" but B adds three arguments and one checkpoint field | deepseek | fixed in §2 |
| W9 | F4 attributed +337 B to the description surface; it is the schema payload, and the figure is withdrawn in rev. 13 | deepseek, beam-free | fixed in §24 |
| W10 | "four extensions" but §22 defines three | deepseek | fixed in §22.2 |
| W11 | `credentialScope` is `z.string()` while the type is a closed union, so a value the type forbids survives | pickle, beam-free | open |
| W12 | `lenient` coercion is silent: no counter, no log, no health metric | pickle | open |
| W13 | The A0 round-trip asserts presence, not value equality | pickle | open |
| W14 | §12 has no row for §22, the ledger migration, G4 auto-close, or concurrent writers to `owners.json` and `snapshot.json` | pickle, mimo | partly resolved: the goal-ledger risks moved to the companion plan; the concurrent-writer rows remain open |
| W15 | The 2000 ms probe timeout is shorter than a cold PowerShell CIM start, so Windows returns `unknown` forever | pickle | open |
| W16 | The 24 MB index cap and the `schemaVersion` mismatch policy are undefined; both silently empty the index | pickle, beam-free | open |
| W17 | `projectStatePath` does not create the new subdirectory; `owners.json` has no in-process write serialization | pickle | open |
| W18 | "2 MB per file" and "2 MB per entry" disagree for a 50-path `batchread` | pickle | open |
| W19 | Bundle planning runs on the dispatch hot path with no deadline and unbounded `SubTask` fan-out | pickle | open |
| W20 | No gate measures the live schema payload after B, so T2's defect survives the plan that fixes T2 | pickle, beam-free | open |
| W21 | Phase 4's go/no-go rests on a log capped at 2000 entries | mimo, pickle | open |
| W22 | `prove-intelligence-off` runs only in Phase 6 | mimo, beam-free, glm | open |
| W23 | The 24 MB snapshot has no flush or debounce policy, and `revision` re-hashes the whole stamp set per write | mimo, glm | open |
| W24 | Root `depmap` is a permanent miss (362 > 256), so Phase 3's main consumer rarely hits | mimo, beam-free, gemini, pickle | open |
| W25 | The bundle planner's behaviour with the index flag off is undefined | mimo, beam-free | open |
| W26 | §3.1 omitted `unverified[]` and `record(limit)` | mimo, beam-free | fixed in §3.1 |
| W27 | `probeOwner` dropped `sessionId`, which the non-owner rule reads | deepseek | fixed in §4.4 |
| W28 | Path C hardcodes `from: "@tawa"` on every created entry | deepseek | recorded in §20.1 |
| W29 | The guard message the plan quotes for a bare dispatch command may never be shown, because the enforcement guard runs first | deepseek | open |
| W30 | Citation drift: `StateManager.ts:704`, `dependency-map.ts:13`, `state-paths.ts:49-51` | deepseek, mimo | fixed |
| W31 | An Arabic-keyword regex in a `.ts` file collides with project rule 1 | glm | open |
| W32 | §14 item 6 still called revision 5 a draft | deepseek, pickle | fixed |
| W33 | The `## 🆕 New Context` heading is quoted without `(for <agent>)` | deepseek | fixed |
| W34 | "103 pinned constraint phrases / 18 / 5" is prose; the generator asserts only `>= 100` | deepseek | open |

### 25.5 Effect on the verdict

- The design is not rejected by any agent. The single reject is narrow and names two mechanisms: W1 and W2.
- Five of six approve the design with changes; W3-W6 are the common blocking set.
- W1, W2 and W6 must close before implementation; W3-W5 are sequencing and ownership.
- The mechanical corrections W7-W10, W26-W27 and W30-W33 are applied in this revision. The rest are open and listed above.

### 25.6 Open questions added

14. G6: resolved in revision 9. The migration requires a quiesced host, a timestamped quarantine copy, a dry-run diff and a byte-identical restore path; the contract is in `docs/plan-goal-ledger-truth.md` section 4.
15. `indexRevision` in the cache key: resolved in revision 9 by a 6-0 vote for option A (remove it from the key). Section 6.2 is updated and the result is recorded in section 26.

## 26. Revision 9 — extraction, G6 decision and indexRevision vote

### 26.1 Goal-ledger extraction

Section 22.1 moved to `docs/plan-goal-ledger-truth.md` as a standalone plan with its own phases, estimate, proofs and rollback. Section 22 now contains the handoff-context track only, and its subsections are renumbered 22.1-22.3. The companion plan carries R21-R24, R27 and the F7 evidence.

### 26.2 G6 decision

G6 is adopted with the full safety contract: the host is quiesced, `goals.jsonl` and `goals-meta.json` are copied to a timestamped quarantine directory with recorded hashes, the migration refuses on a pre-state hash mismatch, the meta is written atomically, a second replay must produce the same `ledgerHash`, and any failure restores both files byte-for-byte. The contract is section 4 of the companion plan.

### 26.3 indexRevision vote

Six agents voted on the question in section 6.2. All six chose A: remove `indexRevision` from the cache key.

| Agent | Vote | Stated reason |
|---|---|---|
| `@analyst-deepseek` | A | The stamps are already in the key and validated; a scoped hash re-hashes the same inputs |
| `@analyst-mimo` | A | B collapses into A; a global revision turns every edit into a total flush |
| `@analyst-pickle` | A | The revision adds no correctness; B recomputes what the stamps encode |
| `@analyst-beam-free` | A | Per-entry validation is the precise mechanism; a global hash contradicts "no central invalidation" |
| `@analyst-gemini` | A | The entry validates its own dependencies; a global hash is redundant |
| `@analyst-glm-5.3-flash-free` | A | The stamps are strictly tighter than a global revision |

Accepted risk, named by four agents: validity now rests on each producer stamping all of its true inputs. A missed input can yield a stale hit, because no global revision forces a blanket miss. The mitigation is to keep the cacheable-tool set in section 6.1 strict and to add a proof that an edit to an unrelated file still hits.

### 26.4 Proof arithmetic after extraction

| Plan | Base | Added | Total |
|---|---|---|---|
| Main plan | 154 | 15 base + 2 handoff | 171 |
| Goal-ledger plan | — | 3 | 3 |
| Combined | 154 | 20 | 174 |

`gate-manifest.json` remains authoritative.

### 26.5 Open questions resolved

13. Resolved: section 22.1 is extracted to `docs/plan-goal-ledger-truth.md`.
14. Resolved: G6 uses quarantine, a quiesced host and a byte-identical restore.
15. Resolved: option A, 6-0.

### 26.6 Remaining blocking set

W1, W2 and W5 were closed by this revision; W3 is closed in revision 10. W4 (the Phase 5 resume proof) and W6 (H1 against decision 14 and Phase 4) remain open; the rest of W7-W34 are non-blocking and unchanged. Section 27 records the second full-plan round.

## 27. Revision 10 — second full-plan six-agent round

Status: evaluation record. The same six agents were asked again, one task each, with the same plain prompt as section 25 and a hard cap of 80 tool calls per agent. No lens, no section list and no output format were imposed. The agents were called sequentially. This round covers revision 9 of this plan and revision 1 of `docs/plan-goal-ledger-truth.md`.

### 27.1 Verdicts

| Agent | Main plan (rev. 9) | Companion plan (rev. 1) | Basis |
|---|---|---|---|
| `@analyst-deepseek` | APPROVE WITH CHANGES, not as one release | APPROVE WITH CHANGES | Re-derived the byte arithmetic; three design defects in Phase 3/4; eleven new items |
| `@analyst-mimo` | APPROVE WITH CHANGES, implementation-gated | APPROVE WITH CHANGES | About 40 citations spot-checked; six new findings, two in the companion |
| `@analyst-pickle` | APPROVE WITH CHANGES, not implementable yet | APPROVE WITH CHANGES, closest to ready | About 40 citations reproduced; fails the plan's own section 25.5 gate |
| `@analyst-beam-free` | SOUND, NOT READY | SOUND, NOT READY | A0 premise and ledger chain confirmed; four blocking items remain |
| `@analyst-gemini` | APPROVE, pending owner sign-off | APPROVE, pending owner sign-off | No new defect; endorses the nine-revision record |
| `@analyst-glm-5.3-flash-free` | APPROVE WITH CHANGES | APPROVE WITH CHANGES | About 30 claims verified on disk; the residual work is decisional |

Five approve with changes, one approves pending sign-off, none rejects. The section 25 reject on W1 and W2 is gone because both closed in revision 9.

### 27.2 Blocking set after this round

Status in revision 11: all twelve are closed; section 28 records each fix.

| # | Finding | Agents | Document |
|---|---|---|---|
| W35 | `selectMode` reads `SubTask.files`: a bundle with more than five files turns the dispatch into `swarm` with three copies, so the bundle changes the execution shape | deepseek N2, pickle B1 | main |
| W36 | Nothing advances `heartbeatAt`; `touch` is listed on terminal transitions only, so a live run older than 30 minutes is reported `stale` | pickle B2 | main |
| W37 | Liveness is probed at boot and on resume, but no mid-session event re-probes an owner | pickle B3 | main |
| W61 | The unrelated-edit cache proof promised in section 26.3 is not registered in section 10.1 | mimo N-A | main |
| W4 | Phase 5's headline acceptance (SIGKILL -> resume -> complete) has no proof registered to Phase 5 | mimo, beam-free, pickle, glm | main |
| W6 | H1 (default off) contradicts decision 14 and Phase 4's "injection unchanged" acceptance | deepseek, mimo, beam-free, pickle, glm | main |
| W22 | `prove-intelligence-off` runs only in Phase 6, against decisions 8 and 14, which require a proof at each phase | pickle B6 | main |
| W42 | G4 and G5 interact: complete goals auto-close and only incomplete goals go stale, so a stale goal can leave every view | pickle L1 | companion |
| W43 | An empty goal fails `checkCloseInvariant`, is never auto-closed and never staled, and leaks forever | pickle L2 | companion |
| W44 | The sweep runs inside `ensureLoaded` at boot while the host may still be writing | pickle L3 | companion |
| W47 | G4 has no kill switch, against decision 8's rule that every new behaviour is flagged | glm | companion |
| W48 | G5 cannot separate the board from the digest through one `digest.text`; `buildDigest` needs a parameter | glm | companion |

The main plan has seven blocking items and the companion has five. W35-W37 and W61 are new; W4, W6 and W22 were already open.

### 27.3 Fixed in this revision

| # | Finding | Agents | Fix |
|---|---|---|---|
| W3 | `--out` was owned by both section 8 and the zod pre-phase and was still scheduled with feature work | deepseek N9, glm F1 | Section 8 now names the zod pre-phase commit as the owner; section 16.3 already carried the row |
| W38 | `resumeInterrupted` duplicates the existing `resumeInterruptedSagas` (`handoff-service.ts:293`) | deepseek N3 | Section 8 now requires the new action to extend the existing recovery path |
| W40 | A third injection channel writes goal text (`goal-auto.ts:62`, `message-updated.ts:726-734`) | mimo companion N2 | Companion root cause 5 names all three channels |
| W41 | `bumpTerminal` also runs from `update()` when `patch.status === "dropped"` (`:712-715`) | mimo companion N6 | Companion root cause 2 and the behaviour table name both call sites |
| W45 | The G6 forced mode had no mechanism | pickle L4 | The companion defines `--force`, its pre-state requirement and its diff |
| W46 | The G6 pre-state hash was circular | pickle L6 | The companion captures the pre-state hash independently before the copy |
| W50 | The live-store premises cannot be re-verified from the sandbox | glm | The companion resolves the real `persistDir` and re-reads, hashes and records the pre-state; the owner re-runs the four probes before G6 |
| W52 | G4 auto-close did not state that it writes `closedAs` and bumps `completed` | deepseek N6 | The companion behaviour table now names the write and the counter |
| W53 | The ledger path was the default state root, not the store's `persistDir` | deepseek N7 | The companion resolves the path from `persistDir` and records it |
| W54 | The per-goal diff was not persisted, so the prior status was lost | pickle L5 | The companion persists the diff next to the quarantine manifest |
| W55 | `ACTIVE_STATUSES` has a third consumer the plan did not enumerate | deepseek N5 | The companion enumerates the list filter, the `markStale` guard and the digest/board count |
| W56 | The `runCleanup` text both registered index eviction and asserted the index survives `CACHE_CLEANUP_REQUESTED` | deepseek N11 | Section 8 and Phase 6 now split the two events |
| W59 | Section 16.2 said 30 record call sites while sections 16.1 and 16.6 said 35 | mimo N-B | Section 16.2 now states 35 (30 `z.record(`, 5 `tool.schema.record(`) |
| W60 | Removing option B from section 6.2 left the rejected option unrecorded | mimo N-C | Section 6.2 now records option B and the 6-0 rejection |
| W62 | The header cited `b98ca02` while HEAD is `1883eaf` | beam-free | The header records both |
| W63 | Decision 3 said the work never adds a schema argument while the same sentence added three | deepseek N10 | The decision now forbids a new tool and a new description line only |

### 27.4 Open non-blocking findings

Status in revision 12: W39, W49 and W51 are closed; section 29 records the vote and the fix.

| # | Finding | Agents | Document |
|---|---|---|---|
| W39 | The read cache is described outside one normative home. The recorded locator ("section 6 and section 16") was wrong: section 16 is the zod pre-phase. The real restatements are section 2 items 5 and 9-11, section 3.2, section 4.2, section 5.3, section 8, section 9 Phase 3, section 12 and section 13 | deepseek N1, mimo, pickle, glm | main |
| W49 | G6 names no entry point and no lock | glm | companion |
| W51 | The stale "attention bucket" has no filter or surface | mimo companion N1 | companion |

W58 (deepseek N8, the 1.5 GB reference) could not be reproduced: the three references at sections 3, 10.4 and 16.1 all match the 1.5 GB cap in `RULES.md`. It is recorded as not reproduced rather than fixed.

### 27.5 Reconciliation with section 25

- W1 (G6 rewrite) and W2 (`indexRevision`) closed in revision 9; no agent reopened either.
- W5 (section 22 outside the phases) closed by the extraction to the companion plan.
- W20 and pickle B4 are the same finding: no gate measures the live schema payload after B. W20 stays open in revision 10 and is closed in revision 13 (section 30).
- W15 and pickle B8 are the same finding: the 2000 ms probe against a cold Windows CIM start. W15 stays open in revision 10 and is closed in revision 13 (section 30).
- W19 and W23 were confirmed by beam-free; W23 was confirmed again by glm; W21 and W24 were confirmed by glm. Their status is unchanged.
- W22 moved from major to blocking.
- W3 (deepseek N9, glm F1) is fixed once.

### 27.6 Effect on readiness

- The factual base survived a second independent pass. No agent found a false code citation in the main plan beyond W59; the companion's one wrong citation (`session.ts`) is fixed.
- The blocking set is twelve: seven in the main plan and five in the companion. It grew because the companion was reviewed as a standalone document for the first time.
- The main plan cannot ship as one release until W4, W6 and W22 close. W35-W37 and W61 are design gaps in the bundle and cache, not sequencing.
- The companion cannot run G6 until W42, W43, W44, W47 and W48 close.
- The design is not rejected. The two section 25 rejects are gone, and every agent approves with changes or pending sign-off.

## 28. Revision 11 — blocking set closed

Status: change record. The twelve blocking findings from section 27.2 are closed in this revision. No code has been changed.

### 28.1 Closures

| # | Fix | Where |
|---|---|---|
| W35 | `SubTask.declaredFiles` is set by `decompose` on every task; `selectMode` reads `declaredFiles ?? files` and `buildPlan` computes conflicts from the same field, so a bundle never selects `swarm` or `moa` and never serializes a parallel batch | 7, 8, 9 Phase 4 |
| W36 | A 60 s unref'd, pid-scoped, serialized heartbeat writer refreshes `heartbeatAt` while a non-terminal record exists; a terminal transition removes the record and stops the interval | 4.4, 5.2, 9 Phase 1 |
| W37 | Detection also runs on the host idle surfaces (`session.idle` in `src/v2/event-adapter.ts`, `experimental.idle` in `src/v2/setup.ts`), debounced per `pid:startedAt:bootId`; the earlier `plugin-init.ts:1259` citation was wrong | 4.4, 8, 9 Phase 1 |
| W61 | `prove-read-cache-unrelated-edit.ts` asserts an edit outside the stamped paths still hits | 9 Phase 3, 10.1, 10.3 |
| W4 | `prove-continuity-resume.ts` covers SIGKILL -> resume -> complete plus the three refusal cases | 9 Phase 5, 10.1, 10.3 |
| W6 | Decision 14 carries an explicit H1 defect exception; the handoff track is Phase 5b with its own acceptance and proofs | 2, 9 Phase 5b, 22.1 |
| W22 | `prove-intelligence-off` starts in Phase 1 and is extended by every later phase; Phase 6 runs the full assertion | 9 Phase 1, 10.3 |
| W42 | A stale goal stays visible through `filter: "stale"`, the board's `Stale` section and `all`, while leaving the active roster and cap | companion 3, 6, 7 |
| W43 | An empty goal is never auto-closed and never counted active; it enters the attention bucket with reason `empty` | companion 3, 7 |
| W44 | The sweep runs at the tail of the first `load()` and inside the existing `mutate("sweep")` critical section; a held lock skips the pass and the next process start retries (corrected in rev. 13; the rev. 11 "after init / outer lock" wording was wrong) | companion 3, 7, 8 |
| W47 | G4 runs only when `TAWASSUL_GOAL_AUTOCLOSE=1`; the default off preserves today's `markStale` | companion 3, 7 |
| W48 | `buildDigest` gains `terminalCounts`; the board passes `true` and `compactDigest` passes `false` | companion 3, 6, 8 |

### 28.2 Proof arithmetic after revision 11

| Plan | Base | Added | Total |
|---|---|---|---|
| Main plan | 154 | 15 base + 2 handoff | 171 |
| Goal-ledger plan | — | 3 | 3 |
| Combined | 154 | 20 | 174 |

`gate-manifest.json` remains authoritative.

### 28.3 What remains open

W39 is closed in revision 12 by declaring section 6 normative and correcting the locator; W49 and W51 are closed by the companion's entry point and stale surface. W58 stays not reproduced. No finding from section 27.4 remains open.

The design is unchanged. Revision 11 edits text, phases and proof registration only.

## 29. Revision 12 — six-agent vote on the revision 11 decisions

Status: vote record and amendment record. Six agents voted sequentially on the same six-item ballot, with the same plain prompt and no imposed lens, section list or output format; the hard cap was 80 tool calls per agent. No code has been changed. The ballot covers the five post-review decisions and the one remaining finding (W39).

### 29.1 Tally

| Item | Approve | Amend | Reject | Outcome |
|---|---|---|---|---|
| D1 H1 default-off as decision-14 exception | 6 | 0 | 0 | adopted unchanged |
| D2 G4 behind `TAWASSUL_GOAL_AUTOCLOSE`, default off | 3 | 3 | 0 | adopted with the flag-off parity pin in 29.3 |
| D3 Phase 5b as an independent phase | 5 | 1 | 0 | adopted with the sequencing pin in 29.3 |
| D4 `SubTask.declaredFiles` | 4 | 2 | 0 | adopted with the `DispatchTask` / conflict-detection extension in 29.3 |
| D5 60 s heartbeat + idle trigger | 3 | 3 | 0 | adopted with the trigger and lifecycle corrections in 29.3 |
| D6 W39 consolidation | 1 | 5 | 0 | adopted with the corrected locator in 29.3 |

No item was rejected. D1 is unanimous.

### 29.2 Per-agent votes

| Agent | D1 | D2 | D3 | D4 | D5 | D6 |
|---|---|---|---|---|---|---|
| `@analyst-deepseek` | APPROVE | AMEND | AMEND | AMEND | AMEND | AMEND |
| `@analyst-mimo` | APPROVE | APPROVE | APPROVE | APPROVE | AMEND | AMEND |
| `@analyst-pickle` | APPROVE | AMEND | APPROVE | AMEND | AMEND | AMEND |
| `@analyst-beam-free` | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | AMEND |
| `@analyst-gemini` | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE | APPROVE |
| `@analyst-glm-5.3-flash-free` | APPROVE | AMEND | APPROVE | APPROVE | APPROVE | AMEND |

### 29.3 Consensus amendments applied

| # | Item | Amendment | Where |
|---|---|---|---|
| A1 | D1 | H1 is the outer switch; `context.relevance-ranked` applies only when H1 is on; flag off gates both `handoff.ts:496-505` and `:670-674`; release note and documented revert | 22.1, 22.3 Q11, 17 Q8 |
| A2 | D2 | The whole G4 lifecycle, including the `stale` roster/cap exclusion and the board's `Stale` section, runs only with the flag on; with the flag off `stale` stays in `ACTIVE_STATUSES` exactly as today | companion 5, 6, 7, 8, 14 |
| A3 | D3 | 5b is independent of Phase 5's content but not optional within the plan; dropping it edits Phase 6's five-flag assertion and the counters; the verbatim `prove-intelligence-off` line is added in 5b, not Phase 4 | 9 Phase 5b, 10.3 |
| A4 | D4 | `declaredFiles` is filled on every `SubTask` by a path-token extractor (the tools take no file argument), including `[]`; `DispatchTask` carries `declaredFiles` and `copyOf`; `buildPlan` computes conflicts from `declaredFiles ?? files` and groups by `copyOf ?? id`, so role copies are not self-conflicting | 7, 8, 9 Phase 4 |
| A5 | D5 | The idle trigger is `session.idle` / `experimental.idle`, not `plugin-init.ts:1259`; the heartbeat is pid-scoped and serialized with one in-flight write and one queued rewrite; a terminal transition removes the record and stops the interval; "zero extra state writes" is scoped to the probe path | 4.4, 5.2, 8, 9 Phase 1 |
| A6 | D6 | Section 6 is the single normative read-cache description; section 2 items 5 and 9-11 hold the decisions; sections 3.2, 4.2, 5.3, 8, 9 Phase 3, 12 and 13 are subordinate to it; the phantom section 16 locator is struck | 2, 3.2, 6, 27.4, 28.3 |

### 29.4 What remains

No finding from section 27.4 remains open. W58 stays not reproduced. Revision 12 pins the D2 flag scope and corrects the D4 and D5 mechanisms; it adds no phase and no tool. The proof count is unchanged (main 171, companion 3, combined 174; `gate-manifest.json` authoritative).

## 30. Revision 13 — six-agent review of revision 12

Status: review record and amendment record. Six agents reviewed revision 12 and companion revision 4 sequentially, with the same plain prompt, no imposed lens or output format, and a hard cap of 60 tool calls per agent. No code has been changed.

### 30.1 Verdicts

| Agent | Verdict |
|---|---|
| `@analyst-deepseek` | NOT READY |
| `@analyst-mimo` | NOT READY |
| `@analyst-pickle` | READY WITH CHANGES |
| `@analyst-beam-free` | READY WITH CHANGES |
| `@analyst-gemini` | READY WITH CHANGES |
| `@analyst-glm-5.3-flash-free` | READY WITH CHANGES |

No agent rejected the design. The two NOT READY verdicts concentrated on the same two areas: the H1 gate covered only one of the two context sites, and the companion's G2 blamed writers that are already correct.

### 30.2 Blocking findings closed

| # | Finding | Fix |
|---|---|---|
| B1 | H1 gated `handoff.ts:670-674` only; the short-context merge branch at `:496-505` runs before validation and would still replace `contextToUse`, so the flag-off path was not verbatim | Section 22.1 gates both sites; Phase 5b and 29.3 A1 state both |
| B2 | B added three `Checkpoint` fields, but `missing` and `bundleDigest` are dead on path D, where the bundle is never delivered | The `Checkpoint` addition drops to one field: section 5.1 keeps only `unverified` (4 + 1 = 5); section 8 and section 10.4 follow |
| B3 | The resurrection proof only covered delete then reload; `commit()` writes `closedAs`, so the legacy backfill was untested | Companion section 8 seeds a `verified` record followed by a `dropped` record with no `closedAs` |
| B4 | `isEmptyGoal` was named without a definition or consumers | Companion section 5 defines it and names the four consumers |
| B5 | The sweep was described as taking an outer lock, but `markStale` already runs inside `mutate("sweep")` | Companion sections 3, 7 and 10 state the existing critical section |
| B6 | G6 routed the meta write through the private, unlocked `persistMeta` | Companion section 4 routes it through `rebuildMeta()` inside `mutate("migrate")` |
| B7 | The G6 fixpoint asserted only `ledgerHash`, which is blind to counts | Companion section 4 asserts `lifecycleSnapshot()` separately and adds `--expect-hash` |
| B8 | G6 precondition 1 allowed "or holds the store lock", which is not a quiesce | Companion section 4 requires the host stopped; a held lock is a refusal |
| B9 | Companion G2 blamed `deleteGoal`/`update`, but `finishLocked` removes terminal goals first, so `bumpTerminal(fresh.status)` already increments `dropped` | Companion sections 2 and 3 rewrite G2 as replay plus a regression assertion |
| B10 | `buildDigest` was written as `buildDigest(goals, { terminalCounts })`, and `goal-auto.ts:62` was not covered | Companion sections 3 and 6 use `buildDigest({ terminalCounts })`, default `false`; the board proof covers `goal-auto.ts:62` |

### 30.3 Non-blocking findings closed

| # | Finding | Fix |
|---|---|---|
| W15 | The 2000 ms probe timeout is shorter than a cold PowerShell CIM start | 2000 ms on POSIX, 5000 ms on the two PowerShell CIM calls (sections 4.4, 12, 19) |
| W17 | `projectStatePath` does not create the new subdirectory | `owner.ts` and `store.ts` create `continuity/` and `project-index/` with `mkdirSync(recursive)` (sections 4.1, 4.4, 5.2, 12) |
| W18 | "2 MB per file" and "2 MB per entry" disagreed for a 50-path `batchread` | The cap is the summed entry payload (sections 6.1, 6.4) |
| W20 | No gate measured the live schema payload | `prove-context-diet` measures it against the Phase 0 receipt; no new step (section 10.3) |
| TTL | TTL could be read as a validity rule in the limits table | Section 6.4 states TTL is cleanup only; `lookup` has no time check |
| Stale | `filter: "stale"` was described as new | It already exists in `GoalListFilterSchema`; only the board's `Stale` section is new (companion sections 3, 6, 7) |
| Consumers | `ACTIVE_STATUSES` consumers were misstated | `activeCount()`, `list("active")` and `pickCaptureGoal`; `markStale` does not read it (companion section 5) |
| Citations | `buildAccumulatedContext` `:21-161`, `DispatchTask` `:8-17`, `isProcessAlive` `:2-15`, `bumpTerminal` `:415-422` | `:21-166`, `:8-17`, `:2-17`, `:418-422`; the rev-13 `:7-16` and `:1-15` values were regressions and are reverted in rev. 14, and the `:19-161` value was corrected in rev. 15 |
| Numbers | 9.5-12.5 days, "rev. 8" extraction, "Open in rev. 6" ledger rows, Decision 2 | Corrected in sections 1.4, 13, 16.3, 22.2 and the companion header |

### 30.4 Proof arithmetic

| Plan | Base | Added | Total |
|---|---|---|---|
| Main plan | 154 | 15 base + 2 handoff | 171 |
| Goal-ledger plan | — | 3 | 3 |
| Combined | 154 | 20 | 174 |

The `Checkpoint` reduction and the W15/W17/W18/W20 closures add no proof step: W20 is an extension of `prove-context-diet`, and the others are text and code rules already covered by the named gates. `gate-manifest.json` remains authoritative.

### 30.5 What remains

No blocking finding remains. The two NOT READY verdicts are answered by B1-B2 in the main plan and B3-B10 in the companion. W58 stays not reproduced. The design is unchanged: revision 13 edits text, one schema contract, phases and citations only.

## 31. Revision 14 — six-agent review of revision 13

Status: review record and amendment record. Six agents reviewed revision 13 and companion revision 5 sequentially, with the same plain prompt, no imposed lens or output format, and a hard cap of 60 tool calls per agent. No code has been changed. The cap was not respected by four of the six; the counts below are the disclosed counts, and beam-free's count is corrected to 110 by the owner after it reported 90.

### 31.1 Verdicts

| Agent | Verdict | Calls | Blocking |
|---|---|---|---|
| `@analyst-deepseek` | READY WITH CHANGES | ~80 (over cap) | 3 |
| `@analyst-mimo` | READY WITH CHANGES | 86 (over cap) | 0 |
| `@analyst-pickle` | READY WITH CHANGES | 67 (over cap) | 3 |
| `@analyst-beam-free` | READY WITH CHANGES | 110 (reported 90; corrected by the owner) | 0 |
| `@analyst-gemini` | READY | 4 | 0 |
| `@analyst-glm-5.3-flash-free` | READY WITH CHANGES | 41 | 2 |

No agent returned NOT READY. The two NOT READY verdicts of the previous round are answered; this round finds seven new blocking items, all bounded text and contract fixes.

### 31.2 Blocking findings closed

| # | Finding | Fix |
|---|---|---|
| R1 | `load({ replay: true })` writes the meta at `goal-store.ts:333` outside `mutate("migrate")`, and step 5 writes it again | Companion section 4 adds a no-persist replay (`load({ replay: true, persist: false })`), runs it inside `mutate("migrate")`, and makes step 5 read-only |
| R2 | `prove-goal-capture.ts:46-47` asserts the terminal-count line from `buildDigest()`, so `terminalCounts: false` turns an existing gate red; the file was not in the modification table | Companion section 8.1 adds the file and rewrites its assertions through `lifecycleSnapshot()`; revision 15 replaces that rewrite with `terminalCounts: true` because the snapshot excludes live terminal goals (section 32.4, P2) |
| R3 | `priorStatus` is described as an optional field that "stays optional and lenient", but no such field exists in `src/` | Companion sections 3 and 5 state that no field is added and the event stream is the audit source |
| R4 | `attachPackToHandoff` appends a default-on `## Portable Context Pack` suffix at `handoff.ts:717-727`, so "verbatim" was false on a default host | Section 22.1 and Phase 5b scope the assertion to `TAWASSUL_CONTEXT_HANDOFF=0` and define prefix equality plus one labeled suffix otherwise |
| R5 | `runCleanup` is shared by `CACHE_CLEANUP_REQUESTED` and `MEMORY_EMERGENCY`, so the W56 split inside it would evict the index on every flush | Section 8 and Phase 6 name two listeners: broadcast stays cache-only, emergency also evicts the index |
| R6 | Section 20.2 said a bare dispatch command yields "use task() instead", but `tawaRoutingEnforcementGuard` runs first and says "use task(desc: 'tawa')" | Sections 20.2 and 20.3 state the guard order and the actual message |
| R7 | `finishLocked` increments the count before the tombstone write; a failed write leaves a live terminal goal and a later delete double-counts | Companion section 3 scopes the G2 claim to the successful-write path and adds the crash-window fixture; revision 15 withdraws the load normalization and fixes the two dropped-write paths instead (section 32.3) |

### 31.3 Non-blocking findings addressed

| # | Finding | Fix |
|---|---|---|
| C1 | `DispatchTask` was "corrected" in rev. 13 to `:7-16`; the interface is `:8-17` | Reverted in sections 7, 8 and 20.9 |
| C2 | `isProcessAlive` is `:2-17`, not `:1-15` | Corrected in sections 4.4 and 19 |
| C3 | `GoalListFilterSchema` is `:415-425`, not `:414-424` | Corrected in the companion and in section 27 |
| C4 | `dispatchToRoles` is `:68-82`, not `:68-90` | Corrected in section 20.9 |
| C5 | `dependency-map.ts:17-45` is helper code; the walk is `collectTsFiles` `:92-130` | Corrected in sections 1.4, 6.4 and 27 |
| C6 | "154 gate steps" is a mislabel; the manifest has 177 named steps | Section 1, section 1.3 and the baseline now say 154 proof steps (177 named gate steps: 16 fast + 154 proofs + 6 smoke + 1 eval) |
| C7 | `lifecycleSnapshot()` is not the only new public surface | The companion calls it the only new read-only accessor |
| C8 | A second migration run rewrites `createdAt`/`updatedAt`, so "no-op" is not byte-identical | The companion defines no-op as the count/hash fixpoint |
| C9 | The five flags have no defined cross-product | Not closed: the full matrix stays open as W25, and Phase 4 covers the all-off case only. Recorded as a known completeness gap, not a regression |
| C10 | "Checkpoint drops to one field" was ambiguous | The status line and section 30.2 say the `Checkpoint` addition drops to one field |
| C11 | The hostile fixture's 13-field scope did not say whether `unverified` is covered | Section 5.1 and Phase 1 keep the 13-field count scoped to A0/A0b and exclude the B checkpoint field |
| C12 | `goal-auto.ts` was reported as `:63` | Rejected: `buildDigest()` is at `goal-auto.ts:62`; no change |

### 31.4 Proof arithmetic

| Plan | Base | Added | Total |
|---|---|---|---|
| Main plan | 154 | 15 base + 2 handoff | 171 |
| Goal-ledger plan | — | 3 | 3 |
| Combined | 154 | 20 | 174 |

No fix in this revision adds a proof step. R2 extends an existing proof, R7 adds a fixture to an existing proof, and the rest are text, contract and citation edits. `gate-manifest.json` remains authoritative.

### 31.5 Methodology

The 60-call cap was exceeded by deepseek (~80), mimo (86), pickle (67) and beam-free (110); gemini used 4 and glm 41. beam-free reported 90 and the owner corrected the count to 110, so a self-reported count is not trustworthy on its own. Future rounds either enforce the cap mechanically or treat it as advisory and record the disclosed count with a correction channel. The overage did not change the blocking set: every blocking finding above was re-verified independently against the tree before it was applied.

## 32. Revision 15 — three-agent review of revision 14

Status: review record and amendment record. Three agents reviewed revision 14 and companion revision 6 sequentially, with the same plain prompt, no imposed lens or output format, and a hard cap of 60 tool calls per agent. All three stayed inside the cap. No code has been changed.

### 32.1 Verdicts

| Agent | Verdict | Calls | Blocking |
|---|---|---|---|
| `@analyst-deepseek` | NOT READY | 54 | 2 |
| `@analyst-pickle` | READY WITH CHANGES | 41 | 4 |
| `@analyst-glm-5.3-flash-free` | READY | 54 | 0 |

The blocking findings converge on one defect: G1's counting rule and G2's "writers unchanged" claim cannot both hold. glm did not report it; deepseek and pickle found it independently, and the owner re-verified it against the tree before applying the amendment.

### 32.2 The defect

- `deleteGoal` sets `tomb.status = "dropped"` and calls `bumpTerminal(fresh.status)` (`src/services/goal-store.ts:788`). For a live `completed` or `verified` goal that increments `completed` or `verified` (`:418-422`), while `commit` writes `closedAs: "dropped"` (`:356-357`).
- The replay counter reads the prior live status, not `closedAs` (`:295-298`), which is the only reason the two agree today. The backfill at `:299-301` then writes the prior status into `closedAs`.
- `scripts/prove-goal-capture.ts` seeds exactly that case: `:162` asserts `1 completed` for a live completed goal, `:166` asserts `1 completed` after the delete, `:168` asserts `0 dropped`, and `:172` asserts the replay agrees. Under G1 those assertions invert.

Revision 14 claimed the writers were correct and that revision 4's `bumpTerminal` edit was a no-op. That claim is false for the crash window. The owner's rule is that a dropped record counts as dropped, so revision 15 restores the writer edit and updates the proof instead of preserving the old expectation.

### 32.3 The crash window

`buildDigest` already counts a live terminal goal once through `countStatus` (`:926-927`). Revision 15 adds no load normalization: folding a live terminal goal into `lifecycleCounts` would double count it. With the writer fix, deleting a live terminal goal moves it from `countStatus` to `lifecycleCounts.dropped`, and a replay from `closedAs: "dropped"` produces the same counts. The crash-window fixture asserts that transition, not a load-time rewrite.

### 32.4 Blocking findings closed

| # | Finding | Fix |
|---|---|---|
| D1 | G1 counts from `closedAs`, but `deleteGoal` increments the prior status while writing `closedAs: "dropped"`, so writer and replay diverge | Companion G2 calls `bumpTerminal("dropped")` at `:713` and `:788`; the revision-6 "writers unchanged" claim is withdrawn |
| D2 | G2's load normalization either double counts (it would add to `countStatus`) or is a no-op (the double count is in-process) | Companion G2 adds no normalization; it relies on `countStatus` for live terminal goals and on the writer fix for the delete transition |
| P1 | The crash-window premise is contradicted by the passing assertions at `prove-goal-capture.ts:166-172` | Companion section 8 updates those expectations to `0 completed` and `1 dropped` under G1 |
| P2 | Rewriting the capture-proof assertions through `lifecycleSnapshot()` breaks them, because the snapshot excludes live terminal goals | Companion section 8 makes `terminalCounts: true` mandatory and reads the digest line; `lifecycleSnapshot()` is used only for lifecycle counts |
| P3 | G1 does not name the replay-counter edit | Companion G1 names `:295-298` (counter) and `:299-301` (backfill removal) |
| P4 | G2's normalization wording would either rewrite live records or leave the crash window unfixed | Companion G2 states counting only, never record identity; the record stays live and deletable |

### 32.5 Non-blocking findings addressed

| # | Finding | Fix |
|---|---|---|
| N1 | The load-heal meta write is `:333`, not `:334` | Section 31.2 corrected |
| N2 | Section 22.2 still cites `load({ replay: true })` | Now `load({ replay: true, persist: false })`, with `scripts/goal-migrate.ts` and `lifecycleSnapshot()` added |
| N3 | Section 22.2 says "one extension"; the companion has two | Now two extended and three new proof scripts |
| N4 | `buildAccumulatedContext` is `:21-166`, not `:19-161` | Corrected in sections 1, 7, 20.6, 21 and 22.1 |
| N5 | Section 20.7 cites `:203-209` for a call at `:205` and a log at `:207-211` | Corrected |
| N6 | The gate composition was wrong: the manifest is 16 fast + 154 proofs + 6 smoke + 1 eval | Sections 1, 31.3 and the baseline corrected; the total 177 was already right |
| N7 | `state-paths.ts:48-50` in the R5 row | Corrected to `:49-51` |
| N8 | `credentialScope` was called the only lenient field while `provenance` and `decision_kind` get the same treatment | Section 5.1 names the three lenient fields and their closed-union types |
| N9 | `decompose` is synchronous; an async change would add two files to the table | Section 8 states that `decompose` stays synchronous and the planner uses `statSync` |
| N10 | `src/scripts/migrate-goals.ts` already exists | Companion section 4 names it as the board-migration precedent and adopts its `--state-dir` convention |

### 32.6 Proof arithmetic

| Plan | Base | Added | Total |
|---|---|---|---|
| Main plan | 154 | 15 base + 2 handoff | 171 |
| Goal-ledger plan | — | 3 | 3 |
| Combined | 154 | 20 | 174 |

No fix in this revision adds a proof step: the capture proof is extended, the crash-window fixture belongs to the new migration proof, and the rest are text, contract and citation edits. `gate-manifest.json` remains authoritative.

### 32.7 Methodology

The three agents used 54, 41 and 54 calls, all inside the 60-call cap; this is the first round in the record where the cap held. pickle disclosed a stale running tally (24) against its itemised count (41) and reported the discrepancy rather than a false precision; glm counted two calls refused by sandbox permissions. No finding was accepted without an independent check against the tree.

## 33. Revision 16 — three-agent final review of revision 15

Status: review record and amendment record. Three agents reviewed revision 15 and companion revision 7 sequentially, with the same plain prompt, no imposed lens or output format, and a hard cap of 60 tool calls per agent. All three stayed inside the cap. No code has been changed.

### 33.1 Verdicts

| Agent | Model | Verdict | Calls | Blocking |
|---|---|---|---|---|
| deepseek | `opencode/deepseek-v4.1-flash-free` | READY WITH CHANGES | 42 | 4 |
| pickle | `opencode/big-pickle` | READY WITH CHANGES | 58 | 2 |
| glm | `opencode/glm-5.3-flash-free` | READY WITH CHANGES | 43 | 0 |

The first deepseek invocation resolved to `nvidia/deepseek-ai/deepseek-v4.1-flash` because the agent had no model binding in the runtime roster, even though `opencode.json` names the OpenCode model. That run was discarded and the review was rerun with an explicit `model` argument. The owner identified the misroute; the plan records it so later rounds pass the model explicitly.

### 33.2 Blocking findings closed

| # | Finding | Fix |
|---|---|---|
| D1 | The resurrection proof asserts `closedAs === "dropped"` for a seeded dropped record with no `closedAs`, while G1 deleted the backfill, so the field stays `undefined` and the assertion fails | Companion G1 keeps a constant backfill (`closedAs ??= "dropped"`) and derives the counter from `closedAs`; `lastLive` (`:269`), `prior` (`:294`) and both `lastLive` uses (`:302`, `:304`) are deleted, so `noUnusedLocals` stays green |
| D2 | `terminalCounts: true` cannot both keep the counts on line 0 and move them to a labelled footer; the capture proof reads line 0 | Companion G5 pins the two shapes: `false` renders `🎯 N open`, `true` renders today's full counts line; the board passes `true` and the "history footer" wording is withdrawn |
| D3 | `hmacWriteFile` returns without writing and without throwing on a foreign key or an isolated session, so `rebuildMeta` can report success with the meta unchanged | Companion section 4 has `rebuildMeta` re-read the meta with `hmacReadFile` and assert `seq`, `ledgerHash` and the three counts; the migration proof asserts the same read-back |
| D4 | "Counted once through `countStatus`" is false in-process: `finishLocked` bumps the counter before the tombstone write, so a failed write leaves `lifecycleCounts.completed` and `countStatus("completed")` at once | Companion section 7 scopes the claim to after a reload; the in-process transient is stated and unchanged by G2 |
| P1 | A stale goal never reaches `compactDigest` when the flag is on: the attention loop iterates `list("active")`, which excludes `stale`, and the `all` scan covered empty goals only | Companion section 5 extends the `list("all")` attention scan to empty and stale goals; the stale-lifecycle proof asserts the single-stale-goal case |

### 33.3 Non-blocking findings addressed

| # | Finding | Fix |
|---|---|---|
| N1 | The short-context merge branch is `:495-505`, not `:496-502` | Section 7 corrected |
| N2 | `activeCount()` is `:402-408`, not `:403-408` | Corrected in the companion, two places |
| N3 | Baseline section 1.3 still said "one more proof than both documents assume" | Now "the base both documents assume" |
| N4 | The metrics row was labelled "Gate steps" while holding proof steps | Renamed "Proof steps" |
| N5 | The catalog also pins the file list and the shard coverage, not only the step count | Section 10.2 names the four assertions |
| N6 | The migration diff rationale claimed the prior status would otherwise be lost, but the ledger is append-only | Companion section 4 makes the diff a review artifact, not a data-loss guard |
| N7 | `load()` does not reset store state, so a second read-only load is not a fresh read | Companion section 4 specifies a fresh `GoalStore` instance |
| N8 | `src/scripts/migrate-goals.ts` is not mentioned in the modification table | Companion section 8.1 states it is untouched |
| N9 | `scripts/goal-migrate.ts` lands under the rules gate | Companion section 4 notes it must be English and comment-free |
| N10 | The capture proof has one `countsLine` helper, not many call sites | Companion section 8 says so |
| N11 | `prove-goal-resurrection.ts` is the resurrection/ghost proof, not a delete/reload proof | Companion section 8 describes it correctly |

glm's five citation claims were checked and rejected: `accounting.ts` is `src/services/context-pack/accounting.ts:15-55` with `computeBudget` at `:55`, `tool-run-log.ts` is `src/services/tool-run-log.ts:59`, `ast-service.ts:230-237` is the exact cache-hit block, `dispatchToRoles` `:68-82` covers the method and its closing brace, and the description string range is `:207-215`. No change was made for those five.

### 33.4 Proof arithmetic

| Plan | Base | Added | Total |
|---|---|---|---|
| Main plan | 154 | 15 base + 2 handoff | 171 |
| Goal-ledger plan | — | 3 | 3 |
| Combined | 154 | 20 | 174 |

No fix in this revision adds a proof step. `gate-manifest.json` remains authoritative.

### 33.5 Methodology

The three agents used 42, 58 and 43 calls, all inside the cap. pickle used 58 of 60. deepseek counted one refused shell call; glm counted two rejected `evaluationreport` calls. The runtime roster does not bind `@analyst-deepseek`, which is why the first call fell through to the NVIDIA model; later rounds pass `model` explicitly.
