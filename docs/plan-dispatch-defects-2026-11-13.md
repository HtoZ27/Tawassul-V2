# Tawassul V2 — Host 2.2.6–2.3.0 Dispatch Defects Plan

Status: revision 21. Phases 0-4 complete on host 2.3.0, variant B selected;
phase 5 open and deferred; `D5` accepted open. Phase 0 evidence is
`docs/phase0-dispatch-capture-2026-11-13.jsonl`, reconstructed read-only from
the host database (`session_message`, `session_v2`) after the JSONL log file
was not retained. The four-agent review of revision 16 returned one SAFE and
three NOT SAFE; the common blocking finding was the missing Phase 0 artifact,
which revision 17 closes with that transcript. Revision 18 corrects the SDK
contract wording: `SessionIdle.sessionID` is the Session that went idle,
`SessionIdleBackground.sessionID` is the job owner, `childSessionID` names the
subagent, and idle does not run after failure or interruption, so the raw
relay is mandatory. Revision 19 raises the host floor to 2.3.0 by owner order,
so the 2.2.x line is refused and its foreground proof is dropped. Revision 20
fixes review finding 7(c) and records the R2, R8 and R10 fixes from the
agent-visibility ledger. Revision 21 fixes finding 7(a) after a 5/5 panel vote
and accepts finding 7(b) after a 3/5 vote; only 7(d) remains open.
Date: 2026-11-13 (revisions 17-18: 2026-11-14; revisions 19-21: 2026-11-15)
Owner: user
Scope: fix the defects surfaced by the 2.2.6 / 2.2.7 / 2.3.0 review and the
six-analyst panel, without changing foreground 2.3.0 behaviour, task-control,
the pipeline, the loop guard, or host continuation ownership.

---

## 0. Authority and constraints

`AGENTS.md` rules 1-5 apply.

- Rule 1: English is canonical. No Arabic in code or docs.
- Rule 2: no comments in gated code.
- Rule 4: the smallest change that fixes the defect. No adjacent refactors and
  no new mechanisms unless the fix is impossible without them.
- Rule 5: no feature-for-feature trade.

User vetoes, binding:

- No matching of the literal `"running"` or `"active"` status strings.
- No `ctx.agent.reload()` and no `transform`.
- No new host-internal APIs.

No commit is requested by this plan.

---

## 1. What the review established

### 1.1 Source-verified facts

- `src/v2/setup.ts:710-712` rebuilds the v1 metadata as
  `{ ...originalMetadata, status: "completed" }` for every non-error result.
- `syntheticStatus` at `src/v2/setup.ts:692` only detects the absence of a
  `status` key, so a host-supplied value is overwritten, not preserved.
- `src/v2/result-bridge.ts:144-157` writes the forged metadata back.
- `src/hooks/tool-execute.ts:590-594` maps `completed` to `success = true`,
  and any other unrecognised status falls through to
  `!!(output.title || output.output || result)`.
- `src/hooks/tool-execute.ts:713-715` clears the 7-minute task timeout.
- `src/hooks/tool-execute.ts:722` emits `TASK_COMPLETED`.
- `src/hooks/tool-execute.ts:753` calls `recordPipelineState`, which at
  `399-482` registers a fix with `regressionGuard.registerFixWithRegression`
  and enqueues structural analysis and quality gates.
- `src/hooks/tool-execute.ts:727-738` appends the analyst nudge inside the
  completion block.

### 1.2 Correction to the panel's blast radius

`isTawassulTool("task")` is false: `task` is absent from
`TAWASSUL_TOOL_NAMES` (`src/tool-names.ts:1-48`) and
`src/hooks/guards/shared/limits.ts:29-31` returns false for it.

`src/hooks/tool-execute.ts:852` therefore returns before the rest of the
after-hook. For a `task` call, these never run:

- `AGENT_SUCCESS` at 938, and with it the circuit breaker, health, trust,
  cost ledger, predictive router, and the phantom `TASK_STARTED` at 500 ms.
- `EXECUTION_FINISHED` at 885 and the collective-memory writes.
- The chain block at 874-891 and the chain teardown at 969-971.
- `recordToolCall` and the conflict learner at 894-902.
- `maybeAutoCapture` at 977.

The chain block is therefore dead for `task`; there is no chain leak to guard.

The real false writes for a dispatch are narrower:

| Effect | Anchor | Persistent |
|---|---|---|
| failure and no-progress counters cleared | `tool-execute.ts:620` -> `tool-loop-guard.ts:115-121` | no |
| repeat ring and usage shadow | `tool-execute.ts:622-638` | no |
| tool run log success | `tool-execute.ts:659-668` | yes |
| `TASK_COMPLETED` activity metrics | `tool-execute.ts:722` -> `service-factory.ts:386` | yes |
| `TASK_COMPLETED` timeline entry | `tool-execute.ts:722` -> `timeline-integrations.ts:30` | yes |
| `TASK_STARTED` checkpoint snapshot per dispatch | `tool-execute.ts:342` -> `service-factory.ts:652-673` -> `checkpoint-manager.ts` | yes |
| bogus regression fix at dispatch | `tool-execute.ts:753` -> `399-482` | yes |
| phase completeness advance on a call that already returned | `tool-execute.ts:753` -> `PipelineStateManager.ts:232-267` | yes, but it is the only working advance path |

The 7-minute watchdog clear at `tool-execute.ts:713-715` is **not** a false
write: the watched call returned at dispatch, so its timer must be cleared.
The timer is warn-only (`tool-execute.ts:81-94`).

### 1.3 Unverified premise

The live host version and the raw `task` result metadata are not proven. At
review time the tree pinned `@opencode/plugin` at 2.2.1 (`package.json:173`)
and `HOST_FLOOR`/`HOST_AUDITED` at 2.2.1 (`src/core/host-floor.ts:1-2`); the
2.3.0 contract was briefed, not observed. Phase 0 then captured the live 2.3.0
host, and revision 14 moves the pin and `HOST_AUDITED` to 2.3.0; revision 19
moves `HOST_FLOOR` to 2.3.0 as well, by owner order.

---

## 2. Defect register

| ID | Feature | Defect | Evidence | Severity |
|---|---|---|---|---|
| D1 | task completion | host `status` overwritten with `completed` | `setup.ts:710-712` | high |
| D2 | loop guard | false success clears failure and no-progress counters; in-memory, and any later success clears them too | `tool-execute.ts:620` | medium |
| D3 | supervision | withdrawn: the watched call returns at dispatch, so clearing its warn-only timer is correct | `tool-execute.ts:81-94,713-715` | withdrawn |
| D4 | activity, timeline | false `TASK_COMPLETED` entries | `tool-execute.ts:722` | high |
| D5 | pipeline | bogus regression fix at dispatch; only fires while a pipeline is active. The phase advance cannot be removed first, because `recordPipelineState` is the only caller of `recordToolResult` and admits `task` alone. Open until a terminal signal can replace it | `tool-execute.ts:404,753`, `PipelineStateManager.ts:232-267` | high, open |
| D6 | analyst notice | nudge fires at dispatch, before the analyst works; phase 1 must drop it, not preserve it | `tool-execute.ts:727-738` | medium |
| D7 | task completion | after suppression, no real completion is recorded; consequential only if phase 1 ships alone | no path after phase 1 | medium |
| D8 | timeline | `TASK_STARTED` would stay without a matching completion; created by phase 1, not live today | `tool-execute.ts:342` | low, conditional |
| D9 | finalization | `experimental.idle` does not run after failure or interruption | SDK `session.d.ts:171-186` | high for design |
| D10 | audit | registry, UPSTREAM and ISSUES say idle is not registered | `registry.json:19`, `UPSTREAM.md:172`, `ISSUES.md:3046` | medium |
| D11 | release surface | CI cannot see a host newer than 2.2.1 | `gate-manifest.json:86-92`, `UPSTREAM.md:37-38` | medium |
| D12 | release surface | the audit ceiling is tied to the SDK pin | `package.json:173`, `check-sdk-pins.ts:99-106,122-141` | medium |
| D13 | release surface | `HOST_FLOOR` is a minimum only; 2.3.0 loads silently. Deliberate: recorded, not fixed | `host-floor.ts:1-2,26-29` | info |
| D14 | cancellation | withdrawn: `web` and `imagegen` already receive `ctx.abort` | `src/tools/web.ts:745`, `src/tools/image-gen.ts:230` | withdrawn |
| D15 | smoke | 60 s cap; the 42.8 s figure is not recorded, and the smoke prompt never dispatches a task | `release-smoke.sh:14,147` | low, UNPROVEN |
| D16 | release surface | `UPSTREAM.md:61-64` claims a `>= 2.2.0 < 3.0.0` range and a 3.x refusal; the code refuses only below the floor | `UPSTREAM.md:61-64`, `host-floor.ts:26-29` | medium |
| D17 | cancellation | `astquery`, `projectmap`, `depmap` and `handoff` never read `ctx.abort`; `web` and `imagegen` do | `adapters.ts:98`, `web.ts:745`, `image-gen.ts:230` | medium |

---

## 3. Phases

### Phase 0 — Premise proof (blocking)

Capture, in one diagnostic run:

1. The host version actually serving the plugin.
2. The raw `task` result `metadata`, including `status` and `sessionID`.
3. Whether `experimental.idle` fires for a child session, and with which
   `background` items.
4. Whether `session.execution.succeeded/failed/interrupted` fires for the
   child.
5. A foreground `task` result on the same host, with the same `status` and
   `sessionID` keys, so the two shapes can be compared.
6. The hook-level `spec.status` itself, and the child session ID or IDs one
   call returns (`src/v2/types.ts:42-48`, `tool-execute.ts:552-553`).

Nothing in the tree logs result metadata today: `tool-execute.ts:600-612` prints
a 300-character output preview only. Phase 0 therefore adds one temporary trace
at `setup.ts:690-712` that dumps `spec.status`, `spec.result.metadata`, the tool
name and the parent session, and removes it before any phase ships.

Capture mechanism: run the live host once with
`TAWASSUL_DEBUG=1 TAWASSUL_LOG_JSON=1 TAWASSUL_LOG_FILE=<path>` set
(`src/utils/logger.ts:2-3,99-106`) and save the JSONL log plus the raw tool
result as `docs/phase0-dispatch-capture-2026-11-13.jsonl`. The artifact is the
evidence; the run must include one background dispatch and one foreground task.

Acceptance: a transcript that shows items 1-6, that
`metadata.sessionID` equals the child session ID observed in items 3-4 rather
than the parent's, and that a foreground result and a dispatch differ by a
signal only the dispatch has. If no such signal exists, phase 1 does not ship;
that is a stop condition, not a variant choice.

If `experimental.idle` never fires for a child, phase 2 needs a success
fallback before coding; that absence is a stop condition, not a slow path.

If the live host is 2.2.1, the defect is latent (background only). Phases 1-2
remain valid but lower priority.

Phase 0 result (2026-11-13, host 2.3.0):

- Host: 2.3.0 (`opencode-cli serve`, crashpad annotation `_version=2.3.0`).
- 524 `subagent` tool parts in the live DB: 426 `completed` with
  `metadata.sessionID`, 51 `running` with `metadata.sessionID` and part state
  `error` (cancelled before completion), 47 `error` with `metadata:null`.
- Raw metadata shape:
  `{"sessionID":"ses_...","status":"completed","truncated":false}`. The
  dispatch returns `status:"completed"` immediately, so status alone cannot
  discriminate and variant A is unusable. Variant B is selected.
- Identity: child `ses_e2a4e0028ffe3GNJHxJ2zsZNBl` has parent
  `ses_e2aa52058ffet7TflZODl4FPoN`; `metadata.sessionID` names the child, not
  the parent.
- No `task` tool name appears in about 18k tool calls; `subagent` is the host
  tool and maps to `task` at `name-utils.ts:44`.
- `subagent` input keys: `agent`, `description`, `prompt`, `sessionID`,
  `model`, `background`. `background` is set on 3 calls, never `false`; every
  other call omits it and still returns immediately with a child session, so
  2.3.0 exposes no foreground `subagent` shape to regress.
- `experimental.idle`: the host database stores 798 idle messages; the child
  `ses_e2a4e0028ffe3GNJHxJ2zsZNBl` has 4, all `succeeded`. Across retained
  child sessions there are 129 idle rows: 82 `succeeded` and 47
  `interrupted`. Idle rows are stored session state, not hook invocations.
- Terminal values observed: `completed` (426), `running` (51, cancelled calls
  only), absent (47, `error` calls). `failed` is not produced by 2.3.0.

SDK contract (installed 2.3.0, `session.d.ts:148-186`):

- `SessionIdle.sessionID` is the Session that went idle. For a dispatch that is
  the child at completion, so it is the ledger key, not an owner field.
- `SessionIdleBackground.sessionID` is the owner of the background job: the
  idle Session itself or a descendant. `childSessionID` names the subagent
  child. The dispatch result's `metadata.sessionID` is the child, never the
  owner.
- The hook runs when a Session finishes model work and has no pending input. It
  does not run after interruption, failure, or control-only work, so the raw
  `session.execution.*` relay is mandatory, not a fallback. A Session's own
  background work re-runs the hook when it finishes; work a descendant owns
  wakes that descendant and is information only.
- "No foreground on 2.3.0" is empirical: 539 parts, 0 `background:false`, and
  every `completed` part carries `sessionID`. Revision 19 drops the 2.2.x
  foreground proof: the floor is now 2.3.0 and those hosts are refused.

Evidence artifact: `docs/phase0-dispatch-capture-2026-11-13.jsonl`, 13 JSONL
records reconstructed read-only from `session_message` and `session_v2` in the
live database. The original JSONL log file was not retained; the database is
the host's own durable record. Re-read on 2026-11-14: 539 parts, 492 with a
string `sessionID`; the 2026-11-13 capture counted 524, and the database has
grown with later runs. Identity check: 492 `subagent` tool parts carry
a string `sessionID`; 136 resolve directly to a child of the dispatching
session, 86 are forked-history copies of the same dispatch, 270 name child
sessions already pruned from the database, and 0 contradict the premise. The
four child idle rows and the 47 interrupted child terminals cover items 3 and
4 at the stored-state layer; the hook invocation itself is not in the artifact
because the run's JSONL log was not kept.

Selected predicate:

`isTaskDispatch = input.tool === "task" && declaredStatus !== "error" &&
declaredStatus !== "failed" && (A || typeof output.metadata?.sessionID === "string")`

with `A` = the status is present and not `completed`. `completed` does not
disable the dispatch flag: on 2.3.0 it is the dispatch's own return status, and
treating it as terminal would make the fix inert on all 426 live dispatches.
The terminal value that wins is `error`/`failed`, because those are real tool
failures and must keep the failure path. This corrects the revision-11 wording
that a terminal status wins over the dispatch flag.

### Phase 1 — Remove the false completion (D1-D6)

| File | Change |
|---|---|
| `src/v2/setup.ts:690-712` | for `task` only: preserve any present `originalMetadata.status` value, string or not. Synthesise `"completed"` when the key is absent, except under variant B when a child session is reported. Variant A never withholds the synthesis, so a foreground task stays byte-identical. Every other tool keeps today's forged shape. |
| `src/hooks/tool-execute.ts:555` | add `isTaskDispatch = input.tool === "task" && (A \|\| typeof output.metadata?.sessionID === "string")`, where variant A is `declaredStatus !== undefined && declaredStatus !== null && declaredStatus !== "completed" && declaredStatus !== "error" && declaredStatus !== "failed"`. The `task` guard wraps the whole expression: `thread.ts:175` and `task-control.ts:49-90` also return `metadata.sessionID`, and they must keep their success path. Variant B ships only if phase 0 shows a foreground task result never carries that key. |
| `src/hooks/tool-execute.ts:555-559` | precedence is fixed: a terminal failure (`error`, `failed`) wins over the dispatch flag and keeps the failure path. `completed` does not, because 2.3.0 returns it at dispatch. The `"failed"` branch is scoped to `input.tool === "task"`, so no other tool's status handling changes. |
| `src/hooks/tool-execute.ts:620` | skip `recordToolSuccess` when `isTaskDispatch`. Keep `recordToolResult` and `observeRepeat` so repeated dispatches are still detected. |
| `src/hooks/tool-execute.ts:640-644` | when `isTaskDispatch`, skip `recordToolFailure`, `resetToolResultRun` and `recordNoProgress`. Keep `refund`: the iteration budget then charges exactly as it does today for an empty dispatch (`iteration-budget.ts:151-155`). |
| `src/hooks/tool-execute.ts:659-668` | when `isTaskDispatch`, record `status: "success"`. The tool returned; the work status is not a tool failure, and `ToolRunStatus` has no third value (`tool-run-log.ts:16`). |
| `src/hooks/tool-execute.ts:668` | when `isTaskDispatch`, drop the `error` field; a success row must not carry `error: "unknown"`. |
| `src/hooks/tool-execute.ts:600-612` | when `isTaskDispatch`, do not print `FAILED`. |
| `src/hooks/tool-execute.ts:713` | no change: the watched call returns at dispatch, so its warn-only timer must clear. |
| `src/hooks/tool-execute.ts:722-751` | skip `TASK_COMPLETED` and skip the analyst nudge when `isTaskDispatch`; both belong to real completion. |
| `src/hooks/tool-execute.ts:753` | no change in either phase. `recordPipelineState` is the only caller of `recordToolResult` and admits `task` alone (`tool-execute.ts:404`), so skipping it freezes every phase. The bogus fix record and the advance stay open as D5. |

No change to the success computation at `550-554` beyond the `"failed"`
branch above. No change after line 811.

Keep unchanged: lock release and depth decrement at `519-542`, heartbeat at
`605-611`, output scan, privacy and cap at `720-809`, `TASK_STARTED` at 341.

Acceptance:

- A dispatch with a present, non-terminal status, or with the child-session
  signal the selected variant uses, produces no `recordToolSuccess`, no
  `TASK_COMPLETED`, and no analyst nudge.
- A dispatch whose output is empty takes neither branch: no
  `recordToolSuccess`, no `recordToolFailure`, no `recordNoProgress`, and no
  `error` row in `toolRunLog`, and no `FAILED` console line. The budget `refund`
  is retained, so the charge is unchanged.
- Retained and declared, not completion claims: the repeat ring (`582-598`,
  `success: true`) and the `toolRunLog` row (`617-628`, tool-level success).
- The watchdog timer and the pipeline call stay unchanged, because both are
  correct for a call that returned at dispatch and both are the only working
  paths.
- A foreground task (`completed`, absent status, or no child session) stays on
  the unchanged path. Phase 0 found no foreground `subagent` on 2.3.0; a
  foreground result carrying a child `sessionID` is a dispatch by construction
  and is barred from the unchanged row.
- An error result takes the existing failure path.
- `handoff` and `fasttrack` are unchanged.

### Phase 2 — Restore true completion (D7-D10)

Design:

- A pending-dispatch ledger keyed by the child session ID from
  `metadata.sessionID`, holding the parent session, call ID, targets, agent and
  open time. Retention must outlive the child, not mirror the 10-minute
  snapshot TTL (`background-tasks.ts:25`).
- The finalizer extends `noteExperimentalIdle` (`setup.ts:56-70`), the single
  idle handler the existing proofs pin; a second `experimental.idle`
  registration fails `prove-host-goal.ts:310-313`.
- The terminal event carries the parent `input.sessionID`, matching
  `TASK_STARTED` (`tool-execute.ts:342`) and `TASK_COMPLETED` (`:722`).
- Primary terminal signal: `experimental.idle` for the child session.
- Ownership is decided by `SessionIdleBackground.sessionID`, not by an empty
  list: when the child's `experimental.idle` arrives with no entry naming the
  child as owner, the child is idle and its dispatch is complete. Work the child
  owns defers the terminal, because the hook re-runs when that work finishes;
  work a descendant owns (`sessionID` = descendant, `childSessionID` = child)
  is information only and does not block it. The parent's snapshot
  (`setup.ts:58`) is not a completion source.
- Two races are handled explicitly: a child idle that arrives before the
  after-hook writes the entry is buffered for 60 s and finalized when the entry
  appears, or dropped with a warning after that; a revived child reuses its
  session ID (`setup.ts:753`), so a dispatch onto a non-terminal entry warns and
  reuses that entry. The child still emits one terminal in total; no new
  terminal status is invented.
- A call may dispatch several children; `tool-execute.ts:552-553` detects only
  parallel input. Phase 0 records what the result actually exposes, and the
  ledger stores every child ID it carries.
- Failure and interruption must be read from the raw `session.execution.failed`
  and `session.execution.interrupted` events. Do not read them through the v1
  adapter: a failed event without an error collapses to `session.idle`
  (`event-adapter.ts:163`), an interruption collapses the same way
  (`:165-166`), and `succeeded` also maps to idle (`:153-154`).
- Finalization is idempotent per child session and call ID. It emits exactly one
  terminal event. It does not touch the watchdog: the timer is keyed
  `parent:agent` and already cleared when the call returned.
- The pipeline advance does not move here. Moving it freezes every phase when a
  child never idles, and no fallback can replay it; see D5.
- The analyst nudge has no delivery channel at finalization: the tool result
  has already returned and prompts are forbidden. It stays dropped until a
  sink is named; do not invent one.
- If a child idles at least once but its terminal signal never arrives, warn
  once per child and leave the entry pending. Never fabricate a completion.
- If `experimental.idle` never fires for any child on the live host, phase 0
  stops phase 2; a pending-only ledger is not a completion path.
- `session.execution.interrupted` with `reason: "shutdown"` is an interruption,
  not an abandonment, but only if it reaches the plugin before the relay is
  disposed (`setup.ts:831-834`); after disposal, shutdown abandons.

| File | Change |
|---|---|
| `src/hooks/tool-execute.ts:550` | write the ledger entry from the after-hook, where the v1 context exists. |
| `src/services/dispatch-ledger.ts` (new) | the ledger and the early-idle buffer: a bounded map keyed by child session, cap 200 shared by ledger and buffer (`background-tasks.ts:26`), eviction oldest-finalized first. At the cap with every entry pending, a new entry is refused with a warning; pending entries are never silently dropped. Each entry emits exactly one terminal. |
| `src/v2/setup.ts:55-60` | extend `noteExperimentalIdle`: keep the `sessionID` guard, turn the `background` check into a conditional around `recordBackgroundSnapshot` (the pinned literal stays), then call the finalizer after `void noteIdle()`, wrapped so `prove-run-interrupt.ts:547-553` still passes. |
| `src/v2/setup.ts:794-802` | subscribe the raw `session.execution.failed` and `session.execution.interrupted` events for the negative paths. |

The pipeline advance stays at dispatch. Phase 2 does not move it: moving it
freezes every phase when a child never idles, and the fallback cannot replay
the advance. D5 therefore remains open with that reason recorded, and phase 2
adds only the terminal event.

The finalizer must not call `getContext()`: it throws outside
`runWithContext` (`context-store.ts:10-18`). Capture `pipelineManager`,
`regressionGuard`, `featureIndex`, `asyncStageQueue`, `serviceClients` and the
parent session at dispatch time. If the fix record and quality gates cannot be
reproduced from the captured context, drop them at finalization and emit the
terminal event alone.

One reading only: the child's own idle terminates the child. The parent's list
may still name it at that moment, and that is not a blocker.

That restructure means `noteIdle()` also runs when a payload has no
`background` array; today it returns first (`setup.ts:56-59`). The behaviour
change is deliberate and bounded to malformed snapshots.

The relay is disposed at teardown (`setup.ts:831-834`), so a shutdown
interruption cannot be observed by a finalizer that lives on the relay. If
shutdown must finalize, it needs an explicit teardown hook; otherwise state
that shutdown abandons.

Docs land in the same change: the `experimental.idle` capability fact in
`registry.json:19`, `UPSTREAM.md:172` and `ISSUES.md:3046`. Version entries in
`registry.json` stay in phase 3.

Acceptance:

- Normal child: one completion. The pipeline advance stays at dispatch; the
  watchdog is cleared when the call returns and is not re-keyed.
- Failed child: one failure, no completion.
- Interrupted child: one interrupted terminal, no completion.
- Duplicate idle: exactly one event.
- A child idle that beats the ledger write is buffered and finalized once.
- A multi-child call records every child ID the result exposes; a revived child
  onto a non-terminal entry warns and reuses the entry, so the child emits one
  terminal.
- Restart with a pending dispatch: the ledger is in-memory, so the dispatch is
  not replayed and no completion is fabricated.
- No prompt is ever issued from the idle handler; host continuation ownership
  is unchanged.

### Phase 3 — Release surface (D11-D13)

- Add 2.2.2 through 2.2.5 (currently missing) and 2.2.6, 2.2.7 and 2.3.0
  entries only after those releases are actually assessed. `auditedThrough` is
  the newest assessed release (`UPSTREAM.md:69-71`); moving it without an audit
  claims work not done, and `check-sdk-pins.ts:99-106` forbids recording a
  newest entry without moving it. If no audit happens, keep the registry at
  2.2.1 and record the gap.
- Fix `UPSTREAM.md:61-64`: it claims the accepted range is
  `>= 2.2.0 < 3.0.0` and that 3.x is refused, while `host-floor.ts:26-29`
  refuses only below the floor.
- Move `HOST_AUDITED` and the three audited strings (`release-smoke.sh`,
  `opencode-v2-iso.sh`, `doctor-v2.sh`) plus the lockfile only when the ceiling
  has actually been audited (`check-sdk-pins.ts:68,122-141`).
- Document the live `check:upstream` step and decide whether it becomes a
  non-blocking CI warning. Do not make a live network call a blocking gate.
- Do not add an upper host gate that refuses 2.3.0. Record the audit gap
  instead.

Acceptance: `check:upstream --offline` reflects the new entries; the manual
audit step is documented; host loading behaviour is unchanged.

Phase 3 result (2026-11-13):

- The registry holds nine releases (2.2.1 through 2.3.0), `auditedThrough` is
  `2.3.0`, and the live and offline upstream checks agree.
- `D16` is fixed: `UPSTREAM.md` now states the floor-only policy, the audited
  ceiling, and the no-upper-gate behaviour.
- `HOST_AUDITED`, the smoke, the launcher, the doctor and `prove-host-floor`
  moved to `2.3.0`; revision 19 then raised `HOST_FLOOR` to `2.3.0` too, so
  floor and ceiling are equal and 2.2.x hosts are refused.
- The live `check:upstream` step is documented as a manual routine step outside
  `ci`, so it never becomes a blocking gate.
- No upper host gate was added: 2.3.0 loads, and a newer major runs untested
  behind the capability probe.

### Phase 4 — Cancellation (D17, separate order)

Thread `ctx.abort` into the long-running loops of `astquery`
(`src/tools/ast-tools.ts`), `projectmap` (`src/tools/project-map.ts`),
`depmap` (`src/tools/dependency-map.ts`) and `handoff` (`src/tools/handoff.ts`).
`web` and `imagegen` already pass it.

Acceptance: a cancelled call stops within a bounded number of iterations and
leaves no partial state.

This phase fixes a different feature and must not be bundled into phase 1 or 2
without an explicit order.

Phase 4 result (2026-11-13):

- `projectmap` checks the signal at the `buildTree` entry for every directory
  and once after the traversal, before `recordTree`; a cancelled walk discards
  its partial stamps.
- `depmap` checks at the collection entry, per directory entry, per file in
  the import graph, and before `recordImports` / `recordImportBatch`. The
  batch path throws an internal sentinel so a cancelled graph is never stored
  in `readCache`, and the post-cache guard covers a signal that fires during a
  cache hit.
- `astquery` and `readsymbol` check at the entry and immediately before each
  `recordIndexFile`, so a cancellation during the AST call does not write the
  index.
- `handoff` checks at the entry and once before `ctx.handoffs.set`, the commit
  point of the create path. The later `await` calls (`attachPackToHandoff`,
  the queue drain and the alternate-agent validation) run after the entry is
  already committed, so a cancellation there cannot remove it without a
  rollback; the call completes instead of leaving a half-removed record. A
  cancelled create can still advance the persisted `hoffSeq` counter, because
  the entry id is allocated before the validator, and validation warnings can
  still increment the agent error counters; that leaves an id gap and a
  counter change, not a handoff record.
- A cancelled call returns
  `{ title: "Cancelled", output: "Cancelled", metadata: { status: "cancelled" } }`
  instead of throwing. The host failure path is untouched, so user
  cancellation never consumes the loop guard's three-strike budget. The v1
  after-bridge normalizes a non-task `status` to `completed`, so the host
  records a normal success while the output text reports the cancellation.
  The repeat-result detector still sees that success: four recorded identical
  results with the same arguments block the next call. That is the repeat
  budget, not the failure budget, and it only fires on identical arguments.
- `prove-tool-cancel` covers the pre-aborted path (no tree, import, file or
  handoff write and no state save), a compute that aborts inside
  `readCache.getOrCompute` (no cache entry and no batch), a cache hit that
  aborts during `getOrCompute` (the post-cache guard returns before the
  batch), and a handoff that aborts inside the agent validator (no entry, no
  save). It also keeps the live path for all four tools, including one handoff
  entry and one save. The proof has 33 assertions and does not claim a
  deterministic mid-traversal injection point; the per-directory
  (`projectmap`) and per-file (`depmap`) checks are the bounded stops.
- The proof stage moved from 182 to 183 steps; shard 2 takes the new step and
  the recorded total moves to `406141ms`.

### Phase 5 — Smoke margin (D15)

Measure `opencode run` on 2.3.0 with a prompt that dispatches a background
task. Raise the 60 s cap or reduce the prompt only if the measurement shows a
real margin problem.

Acceptance: `release-smoke.sh` passes with at least a 2x margin.

---

## 4. Non-regression contract

| Path | Required behaviour |
|---|---|
| 2.3.0 foreground task | `completed` or absent status -> unchanged path |
| Error result | unchanged failure path |
| `handoff` / `fasttrack` | unchanged |
| lock release and call depth | unchanged, before the flag |
| heartbeat | unchanged |
| loop guard | repeat detection retained for a normal dispatch; an empty dispatch records neither success nor failure, so it is not counted as a repeat |
| iteration budget | `refund` retained for an empty dispatch, so the charge matches today (`tool-execute.ts:645` -> `iteration-budget.ts:151-155`) |
| pipeline | unchanged; `recordPipelineState` is the only caller of `recordToolResult` and gates on `task` (`tool-execute.ts:404`), so the advance stays at dispatch in both phases and D5 remains open |
| task-control | unchanged; it reads only the host background snapshot, and the dispatch ledger is a separate store |
| mission board, handoff ledger, goal ledger | untouched |
| host continuation | no prompts from idle; ownership unchanged |

Pipeline wiring check: `TOOLS_PER_PHASE` lists `task` in all four phases
alongside `read`, `grep`, `edit`, `write` and `bash`
(`PipelineStateManager.ts:62-67`), but `recordToolResult` has exactly one
caller, `recordPipelineState`, which returns unless the tool is `task`
(`tool-execute.ts:404`). Only the `task` weight (0.35) can ever apply; the
non-task entries are unreachable. The fix record additionally needs an active
pipeline (`PipelineStateManager.ts:232-234`). Skipping line 753 for a dispatch
therefore freezes every phase, which is why neither phase touches it.

---

## 5. Verification

Commands, in order:

1. `npm run check:rules`
2. `npm run typecheck`
3. `npm run verify`
4. `npm run gate:proofs:1`, `:2`, `:3`, `:4`
5. `npm run prove:independence`
6. `npm run gate:smoke` (phase 5 only)

Existing proofs that must keep passing:

- `scripts/prove-e14.ts:126-135`: the status-to-success contract.
- `scripts/prove-v2-compat.ts:104-113`: synthetic status stripping.
- `scripts/prove-s053.ts:267-289`: the 7-minute parity item.
- `prove-host-goal.ts:309` and `prove-task-control.ts:307-318`:
  idle registration.
- `scripts/prove-run-interrupt.ts:547-553`: interrupted detection still runs
  from `experimental.idle`, including a second call inside 60 s.

New proof files must also be registered: `scripts/prove-proof-catalog.ts:70,256`
(`PINNED_PROOF_FILES` sorted, `PINNED_PROOF_STEPS`), `scripts/proof-shards.json`
(every manifest step exactly once, estimates sum to `totalEstimateMs`, and the
largest shard no more than 1.1x the mean, `prove-proof-catalog.ts:313-319`), and
the generated markers refreshed by `scripts/generate-proof-count.ts` (`AGENTS.md`,
`README.md`, `TRIAGE.md:36,136`, `docs/validation.md`), checked by
`scripts/release/check-release.ts:62-79,109-112`.

After adding a proof, run `bun scripts/generate-proof-count.ts` and commit the
refreshed markers; `gate:fast`'s release step fails on stale counts
(`gate-manifest.json:101-107`).

New proofs:

- `prove-task-dispatch.ts`: a dispatch with a present, non-terminal status
  produces no `recordToolSuccess`, no `recordToolFailure`, no `TASK_COMPLETED`
  and no nudge; the retained repeat-ring and run-log rows are asserted
  unchanged.
- `prove-task-finalize.ts`: success, failure, interruption, duplicate idle and
  a revived child each produce exactly one terminal outcome; a restart produces
  none and fabricates nothing.

---

## 6. Risks and rollback

| Risk | Mitigation |
|---|---|
| host premise wrong | phase 0 blocks phases 1-2 |
| `metadata.sessionID` absent or holding the parent ID | ledger cannot be keyed; the revision-17 artifact resolves 222 dispatches with 0 contradictions, and 270 pruned children remain unverifiable |
| idle not emitted after failure | `session.execution.failed` fallback |
| descendant background items | the child's own idle is terminal; live descendants are not waited for |
| duplicate idle | idempotency key per child and call |
| shutdown loses the ledger | the relay is disposed at teardown (`setup.ts:831-834`), so shutdown abandons pending entries and nothing is fabricated; an explicit teardown hook is required only if shutdown must finalize |
| pipeline freeze | neither phase touches `tool-execute.ts:753`; the advance stays at dispatch because a missing terminal signal cannot replay it |
| `TASK_STARTED` dangling after phase 1 | accepted interim until phase 2; shipping phase 1 alone also silences every completion sink, so phases 1 and 2 ship together or the silence is recorded as accepted |

Each phase is independently revertible: phase 1 reverts the status bridge and
the after-hook gates (dispatch flag, success, failure, run log, console,
`TASK_COMPLETED`, nudge); phase 2 removes the ledger and finalizer; phase 3
reverts the registry and CI entries.

---

## 7. Not defects (scope guard)

- `ImageResponse.image` removal: `@opencode/ai` is imported nowhere.
- `Tool.Error` and `session.fork`: non-adoption is the recorded policy.
- `HOST_FLOOR` as a minimum (now `2.3.0`): intentional; there is still no upper
  gate.
- The 7-minute watchdog: log-only by design.
- `task-control` stale and missing snapshots: already fail closed.

---

## 8. Open decisions

1. Resolved: phases 1 and 2 ship together (revision 13), because phase 1
   alone silences every completion sink.
2. Resolved: the ledger is in-memory only; persistence is deferred and needs a
   separate owner order. Accepted residual: a host restart drops pending
   entries, so that dispatch emits no terminal and the dispatcher's `task`
   counter is not cleared by it; nothing is fabricated.
3. Resolved: `toolRunLog` keeps `success` as tool-level truth
   (`tool-run-log.ts:16`), and a dispatch row drops `error`.
4. Resolved (owner): accepted open, no code change. The bogus fix record and
   the dispatch-time advance stay as D5; the exit path is to move only the fix
   record and the quality gates to finalization and leave the advance at
   dispatch.
5. Resolved: the owner ordered phase 4, and it shipped in revision 16 without
   touching the dispatch path. Phase 5 stays deferred until the owner orders
   it.
6. Resolved: the SDK bump and `HOST_AUDITED` move shipped together on
   2026-11-13 after the 2.2.2–2.3.0 audit (revision 14).
7. Review findings (revision-17 review of revision 16): four defects outside the
   phase scope. (a) Fixed in revision 21: a dispatch with no parsed target
   suppressed completion but registered no ledger entry
   (`tool-execute.ts:568` required `taskTargets.size > 0`). The entry is now
   registered whenever the host returned a child session ID, with an empty
   target list; the terminal clears the dispatching agent's counters, and no
   completion event is emitted because there is no parsed agent to name.
   `prove-task-dispatch` asserts the registration, the pending counter, the
   silent return, and the counter clearing. (b) Accepted in revision 21 by a
   3/5 panel vote: pending entries are never reaped, and at 200 simultaneously
   pending children the ledger refuses a new dispatch with a warning
   (`dispatch-ledger.ts:31-43,80-82`). The refusal is fail-closed on memory and
   invents no outcome; the bound needs 200 live children in one session, and
   the warning is the diagnostic. Reaping or evicting to admit the new entry
   would fabricate an `interrupted`/`failed` terminal for a child whose real
   terminal was never observed, which the contract forbids. (c) Fixed in
   revision 20: `recordToolSuccess` ran for failed and interrupted terminals,
   clearing the dispatcher's failure and no-progress counters. It now runs only
   when the terminal outcome is `completed` (`tool-execute.ts:579`), and
   `prove-task-dispatch` asserts that a failed terminal keeps the counters
   blocking. (d) Open: the early buffer accepts any session's idle, can evict a
   real early completion, and a stale entry can finalize a later dispatch on a
   reused child ID (`dispatch-ledger.ts:101-128,53-57`).

---

## 9. Revision log

Revision 2 (2026-11-13), after the first source-verified review:

- D3 withdrawn. The watched call returns at dispatch, so clearing its
  warn-only timer is correct (`tool-execute.ts:81-84,671-673`).
- D5 narrowed. `recordPipelineState` is the only caller of
  `recordToolResult` and admits `task` alone (`tool-execute.ts:403`), so the
  advance cannot be suppressed without freezing every phase. Line 712 is left
  untouched in both phases; the bogus fix record and the advance stay open as
  D5 until a terminal signal can replace them without stalling.
- D6 changed from "keep the nudge" to "drop the nudge at dispatch". Keeping it
  preserved the defect the register names.
- D14 withdrawn. `web` and `imagegen` already pass `ctx.abort`
  (`src/tools/web.ts:745`, `src/tools/image-gen.ts:230`).
- Added the `TASK_STARTED` checkpoint snapshot to the false-write table
  (`tool-execute.ts:341` -> `service-factory.ts:652-673`).
- Phase 2 fallback corrected. Reading failure through the v1 adapter is wrong:
  a failed event with an error becomes `session.error`
  (`event-adapter.ts:158-163`), while an error-less failure, an interruption and
  a success all become `session.idle` (`:163-166`, `:153-154`); the finalizer
  must consume the raw event type.
- Phase 2 acceptance corrected: `session.execution.interrupted` with
  `reason: "shutdown"` is an interruption, and an in-memory ledger cannot warn
  about a dispatch that predates a restart.

Revision 3 (2026-11-13), after the second source-verified review:

- The nudge contradiction resolved in one direction: dropped at dispatch,
  dropped at finalization unless a delivery sink is named.
- The predicate is total: a present non-string status counts as a dispatch,
  and the failure branch (`tool-execute.ts:599-604`) is gated too, so an empty
  dispatch cannot be recorded as a failure.
- "Zero false writes" narrowed to "no false completion or failure write"; the
  retained repeat ring and `toolRunLog` success are declared.
- Phase 0 now requires identity (`metadata.sessionID` equals the child ID) and
  a stop condition when `experimental.idle` never fires for a child.
- Phase 2 pins the finalizer to `noteExperimentalIdle`, gives the ledger a
  retention that outlives the child, and fixes the terminal `taskId` to the
  parent session.
- Phase 3 bundles the registry entries with the pin and `auditedThrough` move;
  landing them apart breaks `check-sdk-pins.ts:99-106` under `gate:fast`.
- D13 has one classification (recorded gap, info), D15 is UNPROVEN until a
  smoke log exists, and phase 4 drops `imagegen` and names the four real files.

Revision 4 (2026-11-13), after the third source-verified review:

- The flag no longer depends on `status` alone: a child session with no status
  is a dispatch, which is the only shape phase 0 can prove. `"failed"` is
  terminal, matching `prove-e14.ts:126-135`.
- `setup.ts` synthesises `"completed"` only when the key is absent and no child
  session is reported.
- `toolRunLog` and the console line are gated: an empty dispatch no longer
  persists `status: "error"` or prints `FAILED`.
- The ownership predicate now compares `item.childSessionID`, the field that
  names the child (`background-tasks.ts:3-9`). Superseded in revision 9: the
  child's own idle is terminal, so no ownership predicate remains.
- Phase 2 drops the "one watchdog clear per child" promise; the timer is keyed
  `parent:agent` and already cleared on return.
- Phase 3 includes 2.2.2-2.2.5 and the audited strings plus the lockfile.

Revision 5 (2026-11-13), after the fourth source-verified review:

- Phase 1 no longer hard-codes a discriminator: phase 0 selects variant A
  (status-only) or variant B (status or child session), and variant B is
  barred unless phase 0 shows a foreground result never carries that key.
- A host `"failed"` status takes the failure path instead of the string
  heuristic, which could record a failed task as success.
- Phase 2 gained a file table, the anchor-context rule
  (`context-store.ts:15-24`), a single trigger/ownership reading, and the
  teardown limit on the shutdown rule.
- Phase 3 requires a real audit before `auditedThrough` moves; otherwise the
  registry stays at 2.2.1.
- D16 registers the `UPSTREAM.md` range contradiction; D17 registers the four
  tools that never read `ctx.abort`.

Revision 6 (2026-11-13), after the fifth source-verified review:

- The `setup.ts` status preservation is scoped to `task`; no other tool's
  after-hook changes.
- Precedence is fixed: terminal status wins over the dispatch flag, so a
  `"failed"` dispatch takes the failure path.
- Phase 2 no longer moves the pipeline advance. Moving it stalls every phase
  when no terminal signal arrives; D5 stays open with that reason.
- The finalizer's captured context is enumerated, with an explicit fallback to
  drop the fix record and quality gates.
- Phase 0 adds a foreground capture and makes "no distinguishing signal" a stop
  condition rather than a variant choice.
- Phase 1 alone is recorded as completion silence; the review consensus is to
  ship phases 1 and 2 together.

Revision 7 (2026-11-13), consistency pass before delivery:

- Variant A now requires a present status; without it, only variant B can see a
  dispatch, and phase 0 decides.
- Phase 1 acceptance names the selected signal rather than assuming a status.
- Phase 3 moves `HOST_AUDITED` only after a real audit, not with the pin.
- D7 is marked consequential only if phase 1 ships alone.
- The revision log's adapter description was corrected to match
  `event-adapter.ts:153-166`, and section numbering is monotonic.

Revision 8 (2026-11-13), pre-evaluation pass:

- Phase 0 names its capture artifact and the debug environment
  (`TAWASSUL_DEBUG`, `TAWASSUL_LOG_JSON`, `TAWASSUL_LOG_FILE`).
- The no-signal rule is split: a child that idles but never terminates triggers
  one warning and stays pending; a host where children never idle at all stops
  phase 2.
- Phase 2 documents the idle capability fact only; registry version entries stay
  in phase 3.
- The finalize proof no longer claims a restart produces a terminal outcome.
- `toolRunLog` is resolved to tool-level `success`; the open decision is closed.
- D12 cites the full pin contract, and phase 1's foreground guarantee is
  qualified by the phase 0 variant.
- The shutdown rule is bounded by teardown disposal: before disposal it is an
  interruption, after disposal it abandons.

Revision 9 (2026-11-13), after the sixth source-verified review:

- Phase 0 gains a temporary metadata trace and two capture items; nothing in the
  tree logs result metadata today.
- Variant B is stated as an OR, not a narrower AND.
- The `"failed"` branch is scoped to `task`, and `refund` is retained so the
  iteration budget charges exactly as today.
- Phase 2 drops the ownership predicate: the child's own idle is terminal. The
  early-idle race, multi-child calls and revived IDs are handled explicitly.
- The finalizer survives a payload without a `background` array, with the one
  deliberate behaviour change stated.
- The §4 pipeline sentence is corrected: `task` is in every phase list; only the
  non-task entries are unreachable.
- New proofs must be registered in the catalog, shards and generated markers,
  and `prove-run-interrupt` joins the must-pass list.

Revision 10 (2026-11-13), after the confirmation round:

- The predicate's `task` guard now wraps the whole expression, so `thread` and
  `task-control` cannot lose their success path through `metadata.sessionID`
  (`thread.ts:175`, `task-control.ts:49-90`).
- The setup synthesis gate is variant-scoped; variant A keeps every foreground
  task byte-identical, and phase 0 accepts items 1-6.
- Phase 2 names its store: a new `src/services/dispatch-ledger.ts`, bounded at
  200, with a defined supersede that still emits one terminal per entry.
  Supersede is dropped in revision 11; `TASK_COMPLETED` has no status carrier.
- The multi-child claim now says what the result exposes, not what an input
  test implies.
- Proof registration adds the 1.1x shard-mean rule and the generator run.

Revision 11 (2026-11-13), after the final verdict:

- Supersede is dropped rather than given a new terminal carrier:
  `TASK_COMPLETED` has no status field (`event-hub.ts:35`), so a revived child
  reuses its pending entry and still emits one terminal.
- The all-pending cap rule is stated: at 200 pending entries a new entry is
  refused with a warning, and nothing pending is silently dropped.

Revision 12 (2026-11-13), closing the SAFE verdict:

- The early-idle buffer shares the ledger's 200 cap, so it is bounded in count
  as well as in time.
- Status line records the review outcome; phase 0 remains the blocking step.

Revision 13 (2026-11-13), after phase 0 and the phase 1-2 implementation:

- Phase 0 ran on host 2.3.0 and selected variant B, corrected so `completed`
  does not disable the dispatch flag and only `error`/`failed` do. The result
  block sits in section 3.
- The ledger is `src/services/dispatch-ledger.ts`: 200 shared entries, a 60 s
  early-terminal buffer, a 10 min finalized retention, idempotent finalize, and
  a revived child that reuses its pending entry.
- Finalization emits `TASK_COMPLETED` on success and `AGENT_FAILED` only on a
  real failure; interruption finalizes silently, because `AGENT_FAILED` drives
  the circuit breaker, health tracker, handoff-failed ledger and self-heal
  (`event-integrations.ts:97-134`) and a user cancel must not trigger them.
- `recordToolSuccess` moves to finalization instead of being dropped: without
  it the `task` failure counter never clears, since 2.3.0 has no foreground
  `task` path to clear it. It is keyed to the dispatching agent captured at
  the tool call, not to a target, because the loop guard counts the caller.
  `prove-task-dispatch` pins both sides: the dispatcher clears and the target
  stays untouched.
- `refund` stays at dispatch. Phase 1 withholds only `recordToolSuccess`,
  `recordToolFailure`, `resetToolResultRun`, `recordNoProgress`, the
  `toolRunLog` error row, the `FAILED` console suffix, `TASK_COMPLETED` and the
  analyst nudge.
- `prove-task-dispatch` (20 assertions) and `prove-task-finalize`
  (24 assertions) are registered in `gate-manifest.json`, `proof-shards.json`
  and the pinned catalog; the proofs stage is 182 steps and the tree holds 185
  proof files.
- Shared-parity anchors were refreshed for the three lines the edits moved.

Revision 14 (2026-11-13), phase 3 after the owner ordered the SDK bump:

- `@opencode/plugin` moves from `2.2.1` to `2.3.0` in the root and in
  `.opencode`, with both lockfiles and `.opencode/bun.lock` refreshed. The
  Promise type surface is additive (an `artifact` domain,
  `integration.submit`, `SessionRequestMessage`, `SessionModelResolve`,
  `session.fork`, and `ToolContext.signal` replacing `cancel`), and
  `npm run typecheck` passes on 2.3.0.
- Releases 2.2.2–2.3.0 are assessed from the GitHub feed: the registry now
  holds nine releases with `auditedThrough: "2.3.0"`, 2.2.3–2.2.5 reuse
  `docs/UPSTREAM-EVAL-2.2.3-2.2.5.md`, and 2.3.0 carries `#63382` and
  `#63675` as `adopted`.
- The audit adds four entries: `E-57` (background subagents and the
  still-running idle), `E-58` (2.2.7 endpoints skip the plugin wait),
  `E-59` (2.2.6 `opencode run` waits for background jobs, which keeps `D15`
  open), and `E-60` (2.2.5 percentage compaction buffer). The two 2.2.4
  adoptions take `E-61`, the dated record of the catalog and limit fix that
  the registry validator requires for an `adopted` verdict.
- `HOST_AUDITED`, the smoke, the launcher, the doctor, and
  `prove-host-floor` all move to `2.3.0` together. `HOST_FLOOR` stays at
  `2.2.1`: the audit raises the ceiling, not the floor.
- `D16` is fixed. `UPSTREAM.md` now states what the code does: the accepted
  range has no upper gate, a host above the audited `2.3.0` warns, a newer
  major runs in untested mode, and only a host below `2.2.1` is refused.
- `#63675` corrects phase 2: a child idle whose own background work is still
  running is not terminal. `finalizeDispatchOnIdle` takes the idle's
  `background` array and skips the turn while any item names the child; the
  next idle finalizes. The guard also covers the early-idle buffer, so a
  non-terminal idle is never buffered as a completion.
  `prove-task-finalize` grows to 29 assertions.
- Docs aligned: `README.md`, `docs/faq.md`, `docs/dependencies.md`,
  `docs/compatibility.md`, `UPSTREAM.md` (header, policy, ledger, a
  v2.2.2–v2.3.0 section, and the v2.3.0 follow-ups), and the three
  `experimental.idle` descriptions now name the dispatch finalizer.

Revision 15 (2026-11-13), status refresh after the installed host moved to
2.3.0:

- The status line records phases 0-3 complete, phases 4-5 open, and `D5`
  accepted open; it no longer says phases 1-2 are in progress.
- Section 1.3 is dated: the 2.2.1 pin and `HOST_AUDITED` are the review-time
  state, and revision 14 moved both to 2.3.0.
- Phase 3 gains a result block, matching the Phase 0 result.
- Section 8 item 5 records the deferral of phases 4 and 5, and section 10
  records the exit-criteria status.
- The host-version sweep refreshed every live claim that still named 2.2.1 or
  2.2.2: the `UPSTREAM.md` follow-ups, the `docs/RELEASE-0.1.0-PLAN.md`
  authoring-package rows, and the `TRIAGE.md` gate descriptions. Dated records
  keep their numbers.

Revision 16 (2026-11-13), phase 4 implementation:

- The owner ordered phase 4 after an overlap and interdependence review. The
  three completed evaluations chose option A (one guard before the `handoff`
  state write) and a normal cancelled result instead of a thrown error.
- `projectmap`, `depmap`, `astquery`, `readsymbol` and `handoff` now read
  `ctx.abort`. The guards precede `recordTree`, `recordImports`,
  `recordImportBatch`, `recordIndexFile` and `ctx.handoffs.set`; `handoff`
  keeps a single pre-write guard because that set commits the entry and the
  later awaits only enrich and persist it. `depmap` uses an internal sentinel
  so a cancelled graph is never cached and the post-cache guard covers a cache
  hit.
- `prove-tool-cancel` proves the pre-aborted path, the cancelled compute and
  cache-hit paths, the handoff validator abort and the live path with 33
  assertions. The proof stage is 183 steps and the shard estimate total is
  `406141ms`.

Revision 17 (2026-11-14), Phase 0 evidence and review closure:

- Phase 0 was executed on 2026-11-13; the named JSONL log file was not
  retained. The evidence is reconstructed read-only from the host database as
  `docs/phase0-dispatch-capture-2026-11-13.jsonl` (13 records).
- Identity: 492 `subagent` tool parts carry a string `sessionID`; 136 resolve
  directly to a child of the dispatching session, 86 are forked-history copies
  of the same dispatch, 270 name child sessions already pruned, and 0
  contradictions. The child `ses_e2a4e0028ffe3GNJHxJ2zsZNBl` has parent
  `ses_e2aa52058ffet7TflZODl4FPoN` and four `succeeded` idle rows.
- Child terminals: 129 retained child idle rows, 82 `succeeded` and 47
  `interrupted`. No `failed` child row survives; the raw hook invocation is not
  in the artifact because the run's log was not kept.
- Decisions 1, 2 and 4 of section 8 are marked resolved; item 7 of section 8
  records the four open code findings from the four-agent review; (a) and (b)
  touch the one-terminal contract.
- Stale line anchors in sections 1.1, 1.2, 2, 3, 4, 5 and 6 were refreshed
  against the revision-17 working tree. Anchors inside this revision log are
  historical and intentionally unchanged.
- Host note: the installed 2.3.0 host already uses `opencode-pty 0.5.2`
  (protocol 8), the process-daemon release published as `@opencode/pty@0.5.2`.
  It is a host-side PTY dependency, not a plugin dependency; the future D15
  measurement must record the pty version alongside the host version.

Revision 18 (2026-11-14), SDK contract correction:

- The field roles are stated once, from `session.d.ts:148-186`:
  `SessionIdle.sessionID` is the Session that went idle (the ledger key),
  `SessionIdleBackground.sessionID` is the job owner, and `childSessionID`
  names the subagent. The dispatch `metadata.sessionID` is the child, not the
  owner.
- The contract makes the raw relay mandatory: idle does not run after failure,
  interruption, or control-only work.
- Revision 4's note that the ownership predicate compares `item.childSessionID`
  and revision 9's statement that no predicate remains are both corrected. The
  shipped predicate (`dispatch-ledger.ts:139-141`) is required and compares
  `SessionIdleBackground.sessionID`: own work defers the terminal because the
  hook re-runs when it finishes, and descendant work is information only.
- "No foreground on 2.3.0" is recorded as empirical (539 parts, 0
  `background:false`); the 2.2.x floor remains unproven.
- Section 8 item 7(d) also records the stale-entry path: a buffered idle for a
  reused child ID can finalize a later dispatch.
- Documentation only; no source file changed.

Revision 19 (2026-11-15), host floor raised by owner order:

- The owner retired the 2.2.x line: "the minimum is 2.3.0". `HOST_FLOOR`
  becomes `2.3.0`, so floor and ceiling are equal and every 2.2.x host is
  refused at init, by the installer, by the launcher and by the release smoke,
  and the doctor warns about it.
- Code and proofs aligned in the same change: `host-floor.ts`,
  `release-smoke.sh`, `opencode-v2-iso.sh`, `doctor-v2.sh`,
  `prove-host-floor`, `prove-boot-gate`, `prove-global-install`,
  `prove-partial-install`, `prove-global-boot`, `check-ast-bundle`,
  `prove-e27` (the release-smoke stub version), and the five proofs that pinned
  `app.version` at 2.2.2 now pin 2.3.0. `prove-host-floor`
  keeps the 2.2.x parse/compare assertions, because parsing is version
  independent, but its accept/refuse boundary is 2.3.0.
- Documentation aligned: `UPSTREAM.md` (policy list, floor and pin wording),
  `README.md`, `docs/compatibility.md`, `docs/environment.md`,
  `docs/installation.md`, `docs/faq.md`, `NOTICE.md`,
  `docs/release-notes-0.1.0.md`, this plan's scope line, section 1.3,
  Phase 3 result, non-regression table and exit criteria, and the
  `plan-agent-visibility` remaining ledger.
- Verification on 2026-11-15: `npm run verify` passed (fast stage, 16 steps,
  27.3 s, then the build), `prove-host-floor` passed with 28 assertions,
  `prove-boot-gate`, `prove-v2-compat`, `prove-partial-install` (26 assertions)
  and `prove-global-install` all passed. The full proof stage was not re-run:
  no proof file changed behaviour, and the last full run (183/183) still
  covers the dispatch paths.
- The 2.2.x foreground-shape proof is withdrawn, not deferred: the host cannot
  load the plugin, so the measurement has no subject. `D13` keeps its recorded
  status (a floor is not an upper gate); 2.3.0 still loads without a warning.
- Dated records are untouched: revision-log entries, the release ledger rows
  for 2.2.x audits, `docs/experiments/receipts/`,
  `docs/RELEASE-0.1.0-PLAN.md`, `docs/FUTURE-WORK-PLAN.md` (already stale on
  its own: it names the installed host as 2.2.5), and
  `THIRD-PARTY-NOTICES.md` (its 2.2.1 is the `env-paths` package version,
  unrelated to the host).
- No source behaviour other than the floor value changed.

Revision 20 (2026-11-15), the agreed fix package:

- Review finding 7(c) fixed: the dispatch terminal relay records tool success
  only for a `completed` outcome (`tool-execute.ts:579`). A failed or
  interrupted terminal keeps the dispatcher's failure and no-progress counters,
  so the loop guard stops a caller that keeps dispatching into failures.
  `prove-task-dispatch` gains a failed-terminal case that seeds three `task`
  failures, dispatches, finalizes the child as failed, and asserts the caller
  is still blocked.
- Section 8 item 7(a), (b) and (d) stay open for the owner: (a) still requires
  at least one parsed target before a ledger entry is registered, (b) still
  fails closed at the pending cap, and (d) still buffers any session's idle.
- Agent-visibility ledger fixes shipped in the same tree: R2 (all three
  `AgentManager` warn sites share `warnRosterOnce`, a successful global read
  clears the dedupe, and the sync catch caches the last-good list), R8 (both
  end-user guides quote the live `has no model configured` label), and R10
  (the diagnostics recommendation rows no longer repeat the agent name).
- Verification on 2026-11-15: `npm run verify` passed (fast stage, 16 steps,
  28.1 s, then the build; 186 proof files, 183 proof steps), `npm run gate:proofs`
  passed 183 of 183 steps (427.4 s), and `prove-seed-agents`,
  `prove-task-dispatch` (22 assertions), `prove-task-finalize` (29 assertions)
  and `prove-usage-shadow` passed on their own. No proof file was added, so the
  step count is unchanged.
- No foreground behaviour, task-control, pipeline, loop-guard threshold or host
  continuation ownership changed.

Revision 21 (2026-11-15), findings (a) and (b) after a five-analyst vote:

- Finding 7(a) fixed. The after-hook registered a ledger entry only when the
  `task` arguments yielded at least one parsed target, so a call with no
  `subagent`/`agent` and a multi-word `desc` spawned a real child, suppressed
  the ordinary success/failure accounting, and left no entry for the child's
  idle; the idle was buffered and dropped after 60 s, and the dispatch produced
  no terminal at all. The entry is now registered whenever the host returned a
  child session ID, with an empty target list (`tool-execute.ts:568`). The
  terminal then clears the dispatching agent's failure counters exactly once,
  and the return still emits no `TASK_COMPLETED`, because there is no parsed
  agent to name. The gap is recorded as an accepted residual: the event half of
  a targetless dispatch has no subject.
- Finding 7(b) accepted, not fixed. A 3/5 panel vote chose the documented
  residual over the fallback that would return `recordDispatch`'s boolean and
  let an overflowing dispatch take the ordinary accounting path: that fallback
  records success at dispatch time for a child that is still running, which is
  the defect class 7(c) removed. Reaping or evicting a pending entry to admit
  the new one would fabricate an `interrupted`/`failed` terminal for a child
  whose real terminal was never observed. The refusal stays fail-closed on
  memory and logs a warning.
- Proofs: `prove-task-dispatch` gains five assertions inside its existing step,
  for registration, the pending count, the silent return and the counter
  clearing; 27 assertions in total. No proof file was added, so the 183-step
  count is unchanged.
- Verification on 2026-11-15: `npm run verify` passed and `npm run gate:proofs`
  passed 183 of 183 steps.
- Findings (c) and (d): (c) was fixed in revision 20; (d) remains open.


---

## 10. Exit criteria

- The dispatch produces no false completion or failure state, proven by
  `prove-task-dispatch`.
- The dispatch reaches exactly one terminal outcome once phase 2 lands,
  proven by `prove-task-finalize`.
- Foreground 2.3.0 behaviour is unchanged, proven by `prove-v2-compat`.
- `npm run verify` and the four proof shards are green.
- `registry.json`, `UPSTREAM.md` and `ISSUES.md` no longer contradict the
  code about `experimental.idle`.

Status 2026-11-14: criteria 1-5 are met. Criterion 6 was green on the
revision-16 tree; the revision-17 and revision-18 changes are documentation
only. Phase 4 adds a cancellation proof outside the dispatch contract; phase 5
stays deferred. Section 8 item 7 lists four open code findings; (a) and (b)
touch the one-terminal contract and need an owner decision before sign-off.

Status 2026-11-15 (revision 19): criterion 3 now reads "foreground 2.3.0",
because 2.2.x hosts are refused. The floor change touches `host-floor.ts` and
the host-version surface only; the dispatch code paths are untouched, so
criteria 1-2 and 5 keep their revision-16 evidence. Criterion 4 is not
re-asserted here: the last full run was revision 16 (183/183), and the
revision-19 verification covers `npm run verify` plus the host-floor,
boot-gate, v2-compat, partial-install and global-install proofs.

Status 2026-11-15 (revision 20): finding 7(c) is fixed and proven inside
`prove-task-dispatch`, so criteria 1 and 2 keep their evidence plus one
failed-terminal shape. Criterion 4 is re-asserted in full: `npm run gate:proofs`
passed 183 of 183 steps on 2026-11-15 (427.4 s), after `npm run verify` passed
the fast stage and the build.

Status 2026-11-15 (revision 21): finding 7(a) is fixed and proven in the same
step of `prove-task-dispatch`, so a targetless dispatch now emits exactly one
terminal instead of none; its completion event stays absent by design because
no agent was parsed. Finding 7(b) is accepted by a 3/5 vote and documented
above. Criterion 4 is re-asserted for this tree by `npm run verify` and
`npm run gate:proofs`; only finding 7(d) remains open, and it is not proven to
fire on a 2.3.0 foreground session.