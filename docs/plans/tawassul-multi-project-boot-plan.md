# Tawassul V2 — Multi-Project Boot Plan (revised)

Status: revised plan (evaluation-driven), no implementation yet
Date: 2026-11-23
Revision: 5
Scope: reduce per-generation boot cost for local per-project installs
Target: Tawassul V2, this tree, OpenCode host >= 2.2.0

Revision 5 keeps the diagnosis of revision 4 and replaces every remaining open
decision with a binding choice. Section 6 is the decision record. Section 8 is the
traceability ledger: each finding, its source, and where it is resolved.

Revision 5 changes three remedies:

- Phase 2 is narrowed to the durability fix (persist dropped-handoff counters). The
  skip guard is withdrawn: the two observed save pairs are not proven redundant, and
  skipping the final write would trade durability for an unmeasured boot gain.
- Phase 3 keeps the release deferred but drops the phase accessor, the per-step bound,
  and the 150 ms runtime race. The 150 ms value becomes a proof assertion only.
- Phases 4 and 6 default to **drop** and carry numeric gates instead of open questions.

## 0. Owner constraints (binding)

| ID | Constraint | Source |
| --- | --- | --- |
| C1 | Local per-project installs stay. No global-only deployment. | Owner instruction 2026-11-22 |
| C2 | Do not touch the file watcher (`TAWASSUL_WATCHER`, `OPENCODE_DISABLE_FILEWATCHER`, host watcher policy). It protects agent loading. | Owner instruction 2026-11-22 |
| C3 | No new tools are added. The tool surface is fixed. | Owner instruction 2026-11-22 |
| C4 | English only, no comments in gated code, minimum fix, no feature-for-feature trade. | AGENTS.md rules 1, 2, 4, 5 |
| C5 | Nothing is implemented while in plan mode. | Harness instruction |

## 1. Diagnosis after verification

Measurements come from four sources:

1. Real Desktop boot marks: `~/.config/ai.opencode.desktop/logs/*/main.log` (last 5 boots).
2. Real host and plugin logs: `opencode.log`, `tawassul.log` (104 MB, 30-day window).
3. Live sidecar API, read-only: `GET /api/session`, `/api/session/:id`,
   `/api/session/:id/message`.
4. Isolated attribution probes in `/tmp/opencode` (measurement only, outside the tree).

The collection script is `scripts/measure-boot-sessions.ts`
(`npm run measure:boot-sessions`). It is read-only: no second host, no state writes.

### 1.1 Cost of one generation

| Stage | Measured | Evidence |
| --- | --- | --- |
| Module import | 1256 ms per copy alone; 1861–1872 ms per copy under 4-project contention | `IMPORT_MS` probe |
| `initPlugin` (synchronous span) | p50 11.2 ms, p95 1.45 s, max 30.13 s (n=4744) | real `tawassul.log`, 30 days |
| Readiness (`getInitReady`) | 790–2231 ms | `INIT_READY_MS` probe |
| `setup` registration | 49–115 ms | `SETUP_MS` probe |
| `setup` steps `ask`/`skills`/`command` | p95 0–1 ms | real `tawassul.log` |
| Roster prewarm | p50 26 ms, p95 853 ms, max 16.9 s (n=594) | real `tawassul.log` |
| `await usageLedger.start()` + `await warmWorkspace()` | not measured | `src/v2/setup.ts:655`, `:660` |
| Total, isolated | 2646–3536 ms | `TOTAL_MS` probe |
| Warm boot | not faster (1216 / 1546 / 959 ms ready) | warm-boot probe |

Notes:

- The import figures are **per copy**, not a sum. Four copies under contention each pay
  1861–1872 ms because they contend for I/O; the sum is not 1.86 s.
- `initPlugin` is synchronous (`src/bootstrap/plugin-init.ts:486`): the `initPlugin=` sample
  spans `:498` to `:1083` inside one synchronous body. It **cannot** be the `initTimeoutMs`
  wall: that timer lives in `ensureReady` (`:1011`, `:1019`), which `initPlugin` never calls.
  The 30.13 s max is therefore either a blocked JS thread or a corrupted sample, because the
  perf marks are a module-global map with fixed keys (`src/utils/perf.ts:1`,
  `plugin-init.ts:497`, `:1089`) and overlapping generations overwrite them. The number is
  treated as **unreliable** until Phase 0 measures a per-generation sync span.
- The roster max of 16.9 s exceeds its own 2000 ms bound (`src/v2/setup.ts:525`,
  `src/context/managers/AgentManager.ts:379-388`). That is timer overshoot, not work.

### 1.2 Retirement: bounds, work, and timers

| Item | Measured | Evidence |
| --- | --- | --- |
| `cleanup step refresh stop` | rev 2: 1107–2948 ms; fresh real window: n=2, both `abandoned after` 5000 ms | cleanup log lines |
| `cleanup step plugin dispose` | n=22 in the last 7 days, all at or above the 5000 ms step bound: p50 5.0 s, p95 7.69 s, max 8.79 s | cleanup log lines |
| `dispose exceeded` | 245 occurrences | `dispose exceeded 7500ms`, no duration printed |
| Step bound | 5000 ms | `TEARDOWN_STEP_TIMEOUT_MS`, `src/v2/setup.ts:56`, `:609-643` |
| Dispose budget | 7500 ms | `DISPOSE_BUDGET_MS`, `src/hooks/dispose.ts:6`, `:31`, `:47-49` |
| `previousRetire` ceiling | 8000 ms | `src/bootstrap/plugin-init.ts:741` |
| Save pairs in destroy | two `STATE_SAVING` -> `SAVED` pairs observed; caller not labelled | debug log |

Corrections:

1. Three timers exist, not two. The cleanup **step** bound is 5000 ms; the dispose **budget**
   is 7500 ms; the retirement **ceiling** is 8000 ms. The step bound is the smallest, so a
   `plugin dispose` step whose `destroy()` runs longer than 5 s always logs `abandoned after`
   even though the inner budget has 2.5 s left. The 8.79 s sample is 3.79 s of overshoot
   against the **5000 ms** step bound; it is not "3.79 s past 7500". The `dispose exceeded
   7500ms` line carries no duration, so it can never be paired with 8.79 s.
2. The 8000 ms value is a **ceiling**, not the actual wait. In 11 real `superseding` events
   (excluding `/tmp`), the next `Background init completed` arrived 0.8–3.3 s later. No event
   approached 8 s. The ceiling is not the common path.
3. The 5–8.8 s disposals are **background** work. On 2026-11-21 seven dispose steps
   overlapped inside eight seconds:
   `08:21:22.796 5001 ms`, `08:21:25.764 7687`, `08:21:25.841 6919`, `08:21:26.942 7662`,
   `08:21:27.484 7539`, `08:21:27.807 7191`, `08:21:30.032 8788`.
   Overlap shows the host does not serialize these disposals. It does **not** prove that a
   successor skips cleanup: a same-directory successor still races `previousRetire`
   (`plugin-init.ts:741`). The retirement path itself does not wait for init:
   `disposeInstance` aborts `initAbortController` at `:1121` before `await ensureReady()` at
   `:1147`, and `ensureReady` returns immediately on the aborted check at `:1007-1008`.
   Phase 0 measures the actual await with a generation id.
4. **Reversal of revision 2.** Revision 2 claimed the 2.9 s `refresh stop` was
   `collectToolSchemas`. The fresh attribution refutes that: the redundant collection costs
   6.1–7.3 ms, while the multi-second stop is `probe()` parked on `initPromise`
   (`src/v2/schema-refresh.ts:42` -> `src/bootstrap/plugin-init.ts:1004-1032`).
   Evidence: the stop falls to 1 ms once init is ready, the delay gradient tracks init
   readiness (0 ms -> 1005 ms, 250 -> 952, 800 -> 346, 1500 -> 1), and the real 5001 ms
   lines have no preceding `tool schema payload` line.
5. The two save pairs are **not** established as redundant. `doSave` returns without writing
   when another save is in flight and marks the state dirty instead
   (`src/services/state-persistence.ts:853-856`); the flush retry loop (`:796`) is what
   captures the newer state. `flushAllPersists` also runs **after** the flush
   (`src/services/lifecycle-controller.ts:210`), but it drains only the `schedulePersist`
   entries (`persist-utils.ts:20-33`, `:45-56`: predictive-router at `service-factory.ts:284`,
   `:290`, base-innovation at `base-innovation-service.ts:37`) and never drives `saveState`.
   `handoff-service.ts:408` is an explicit `saveState()` in `resume()`, unrelated to the
   flush. Phase 0 labels every write with caller and generation; no write is removed before
   that label exists.

### 1.3 Generation churn in the real host

| Metric | Value | Source |
| --- | --- | --- |
| Plugin load events (17 days) | 1214 across 10 projects | host log |
| Same-project chains < 12 s | 678 single, 128 pairs, 21 triples, 3 quads, 2 sixes | host log |
| Bursts with a single location boot (true double boot) | 120 of 168 | host log |
| Bursts containing `config.updated` | 147 of 168 | host log |
| `config.updated` followed by a load within 8 s | 617 of 823 | host log |
| Peak process memory | 1852 MB | `SelfHealEngine` in the real log |
| Real boots (30 days) | 704 processes / 123 sessions | `n2-auto.jsonl` |

Mechanism: the host emits `config.updated` after the plugin's tool registration, then
re-creates the plugin generation. The second generation logs
`v2 tool schemas unchanged after init (44 schemas); reload skipped` and the chain stops at two.
This is host behavior, not a plugin loop, and it is not the watcher (see 1.4).

### 1.4 Claims tested and refuted

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Boot writes into `.opencode` and triggers a watcher reload | Refuted | warm boot: `DOT_OPENCODE_UNCHANGED=true`, `SECOND_BOOT_WRITE_LINES=0` |
| The `config` hook mutates config and triggers the reload | Refuted | v2 host does not call it: `config hook has no host channel` |
| The reload is an endless loop | Refuted | chains are dominated by pairs (128), not long chains |
| The watcher is the reload driver | Not established; out of scope per C2 | host log has no file-change line before `config.updated` |
| The next generation waits 5–8 s for retirement | Refuted | 11 real `superseding` events: next init 0.8–3.3 s |
| The multi-second `refresh stop` is `probe()` waiting for init | **Supported** (revision 2 said Refuted) | `schema-refresh.ts:42`; 1 ms once ready; no payload line before the 5001 ms lines |
| The redundant schema collection is the largest single boot cost | **Refuted** | 6.1–7.3 ms removable; smaller than `initPlugin` p50 11.2 ms and roster p50 26 ms |
| The 30.13 s `initPlugin` max is the `initTimeoutMs` wall | **Refuted** | `initPlugin` is synchronous; the timer is used only inside `ensureReady` |
| `stop()` can become non-blocking without a contract change | Refuted | `scripts/prove-e38.ts:131-140` and `:256-266` |
| A process-level cache works across generations | Unproven | module reuse not measured; `tool.reload()` re-ran `transform` 3x with one module evaluation |
| Lazy import saves 1.3 s of visible time | Unproven and bounded | plugin total 2646–3536 ms vs `entry -> visible` 1290 ms; at least 1.3–2.2 s is already off the visible path |
| The duplicate save in destroy is redundant | **Refuted as a claim** | `state-persistence.ts:853-856` (in-flight save marks dirty and returns); `lifecycle-controller.ts:210` runs `flushAllPersists` after the flush |
| F6 needs a no-op on a matching generated config | Already implemented | `plugin-init.ts:770-771` returns when `checkGeneratedConfig().ok` |

The "zero writes when warm" measure is already satisfied and stays out of this plan. The
watcher stays untouched per C2.

### 1.5 Schema collection twice (CPU hygiene, not boot)

The setup path collects tool schemas once for registration, then the post-init refresh loop
collects them again to detect drift:

- `src/v2/setup.ts:692` — first `collectToolSchemas` when init is ready at setup.
- `src/v2/setup.ts:740` — `registeredSchemaFingerprint` is set after registration.
- `src/v2/setup.ts:690` (`refreshSchemas`, invoked at `:716` and `:761`) — second collection.

Real-log counts:

| Line | Count |
| --- | --- |
| `tool schemas unchanged after init` | 2417 |
| `tool schemas refreshed after init` | 1204 |
| `schema refresh gave up` | 0 |

The 2417 are redundant collections: the first collection succeeded and the tool surface is
fixed (C3). The 1204 are late-init or registration-failure cases, not "recovery":

- Late init: `initial.ready` is false at `:716`, so the first collection is skipped and the
  refresh loop's collection reports `changed`.
- Registration failure: `ctx.tool.transform` throws at `:741`, `registeredSchemaFingerprint`
  stays `""` (`:740`), and the next collection reports `changed`.

The `catch` at `:693-695` is unreachable for the static `wrapped` map: `collectToolSchemas`
catches per tool (`adapters.ts:18-24`), so it cannot reject. Phase 0 therefore records
`initial`, `late-init`, `refresh`, and `skipped`, and no `recovery` reason.

Measured cost of one collection: 8.2–8.6 ms first call, **6.1–7.3 ms** for the redundant
second call, 44 tools, identical fingerprint. Only the second-call cost is removable by
Phase 1. The call is real but small. It is **not** the largest boot cost and **not** a latency
fix.

### 1.6 Entry and bundle constraints

- `src/index.ts:5` exports `createHooks = initPlugin` statically. It is used by
  `scripts/prove-no-git-init.ts` and `scripts/release-smoke.sh`. Lazy-loading the heavy graph
  requires changing that surface or keeping the static import (which defeats the purpose).
- `src/index.ts:9` evaluates `setup: createV2Setup()` at module load. The call is a cheap
  closure factory (`src/v2/setup.ts:489`), so it is a constraint, not a blocker: `tawassul.setup`
  must be a function at `Plugin.define` time, so any deferral has to be a wrapper inside the
  `setup` property.
- `setup()` is called by the host at load time: registration is 49–115 ms and appears in the
  boot stage table. "Defer to the first `setup` call" therefore defers nothing unless the
  deferred body sits **inside** `setup`, before `tawaCtx.init()`.
- Bun does support dynamic imports with `splitting: false`: `dist/index.js` already contains
  13 `await import(` calls, including `gen-opencode-config`. The blocker is the static
  `createHooks` export, not the bundler.
- `dist/global.js` is 2.83 MB; `dist/index.js` is 2.40 MB. The entry is not thin today.

### 1.7 Measurement method and limits

App boot (last 5 Desktop boots, deltas from the `entry` mark):

| Mark | p50 | p95 | Note |
| --- | --- | --- | --- |
| `entry -> visible` | 1.29 s | 3.99 s | p95 at n=5 is the maximum |
| `entry -> layers` | 9.71 s | 22.57 s | p95 at n=5 is the maximum |
| `entry -> service ready` | 20.99 s | 47.11 s | includes polling and restarts, not pure boot |

Session open (live sidecar, 3 recent sessions):

| Operation | p50 | p95 |
| --- | --- | --- |
| `GET /api/session` | 21 ms cold, 8.6 ms warm | n=1 each |
| `GET /api/session/:id` | 1.6 ms | 1.7 ms |
| `GET /api/session/:id/message` | 20.3 ms | 30.0 ms |
| Session open total | 21.9 ms | 31.7 ms |

First visible output (`n2-auto.jsonl`): 266 records within 120 s of module evaluation,
p50 30.75 s, p95 106.76 s, 77 within 15 s.

Limits that bind every claim below:

1. `p95` at n < 20 is the maximum. App-boot p95 and session p95 above are worst samples.
2. `abandoned after 5000 ms` is a bound, not work. The current script still merges `done` and
   `abandoned` into one key (`measure-boot-sessions.ts:197-198`); the separation is Phase 0
   work.
3. The first-output figure starts at `process_start_ms` (module evaluation), not at boot and
   not at plugin init. `since_init_ms` is the same value (`src/hooks/n2-auto.ts:70`), so
   switching to it changes nothing. N2 is defined by `boot-scorecard-v2.sh:233` as
   `ts - since` with the boot time passed by the operator.
4. The script does not attribute plugin time to any Desktop mark. No phase may claim a
   user-visible delta without the paired control in Phase 0.
5. Timer overshoot inflates **timer-bounded** intervals (cleanup steps, roster bound). It does
   not inflate `entry -> visible`, `entry -> layers`, or live API spans, which are real
   elapsed time. The script collects **no CPU time today**; Phase 0 adds `process.cpuUsage()`
   sampling, and until then no saving is reported in CPU units.
6. `shownAt` and the marks are matched only inside the first 8 KB / 4 KB of `main.log`
   (`measure-boot-sessions.ts:95`, `:99`). Slow boots whose marks fall past that window are
   dropped, biasing `entry -> visible` toward fast samples. Phase 0 fixes the parser to read
   the whole file.

Consequence: `initPlugin` p50 11.2 ms, session open 22–32 ms, and app visible 1.29 s are not
improved by Phases 1–3. Phase 6 is the only phase with a plausible mechanism for
`entry -> visible`, and its ceiling is the unknown overlap with a 2.6–3.5 s plugin total, not
the whole 1.29 s p50.

### 1.8 Instrumentation gaps (blocking the metrics)

These metrics cannot be scored today:

| Metric | Why not | Phase 0 fix |
| --- | --- | --- |
| Cleanup step **completed** duration | `done in` is `logger.debug` (`setup.ts:638`); only `abandoned` is warn (`:636`) | info line when a step exceeds 100 ms, plus a counter for every step |
| State saves per destroy | `STATE_SAVING`/`SAVED` are `eventHub` events (`state-persistence.ts:864`, `:984`), logged at debug at best | info `v2 save gen=N caller=flush\|auto\|retry dirty=<bool>` |
| Save failures | `saveFailureCount` is internal (`state-persistence.ts:618`) | info counter on the failure path |
| Per-generation sync span | perf marks are module-global with fixed keys (`utils/perf.ts:1`) | per-instance timer, `v2 init sync gen=N ms=X` |
| CPU time | not collected | `process.cpuUsage()` delta around init, setup, cleanup |
| Generation pairing | no generation id | `gen_<n>` on setup, cleanup, collection, and save lines (retire in Phase 5) |
| Second-generation ready | no baseline | derive from `superseding` -> `Background init completed` with the id |
| N2 | proxy starts at module eval | `boot-scorecard-v2.sh --since <boot-t0> --n2 auto` |
| Module reuse | no module-evaluation line | `v2 module eval pid=<pid>` at module scope in `src/index.ts` |
| Per-await wall time before registration | no timer around `setup.ts:655`/`:660` | info line when the await exceeds 20 ms |

## 2. Plan (revised order)

Implementation order: **0 -> 1 -> 2 -> 3 -> 5 -> 4 -> 6 -> 7**.

| Adjacency | Justification |
| --- | --- |
| 0 first | Every claim and every proof depends on the control and the instrumentation |
| 1 next | The only isolated, proven, mergeable change; shares `setup.ts` with 3 but in a different function (`refreshSchemas` vs the `refreshStop` closure) |
| 2 before 3 | Phase 2 changes `destroy`; Phase 3 changes the refresh stop in `runCleanup` (`setup.ts:1000-1002`), and `destroy` runs inside the `plugin dispose` step. Land 2 first so a lost write cannot be attributed to teardown |
| 3 before 5 | Phase 3 is a correctness fix (post-dispose collect/reload); 5 is telemetry-only |
| 5 before 4 | Every unconditional phase runs before the gated ones; 4 and 6 may never run |
| 4 before 6 | Opposite host assumptions (reuse vs re-evaluation); prove reuse first |
| 6 before 7 | 6 is a structural change with an owner-approval gate; 7 is a set of small conditional edits and goes last regardless |
| 7 last | Conditional on the Phase 0 per-await timers; changes only what exceeds 50 ms |

### Phase 0 — Proofs, instrumentation, and the control run

Each phase ships the proofs that fail before it and pass after it. Do not use one bundled
gate. Phase 0 ships diagnostics only, because a red catalog proof fails `gate:proofs`.

| Proof | Asserts | Initial state |
| --- | --- | --- |
| `scripts/measure-module-reuse.ts` | Measurement only: module-evaluation count vs generation count in a real host window, with a process id and a synthetic cache-lookup cost | diagnostic |
| `scripts/measure-generation-ready.ts` | Measurement only: second-generation ready time from `superseding` to `Background init completed` | diagnostic |

`prove-schema-reuse` ships in Phase 1 and `prove-dropped-persist` in Phase 2, red-first in
their own commits. Phase 0 ships **no red catalog proof**: `prove-proof-catalog.ts:265-292`
wires every `prove-*` file into the proofs stage, and a red proof fails `gate:proofs`.
`prove-cleanup-bound.ts` belongs to Phase 3 for the same reason; its red state is produced by a
no-op stub (Phase 3, proof shape).

Rules:

1. A new `prove-*` file must be wired into exactly one gate step
   (`scripts/prove-proof-catalog.ts:273-285`) and pinned in **both** `PINNED_PROOF_FILES`
   (`:70`) and `PINNED_PROOF_STEPS` (`:262`), with `gate-manifest.json`, `proof-shards.json`,
   and `package.json` regenerated. `scripts/release/check-release.ts:85-124` additionally pins
   the step count in `AGENTS.md`, two lines in `docs/validation.md`, and four count rows in the
   release notes page linked from `CHANGELOG` (`:50-53`). Update all of them in the same
   commit.
2. Diagnostics are `measure-*`, not `prove-*`; a diagnostic cannot be a catalog entry.
3. Existing proofs must stay green: `prove-e38`, `prove-b01`, `prove-no-git-init`,
   `release-smoke.sh`.
4. Phase 1's `prove-schema-reuse` needs a seam: add an optional `collectSchemas` to
   `V2SetupDeps` (`setup.ts:387-394`) defaulting to the real `collectToolSchemas`. This is
   test-only dependency injection, not a feature.
5. API-dependent proofs are red-first through a stub: land the new surface as a no-op, show
   red, then wire it.

Instrumentation to add before any saving is claimed:

1. **Generation id** on setup, cleanup, collection, and save lines; Phase 5 adds it to the
   retire line it creates.
2. **Sync span per generation** with a per-instance timer, not the module-global marks.
3. **CPU time** per generation around init, setup, and cleanup via `process.cpuUsage()`.
4. **Cleanup completion** at info when a step exceeds 100 ms, plus a counter for all steps.
5. **Save count per destroy** at info with caller (`auto`, `flush`, `retry`), generation, and
   dirty flag; plus the dropped-handoff count.
6. **Save failure** count at info on the failure path.
7. **Collection count and duration** per generation with the reason
   (`initial`, `late-init`, `refresh`, `skipped`).
8. **Module evaluation marker**: one info line at module scope in `src/index.ts`
   (`v2 module eval pid=<pid>`), so `measure-module-reuse` and the Phase 4 gate have a data
   source that fires once per module evaluation.
9. **Process id** on every generation-id line, so "per process" is groupable.
10. **Per-await wall timers** around `setup.ts:655` and `:660`, at info when the await exceeds
    20 ms; these are the Phase 7 inputs.
11. **Script fixes**: separate `done`/`abandoned`; parse the whole `main.log`; report
    `n`/`p50`/`p95`/`max` and suppress `p95` below n=20; drop the `since_init_ms` change
    (it is a no-op); correlate boot marks by boot directory, not by substring window.

Paired control (owner approval required):

- Run at least five boots per arm on the same host and projects, with the plugin **not
  installed** in one arm (remove the project's `.opencode/plugin` entry, or move
  `dist/index.js` aside). `TAWASSUL_DISABLED=1` is not a baseline: `initPlugin` returns `{}`
  at `plugin-init.ts:535-538`, but `setup()` still runs and still awaits
  `usageLedger.start()` (`setup.ts:655`) and `warmWorkspace()` (`:660`), so that arm pays
  setup cost and biases the delta toward zero.
- Compare only first-generation boot marks: `entry -> visible`, `entry -> layers`,
  `entry -> service ready`.
- The plugin-free arm registers zero tools, so it may not emit `config.updated` and may not
  produce a second generation. That is acceptable for the first-generation boot marks and
  invalid for any first-output comparison; state the arm difference in the result.
- The control decides **Phase 6 only**. Phases 1–3 already disclaim boot-time savings, so a
  null delta cannot retroactively invalidate them; it removes Phase 6.
- If the plugin-free arm is not run, no phase may claim a user-visible delta and Phase 6 stays
  dropped.

Phase 0 acceptance: both diagnostics run on a real window, the eleven instruments emit at info,
and the control is recorded or explicitly marked not run. No saving is claimed before this.

Phase 0 execution record (2026-11-23, isolated experiment and real host window):

| Item | Result |
| --- | --- |
| Isolated boot | two generations in one process, same `pid`, exactly one `v2 module eval` line |
| `init sync` | gen 1 104.4 ms / gen 2 2.1 ms in run 1; 18.0 ms / 1.5 ms in run 2 |
| `setup ready` | 70.6 ms and 64.7 ms; 44 tools both times |
| `schema` | `skipped detail=init-not-ready`, then `late-init` 27.6 ms / 9.0 ms, 44 tools |
| `cleanup` | 15 steps, 15 done, 0 abandoned, max 643.3 ms; the already-retired generation reports 0.6 ms |
| `destroy` | `saves=2` per generation; 2474 ms and 643 ms wall, 661 ms and 116 ms CPU |
| Per-await timers | both awaits stayed under 20 ms, so no line was emitted |
| Script on the real log | `entry -> visible` p50 1.29 s at n=9, `p95` suppressed below n=20, abandoned steps separated from done (`plugin dispose` n=22, max 8.79 s) |
| Module reuse | 2 generations per module evaluation in the isolated process |
| Synthetic lookup | name-set hash 0.024 ms; sha256 over 2.40 MB 8.90 ms; memoized estimate 0.024 ms |
| Paired control | not run: owner approval and a plugin-not-installed arm are required, so Phase 6 stays dropped |
| Real host `init sync` | n=25 p50 9.3 ms, two outliers at 2.51 s and 3.06 s during Desktop startup (CPU contention, not code) |
| Real host awaits | `usage-ledger` 400.8 ms on one generation and 5048.6 ms on the next; `setup ready` 980.9 / 1280.9 / 5080.3 ms |
| Real host schema | `initial` 9.0 ms `changed=true`; `refresh` 0.3 ms `changed=false` |
| Real host destroy | 4512 ms wall, 2388 ms CPU, `saves=2`; this is the 5–8.8 s `plugin dispose` step, not a boot step |
| Real host ready line | `tools=0` with `schemas=44`, then `registered 44 tools` about 400 ms later; the field counts tool-domain entries, not schemas |
| `generation-ready` on the real log | 183 pairs, p50 1.51 s, p95 3.62 s, max 515 s (one overnight outlier) |
| Module reuse on the real log | pid 766885: 2 module evaluations, 3 generations; `gen=0` direct-setup proof lines are reported separately |

The synthetic sha256 cost exceeds the 6.1-7.3 ms Phase 1 saving, so the Phase 4 precondition
("memoize `bundleFingerprint()` before the cache") is load-bearing, not cosmetic. The real host
re-evaluated the plugin module inside one `pid` during a rebuild, which reset the module-level
generation counter and produced two different instances both labelled `gen=1`. The counter now
lives on `globalThis` (verified across three re-imports: 1, 2, 3), so the label is unique per
process without a behaviour change. Custom `deps.init` seams (for example `prove-e38`) log `gen=0`
because they bypass `initPlugin`; every real host init logs `gen>=1`, and the module-reuse
diagnostic reports those direct-setup lines separately from host generations.

### Phase 1 — Skip the redundant post-init schema collection (CPU hygiene)

Change `src/v2/setup.ts`:

- `refreshSchemas` (`:690`) is defined before the registration block and cannot see the
  `nameSetHash` const at `:729`. Compute the name set inside `refreshSchemas` from
  `Object.keys(wrapped)` instead of hoisting the registration const.
- Add `let initialSchemasCollected = false;` and `let registeredNameSetHash = "";` next to
  `schemas` and `registeredSchemaFingerprint`.
- Set both only when a collection actually ran **and succeeded**: inside `refreshSchemas` on
  the success path, after `collectToolSchemas` resolves. Not after registration: `:716` runs
  before registration at `:728-740`, and a late-init generation registers without collecting.
  Setting the flags on registration would make the refresh loop skip the only collection and
  leave the host on placeholder schemas.
- Record the name-set hash at the same point, from `Object.keys(wrapped)`.
- In `refreshSchemas`, before `collectToolSchemas`:
  - if `initialSchemasCollected` is true, `registeredNameSetHash` is non-empty,
    `registeredSchemaFingerprint` is non-empty, and the current name-set hash equals
    `registeredNameSetHash`, return `false` without collecting;
  - otherwise collect as today.
- Keep the late-init path unchanged: it collects once and sets the flags. A registration failure
  leaves `registeredSchemaFingerprint` empty, so the guard collects and the failure diagnostic
  is preserved.
- Fail open on any uncertainty: an empty hash, an empty fingerprint, a failed collection
  (`:695`), a `ctx.tool.transform` throw (`:741-743`), or a changed set all collect.

Why this is safe:

- `wrapped` is the static tool map from `initPlugin`; the tool surface is fixed (C3).
- `wrapped` is static per generation, so the name-set half can never differ in production and
  the guard degenerates to `initialSchemasCollected`. The changed-name-set case in
  `prove-schema-reuse` mutates the fake plugin's tool map after registration; it proves the
  fail-open branch, not a production path.
- `registeredSchemaFingerprint` is a 64-hex hash set on **every** successful registration,
  including the empty map. It is not a "collected" flag because it is non-empty in both
  states, not because it is empty when skipped.
- The guard compares names only, so a changed schema under an unchanged name would be
  skipped. Phase 0's collection counter must show zero drift under stable names in the
  observed window; if it shows drift, drop Phase 1 rather than adding a full-fingerprint
  pre-check (a full fingerprint requires collecting first, which is the cost being avoided).

Expected: removes 6.1–7.3 ms of **wall time of the awaited `collectToolSchemas` call** on the
2417 unchanged generations. This is not a CPU-time figure: §1.7 limit 5 says the script
collects no CPU time. No wall-clock or user-visible boot claim.

Risk: low. Proofs: `prove-schema-reuse`, `prove:reload-live`, `prove:boot-budget`,
`prove:skills-manifest`.

Phase 1 execution record (2026-11-23):

| Item | Result |
| --- | --- |
| Red first | `prove-schema-reuse` failed on the ready generation (2 collections); green after the guard (1 collection, 11 assertions) |
| Fail-open | a failed registration and a changed name set both collect again; late-init still collects its only set |
| Real host window | 22 `reason=refresh changed=false` collections; no real-host drift (the 4 `changed=true` refresh lines are `gen=0` proof runs) |
| Scope | the guard runs before `collectToolSchemas`, so the saving is the 6.1–7.3 ms call itself, not a CPU measurement |
| Catalog | 190 proof files, 187 proof steps; `check:release` and `gate:fast` green |

### Phase 2 — Persist dropped-handoff counters (durability, no save removal)

Change `src/services/lifecycle-controller.ts`, `src/context/managers/RatingManager.ts`, and
`src/services/state-persistence.ts`:

- `detectDroppedHandoffs` (`RatingManager.ts:266-274`) returns the number of newly counted
  drops instead of `void`. The distinction already exists in `_countedDroppedHandoffs`
  (`:264`).
- Make `StatePersistence.markDirty()` public (one keyword; it is private at
  `state-persistence.ts:673` and called from `saveState()` at `:661` and from the in-flight
  branch of `doSave` at `:854`).
- In `destroy`, after `detectDroppedHandoffs` (`lifecycle-controller.ts:145`), call
  `markDirty()` **only when the returned count is greater than zero**.
- Leave `flushSaves` unchanged.

What the marker actually closes:

- The **lock-loss silent skip** (`state-persistence.ts:885-889`): `doSave` returns with
  `saveDirty` untouched, so the `flushSaves` retry loop (`:796`) runs and the newest counter is
  retried.
- It does **not** close a thrown write. `flushSaves` rethrows at `:792` before the retry loop
  at `:794-800` is reached. The deferred save that `doSave` schedules in its `finally`
  (`:1001`) is cleared by `markDisposing` (`lifecycle-controller.ts:39-42`, invoked at `:214`)
  a few microtasks later.
- It does **not** close the isolation path (`:826-841`) or `stateReadOnly` (`:810-814`), which
  set `saveDirty = false` themselves, or `!persistDir` (`:809`), which has no target.

Cost:

- On lock loss the retry loop can add one full `doSave()` whose lock backoff is
  `LOCK_ATTEMPTS = 10` × `50 * (l + 1)` = 2750 ms (`:627`, `:878-884`). The 1000 ms deadline
  (`:794`) is checked only at the loop top (`:796`), so the first extra attempt overshoots it.
  Phase 2 therefore adds up to ~2.8 s to `destroy` **only when the lock is lost**, which is
  exactly the case that loses the counter today. The happy path is unchanged.

Limit: `_countedDroppedHandoffs` is per instance (`:264`), so an `accepted` handoff is
re-counted once per generation. Phase 2 persists that number as-is; it does not fix
cross-generation inflation (that needs a persisted dedupe set, a new mechanism).

Why no skip guard in this revision:

- The two save pairs are not proven redundant. `doSave` returns without writing when a save is
  in flight (`state-persistence.ts:853-856`), and the flush retry loop (`:796`) is what
  captures the newer state. `flushAllPersists` (`lifecycle-controller.ts:210`) drains only
  `schedulePersist` entries (`persist-utils.ts:20-33`, `:45-56`) and never calls `saveState`.
- `markDirty` is called from two places (`:661`, `:854`), so `!saveDirty` is plausible but not
  an audited invariant. Skipping the final write would trade durability for an unmeasured
  background gain.
- The guard becomes admissible only if Phase 0 labels a write with a generation unchanged
  since the last successful save. In that case the guard is
  `!saveDirty && saveFailureCount === 0`, with its own proof. Otherwise it is not added.

Effect:

- Happy path: unchanged. The unconditional write at `:785` still saves.
- Lock loss: today a state that was clean before destroy, followed by one new dropped handoff,
  has `saveDirty=false`; `doSave` fails to acquire the lock, returns silently, and the counter
  is lost. After the marker, the retry loop runs and retries the write.

Proof `prove-dropped-persist` (shipped in this phase):

1. Controller unit: construct `LifecycleController` (`lifecycle-controller.ts:24-29`) with a
   fake persistence and a context holding one `accepted`, uncounted handoff; call `destroy()`;
   assert `markDirty` was called exactly once and `detectDroppedHandoffs` returned 1. Red today
   (no call, `void` return). A second `destroy()` must not call it again (`destroyed` guard).
2. Regression guard, green before and after: with a real `StatePersistence` and a temp
   `persistDir`, detect one new drop, flush, and read the state file; assert `handoffsDropped`
   is on disk and a repeated detection of the same handoff in the same instance does not
   increment it. This half does not test the marker.

The fake context needs the members `destroy()` touches unwrapped: `sessionManager.getSessionId`
(`:311`), `persistence.markDisposing` plus a writable `saveTimeout` (`:214`), `timerManager`
(for `AutoSaveManager` at `:28`), and `autoSaveManager`. Everything else is inside
`try`/`catch` (`:130-310`).

Expected: zero boot-time change on the happy path; the lock-loss lost-write path closed; up to
~2.8 s added to `destroy` only when the lock is lost.

Risk: low. Proofs: `prove-dropped-persist`, `prove:state-root-survival`,
`prove:state-root-rollback`, `prove:db-retention`, `prove:handoff-undo`.

Phase 2 execution record (2026-11-23):

| Item | Result |
| --- | --- |
| Red first | `prove-dropped-persist` failed before the marker (no `markDirty` call, `void` return); green after (9 assertions) |
| Controller | one new drop marks the state dirty once; a second `destroy()` is a no-op |
| Real save | a real `StatePersistence` + `StateManager` writes `agentRatings.dev.handoffsDropped=1`; a repeated detection stays at 1 |
| Happy path | unchanged: `flushSaves` still writes; the marker only adds the lock-loss retry path |
| Catalog | 191 proof files, 188 proof steps; `check:release` and `gate:fast` green |

### Phase 3 — Release a parked schema probe (two-phase stop)

Change `src/v2/schema-refresh.ts` and `src/v2/setup.ts`:

- Extend `SchemaRefreshHandle` (`schema-refresh.ts:17-20`) with `stopProbe: () => void`.
- Inside `startSchemaRefresh`, add a sticky `released` flag and a release deferred. The loop
  checks `released` at the top and races `options.probe()` against the release promise. When
  release wins, the loop returns without calling `refresh()` or `reload()`.
- `stop()` stays as today (`:74-77`): set `stopped`, await `done`, so an in-flight
  `refresh()`/`reload()` still completes.
- Add `if (stopped) return;` immediately after `await options.probe()` (`:42-43`). This is
  the correctness fix; it does not shorten the wait by itself.
- In `setup.ts:770`: `refreshStop = async () => { refresh.stopProbe(); await refresh.stop(); }`.
  `runCleanup` (`:1000-1002`) and `boundCleanupStep` (`:609-643`) stay unchanged.

No phase accessor, no per-step bound, and no 150 ms runtime race. A runtime race on the whole
stop is what would break the reload contract: `prove-e38.ts:260` holds its gate only 50 ms, so
a 150 ms race passes all four assertions (`:261`, `:264`, `:265`, `:266`) while violating the
contract for any reload longer than 150 ms. The 150 ms value is a **proof assertion**, not a
production budget.

The 150 ms assertion covers the parked-probe case only. `stop()` awaits `done`, and the loop
can sleep `delayMs` (default 500 ms, `setup.ts:54`) between attempts (`schema-refresh.ts:68`); a
release during that sleep is bounded by `delayMs`, not by 150 ms. The proof asserts both bounds.

Proof `prove-cleanup-bound` (shipped in this phase):

1. Parked probe: `probe` never settles; call cleanup with `teardownTimeoutMs` at the default
   5000 ms; assert it settles in < 150 ms and that `refresh`/`reload` were never called.
2. In-flight reload: hold the reload gate 400 ms; at 300 ms assert cleanup has not settled and
   `tool-dispose` has not run; release; assert `reload-end` precedes `tool-dispose` and
   `reloads === 1`.
3. Backoff sleep: park the loop in a `delayMs` sleep; release; assert cleanup settles in
   <= `delayMs` + 100 ms and that no `refresh`/`reload` follows.

Red-first: land `stopProbe` as a no-op (compiles, releases nothing) → part (1) red; wire the
release → green. The red state requires keeping `teardownTimeoutMs > 150 ms` (default 5000,
`setup.ts:542`); a smaller dep value settles below 150 ms and falsely passes.

Residual, corrected: an earlier revision claimed `disposeInstance` awaits `ensureReady`
(`plugin-init.ts:1147`) and that the release is therefore partial. That is false: `:1121`
aborts `initAbortController` before the await, and `ensureReady` returns immediately at
`:1007-1008`. The release is complete for this path.

The 5–8.8 s `plugin dispose` step is separate work, owned by no phase: `destroy()` itself
(`flushSaves` lock backoff at `state-persistence.ts:878-884`, `drainStructuralAnalyses(2000)`
at `lifecycle-controller.ts:155`, `sessionManager.cleanup()` at `:258`), and the 8.79 s max is
timer overshoot of the 5000 ms parked timer (`setup.ts:635-638`), which §1.7 limit 5 says is
not work.

Expected: removes the 5000 ms abandoned `refresh stop` step when the probe is parked. No
boot-time claim until Phase 0 establishes whether the host awaits `runCleanup`.

Risk: medium (ordering). Proofs: `prove-cleanup-bound`, `prove-e38`, `prove-b01`,
`prove:reload-live`.

Phase 3 execution record (2026-11-23):

| Item | Result |
| --- | --- |
| Red first | the parked probe timed out at 150 ms with the no-op `stopProbe`; green after the release (13 assertions) |
| Ordering | cleanup waits for an in-flight 400 ms reload; `reload-end` precedes `tool-dispose`; one reload |
| Backoff | a release during the 300 ms sleep settles within 400 ms and never refreshes or reloads |
| Neighbours | `prove-e38` 19, `prove-b01` 23, `prove:reload-live` 30 assertions green; `prove-dispose-bounded` updated from "abandoned refresh stop is logged" to "released refresh stop is not logged as abandoned" (27 assertions) |
| Catalog | 192 proof files, 189 proof steps; `check:release` and `gate:fast` green |

### Phase 4 — Cross-generation schema cache (default: drop)

Gate (all required, numeric):

1. `measure-module-reuse` shows module evaluations fewer than generations in the same process
   (reuse = true) and at least one module evaluation serving >= 3 generations. The observed
   longest chain is 6 and the mean is ~1.7 loads per process, so ">= 50 generations per
   process" is unsupported by the plan's own data.
2. The cache lookup (name-set hash + bundle sha) costs less than the measured 6.1–7.3 ms wall
   saving. `measure-module-reuse` records that lookup cost; no production instrument is added.

Precondition (not a numeric gate): `bundleFingerprint()` is memoized per module instance before
the cache is added. It reads and hashes the whole 2.4–2.83 MB entry and is already called at
`plugin-init.ts:975` and `db-maintenance-trigger.ts:290`; a third un-memoized call would cancel
the schema saving.

Change (only if the gate passes): add a module-level cache keyed by **project directory** +
bundle sha + tool name set hash. On a match, reuse the **schema map only**.

- Do **not** put the config mtime in the key. The churn being cached is `config.updated`, and
  the tool map (`wrapped`) does not change when the config does; a config-mtime key would miss
  on every generation that the very churn produces.
- Never share entries across directories.
- Any mismatch falls back to the current path.
- Keep the cache inside the module instance; no process-wide map.
- The `agent template hash` in any key must be costed against the roster read it replaces.

Roster caching is **out of scope** (see 5). The roster lives in per-generation private fields
(`AgentManager.ts:68-94`: `_opencodeAgentsCache`, `_opencodeWarmPromise`, `_rosterGeneration`,
`_deletedRosterCache`) and has no seed API. "Skip the prewarm" without hydrating those fields
leaves the new generation cold.

Expected: 6.1–7.3 ms per cached generation, second generation only. Default outcome: dropped,
because a module-level cache is useless if the host re-imports the bundle for each generation.

Risk: medium (staleness). Proofs: `measure-module-reuse`, `prove:skills-manifest`,
`prove:model-switch`, `prove:boot-budget`.

Phase 4 execution record (2026-11-23): **dropped, no code change.**

| Gate | Result |
| --- | --- |
| Reuse | 30-day window: 10 module eval lines against 17 generation starts; host pid 2989 has 5 evals / 5 generations, pid 766885 has 3 / 4 (max ratio 1.33); no module evaluation serves >= 3 generations |
| Lookup | name-set hash p50 22us; the cold key adds a sha256 of the 2.41 MB bundle at p50 8.95ms, above the 6.1–7.3 ms saving; 22us applies only after the bundle-fingerprint memoization precondition |
| Decision | gate 1 fails and the cold lookup fails gate 2, so the cache is not added; the current per-generation collection stays |

### Phase 5 — `previousRetire`: measure every supersede, add no cap

Change `src/bootstrap/plugin-init.ts`:

- Log the elapsed `previousRetire` on **every** supersede, not only when the 8 s race wins,
  because the observed 0.8–3.3 s sits directly before `tawaCtx.init()` (`:741-742`) and is the
  only measured readiness cost on the second generation.
- Add a separate counter when the 8 s ceiling wins, kept distinct from the 5 s step bound and
  the 7.5 s dispose budget.
- Add **no cap**. The ceiling fired in none of the 11 observed supersedes; a 300 ms cap or a
  split flush would be an unproven change on the state path. Revisit only if the counter fires
  in a real window.
- Keep the `activePluginInstances` ownership check unchanged.

Proof `prove-retire-telemetry` (shipped in this phase): boot `initPlugin` twice inside an
isolated `XDG_*` home, following the `prove-global-boot.ts` pattern, keeping the first instance
registered so the second call takes the supersede branch; assert one `v2 retire gen=N ms=X` line
per supersede and that a retire above 8 s increments the ceiling counter. Red-first: the line
does not exist today, so the proof fails before the phase.

This phase is the only owner of the retire telemetry; Phase 0 no longer carries it.

Regression proofs: `prove:state-root-survival`, `prove:state-root-rollback`,
`prove:handoff-undo`, `prove:db-retention`.

Phase 5 execution record (2026-11-23):

| Item | Result |
| --- | --- |
| Red first | with the retire log removed, `prove-retire-telemetry` fails on "one retire line per supersede"; green after the line (14 assertions) |
| Wait measure | the timer starts when the supersede waits, so the line reports the blocked readiness cost, not the context construction |
| Settled retire | `v2 retire gen=2 pid=... ms=984.4`; one line per supersede; ceiling counter stays at 0 |
| Ceiling branch | a 300 ms retire against a 60 ms test ceiling logs `ceiling=1 hits=1`; `RETIRE_CEILING_MS` stays 8000 |
| Counter | `retireCeilingHits()` is stored on `globalThis` and survives a module re-evaluation |
| No cap | no retirement cap, no split flush, no change to `activePluginInstances` |
| Regressions | `prove-c03` 21, `prove:handoff-undo` 48, `prove:state-root-rollback` 125, `prove:state-root-survival` 44, `prove:db-retention` green |
| Catalog | 193 proof files, 190 proof steps; `check:release` and `gate:fast` green |

### Phase 6 — Lazy import (default: drop)

Gate (all required):

1. The paired control (plugin-free baseline, Phase 0) shows `entry -> visible` differs by a
   material amount between arms.
2. The owner accepts the surface change below.

A real-host import/visible overlap is not a usable gate: the script does not attribute plugin
time to Desktop marks (§1.7 limit 4), and Phase 0 adds no such join. The control is the only
available evidence.

Change (only if the gate passes): keep `Plugin.define` at module top; keep `tawassul.setup` a
function at define time; defer the heavy graph **inside** `setup`, before `tawaCtx.init()`;
resolve the static `createHooks = initPlugin` export (`index.ts:5`) and the static imports at
`:2-3`. Preserve the `import.meta.resolve` external guard for `@opencode/plugin`. Keep
`dist/global.js` self-contained and `dist/index.js` valid.

Why the default is drop:

- Plugin total is 2646–3536 ms against `entry -> visible` p50 1290 ms, so at least 1.3–2.2 s of
  plugin work is already off the visible path. A 1.3 s visible saving (the whole p50) is
  arithmetically impossible; the ceiling is the unknown overlap.
- The only implementable form makes `createHooks` asynchronous and changes a public surface
  used by `scripts/prove-no-git-init.ts` and `scripts/release-smoke.sh`. That is not a minimum
  fix; it needs explicit approval and a material control delta.

Risk: medium (bundle shape, global flat file). Proofs: `prove:bundle-freshness`,
`prove:global-install`, `verify:global`, `smoke:release`, `prove:boot-budget`.

Phase 6 execution record (2026-11-23): **dropped, no code change.** The required paired
control was not run (Phase 0 record); a plugin-free arm needs the owner to uninstall the
plugin on the live Desktop and to approve the async `createHooks` surface change. Without
both, no user-visible delta is claimed and the lazy import stays out. `dist/index.js` and
`dist/global.js` keep their current static shape.

### Phase 7 — Background gating (last, evidence-gated)

- Measure `await usageLedger.start()` (`setup.ts:655`) and `await warmWorkspace(...)` (`:660`)
  with the Phase 0 per-await timers. They run before registration and are absent from the
  stage table.
- If either exceeds 50 ms, move that call after registration; if neither exceeds 50 ms, make
  no change. `usageLedger.start()` awaits only `load()` (`usage-ledger.ts:354-366`);
  `reconcile()` is already `void` at `:363`, so moving the reconcile cannot shorten the await.
- F6 config generation needs no change: `plugin-init.ts:770-771` already returns when
  `checkGeneratedConfig().ok`. `ensureBaseAgentFiles(paths.agentsDir)` at `:769` is inside the
  detached `void (async () => ...)` at `:758`, so it is already off the boot path; no change
  and no gate.
- No cache-key change: Phase 4 does not key on the config mtime.

Expected: CPU relief after boot, not boot time. An edit lands only if the Phase 0 timer shows
the await above 50 ms.

Gate: N2 measured from boot t0 as a diagnostic, and N3 p95 as a regression guard. No phase
here targets model latency.

Phase 7 execution record (2026-11-23):

| Item | Result |
| --- | --- |
| `usageLedger.start()` | n=75, p50 462.0 ms, p95 715.6 ms, max 5048.6 ms; above the 50 ms gate |
| `warmWorkspace()` | n=6, p50 48.5 ms, p95 72.3 ms, max 402.3 ms; 3 of 6 boots above 50 ms |
| Change | both awaits moved after the tool-registration block; the ledger and shadow stay installed before it, and tool registration no longer waits on either |
| Unchanged | the ledger `load()` still gates its own start and no record path is installed earlier than the await |
| Regressions | `prove-b01` 23, `prove-e38` 19, `prove:reload-live` 30, `prove:boot-budget` 5, `prove:skills-manifest` 348, `prove:model-switch`, `prove-usage-ledger`, `prove-usage-shadow` green |
| No change | F6 config generation, `ensureBaseAgentFiles`, and the cache key stay as they are |
| Full stage | shards 1–4 green (44/49/48/49 steps); `prove-boot-budget` now disposes its plugin instance and waits 250 ms before removing its isolated home, so a background save cannot race the cleanup |

Close-out (2026-11-23): phases 0, 1, 2, 3, 5, and 7 landed; phases 4 and 6 are dropped with
their gates and evidence recorded above. `npm run verify`, `check:release`, and all four proof
shards are green.

| Real window (24 h) | Result |
| --- | --- |
| N1 subscribe errors | 0 |
| N2 first LLM stream | INCOMPLETE; no click-run was recorded, so no N2 claim |
| N3 init p95 | 1885 ms, n=129, max 3065 ms (target <= 2000 ms) |
| N4 state validation | one line at 2026-11-23T18:25:34, from the discarded `prove-dropped-persist` fixture before its fake context was corrected; no production failure and no `TAWASSUL_*` state write outside the proof home |
| N5 project-copy refresh | N/A; host 2.2.0 emits no v1 watcher metric |
| Host verify | not forced; `host:refresh --verify-only` reports the live service is loaded from another workspace entry, so this tree was not reloaded and no boot-time claim is made |

## 3. Overlap and dependency map

### 3.1 Pairwise relationships

| Pair | Relationship | Consequence |
| --- | --- | --- |
| Phase 1 ↔ Phase 3 | Different objects: Phase 1 skips 6.1–7.3 ms of collection; Phase 3 releases a parked probe | Do not add their estimates |
| Phase 2 ↔ Phase 3 | Phase 2 changes `destroy`; Phase 3 changes the refresh stop in `runCleanup` (`setup.ts:1000-1002`), and `destroy` runs inside the `plugin dispose` step | Land 2 first so a lost write cannot be attributed to teardown; Phase 3 does not own the dispose step |
| Phase 2 ↔ Phase 5 | Phase 2 makes dirty state truthful; Phase 5 measures retirement | No cap; if one is ever added, Phase 2 must land first |
| Phase 1 ↔ Phase 4 | Phase 1 removes the second collection in a generation; Phase 4 would remove the first across generations | Additive, not double-counted: Phase 4 can save at most the one collection Phase 1 leaves, and only if module reuse holds |
| Phase 4 ↔ Phase 6 | Opposite host assumptions: module reuse vs module re-evaluation | Not additive; prove reuse first |
| Phase 4 ↔ Phase 7 | Phase 7 writes config; Phase 4 caches schemas keyed by the tool map | Independent: no config mtime in the key |
| Phase 5 ↔ Phase 3 | Phase 5 measures retirement; Phase 3 changes cleanup | Phase 5 is independent; Phase 0 instrumentation first |
| Phase 0 ↔ all | Unattributed numbers caused the revision-2 and revision-3 errors | Control and instrumentation first |

### 3.2 Corrected savings

| Measure | Revision 4 claim | Revision 6 estimate |
| --- | --- | --- |
| Phase 1 (schema reuse) | 6.1–7.3 ms CPU | 6.1–7.3 ms wall per unchanged generation (2417 cases); hygiene only |
| Phase 2 (dropped-handoff marker) | One save per clean destroy; -250 to -600 ms unproven | Zero on the happy path; closes the lock-loss retry path; up to ~2.8 s added to `destroy` only on lock loss |
| Phase 3 (probe release) | 0 boot time; removes one abandoned step | 0 boot time; removes one abandoned 5000 ms step and a post-dispose collect; does not touch the `plugin dispose` step |
| Phase 4 (schema cache) | 6.1–7.3 ms per cached generation | Same, only if the reuse gate passes; default drop |
| Phase 5 (retire) | ~0 for the cap; 0.8–3.3 s measured | Same; telemetry only, no cap |
| Phase 6 (lazy import) | Unknown overlap, ceiling <= 1290 ms | Same; default drop |
| Phase 7 (gating) | CPU relief after boot | CPU relief after boot; no boot-time saving |

No two rows describe the same interval. Phases 1 and 3 are distinct; Phase 2 no longer claims
a save at all.

## 4. Verification protocol

After every phase:

1. `npm run verify` (fast gate + build).
2. `npm run gate:proofs` or the four shards (`gate:proofs:1..4`).
3. The phase's proof, when the phase ships one, must be green; `prove-e38`, `prove-b01`,
   `prove-no-git-init`, and `release-smoke.sh` must stay green. Phase 0 has no proof: its
   acceptance is the two diagnostics, the eleven instruments, and the control record.
4. Real-window scorecard: `bash scripts/boot-scorecard-v2.sh --since <boot-t0> --n2 auto`.
5. Record before/after: import ms, sync init ms, cleanup completed vs abandoned, CPU time,
   schema calls and duration, saves per destroy with caller, second-generation ready, and timer
   overshoot. RSS is not recorded: the script has no collector for it.

Reporting rules: report `n`, `p50`, `p95`, and `max`; do not report `p95` below n=20; do not
merge `done` and `abandoned`; do not compare wall-clock across arms unless both arms are
measured on the same host and load; report CPU time only when `process.cpuUsage()` data
exists.

Success metrics:

| Metric | Target | Population | Status today |
| --- | --- | --- | --- |
| `entry -> visible` | p50 <= 1.5 s (non-regression), n >= 20, whole-file parsing | Desktop `main.log` marks | 1.29 s at n=9 |
| `entry -> layers`, `entry -> service` | report p50/p95/max; no target until a phase claims it | Desktop marks | 9.71 s / 20.99 s |
| Sync `initPlugin` span | report max and count above 1000 ms; target after Phase 0 calibration | `v2 init sync gen=N` | 30.13 s sample, unreliable |
| `initPlugin` p95 | <= 2000 ms as a regression guard | host log | 1.45 s |
| `refresh stop` | parked probe released in < 150 ms; release during backoff <= 600 ms; zero abandoned; reload contract green | `v2 cleanup` info | 2 abandoned at 5000 ms |
| `plugin dispose` step | report only; no target (owner: `destroy` work + timer overshoot) | `v2 cleanup` info | p50 5.0 s, max 8.79 s |
| Dispose budget timeouts | count only; no target until measured | dispose budget log | 245 lines, no duration |
| Schema collections per generation | <= 1 after a successful collection; zero redundant refresh collections under a stable name set | `v2 schema` info | 2417 redundant collections |
| Dropped-handoff durability | `destroy` with a new drop calls `markDirty` once; counter survives a flush | `v2 save` info + `prove-dropped-persist` | no marker call |
| Second-generation ready | diagnostic only, no target until measured | `measure-generation-ready` | no baseline |
| Supersede retire wait | report ms per supersede; ceiling count only, no cap | `v2 retire` info | 0.8–3.3 s in 11 observed supersedes |
| Module reuse | diagnostic only; feeds the Phase 4 gate | `v2 module eval pid=` | unmeasured |
| N2 first output | report only; model-dominated, no plugin target | `n2-auto.jsonl` | p50 30.75 s from module start |
| N4 state validation failures | 0 | validation log | 0 |
| `prove-e38` / `prove-b01` | green | proofs | green |
| Feature regressions | none (F6 regen, roster repair, continuity, handoffs, state durability) | proofs | none |

## 5. Out of scope (explicit)

- Global-only install (C1).
- Watcher policy or `TAWASSUL_WATCHER` changes (C2).
- New tools or tool-surface changes (C3).
- Sidecar/shared daemon (not supported by the plugin API).
- Any change that trades one feature for another (AGENTS.md rule 5).
- Roster snapshot hydration (private per-instance fields, no seed API).
- Model or agent latency. The first-output p50 of 30.75 s is dominated by the model.
- Removing a final state write without a labelled redundant write.
- A retirement cap with no firing ceiling.
- Cross-generation dedupe inflation of `_countedDroppedHandoffs` (the dedupe set is per
  instance; fixing it needs a persisted dedupe set, a new mechanism).
- A plugin-free baseline beyond the Phase 0 control arm.

## 6. Decisions (resolved)

| ID | Decision | Rationale |
| --- | --- | --- |
| D1 | Phase 1 guard is `initialSchemasCollected` plus the name-set hash, set only after a successful collection; drift under stable names drops the phase | A full-fingerprint pre-check requires collecting first; the name set is static per generation, so the collected flag is the real discriminator |
| D2 | Phase 2 ships the conditional dirty marker only; no skip guard | The save pairs are not proven redundant, `!saveDirty` is not an audited invariant, and the marker closes only the lock-loss silent skip; durability outranks an unmeasured background gain |
| D3 | Phase 3 uses the release deferred; no abort signal into `ensureReady`, no phase accessor, no runtime race | `stopProbe()` + unchanged `stop()` satisfies `prove-e38`; a 150 ms runtime race would break the reload contract; the retirement path does not wait for init |
| D4 | Phase 4 defaults to drop; it lands only if reuse = true, one module evaluation serves >= 3 generations, and the lookup costs less than 6.1–7.3 ms | A module-level cache is worthless if the host re-imports per generation; ">= 50 generations per process" is unsupported by the measured chains |
| D5 | Phase 5 owns the retire telemetry and adds no cap; its own proof is red-first | The 8 s ceiling fired in none of 11 observed supersedes; a cap is unproven on the state path |
| D6 | Phase 6 defaults to drop; it lands only with a material delta in the plugin-free control and explicit approval of the async `createHooks` surface | Plugin total exceeds visible p50, so any visible saving is bounded by the unknown overlap; no host-side overlap instrument exists, so the control is the gate |
| D7 | Phase 7 changes only awaits measured above 50 ms by the Phase 0 timers; the reconcile and `ensureBaseAgentFiles` halves are withdrawn | `reconcile()` is already `void`, and `ensureBaseAgentFiles` is already inside a detached block |

## 7. Evidence appendix

- Measurement script: `scripts/measure-boot-sessions.ts`
  (`npm run measure:boot-sessions`). Read-only; parses Desktop, host, plugin, and n2 logs and
  queries the live sidecar with GET requests.
- Isolated probes: `/tmp/opencode/boot-profile.ts`, `parallel-boot.ts`, `warm-boot.ts`,
  `idempotence.ts`, `cleanup-profile.ts` (measurement only, outside the tree; `RULES.md`
  allows `/tmp/opencode` cleanup, so out-of-tree receipts are transient).
- Real logs: `${XDG_DATA_HOME}/opencode/log/opencode.log`,
  `${XDG_DATA_HOME}/tawassul-v2/tawassul/tawassul.log`,
  `${XDG_DATA_HOME}/tawassul-v2/n2-auto.jsonl`,
  `~/.config/ai.opencode.desktop/logs/*/main.log`.
- Fresh log evidence: `initPlugin` n=4744 p50 11.2 ms / p95 1.45 s / max 30.13 s; roster
  n=594 p50 26 ms / p95 853 ms / max 16.9 s; 22 dispose steps at the 5000 ms bound in 7 days;
  245 `dispose exceeded`; 2417 `schemas unchanged` vs 1204 `refreshed`; 7 overlapping
  disposals on 2026-11-21 08:21.
- Fresh attribution: `collectToolSchemas` 8.2–8.6 ms then 6.1–7.3 ms, 44 tools, identical
  fingerprint; `refresh stop` 1005 ms at 0 ms cleanup delay, 346 ms at 800 ms, 1 ms at
  1500 ms; cleanup total 799 ms with dispose 793 ms and refresh stop 1 ms when init is ready.
- Key code locations: `src/v2/setup.ts:56` and `:609-643` (cleanup bound), `:387-394`
  (`V2SetupDeps`), `:542` (`teardownTimeoutMs` default), `:655`/`:660` (awaited setup work),
  `:690` (`refreshSchemas`), `:692` (initial collection), `:695` (collection catch, unreachable
  for the static map), `:716` and `:761` (refresh invocations), `:729` (`nameSetHash`),
  `:740` (`registeredSchemaFingerprint`), `:741-743` (registration failure), `:757-770`
  (`refreshStop`), `:997` (`runCleanup`), `:1000` (refresh stop step);
  `src/v2/schema-refresh.ts:17-20` (handle), `:42` (`probe`), `:44` (`refresh`), `:53`
  (`reload`), `:68` (backoff sleep), `:74-77` (`stop`); `src/v2/adapters.ts:12-28`
  (`collectToolSchemas`, per-tool catch at `:18-24`);
  `src/bootstrap/plugin-init.ts:486` (synchronous `initPlugin`, `deps` seam), `:497`/`:1089`
  (`perfReset`), `:535-538` (`TAWASSUL_DISABLED`), `:541-543` (directory-keyed supersede),
  `:700` (`repairProjectConfigBoot`, fire-and-forget), `:734` (`initTimeoutMs`), `:739`
  (`initPromise`), `:741` (8 s race), `:758` (detached `void async` block), `:769`
  (`ensureBaseAgentFiles`), `:770-771` (F6 no-op), `:975` (`bundleFingerprint`), `:1007-1008`
  (aborted check), `:1004-1032` (`ensureReady`), `:1121` (abort before dispose),
  `:1147` (dispose awaits ready, returns immediately when aborted);
  `src/services/lifecycle-controller.ts:130-312` (`destroy`), `:145` (`detectDroppedHandoffs`),
  `:150` (`flushSaves`), `:155` (`drainStructuralAnalyses`), `:210` (`flushAllPersists`),
  `:214` (`markDisposing`), `:258` (`sessionManager.cleanup`), `:311` (unwrapped `getSessionId`);
  `src/context/managers/RatingManager.ts:109-112` (`recordHandoffDropped`), `:264`
  (`_countedDroppedHandoffs`), `:266-274` (`detectDroppedHandoffs`);
  `src/services/state-persistence.ts:618` (`saveFailureCount`), `:627` (`LOCK_ATTEMPTS = 10`),
  `:661` and `:854` (`markDirty` callers), `:673-676` (`markDirty`), `:765-804` (`flushSaves`),
  `:785` (unconditional write), `:792` (rethrow), `:794-800` (retry loop, deadline checked only
  at `:796`), `:853-856` (in-flight save marks dirty and returns), `:864`/`:984`
  (`STATE_SAVING`/`STATE_SAVED`), `:878-884` (lock backoff), `:885-889` (lock-loss silent
  return), `:982` (`saveDirty` after save), `:1001` (deferred save in `doSave`'s `finally`);
  `src/services/handoff-service.ts:408` (direct `saveState` in `resume()`, unrelated to the
  flush); `src/services/persist-utils.ts:20-33` (`schedulePersist`), `:45-56`
  (`flushAllPersists`); `src/hooks/dispose.ts:6`, `:31`, `:47-49` (dispose budget);
  `src/utils/perf.ts:1` (module-global marks); `src/utils/opencode-config.ts:327-334`
  (`ensureBaseAgentFiles`); `src/utils/bundle-fingerprint.ts:15-18`;
  `src/services/usage-ledger.ts:354-366` (`start` awaits `load`; `reconcile` is `void` at
  `:363`); `src/index.ts:2-5` (static imports and `createHooks`), `:9` (`createV2Setup`);
  `scripts/prove-e38.ts:131-140` (direct stop), `:256-266` (cleanup ordering, gate held
  50 ms); `scripts/prove-proof-catalog.ts:70` (`PINNED_PROOF_FILES`), `:262`
  (`PINNED_PROOF_STEPS`), `:268-292` (file, owner, and step assertions);
  `scripts/release/check-release.ts:85-124` (AGENTS.md, `docs/validation.md`, release notes,
  pinned files and steps).
- Test-only seam: `V2SetupDeps.collectSchemas` (new) for Phase 1's `prove-schema-reuse`; default
  is the real `collectToolSchemas`. `markDirty` is a production visibility change, not a seam:
  `LifecycleController` is a different class and must call it.

## 8. Findings ledger (six reviews of revisions 3 and 5)

| ID | Finding | Source | Disposition |
| --- | --- | --- | --- |
| F1 | Phase 2 unconditional marker defeats its own guard; phase is a no-op | mimo, deepseek, hy4, beam-free, pickle | F41/D2: guard withdrawn, marker conditional |
| F2 | `prove-state-save-once` is green before the phase; clean destroy already saves once | mimo, pickle, beam-free | Replaced by `prove-dropped-persist` (red today) |
| F3 | 150 ms whole-stop race passes `prove-e38` as timed (gate held 50 ms) | mimo, deepseek, hy4, pickle | Phase 3: proof holds 400 ms, asserts at 300 ms |
| F4 | `stopProbe()` has no release mechanism; `ensureReady` cannot be aborted | gemini, hy4, beam-free, pickle | Phase 3: release deferred + `stopProbe` |
| F5 | `disposeInstance` also awaits `ensureReady`, so the setup probe release is partial | pickle (rev 3) | **Retracted**: `:1121` aborts before `:1147`; `ensureReady` returns at `:1007-1008` |
| F6 | 30.13 s `initPlugin` is not `initTimeoutMs` | mimo, deepseek, hy4, beam-free, pickle | 1.1, 1.4; Phase 0 per-generation sync span |
| F7 | Perf marks are module-global and corrupted across overlapping generations | hy4, pickle | 1.1; per-instance timer in Phase 0 |
| F8 | 8.79 s belongs to the 5000 ms step bound, not the 7500 ms budget | mimo, deepseek, pickle | 1.2 correction 1; metrics split |
| F9 | The step bound (5000) is smaller than the dispose budget (7500), so dispose can never report done past 5 s | deepseek | 1.2 correction 1 |
| F10 | Host-await claim is overstated; same-directory successor awaits `previousRetire` | mimo, deepseek, pickle | 1.2 correction 3; Phase 0 measurement |
| F11 | Phase 1 removable cost is 6.1–7.3 ms, not 6–9 ms | mimo, pickle | 1.5, Phase 1, 3.2 |
| F12 | `registeredSchemaFingerprint` is never empty; wrong reason given | mimo, pickle | Phase 1 |
| F13 | Full-fingerprint guard is impossible without collecting | deepseek | Phase 1, D1 |
| F14 | `flushSaves` ends at `:804`; `:807+` is `doSave` | mimo, pickle | 7 appendix |
| F15 | `initPromise` is declared at `:739`, not `:741` | mimo, pickle | 7 appendix |
| F16 | `since_init_ms` equals `ts - PROCESS_START_MS`; switching to it is a no-op | deepseek, hy4, beam-free, pickle | 1.7 limit 3; Phase 0 drops the change |
| F17 | Phase 4 roster skip needs hydration into private per-generation fields | mimo, deepseek, hy4, beam-free, pickle | Phase 4 descopes roster; 5 out of scope |
| F18 | `bundleFingerprint()` costs 3–8 ms and is called twice per generation | mimo, deepseek, hy4, pickle | Phase 4 memoization |
| F19 | `prove-module-reuse` cannot run in an isolated child and cannot be a catalog proof | mimo, deepseek | Phase 0: `measure-module-reuse` |
| F20 | `prove-generation-ready` is independent of Phase 4 (which does not touch `initPromise`) | mimo, pickle | Phase 0: diagnostic `measure-generation-ready` |
| F21 | Phase 6 visible saving is bounded by overlap; plugin total exceeds visible p50 | deepseek, hy4 | Phase 6 gate, default drop |
| F22 | `setup` runs at load, so "defer to first setup call" defers nothing | deepseek | 1.6, Phase 6 |
| F23 | Cleanup `done` is debug-only; save pairs are events only; metrics unobservable | mimo, deepseek, hy4, beam-free, pickle | 1.8; Phase 0 items 4–6 |
| F24 | `prove-schema-reuse` has no collector seam | mimo, deepseek | Phase 0: `V2SetupDeps.collectSchemas` |
| F25 | `prove-cleanup-bound(a)` is blocked until the Phase 3 API exists | hy4, beam-free | Phase 3 ships it; red via no-op stub |
| F26 | Script merges `done`/`abandoned`; limit 2 in 1.7 was premature | mimo, hy4, pickle | 1.7 limit 2; Phase 0 item 11 |
| F27 | "CPU is the only comparable unit" is unimplemented and overbroad | deepseek, pickle | 1.7 limit 5; Phase 0 adds `cpuUsage` |
| F28 | Desktop mark parsing drops slow boots past 8 KB / 4 KB | deepseek | 1.7 limit 6; Phase 0 item 11 |
| F29 | Control arm registers zero tools and may not produce a second generation | deepseek | Phase 0 control; first-generation marks only |
| F30 | Overlapping generations need a generation id for pairing | deepseek | Phase 0 item 1 |
| F31 | Phase 5 counts only the 8 s race; the 0.8–3.3 s retirement is the real quantity | deepseek | Phase 5 logs every supersede |
| F32 | Phase 7 targets the reconcile, not `usageLedger.start`/`warmWorkspace` | deepseek | Phase 7 targets both, gated at 50 ms |
| F33 | Phase 7 ordering ("write before the key") is not enforceable | beam-free | Withdrawn: no config-mtime key; Phase 7 does not touch the cache |
| F34 | Ordering 2/5 before 1 and 1 before 3 is not evidence-based | mimo, hy4, pickle | 2 order table (1 second, 5 after 3) |
| F35 | Phase 6 is blocked by the static `createHooks`, not by Bun | mimo, deepseek | 1.6, Phase 6 |
| F36 | `dist/index.js` already has dynamic imports, refuting "Bun unimplementable" | gemini claim, refuted by mimo/deepseek | 1.6 |
| F37 | Phase 4 cache key omits deleted-roster state | pickle | Moot: roster out of scope |
| F38 | `ensureBaseAgentFiles` runs before the F6 no-op | mimo, beam-free | Phase 7, gated at 20 ms |
| F39 | Import figures were ambiguous (per copy vs sum) | deepseek | 1.1 note |
| F40 | The 1204 "refreshed" are late-init or registration-failure, not post-failure recovery | deepseek | 1.5 |
| F41 | The two save pairs are not proven redundant: an in-flight save marks dirty and returns, and `flushAllPersists` runs after the flush | rev 5 audit (`state-persistence.ts:853-856`, `lifecycle-controller.ts:210`) | D2: guard withdrawn; Phase 0 labels each write |
| F42 | A skip guard on `!saveDirty` has no audited invariant; `markDirty` is called from `saveState` and from the in-flight branch | rev 5 audit (`state-persistence.ts:661`, `:854`) | D2: no guard; fallback rule recorded |
| F43 | An API-dependent proof cannot be red before its phase | rev 5 audit (F25) | Phase 0 rule 5: no-op stub |
| F44 | N2 is model-dominated and cannot carry a plugin target | rev 5 audit (`n2-auto.ts:70`) | 4: report only |
| F45 | The Phase 3 phase accessor and per-step bound are unnecessary | rev 5 audit (`setup.ts:770`, `schema-refresh.ts:74-77`) | D3: `stopProbe` + unchanged `stop` |
| F46 | Phases 4 and 6 cannot be decided without a gate | rev 5 audit | D4: numeric gate; D6: control + approval |
| F47 | The "one save per destroyed generation" target contradicted the unlabelled cause | rev 5 audit | Phase 2 retitled; no save claim |
| F48 | Phase 0 shipped two red `prove-*` proofs; the catalog runs every proof file, so Phase 0 could not end green | mimo, deepseek, hy4, beam-free, pickle | Proofs moved to Phase 1 and Phase 2 |
| F49 | Rule 1 omitted `PINNED_PROOF_FILES` and the release pins | deepseek, hy4, pickle | Phase 0 rule 1 covers both catalog arrays and `check-release.ts:85-124` |
| F50 | Phase 2's Effect was false for a thrown write (`:792` rethrows before the retry loop) | mimo, deepseek, hy4, beam-free, pickle | Effect scoped to the lock-loss silent skip |
| F51 | The marker can add ~2.8 s to `destroy` on lock loss | hy4, pickle | Cost stated; only on lock loss |
| F52 | `markDirty` is also called at `:854` | mimo, deepseek, pickle | D2 citation corrected |
| F53 | `flushAllPersists` never drives `saveState` | mimo, deepseek, hy4, pickle | §1.2 and §3.1 corrected |
| F54 | The `destroy` fake context needs `:311`, `:214`, and `:28` | mimo, deepseek, pickle | Phase 2 proof spec corrected |
| F55 | Phase 3's "residual init wait" is false | mimo, deepseek, hy4, beam-free, pickle | F5 retracted; Phase 3 corrected |
| F56 | Phase 1 flags set after registration skip the late-init collection | deepseek, hy4, beam-free, pickle | Flags set only after a successful collection |
| F57 | Phase 5 duplicated Phase 0 item 8 and had no proof | deepseek, hy4, beam-free, pickle | Item 8 moved to Phase 5; `prove-retire-telemetry` added |
| F58 | Phase 7 targeted the already-void reconcile; `ensureBaseAgentFiles` is already detached | mimo, deepseek, hy4, beam-free, pickle | Both halves withdrawn; the target is `load()` |
| F59 | `collectToolSchemas` cannot reject; the 1204 are late-init or registration-failure | mimo, deepseek, beam-free, pickle | §1.5 corrected |
| F60 | "Zero cleanup steps above 5500 ms" is unreachable | mimo, deepseek, hy4, pickle | Replaced: refresh-stop target plus dispose report-only |
| F61 | D4 gate ">= 50 generations per process" contradicts the measured chains | pickle | Re-based to >= 3 per module evaluation |
| F62 | D4/D6/D7 gates lacked instruments | mimo, deepseek, hy4, pickle | Module-eval marker, pid, per-await timers; D6 uses the control |
| F63 | "No shared files with 2/3" is false | mimo, deepseek, pickle | Order table corrected |
| F64 | The paired control was contaminated (`TAWASSUL_DISABLED` still runs `setup`) | pickle | Plugin-free arm required |
| F65 | `stop()` during the backoff sleep is bounded by `delayMs`, not 150 ms | pickle | Proof part 3 added |
| F66 | Phase 4's config-mtime key would miss on every churned generation | pickle | Config mtime removed from the key |
