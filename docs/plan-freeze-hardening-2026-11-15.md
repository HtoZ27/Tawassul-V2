# Tawassul V2 — Host Freeze Hardening Plan (2026-11-15)

Status: revision 5.16; the deepseek gates are done (final evaluation READY,
implementation APPROVED FOR IMPLEMENTATION on 5.15), and revision 5.16 records
the isolated experiments that settle several premises: the node and bun
cache-busts are proven, the shared-instance premise behind F10 is proven, A1's
filesystem rules and A2.7's identity guard are validated, and the reload trade is
sharpened to "first replace fires, later ones may not". Round history is in the
review record. Implementation waits on the four rule-5 trades, which stay gated
on explicit owner authorization — trade 1 (the guard window) blocks part of
change A. No production code has been changed for this plan.
Owner: user (approval), dev (implementation), analyst panel (review).
Scope: remove the proven enablers of the multi-minute host freeze, bound the
host calls that run before tool registration, and harden teardown. The 44-tool
surface, the live-entry build contract, and the single-copy ownership rule stay
unchanged. Owner rule (2026-11-16): no deletion of a complete feature and no
change that breaks one, including surface that is currently dead such as
`SessionBridge.get` and `SessionBridge.list`; every addition must have a named
production or proof consumer. This plan deletes no implemented feature. The
trailing drain was a proposed pattern, never code, and is not a deletion.

Review record: six analysts reviewed revision 1 independently
(`analyst-gemini`, `analyst-pickle`, `analyst-minimax`, `analyst-deepseek`,
`analyst-glm-5.3-flash-free`, `analyst-mimo`). Verdicts: one SAFE, five
NOT SAFE. Revision 2 applied their corrections. A second round of six reviews
then produced one SAFE (gemini) and five NOT SAFE (pickle, minimax, deepseek,
glm, mimo). This revision answers every round-2 blocker by splitting the work
into change A (freeze fix) and change B (teardown hardening), and by moving the
identity-scoped ledger, shadow, and bridge disposal into change A. A third round
against revision 3 produced three SAFE (gemini, minimax, glm) and three NOT SAFE
(pickle, deepseek, mimo); every blocking item was applied as text. Revision 4
applies the owner rule of 2026-11-16: no deletion of complete surface, no
addition without a named consumer, and no wiring that exists only to close a
proof gap. It removes the proposed live-sync switch, which had no CI consumer
and was not needed for the fix, and the proposed `whenReconciled()` method; the
proofs await the existing single-flight `reconcile()` promise instead.
`SessionBridge.get` and `SessionBridge.list` stay untouched. The first round-4
pass gave each analyst a narrowed focus, so its verdicts are not the final
record; its corrections (the fail-open catch, the disposed page race, the timer
clear, the exact proof order, the portable byte comparison, and the symlink
order) remain in the text; the turn guard was removed after review as a no-op. The panel restarted on revision 4.4
with one identical whole-plan prompt, in the same order: gemini SAFE; pickle
NOT SAFE, and its two blockers (dispose could reject before the final flush;
the guard-window trade lacked explicit owner authorization) plus its major and
minor text corrections were applied as revision 4.5. Minimax returned NOT SAFE;
its reload-turn blocker (`absorb()` must max the turn), the hard rule-5
authorization gate, and its major and minor corrections were applied as
revision 4.6. Deepseek returned NOT SAFE; its two blockers (every cleanup step
bounded; B4 named as an extension of `prove-boot-budget.ts`) and its majors and
minors were applied as revision 4.7, including removal of the no-op turn guard
as a rule-4 scope reduction. Glm returned NOT SAFE; its dispose-promise blocker
(two promises: `disposedSignal` for the page race and `disposeCompletion` for a
second dispose), the ask-permission rule-5 gate, and its other text corrections
were applied as revision 4.8. Mimo's 4.8 review was cancelled before a verdict.
Revision 5.0 applies the final self-audit fixes (dispose completion on flush
failure, `ensureLineage`'s second await, and the `start()`/absorb observation
channels) and starts a fresh six-agent full-plan round in the fixed order
gemini → pickle → minimax → deepseek → glm → mimo. On 5.0, gemini returned
SAFE; pickle returned NOT SAFE and its corrections were applied as revision
5.1: the B4 assertion now matches the real `claimCoexistence` contract (same
pid, scope, and token increments refs and registers again), the
identity-scoped ledger clear gets a non-vacuous case, F5 and the
pre-registration call table include the two already-bounded probes, the page
bound is stated as conditional and its abandoned request as still running, the
bounded teardown is gated as the third rule-5 trade, and "next reconcile" is
corrected to the next event or reload. Minimax returned NOT SAFE; its blocker
(`warmWorkspace` must not abort the setup signal that feeds the event relay),
its pass-identity and timeout-ordering correction, the pre-cleanup claim
assertion, the `finally` release of the in-flight handle, temp-file mode and
uniqueness, and its minor corrections were applied as revision 5.2. Deepseek
returned NOT SAFE; its blocker (B2's `warmWorkspace` abandonment loses
`warmInjection` and is an ungated trade) removed that step, and its corrections
on `flush()` (it cannot reject), `disposeCompletion`'s synchronous creation,
the `continue` past `unobservedRows`, the `ensureLineage` depth re-check, the
deferred two-page fake, an executed `cmp` negative control, the B4 claim
ordering and token derivation, the proof citations, and the overstated
`plugin.dispose` risk were applied as revision 5.3. Glm returned SAFE on 5.3 and
its three text minors (the F14 forward-order wording, the missing-entry mode
derived from `dist/index.js`, and the equal-priority cross-process yield in B4)
were applied as revision 5.4. Mimo returned NOT SAFE on 5.4; its three blockers
(the B4 release rationale, which now rests on refs 2 minus one release from
`cleanup()`; the unnamed B3 zero-tool proof, now pinned to
`prove-setup-budget.ts`; and the comparator exit code, now 1 for `cmp` and 3
only in the smoke wrapper) and its minors (the `disposedSignal` creation site,
the relay entry removed from `registered`, the `prove-bundle-freshness.ts:28`
and `setup.ts:601` citations, the vestigial empty-hash clause, and the
change-B scope sentence) were applied as revision 5.5. The round ended with two
SAFE (gemini, glm) and four NOT SAFE whose corrections were all applied.
Revision 5.6 is the owner-ordered self-audit before the next round: the
ecosystem row no longer claims an opt-in skip, the missing-entry mode is derived
from `dist/index.js` and umask-masked without asserting `copyFileSync`
internals, `disposedSignal`'s creation site is stated exactly, B4's refs
argument is marked explanatory rather than asserted, the reconcile-log risk
names the start site instead of the log, and A3 gains a setup-level control in
`prove-boot-budget.ts` (no new file, no new step) that a never-settling
`session.list` does not delay registration and that cleanup ends the parked
pass. A new sequential six-agent full-plan round started on 5.6. Gemini returned
SAFE. Pickle returned NOT SAFE: its blocker was that F10, F14, and A2.7 stated
the cross-instance kill unconditionally, while a content-changing reload
re-imports the module (`source.node.js:53-54`, `source.bun.js:23,74`) and the
pointers are module-level `let`s (`usage-ledger.ts:923`), so the kill is
reachable only when the host reuses the module instance (unchanged entry
digests, `source.js:12-16,34`); the premise is now stated for that path alone
and the guard stays in A because that path exists on unchanged-bytes reloads.
Its majors narrowed the smoke claim to the executed snippet plus the pinned
line and pinned B4's shared scope explicitly; its minors fixed the citation
drift (`:510`→`:517`, `:549`→`:556`, `:556-557`→`:559`), the `:916-941` range,
the boot-budget fixture (`session.list` and console capture), and the
`validation.md:86`/`:88` marker wording. Minimax returned SAFE on 5.7 with one
evidence correction and five minors, all applied as 5.8: the bun lane's
cache-bust is marked unverified instead of proven (`source.bun.js:23,74`), the
cache-hit trigger is labelled inferred from the retire map rather than proven,
A2.7's justification now rests on the guard being behaviour-independent rather
than on an unreachable post-A1 path, a stale temp file retries with the next
counter on `EEXIST`, rollout restarts the host after a content-changing build
and the risk section records that A1 cannot force a reload, and rollout step 0
now gates only the three then-recorded trades, not A1 or A2.7. Deepseek then
returned NOT SAFE on 5.8: A1's "still triggers the reload" contradicted its own
unverified-watcher statement, so the reload trigger is now the fourth rule-5
trade (atomic replace versus build-triggered hot reload); F5 marks the signal
carriage conditional instead of asserted; B3 derives failure from the catch, not
the hoisted count; the temp cleanup is scoped to the name this call created; the
`host-refresh.sh` citations name the sha path first and the mtime check as its
fallback; the ask order is described as preserved rather than changed; and B3's
"no new file" is corrected. Applied as revision 5.9. Glm returned SAFE on 5.9
with no blocker and only wording and not-checked notes; its one actionable
minor is applied as 5.10: B4 no longer says the proof would "have to
reconstruct" the claim token, because the token is that module's own URL
(`plugin-init.ts:559`) and is recomputable from the import. Glm's remaining
notes are items it did not open this pass (`doctor-v2.sh:382-384`,
`prove-e38.ts:261,265`, `prove-bundle-freshness.ts`, `prove-global-install.ts`),
all of which the plan already hedges. The glm seat was also re-run and returned
SAFE again on 5.9 with two further minors, applied as 5.11: B3 no longer
contradicts itself over which proof asserts the failure cases, and the hoisted
tool count must leave `[tawassul] v2 registered <n> tools name-set` printing
today's count (`setup.ts:614-619`), with that pinned in the acceptance. Mimo was
stopped by owner order before it produced a verdict, so the closing review of
5.11 answers its seat: the counts, the catalog insertion points, the shard
sums, and the gate ordering were re-derived from disk here rather than taken
from any prior verdict. Revision 5.12 applies one repair found by the closing
pass: B1's explicit cleanup sequence put the relay wait ahead of `refreshStop()`,
which reversed today's order without a stated reason and let a schema refresh
run during the relay wait; the refresh stop now stays first, after the abort.
Pickle returned SAFE on 5.12 with no blocker and one minor, applied as 5.13:
B1 now states that the abort and the refresh stop are the only steps before the
relay bound, and that the tool disposer and every other registered step wait
until the relay settles or its bound expires, with the same sentence added to
the acceptance. Deepseek returned NOT SAFE on 5.13 with one blocker and four
minors, applied as 5.14: the blocker is that `disposed = true` is assigned only
inside the registered relay disposer (`setup.ts:846-849`), which the explicit
tail removes, so B1 now aborts and sets `disposed` in the same first step and
the acceptance pins that an event delivered after the abort is dropped; the
majors and minors reworded the acceptance and the `prove-dispose-bounded.ts`
controls from "a disposer before the relay" to an abandoned refresh stop plus a
disposer abandoned after the relay bound, stated why the bridge clear moves
from `registered[0]` to the tail, corrected the page-race wording so the
`.catch` observer is not claimed to forward the error to the fail-open catch,
fixed the `setup.ts:515-528` and `prove-v2-independence.ts:112-115` citations,
and made `host:refresh -- --restart` the named fallback in rollout step 2. The
plan is now at revision 5.15; deepseek's final evaluation returned NOT READY on
5.14 with one blocker and four minors, three of them applied as 5.15: the
leaky total bound now includes each identity-scoped clear, because the ledger
clear awaits `dispose()` (`usage-ledger.ts:912-920`) and then the `flush()`
chain (`:862-876`); the incident line no longer says the new `setup()` never
reached its success log (it reached it 46 ms after the eviction); the prior-art
row says the bounded race is the real stop; and the health line's four fields
plus the 10 s registration watchdog now each have a `prove-setup-budget.ts`
control. The one minor not applied is the "corrupted"
`promise/registration.d.ts` citation: the file text is correct and only the tool
output masks that path, so no edit was made. Deepseek then returned READY on
5.15 and, at the owner's order, APPROVED FOR IMPLEMENTATION on the same
revision, naming three residual risks (an abandoned page keeps running and may
hold the host lock; A1 cannot force a reload; a session missing from `load()`
and its page has no snapshot for up to 50 s, and an abandoned flush keeps its
rows buffered) and restating that trade 1 blocks change A. Owner authorization
of change A and the four rule-5 trades is still outstanding.

## Isolated experiments (2026-11-16)

Run in `/tmp/opencode/exp-freeze` on Node 26.13.0 and Bun 1.3.14, outside this
repository; no repo file was touched. Each one settles a premise the plan had
marked proven, inferred, or unverified.

| # | Setup | Result | Effect on the plan |
| --- | --- | --- | --- |
| E1 | `syncLiveEntry` reimplemented in a temp dir: identical bytes, changed bytes, stale temp, symlink, dangling link, missing source | 15/15: identical bytes leave inode and mtime untouched; a change renames and changes the inode; mode 755 survives; a stale temp is skipped through the `EEXIST` retry; a symlink keeps the link and replaces its target; a dangling link throws and its target is never created; missing source throws. A naive version replaced the dangling link itself, so the hard-error rule is load-bearing. | A1 mechanics confirmed; the dangling-link rule is required, not decorative |
| E2 | `fs.watch` on the entry file, then one rename-over | one burst of events at the replace; writes to the new inode are silent; a directory watch fires on the rename; re-arming the path resumes events | the first atomic replace still wakes a file watcher |
| E7 | three consecutive rename-overs on one watch, no re-arm | events only for the first replace; the next two are invisible | trade 4 sharpened: the first content-changing build can still reload; later ones need a re-arm or a restart |
| E3 | Node ESM import with `?__opencode_reload=N` | every query re-evaluates; the bare URL stays cached | the node-lane cache-bust is confirmed |
| E4 | Bun 1.3.14: `delete require.cache[path]` then re-import, in both path and `file://` form | re-evaluates every time (1→2→3→4) | the bun lane is no longer unverified: it busts the cache |
| E5 | `createPluginSources` driven three times on one entry, then once after editing it | a cache hit returns the same module object, does not re-evaluate, and shares module-level state; a changed entry yields a fresh module | the shared-instance premise behind F10 is proven; whether the host re-runs `setup` on a cache hit is still host-side |
| E6 | two module generations, identity-scoped clear against unconditional clear | the old generation's identity clear leaves the new pointer intact; the unconditional clear kills it | A2.7 confirmed, and today's cross-instance kill reproduced |

Not settled by experiment: whether the host re-arms its watch after an event,
whether the host re-runs `setup` on a cache hit, the 50 s guard window, the 2 s
ask bound, the bounded teardown, and the native Windows rename lane.

Non-goals: no v1/v2 dual export, no new adapter layer, no global reinstall, no
ledger format change, no setup refactor, no new dependency, no same-token
dedupe change.

---

## 1. Incident record

All times UTC. Local time is UTC+1.

| Time | Event |
| --- | --- |
| 14:32:40 | `npm run verify` starts (`gate:fast` then `bun build-v2.mjs`). |
| 14:33:03 | `GATE PASS: fast (16 step(s), 22699ms)`; the build rewrites the live entry. |
| 14:33:14.374 | Last provider stream observed. |
| 14:33:14.495 | Host logs `loading plugin`. |
| 14:33:14.495 → 15:26:13.797 | Silence. The host process is unresponsive; the UI is force-killed. |
| 15:26:13.797 | Host logs `location services evicted directory=/tmp/opencode/probe`. |
| 15:26:13.843 | Host logs `v2 registered 44 tools` (46 ms after the eviction). |
| 15:26:16.342 | The shell job that was blocked for the whole window returns. |

Proven trigger: the build rewrote `.opencode/plugins/tawassul.js` and the host
reloaded the plugin. The new `setup()` logged nothing for the whole window and
reached `v2 registered 44 tools` only at `15:26:13.843`, 46 ms after the
location eviction, so the block sat in the pre-registration calls rather than in
registration itself.

Proven reload amplifier, not the measured cause of the 46-minute stall:
`build-v2.mjs:132` copies the bundle with a non-atomic
`copyFileSync` into the live entry, and both `npm run verify`
(`gate:fast && bun build-v2.mjs`) and `npm run ci` reach it
(`scripts/prove-bundle-freshness.ts:28`, `scripts/prove-global-install.ts:326`,
plus the smoke-stage build in `scripts/gate-manifest.json`).

Measured exclusions: 156 sessions; no context-pack `index.json`, so
`warmWorkspace` warms zero entries; `usage-ledger.jsonl` is capped at 32 MB per
file; file locks are single-attempt. None of these explains a 46-minute stall.

Binding constraint: `v2 registered` is `src/v2/setup.ts:619`. Everything the
host executes before it is one of eight calls, two of them already bounded:

| Line | Call | Domain | Can carry a signal? |
| --- | --- | --- | --- |
| 518 | `await rosterProbe(2000)` (roster prewarm) | config read | n/a; already bounded at 2 s |
| 547 | `await usageLedger.start()` → `ctx.session.list` | session RPC | conditional: the installed client's `SessionListOperation` takes one argument, so the request options are not threaded; the bounded race is the enforcement |
| 552 | `await warmWorkspace(...)` | local disk | n/a |
| 571 | `await registerAskPermission(ctx)` → `ctx.permission.hook` | permission | no |
| 573 | `await registerPilotSkills(ctx)` → `ctx.skill.transform` | skill | no |
| 575 | `await registerPilotCommand(ctx)` → `ctx.command.transform` | command | no |
| 601 | `await Promise.race([readyProbe(), …])` bounded by `INITIAL_SCHEMA_WAIT_MS` | local state | n/a; already bounded at 750 ms |
| 613 | `await ctx.tool.transform(...)` | tool | no |

`Transform` is `(callback) => Promise<Registration>` with no options
(`node_modules/@opencode/plugin/dist/promise/registration.d.ts:12`), so lines
571, 573, 575, and 613 cannot be cancelled; they can only be bounded by
abandonment, which for 613 leaks the registration handle and yields zero tools.
The blocked await is one of the unbounded calls. `warmWorkspace` is a no-op in this
workspace and is not a suspect.

---

## 2. Findings

Confidence is about the link to the 14:33 stall, not about whether the defect
exists in the code.

| # | Finding | Evidence | Confidence |
| --- | --- | --- | --- |
| F1 | The previous plugin instance is retired behind an 8 s race, so a stuck old dispose cannot block the new init forever. | `src/bootstrap/plugin-init.ts:546-550, 741` | proven mitigation; keep |
| F2 | The event relay can only stop on the next event. `disposed = true` is set, then `await relay`; the loop is parked inside `next()` with no signal and no `iterator.return()`. | `src/v2/setup.ts:809-849`; the installed client aborts and closes on `signal` (`node_modules/@opencode/plugin/dist/promise/adapter.js:18-40`) | proven defect; medium as a reload-stall cause |
| F3 | Cleanup awaits every disposer in forward registration order, so the relay (registered at `:846`, before the identity clears at `:858-859`) stops after the session bridge is cleared, and the ledger is cleared after it. | `src/v2/setup.ts:861-881` | proven ordering defect |
| F4 | A failed `ctx.tool.transform` is swallowed; the plugin then loads with zero tools and only a log line. | `src/v2/setup.ts:623-625` | proven |
| F5 | Six pre-registration calls have no time bound: `start()`/`session.list`, `warmWorkspace`, ask, skills, command, and `tool.transform`. The roster prewarm (2 s) and the schema ready probe (750 ms) are already bounded. | `src/v2/setup.ts:515-528, 547-575, 599-608, 613` | proven |
| F6 | `usageLedger.start()` runs `load()` then `reconcile()`, and `reconcile()` is the only session RPC on the init path: up to 10 pages of `ctx.session.list`, with no signal. | `src/services/usage-ledger.ts:342-355, 441-455`; our type drops the request options (`src/v2/types.ts:104`, `src/v2/setup.ts:539`, `src/services/usage-ledger.ts:121`) | high; prime suspect |
| F7 | The live entry is rewritten in place by every content-changing build, and the build proofs run builds. | `build-v2.mjs:132`; `scripts/prove-bundle-freshness.ts:28`; `scripts/prove-global-install.ts:326` | proven |
| F8 | The skip predicate cannot be the digest alone: `sourceDigest()` covers `src/**`, `build-v2.mjs`, and `package.json` only, so a lockfile or toolchain change leaves a stale live entry carrying the current digest. | `scripts/source-digest.ts:20-33`; `scripts/prove-bundle-freshness.ts:49-50` asserts the digest only | proven |
| F9 | The smoke stage builds once (`build` step), then `release-smoke` skips its own build, copies the repo live entry into its work directory, and boots the copy. The entry is gitignored, so on a fresh clone it exists only after that build; disabling live sync on the stage build would make smoke exit 3 or validate the previous bundle. | `scripts/gate-manifest.json:1407-1414, 1435-1436`; `scripts/release-smoke.sh:106-118`; `.gitignore:1` | proven |
| F10 | `installUsageLedger` replaces the active ledger and disposes the previous one fire-and-forget; `clearUsageLedger` disposes and `clearUsageShadow` clears whichever instance is global. An old instance's cleanup can kill the new instance's ledger, shadow, and bridge when the host reuses the module instance: the loader returns the cached module while the entry digests are unchanged (`node_modules/@opencode/plugin/dist/source.js:12-16,35`), and a cache hit returns the same module object, so module-level pointers are shared (`usage-ledger.ts:923`, `usage-shadow.ts:358`, `session-bridge.ts:26`; E5). On a content-changing reload the node lane busts the cache with `__opencode_reload` (`source.node.js:53-54`; E3) and Bun re-evaluates after `delete require.cache` (`source.bun.js:23,74`; E4). | `src/services/usage-ledger.ts:925-931`; `src/v2/session-bridge.ts:28,49`; `src/v2/setup.ts:858-859` | mechanism proven; host re-running `setup` on a cache hit inferred |
| F11 | `load()` parses up to two files of 32 MB each on the init path. It is the delta baseline, so it stays, but it is the heaviest local await left after change A. | `src/services/usage-ledger.ts:11, 357-377` | proven; measure, do not move |
| F12 | `start()` after `dispose()` resurrects a dead instance: `start()` checks only `started`, and `dispose()` never sets it. | `src/services/usage-ledger.ts:342-344, 912-919` | proven |
| F13 | `emitUsage` and `enqueue` have no disposed check; `scheduleFlush` refuses to flush after dispose, so a post-dispose row is counted and then dropped silently. | `src/services/usage-ledger.ts:564-620, 845-851`; contrast `recordInjection` at `:624` | proven |
| F14 | The cleanup order is forward, so when a reload reuses the module instance the old instance clears its session bridge first (`:536`), parks its relay after that (`:846`), and clears the shadow and ledger last (`:858-859`); those trailing clears then dispose the new instance's globals. | `src/v2/setup.ts:846-859`; `src/services/usage-ledger.ts:937-941` | ordering proven; reused-module trigger inferred (F10) |
| F15 | `reconcile()` has no completion handle, so moving it off the init path leaves the usage proofs unable to await the backfill. | `src/services/usage-ledger.ts:342-355`; `scripts/prove-usage-ledger.ts:251-266` | proven |

Withdrawn from earlier revisions: the claim that `processedMessages` is
unbounded (it is capped at 1024, `src/v2/setup.ts:51, 104-112`); the claim that
a failed `tool.transform` must be rethrown (the reference plugin only logs and
adds a health line, `oh-my-opencode-slim/src/v2/setup.ts:3048-3050,
4092-4103`); "each item touches one file"; "the digest comparison is exact";
"five seconds per step truncates the ledger flush" (`flush()` re-adds the batch
on failure, `usage-ledger.ts:868-875`, and `append()` writes unlocked when the
lock is busy, `:884-886`); "a whole-setup deadline can bound line 613" (it can
only abandon the registration).

---

## 3. Ecosystem review

Reviewed: `opencode-mem` 2.42.0, `opencode-plugin-otel` 2.1.0,
`oh-my-opencode-slim` 3.0.7, `oh-my-opencode` 5.1.71,
`opencode-tokenscope` 2.1.0, `opencode-force-input` 1.1.21. `context7` is an
MCP server and `awesome-opencode` is a list, so neither informs the plugin
lifecycle.

| Pattern | Source | Adopt? | Change |
| --- | --- | --- | --- |
| Fire-and-forget warmup behind a `Symbol.for` guard | `opencode-mem/src/index.ts:400-413` | yes | A |
| Single-flight (trailing drain not added: no production second caller) | `opencode-mem/src/index.ts:444-465` | partly | A |
| Event watcher aborted by signal, then awaited | `opencode-mem/src/v2/adapter.ts:210-238` | yes | B |
| Iterator `return()` with a bounded race as the real stop | `oh-my-opencode-slim/src/v2/setup.ts:4084-4089` | yes | B |
| Bounded stop for every step under one deadline | `oh-my-opencode-slim/src/v2/setup.ts:2327-2341`; `session-quiescence.ts:39-76` | yes | B |
| Essential versus optional registration; zero-registration health warning | `oh-my-opencode-slim/src/v2/setup.ts:3048-3050, 4092-4103` | yes | B |
| Process-wide init dedupe and refcount | `opencode-plugin-otel/src/state.ts:44-95` | partly present as S-038 | B, verify only |
| 5 s bound on self-owned network work | `opencode-plugin-otel/src/probe.ts:30-38` | yes | A |
| Heavy work inside tool execution, never in setup | `opencode-tokenscope/plugin/v2/tokenscope.ts:224-292` | already our shape | none |
| Honest v2 stub instead of a half adapter | `oh-my-openagent/.../opencode-v2/server-entry.ts` | no; we are native v2 | none |
| Immutable packaged artifact; no self-rewrite of a loaded entry | all of the above | partly: atomic replace, byte-equality skip | A |

Reference patterns deliberately not copied: slim's `withTimeout` leaks the
losing promise (`src/utils/session.ts:44-56`); mem's `await watcher` without a
bound is replaced by a bounded await.

v2 contract facts confirmed, no action required: `default` is `{id, setup}`;
no `tui` key on a server module; events carry `data` (our `dataOf` already
reads it, `src/v2/event-adapter.ts:87`); lifecycle is `session.execution.*`;
reduced hosts lack `agent.transform` and are capability-guarded. The duplicate
plugin ID rule confirms that the global install must stay removed.

---

## 4. Change A — remove the freeze (this commit)

Change A contains only what is needed to stop the proven trigger and the prime
suspect, plus the state guards those changes make reachable. It does not
restructure teardown and does not change registration semantics.

### A1 — Build writes the live entry atomically and only on a byte difference

Change:
1. Extract `syncLiveEntry(sourcePath, livePath, options)` into
   `scripts/live-entry-sync.ts`.
2. Read the final `dist/index.js` bytes after the SHA trailer is appended
   (`build-v2.mjs:126`) and the live entry bytes when it exists; a missing live
   entry that is not a symlink counts as a difference and is created. Byte
   equality is the only skip predicate. The `TAWASSUL_CONTENT_SHA` trailer is
   read for logging only, never for the decision. Byte equality includes the
   `TAWASSUL_SOURCE_SHA` trailer (`build-v2.mjs:112-126`), so a new commit
   rewrites the entry even when the source is unchanged; that is intended and
   the rewrite is atomic.
3. If the live path is a symlink, resolve `realpathSync` and replace the target
   in its own directory; the link is preserved. A dangling link is a hard
   error: it is not treated as a missing entry and its target is never created.
   E1 shows a naive implementation silently replaces the dangling link itself,
   so this rule is required rather than defensive.
   `build-v2.mjs:9` clears `dist/` and the build recreates `dist/index.js` before
   sync, so a link into `dist/` resolves again and the sync replaces the
   rebuilt target. This is a contingency path only: `doctor-v2.sh:382-384`
   fails a symlinked entry, so the production live entry stays a plain file.
4. On a difference, write `tawassul.js.<pid>.<counter>.tmp` beside the resolved
   target with an exclusive create, chmod it to the entry's existing mode when
   the entry exists, otherwise to the mode of `dist/index.js` from `statSync`
   masked by the process umask, falling back to `0o644` when that stat fails,
   fsync it,
   and `renameSync` it over the target. Never `copyFileSync` over the live
   file. Remove the temp file in `finally`, but only the name this call created:
   never a temp owned by another build. A stale temp left by a crashed build
   makes the exclusive create fail with `EEXIST`; retry with the next counter,
   bounded at a few attempts, instead of failing the build. The `.tmp` suffix
   cannot match a
   `*.js` plugin glob, and the unique suffix prevents two concurrent builds
   from sharing a temp name; whether the host also wakes on a directory change
   is unverified, so only the rename is claimed to touch the entry. The mode
   copy keeps the entry's readable plugin mode; rename alone would apply the
   temp file's default. No directory fsync is claimed: the rename is atomic,
   not durable across a power loss.
5. If `dist/index.js` is missing, throw with a clear message; never skip.
6. A failed `renameSync` (for example `EPERM`/`EBUSY` on Windows) retries once
   after 100 ms, then throws with the temp path removed. The Windows lane is
   not asserted live; the proof uses an injected failing-fs seam and prints
   `skipped`, never `ok`.
7. `release-smoke.sh` compares the repo live entry to `dist/index.js` with
   `cmp -s` after the build-or-skip branch and before copying, and exits 3 on
   any non-zero comparator result, including a difference, an unreadable file,
   or a missing `cmp`.
   The smoke stage boots only the exact artifact it validated, so a stale
   bundle cannot pass; `host-refresh.sh:272-274,299-301` independently fails
   when the live bundle differs from the logged entry, and its no-fingerprint
   fallback fails when the init predates the entry (`:276-277,303-304`).

Why: the digest does not cover the lockfile or the toolchain, so a digest-only
skip can ship a stale entry that still looks current. Byte equality is exact
and also covers artifacts produced by a different `bun` or dependency tree.
Atomic replacement removes the torn-read amplifier, and the byte skip removes
needless rewrites. A rewritten entry is not guaranteed to make the host reload:
the watcher is host-side, the first replace still emits watch events (E2), and a
second replace on the same un-re-armed watch is silent (E7), so a rename can
leave a file watch attached to the unlinked inode. A1 therefore removes the torn
read; it does not claim the reload, and rollout step 1 restarts the host rather
than relying on one. This is the fourth rule-5 trade: atomic replace versus
build-triggered hot reload. There is no skip switch: a stale live entry must fail smoke,
not pass behind an ambient flag.

Acceptance: identical bytes leave the live entry untouched (inode and mtime
unchanged); different bytes replace it with byte equality and a changed inode;
fsync completes before the rename; a stale entry carrying the current digest but
different bytes is replaced; missing `dist/index.js` fails loudly; no temp
residue; a symlink keeps the link and replaces the target; smoke refuses a live
entry that differs from `dist/index.js`.

### A2 — Reconcile leaves the init path, with a real signal

Change:
1. `UsageLedger.start()` awaits `load()` only. It launches
   `void this.reconcile().catch(...)` with today's fail-open warn
   (`usage-ledger.ts:350-354`), so a rejected backfill is logged and never
   becomes an unhandled rejection. `reconcile()` runs behind one in-flight
   promise. Production has one caller, `start()`; a proof that awaits the same
   promise is not a request for a second pass. Nothing queues a follow-up: the
   trailing drain from the reference plugin has no production caller here and
   is not added (rule 4).
2. Thread the request options through three places: `V2Session.list`
   (`src/v2/types.ts:104`), the adapter (`src/v2/setup.ts:539`), and
   `listSessions` (`src/services/usage-ledger.ts:121, 446`). Optional, so
   existing callers are unchanged.
   Verified at implementation: the installed client declares
   `SessionListOperation<E> = (input?: SessionListInput) => Effect<...>`, so
   there is no second argument to thread, and `prove-e37.ts` rejects an
   optional `signal` restated in the shim. The threading is therefore not
   applied; `ctx.session.list(input)` stays one-argument and the bounded race
   in step 3 is the whole enforcement.
3. Bound every page at `pageTimeoutMs` (default 5000, injectable in the ledger
   options beside `now` and `maxBytes`). On timeout, let the race end the
   page, log the page count and duration at warn, and end the pass by resolving: timeout is
   not a rejection. The race is the bound. Race the
   original page promise; attach `.catch(() => {})`
   to that same promise as a second observer before racing, so a page rejection
   (for example one the host raises on its own) cannot become an unhandled rejection.
   The observer does not forward the error: when the page rejects first, the
   race rejects and `reconcile()`'s fail-open catch logs it; when
   `pageTimeoutMs` or the dispose signal wins, the observer swallows the late
   rejection and the timeout branch logs the warn. Clear the timer in `finally`
   and call `unref()` on it, matching `usage-ledger.ts:858`. Check `disposed`
   immediately after the race before using the page result.
4. `disposedSignal` is created once at construction, before any method can run,
   so a page race can attach to it before any dispose; `dispose()` sets
   `disposed` first, then settles `disposedSignal` synchronously. The loop checks `disposed` before each page and before each
   emit, and the per-page race includes `disposedSignal` beside
   `pageTimeoutMs`, so a parked page ends on dispose instead of waiting for the
   timeout. The race loser is caught synchronously. `dispose()` then awaits the
   unparked pass inside `try`/`catch`: the page can still
   reject as the race winner, and that rejection must not skip the final
   flush. `flush()` runs in `finally`. `flush()` cannot reject: an append
   failure re-buffers the batch and logs (`usage-ledger.ts:871-875`), so
   `disposeCompletion` always resolves after the flush attempt and no no-op
   observer is needed; a failed final append is logged and its rows stay in the
   buffer. `disposeCompletion` is created synchronously at the top of
   `dispose()`, before any await, so a second `dispose()` always sees it. A
   second `dispose()` awaits `disposeCompletion`, not `disposedSignal`; the
   page race never waits on the completion promise and cannot deadlock.
   `start()` returns early when `disposed` or `started`.
5. No new await method. `reconcile()` is the single-flight handle: while a
   pass is in flight it returns that same promise; with no pass it starts one;
   once `dispose()` has settled it returns a resolved promise and never
   rejects; a call made while dispose is in flight returns that pass, which may
   reject and is caught by the caller (no production caller makes that call).
   It registers the pass promise synchronously at its top and is not an `async`
   wrapper, so the identity is real. The proofs use the exact order
   `await ledger.start(); const pass = ledger.reconcile();
   await pass;` with a deferred list fake, so the pass is in flight and the
   call settles with it; they start no second pass for a deferred or late
   fake. The in-flight field is cleared in `finally` on every settlement, and a
   ledger without `listSessions` returns an already-resolved promise without
   registering a pass (the shadow proof depends on it). Production still has
   one caller, `start()`. The upper bound is pages times `pageTimeoutMs`.
6. `emitUsage` checks `disposed` and, when set, returns the constructed row
   without mutating state, incrementing counters, or enqueuing. That preserves
   `ingest`'s declared `UsageLedgerRow` return type; the four
   `prove-call-depth-clamp.ts:346,385,403,422` call sites ignore the value.
   `enqueue` checks `disposed` as a second guard; `recordShadow` already does
   (`usage-ledger.ts:650`); the reconcile loop checks it before `emitUsage` and
   must `continue`, not only skip the call, because `unobservedRows += 1` sits
   outside `emitUsage` (`:523`); `ensureLineage` checks it before `getSession`,
   again after the parent recursion, and immediately before `states.set`, and
   keeps an already-set `depth` instead of overwriting it with a computed null
   after its awaits, so a dispose mid-walk cannot write a post-dispose lineage
   state and a concurrent emit cannot be clobbered.
7. Identity-scoped disposal. `installUsageLedger` captures the instance and
   disposes it by handle, not by global. `clearUsageLedger(instance?)` disposes
   that instance and clears the global only when the global is still that
   instance. `clearUsageShadow(instance?)` is a pointer clear with the same
   identity check: the shadow holds only in-memory maps, so there is nothing to
   dispose (`usage-shadow.ts:358-372`). `clearSessionBridge(instance?)` follows
   the same rule and `setup.ts:536` passes the bridge it installed. This is in
   change A because the bridge clear is the first registered disposer
   (`setup.ts:536`), `getSessionBridge()` is read at runtime
   (`hooks/message-updated.ts:350`; `tools/thread.ts:198,284`), and an old setup
   cleanup that runs after a new bridge was installed in the same module
   generation would otherwise null it (F10).
   `setup.ts:858-859` passes the ledger and shadow instances it installed. The
   guard belongs to A because it is correct under every loader behaviour and
   costs one optional argument: the loader returns the cached module when entry
   digests are unchanged (`source.js:12-16`), and on the node lane a
   content-changing reload takes the fresh-module path (`source.node.js:53-54`).
   Whether the host re-runs `setup` on a cache hit, and whether Bun re-evaluates
   a module after `require.cache` deletion, are both unverified (F10); either
   way the identity-scoped clear changes nothing for existing callers and only
   stops an old cleanup from nulling a newer pointer. E6 reproduces today's
   kill with two module generations and confirms the guard prevents it.
8. No turn guard is added. The reconcile emit already passes `existing.turn`
   (`usage-ledger.ts:517`), a new session starts at 0, and `ingest` increments
   the existing turn (`:556`), so every call site is monotonic without a
   `Math.max`. A reload of an out-of-order file can lower the turn today; that
   is a pre-existing defect, not caused by this move, and is recorded as a
   residual risk (rule 4).
9. Log one line per reconcile: pages, rows, duration, aborted.

Why: this is the only location-scoped call before registration and the best
match for a wait released 46 ms after location eviction. `compareCounters`
already rejects a snapshot older than the current state, so counters converge
under interleaving; the guards close the post-dispose and resurrection paths
the move opens. Identity-scoped disposal is in change A because forward cleanup
otherwise disposes the new ledger and shadow after a reload, and the bridge
clear is the first disposer and is read at runtime (F10, F14).

Acceptance: a never-settling `listSessions` no longer delays registration (the
setup-level control in `prove-boot-budget.ts`); a
late-settling pass still backfills; an event during a pass does not inflate
totals; no row is written after dispose and a row
queued before dispose is still flushed; a second `start()` is a no-op and
`start()` after `dispose()` is a no-op; `reconcile()` settles on dispose,
before `dispose()` resolves, even when a page never settles.

### A3 — Proofs and gate wiring

| Proof | Controls that make it non-vacuous |
| --- | --- |
| `prove-live-entry-sync.ts` (new, isolated temp dir, unit-level) | Identical bytes: inode and mtime unchanged. Different bytes: bytes equal and inode changed. The injected fs seam records fsync before rename. Stale entry with the current digest but different bytes: replaced. Missing source: throws, no write. No temp residue. Symlink: link preserved, target replaced. Injected failing rename: throws, temp removed; the EPERM case prints `skipped`. Static check that `build-v2.mjs` calls `syncLiveEntry` and that `release-smoke.sh` compares the live entry to `dist/index.js` before copying. It also executes the same
`cmp -s <live> <dist> || exit 3` snippet the script contains on a differing
pair and asserts exit 3, and pins that exact line in `release-smoke.sh`; the
wrapper's preflight is not driven, so the executed claim covers the comparator
and its exit mapping, not the whole smoke run. |
| `prove-usage-ledger.ts` (updated, lifecycle) | A ref'd `deadline(ms, label)` helper that fails, never hangs, and clears its timer in `finally`. Exact order: `await ledger.start()`, capture `const pass = ledger.reconcile()`, assert `ledger.reconcile() === pass` while the deferred is unresolved, resolve the deferred, then `await pass`; no second pass starts for a deferred or late fake. The identity, 100 ms late-settle, and dispose cases use the default `pageTimeoutMs` (well above `load()`), and `listCalls.length === 1` is asserted after the pass settles; the 20 ms timeout case is separate and never asserts call count. The two-page case at `:251-252` also defers its fake (the first page resolves, the second is held) and asserts `listCalls.length === 2` after `await pass`. A rejecting `listSessions` logs the fail-open warn and leaves `start()` resolved; the proof catches the pass rejection before asserting the warn. Never-settling `listSessions`: `start()` under 1 s, a page call recorded, `reconcile()` still pending at 300 ms, `dispose()` settles `disposedSignal` and ends the parked page, no row written. |
| `prove-usage-ledger.ts` (updated, lifecycle tail) | `pageTimeoutMs: 20` with a `listSessions` that never settles: `reconcile()` resolves without `dispose()`, the warn names the page, no row is written, and the pass ends. A session already present in the ledger file keeps its `load()` snapshot while reconcile is parked, so the budget and fan-out guards see it. Late-settling pass (100 ms): the totals at `:251-266` and the `gap` block at `:291-299` still hold after `reconcile()`. Event during reconcile: totals not inflated. `start()` after `dispose()`: no reconcile call and no absorbed row. Second `start()`: no second reconcile (`listCalls` unchanged); a row appended to the file after the first `start()` is not absorbed, proving the early return without an fs seam. `handleEvent` after dispose: no enqueue and still returns `true`. An `ingest` that resumes after dispose returns its row without recording it; the assertion pins that shape because rule 2 forbids the explanatory comment. A pass parked on a later page ends on dispose and emits none of the rows collected before it. Static pin that `setup.ts` forwards the one-argument host call: `ctx.session.list(input)`. |
| `prove-usage-ledger.ts` (updated, window) | A session only on a later page is `undefined` in `sessionSnapshot` while parked, `sessionBudgetGuard` returns null for it and the fan-out block is off, and it is defined after `reconcile()`; a session created after its page was fetched stays undefined until its next usage event; an aborted page ends the pass without reaching later pages; a zero-counter session entry is skipped, so that session waits for its next event. |
| `prove-usage-ledger.ts` (updated, dispose) | Dispose mid-pass: no post-dispose row; a row queued before dispose is on disk after `dispose()` returns even when the aborted page rejects as the race winner; `ensureLineage` writes no state after the dispose; a second `dispose()` awaits `disposeCompletion` and the final flush. Identity: install ledger A then ledger B, clear A by handle, and `getUsageLedger()` stays B and B still records; the no-arg clear still clears B. |
| `prove-usage-shadow.ts` (updated) | Explicitly assert that a ledger without `listSessions` resolves `reconcile()` immediately and writes no backfill row, so the no-op is proven rather than assumed. |
| `prove-bundle-freshness.ts` (updated) | Keep the trailer digest assertions on the dist artifacts; replace the live-entry digest assertion with byte equality to `dist/index.js`. The proof always asserts byte equality after the build; there is no skip mode. |
| `prove-global-install.ts` | Unchanged. It spawns a default build, which rewrites the live entry when bytes differ, but it reads only `dist/global.js` and never the live entry; CI leaves live sync on. |
| `prove-context-bridge.ts` (updated) | Hoist the `direct` bridge out of the `if` block at `:183-186` so it is in scope at `:188`. After `await bareCleanup()` assert `getSessionBridge() === direct`: change A's setup passes its own bridge to `clearSessionBridge(instance)`, so cleanup leaves the replacement in place. The `finally` no-arg clear at `:196` still clears the active bridge. |
| `prove-boot-budget.ts` (updated, registration independence) | The fixture adds `session.list: () => new Promise(() => {})`; the current ctx has no `session.list` at all (`scripts/prove-boot-budget.ts:65-87`), which is why every existing run takes the fail-open catch. The proof captures logs by replacing `console.error` for the run (`src/utils/logger.ts:161-164`) and restoring it in `finally`. The setup still reaches `ctx.tool.transform` and logs `v2 registered`, so registration does not wait for reconcile. The same run then calls `cleanup()` with the pass parked: dispose settles `disposedSignal`, the page race ends, and cleanup resolves, which proves the setup-level dispose path. No new file and no new step; the counts stay 184 and 187. |
| `prove-proof-catalog.ts` | Add `prove-live-entry-sync.ts` to `PINNED_PROOF_FILES` in sorted order (between `prove-intelligence-off.ts` and `prove-md-gate.ts`), raise `PINNED_PROOF_STEPS` from 183 to 184 (`:259`, files 186 to 187), add one proofs-stage step in `scripts/gate-manifest.json`, add the step to `scripts/proof-shards.json` (shard 3 is the smallest at 99 302 ms), raise the target shard's `estimateMs` by the new proof's estimate and `totalEstimateMs` by the same amount, and run `npm run generate:proof-count` for the generated markers in `AGENTS.md`, `TRIAGE.md`, `docs/validation.md`, `docs/portable-context-handoff.md`, and `README.md` (the skills table only). Hand-update `docs/validation.md:13` and `docs/release-notes-0.1.0.md:137,139`, which `scripts/release/check-release.ts:71-91` validates in the fast stage before the catalog runs; the shard-seconds and proof-seconds markers live in `docs/validation.md:86` and `:88`, not in the README. Shard step names must equal the manifest names (`check-release.ts:107-109`) and the shard estimates must sum to `totalEstimateMs` (`:110-113`). `docs/CI-TRANSCRIPT.md:36` is a historical transcript, not regenerated by `generate:proof-count` and not gate-checked. |

No `prove-setup-budget.ts` in change A: the start, page-bound, dispose, and
guard-baseline acceptance assertions live in `prove-usage-ledger.ts`, where the
ledger behaviour is exercised.

---

## 5. Change B — harden teardown and diagnostics (separate commit)

Change B is deferred because it hardens teardown and bounds the ask, skills,
and command calls before registration, but does not fix the measured freeze:
the 8 s retirement race already bounds the new init, and change A removes the
duplicate-write and drop paths. `warmWorkspace` and `ctx.tool.transform` stay
unbounded by design (B2.2, B2.5). It reuses the identity-scoped clears change A
introduces. It lands as its own reviewable change.

### B1 — Stoppable relay and explicit teardown order

Change:
1. Create an `AbortController` per setup and pass `ctx.event.subscribe({ signal })`.
   `V2Event.subscribe` already accepts the options (`types.ts:146`,
   `event.d.ts:5`). If the host rejects the options at runtime, retry
   `subscribe()` without them and rely on `iterator.return()` plus the 5 s
   race.
2. Keep the iterator handle and call `iterator.return()` as the cooperative
   fallback; `return()` alone cannot unpark an idle `next()`, so the 5 s race
   is the real stop.
3. Abort at the top of cleanup, before any disposer runs, and set `disposed`
   in that same step. Today the flag is assigned only inside the registered
   relay disposer (`setup.ts:846-849`), which the explicit tail removes, so the
   abort must set it; otherwise a host that ignores the signal can still deliver
   and fully handle one event after the abort, and the "dropped event" control
   cannot pass.
4. Use an explicit sequence, not blanket reverse order: abort first, then the
   refresh stop (today's first cleanup step, kept ahead of the relay so nothing
   can restart schema work during the relay wait), await the relay
   (5 s bound), the remaining forward disposers, then bounded
   `plugin.dispose()`, then identity-scoped clears for bridge, shadow, and
   ledger. Abort and the refresh stop are the only steps that run before the
   relay bound; the tool disposer and every other registered step wait until
   the relay settles or its 5 s bound expires, so no disposer runs while the
   relay can still produce. The refresh stop stays before the tool disposer
   (`prove-e38.ts:265`). The bridge clear moves from `registered[0]`
   (`setup.ts:536`) to this tail on purpose: `getSessionBridge()` is read at
   runtime (`hooks/message-updated.ts:350`; `tools/thread.ts:198,284`), so the
   bridge stays readable while the relay and the disposers run under their
   bounds, and identity scoping (`setup.ts:536` passes the instance it
   installed) stops this cleanup from nulling a newer one. Every clear runs
   after the abort and the bounded stop
   attempt; a step abandoned at its 5 s bound may still be running, but its
   post-dispose writes are dropped by the disposed guards and the
   identity-scoped clears never touch a newer instance.
5. Bound every step in the explicit sequence at 5 s: the relay await, each
   registered disposer, `refreshStop()`, `plugin.dispose()`, and each
   identity-scoped clear. The ledger clear is the one that matters here: it
   awaits `dispose()` (`usage-ledger.ts:912-920`), which parks an in-flight
   page and then waits for the `flush()` chain (`:862-876`), so leaving the
   clears out would break the total bound. The whole
   cleanup is therefore bounded by the number of steps times 5 s. A step that
   does not settle is abandoned and logged, and the next step runs; the step
   promise is caught before the race, so an abandoned step cannot reject
   unhandled; the relay is stopped first so an abandoned disposer cannot keep a
   producer alive.
   `plugin.dispose()` currently waits up to 30 s in `ensureReady()`.
6. Make cleanup idempotent: a second call awaits the in-flight completion and
   each disposer runs exactly once, including a late registration. The explicit
   tail replaces the registered entries for the relay, bridge, shadow, and
   ledger clears; all four are removed from `registered` so none runs twice. A
   per-disposer `ran` flag (or a `Set`) enforces once-only when the explicit
   tail and a late registration overlap.

Why: the relay cannot end while the stream is idle, and forward order stops it
last. An explicit order stops producers before consumers, and the
identity-scoped clears introduced in change A remove the cross-instance kill
that reverse order would widen.

Acceptance: an idle stream cleans up within one 5 s bound per step, so the
whole cleanup is bounded by the explicit sequence length times 5 s; only the
abort and the refresh stop run before the relay bound; the abort sets
`disposed` before the relay starts, so an event delivered after it is dropped;
a host that ignores the signal is still bounded; a refresh stop that never
settles is abandoned and the relay bound still runs; a registered disposer
abandoned after the relay bound does not prevent the clears; a second dispose
calls each disposer once; a late registration is disposed exactly once.

### B2 — Bounds that stop work, not only waiting

Change:
1. Bound optional single-call steps at 2 s (`OPTIONAL_TIMEOUT_MS`, injectable),
   keeping today's ask → skills → command order (`src/v2/setup.ts:571-575`).
2. `warmWorkspace` keeps its current unbounded behavior (rule 4). Abandoning it
   is an ungated rule-5 trade: a skipped entry never gets `warmInjection`
   (`src/services/context-pack/index.ts:454`), and `handleContextEvent` only
   reads that cache (`src/services/context-pack/hook.ts:106`), so the pack is
   not injected until a later warming event. It is a no-op in this workspace
   (no `index.json`) and not a freeze suspect.
3. Ask is safety-critical: if abandoned, log at error, because `askEnabled`
   becomes false and every confirmation disappears silently
   (`src/v2/setup.ts:577`).
4. Emit a breadcrumb per step (`start`, `done in <ms>`, `abandoned after
   <ms>`). Snapshot `registered` before each push; a late registration disposes
   itself immediately through the same idempotence ledger.
5. Keep `ctx.tool.transform` unbounded and outside every budget. Add an
   unref'd 10 s watchdog that logs the pending step set; it names line 613, it
   does not abandon it, and its timer is cleared in `finally` on success.

Why: an aggregate budget lets a slow local step starve the safety hook, and a
deadline around 613 would trade the tool surface for liveness. A latency bound
on work that keeps running is fiction, so work is stopped first and bounded
second.

Acceptance: a fake host whose `command.transform` and `skill.transform` never
settle still reaches tool registration; the log names the abandoned steps; the
ask hook is still attempted before skills and command; a late registration
leaves exactly one disposer call.

### B3 — Report a failed tool registration

Change: keep the catch, log at error, and add a health line after registration:
`[tawassul] v2 health: tools=<n> schemas=<n> ask=<bool> skills=<n>`. Hoist the
tool count out of the `editor` callback (`src/v2/setup.ts:614-618`) as a mutable
counter incremented inside the callback and read after registration, so a stale
pre-registration count cannot mask a zero. The failure signal is the catch, not
the count: set a `registrationFailed` flag in the catch and log the health line
at error whenever it is set or the count is zero, with the reason, so a callback
that added tools and then rejected still reports the failure. The hoist must
leave today's log line intact: `[tawassul] v2 registered <n> tools name-set ...`
keeps printing the same count from the same callback (`src/v2/setup.ts:614-619`).
All four fields are asserted by the `prove-setup-budget.ts` control on a full
run, so none is decorative.
No rethrow and no retry until `editor.add` failure is proven atomic.

Acceptance: a fake `tool.transform` that rejects leaves setup loaded, logs the
error, and emits a zero-tool health line; the other bridges stay registered.
A callback that adds tools and then rejects still logs the health line at
error. Both cases are asserted in `prove-setup-budget.ts`, beside the
late-registration control, and the `[tawassul] v2 registered <n> tools` line
still reports the count it reports today; no file beyond the two B5 already
counts is added, so the B counts stay 184→186 and the files 187→189.

### B4 — Verify the double-instance path

`createV2Setup` never calls `claimCoexistence`; the claim lives in
`plugin-init.ts:558-564`. The contract is not "one registration per workspace
and token": a second claim with the same pid, scope, and token increments refs
and registers again (`install-scope.ts:69-73`), while a different token, a
lower-priority scope, or an equal-priority claim from another process yields
(`install-scope.ts:74-77, 89-92`). The assertion extends `prove-boot-budget.ts` (no
new proof file; the B counts stay 184→186, files 187→189): after `createV2Setup`
returns and before its `cleanup()`, a claim for the same directory with a
different token returns `shouldRegister: false`. Both claims pass the same
explicit scope (the fixture pins `detectInstallScope`), so the yield comes from
`install-scope.ts:69-77` and not from the priority fallback at `:89-92`. The
measured boot claims twice,
once at `prove-boot-budget.ts:90` and again through `initPlugin` at
`src/v2/setup.ts:514`, so the entry holds refs 2; `cleanup()` at `:95` runs
`plugin.dispose()` (`src/v2/setup.ts:877`), which releases once
(`src/bootstrap/plugin-init.ts:1115-1118`) and leaves refs 1, so the entry
survives the measured boot. That survival is explanatory, not asserted: the
different-token claim runs before `cleanup()` and does not depend on it. The
same-token
refs increment is documented from `install-scope.ts:69-73`, not asserted,
because the claim token is the plugin module path (`plugin-init.ts:559`),
which the proof would have to recompute from that module's own URL if it
asserted the increment. The cross-process case is registry
semantics, not driven here. This is a verification, not a change; if the
different-token assertion fails, fix identity-scoped singletons and idempotent
release in a separate change.

### B5 — Change B proofs

| Proof | Controls |
| --- | --- |
| `prove-dispose-bounded.ts` (new) | Idle iterator; a host that ignores the signal; a refresh stop that never settles is abandoned while the relay bound still runs; a registered disposer abandoned at its 5 s bound after the relay still lets the clears run; abort happens first and sets `disposed`; relay stops before the bridge clears; `plugin.dispose` runs before the bridge clear; a refresh that exceeds 5 s is abandoned and logged, and the tool disposer still runs after the abort; second dispose awaits the in-flight dispose and calls each once; one in-flight event during dispose is dropped deterministically; whole cleanup bounded. |
| `prove-setup-budget.ts` (new) | Wall-clock watchdog fails rather than hangs; injected budgets; captured logger names the abandoned step; the preserved ask → skills → command order; the optional steps stop after abandonment; a late registration is disposed exactly once; the health line reports `tools=`, `schemas=`, `ask=`, and `skills=` on a full run; a rejecting `tool.transform` emits the zero-tool health line, and a callback that adds then rejects still logs it at error; the 10 s registration watchdog logs the pending step set when a fake host parks `tool.transform`, and its timer is cleared on a successful run. |
| `prove-proof-catalog.ts` | Add `prove-dispose-bounded.ts` between `prove-dispatch-model.ts` and `prove-e02.ts` and `prove-setup-budget.ts` between `prove-seed-agents.ts` and `prove-setup-delegation.ts`, raise `PINNED_PROOF_STEPS` from 184 to 186 (files 187 to 189), add two proofs-stage steps, add both to `scripts/proof-shards.json`, raise the target shard's `estimateMs` by the new proofs' estimates and `totalEstimateMs` by the same amount, and rerun `npm run generate:proof-count` plus `docs/validation.md:13` and `docs/release-notes-0.1.0.md:137,139`. Shard step names must equal the manifest names (`check-release.ts:107-109`) and the shard estimates must sum to `totalEstimateMs` (`:110-113`). |

---

## 6. Decisions resolved

| Dispute | Resolution |
| --- | --- |
| Split the work | Yes: change A (freeze) and change B (teardown and diagnostics). The relay stop, explicit teardown order, per-step bounds, health line, and the double-instance check move to B. |
| No deletion | No implemented feature is deleted. `SessionBridge.get/list` stay as-is; the trailing drain was a proposed pattern, never code. Every addition has a named production or proof consumer. |
| Registration bound vs guard window | Change A moves reconcile off the init path, so until a session's page is fetched and emitted the budget guard has no snapshot and the fan-out block is off. The pass is bounded by pages times `pageTimeoutMs` (50 s worst case at defaults); a session created after its page, a zero-counter session, or a session only in a rotated backup waits for its next event, or for the next `start()` after a reload, so its gap is not bounded by the pass. This is a deliberate rule-5 trade, not a free fix: it requires explicit owner authorization before implementation. Without that authorization, change A is not approved. The detector keeps observing, the reconcile log names the window, and keeping the await is the alternative. |
| Ask-permission bound vs confirmations | B2 abandons `registerAskPermission` at 2 s; `askEnabled` then becomes false and every confirmation disappears silently for that session. This is a second rule-5 trade: it requires explicit owner authorization in the same gate as the guard window. The alternative is an unbounded ask wait, which can park setup. The error log names the abandonment. |
| Bounded teardown vs in-flight reload | B1 bounds the relay, `refreshStop()`, and every disposer at 5 s each. A step that exceeds its bound is abandoned and logged, so an in-flight `ctx.tool.reload()` can outlive the refresh stop and the tool disposer can run while the host is still reloading. This is a third rule-5 trade: bounded cleanup versus the `prove-e38.ts:261,265` ordering guarantee. It requires explicit owner authorization in the same gate. The alternative is an unbounded cleanup wait, which is the current 30 s hang. |
| Reload trigger vs atomic replace | A1 replaces the live entry with `rename`, which may leave the host's file watch on the unlinked inode, so later builds may no longer hot-reload the plugin; the alternative is today's in-place `copyFileSync`, which keeps the inode but keeps the torn read. This is a fourth rule-5 trade: atomic replace versus build-triggered hot reload. Experiment E2/E7 sharpens it: the first replace still emits watch events, and a second replace on the same un-re-armed watch is silent. It requires explicit owner authorization in the same gate. If the owner requires hot reload, the escape is a directory mtime touch after the rename, which must be proved against the host watcher before it is added; until then rollout step 1 restarts the host. |
| Wiring consumers | Every new parameter has a caller: `pageTimeoutMs` in `UsageLedger`; the `clear*` instance arguments at `setup.ts`; `syncLiveEntry` in `build-v2.mjs`. No parameter is added without a caller. |
| Test seams | `pageTimeoutMs`, the `syncLiveEntry` fs seam, and the proof `deadline` helper exist for named proofs, not runtime surface. `pageTimeoutMs` defaults to 5000 in production; the fs seam defaults to `node:fs`; `deadline` is proof-only. Each has a caller in A3. Neither timeout is env-readable, so `docs/environment.md` stays unchanged. |
| `SessionBridge.get/list` | Kept. Both are currently uncalled, but deleting them breaks `prove-usage-ledger.ts:370` and removes complete surface for no freeze benefit. `list` stays one-argument; the ledger backfill continues to call `ctx.session.list` directly. |
| Live write | Always on. `host:refresh`, `doctor-v2.sh`, and the smoke stage depend on it. The build compares bytes and renames atomically; there is no skip switch. `release-smoke.sh` refuses a live entry that differs from `dist/index.js`, so a stale bundle cannot pass smoke. |
| Skip predicate | Byte equality is authoritative; the digest is logging only. |
| Missing source, symlink, rename failure | Fail loudly; resolve symlinks and replace the target; one retry then throw. |
| Timeout mechanism | No request signal: the installed client takes one argument, so a restated optional `signal` would fail `prove-e37.ts`. The bounded race is the enforcement, and the loser is always caught. A host page that never settles still ends at `pageTimeoutMs`. |
| Ledger disposal identity | In change A: install and clear take the instance; a clear never kills a newer instance. |
| Bridge identity clear | In change A, not B: the bridge clear is the first registered disposer (`setup.ts:536`), `getSessionBridge()` is read at runtime (`hooks/message-updated.ts:350`; `tools/thread.ts:198,284`), and an old setup cleanup that runs after a replacement installed the new bridge would null it. Cost is one optional argument and one proof edit, and it closes the same defect as the ledger clear instead of splitting it across two commits. |
| Legacy no-argument clears | `clearUsageLedger()`, `clearUsageShadow()`, and `clearSessionBridge()` keep today's clear-the-active semantics; only a passed instance is identity-scoped. |
| Reverse disposal order | Not adopted. Change B uses an explicit producer-first sequence plus identity-scoped clears. |
| `tool.transform` failure | Log at error plus a health line. No rethrow, no unproven retry. |
| Optional budget | Per-step bounds, ask first and fail-closed; 613 excluded; `warmWorkspace` is unchanged. |
| Whole-setup deadline | Not for 613. An unref'd 10 s watchdog logs the pending step without abandoning registration. |
| Reconcile-window guards | Documented, not code-guarded. Closing the gap means either `ctx.session.list` on the init path (F6) or failing closed on every fresh session's first dispatch (rule 5); neither is minimal or non-trading. The `load()` baseline, the bounded page, and the log are the controls. |
| Flush bound | No code change. `flush()` re-adds on failure and `append()` writes unlocked when the lock is busy. |
| Await handle | No new method. `reconcile()` returns the single in-flight promise; with no pass it starts one; after `dispose()` it resolves immediately and never rejects. Proofs hold the pass with a deferred list fake; production still has one caller. |
| Same-token dedupe | Out of scope. Verify only, at the `plugin-init` seam. |
| `prove-live-entry-sync` location | Isolated temp dir; never the repo live path, because shards run in parallel and a seeded stale entry would cross-fail other proofs. |

---

## 7. Interference matrix (rules 4 and 5)

| Surface | Must not change | Checked by |
| --- | --- | --- |
| 44-tool name set | No add, rename, or removal | `prove-intelligence-off.ts:107-108`; `prove-skill-registration` |
| Live entry | Still `.opencode/plugins/tawassul.js`, same content contract | rollout: `host:refresh -- --verify-only`; `doctor-v2.sh` (neither is a gate step) |
| Build-triggered reload | May stop firing after an atomic rename; this is the fourth rule-5 trade, so the host is restarted in rollout step 1 instead | `host-refresh.sh:272-274,299-301` sha comparison |
| Global install | Stays removed; no `install:global` | `prove:independence`; absence check |
| Ledger | Same file, same format, same event capture, no inflated totals; rows recorded before dispose are flushed, rows after dispose are dropped | `prove-usage-ledger`; `prove-usage-shadow` |
| Ledger identity | A clear never disposes a newer instance | `prove-usage-ledger` |
| Budget and fan-out guards | Snapshot semantics unchanged; a session present in `load()` or after its page is emitted keeps the same guard | `prove-usage-ledger`; `prove-usage-shadow` |
| Guard window during reconcile | The block is off for a session absent from `load()` until its page is fetched and emitted; the pass is bounded by pages times `pageTimeoutMs`, while a session created after its page, zero-counter, or only in a rotated backup waits for its next event, or for the next `start()` after a reload. Owner authorization required (rule 5) | `prove-usage-ledger`; reconcile log |
| Event bridge | Same mapping and ordering; change B changes only stop and teardown order | `prove-e15.ts`; change B dispose proof |
| Build contract | `host:refresh` still accepts an unchanged entry older than the new init after a skip | `host-refresh.sh:276,303` semantics |
| Setup logs | Existing lines keep their meaning; new lines are English | `check:rules` |
| Rules 1-2 | No Arabic, no comments in gated code | `npm run check:rules` |

### Unintended-touch audit

These are the existing consumers of every symbol change A or change B edits. The
optional-argument rule is binding: a call without an instance keeps today's
clear-the-active behaviour, so no existing proof or caller changes meaning.

| Touched symbol | Existing consumers | Guarantee |
| --- | --- | --- |
| `clearUsageLedger` | `src/v2/setup.ts:859`; `scripts/prove-call-depth-clamp.ts:364,443`; `docs/experiments/receipts/2026-11-07-p2-isolated-experiments.ts:150,182` | Optional instance argument. No argument clears the active ledger, as today. The name is unchanged, so the source assertions in `prove-usage-ledger.ts:367` still match. |
| `clearUsageShadow` | `src/v2/setup.ts:858`; source assertion `prove-usage-shadow.ts:352-354` | Optional instance argument; stays synchronous; it only clears the pointer because the shadow owns no external resources. No argument clears the active shadow. |
| `installUsageLedger` | `src/v2/setup.ts:537`; `prove-call-depth-clamp.ts:345,366`; the docs receipt | The global is still replaced synchronously and the previous instance is disposed by handle, still fire-and-forget. No new init-path await. |
| `V2Session.list` | `src/v2/setup.ts` only | Unchanged one-argument signature. The installed client's `SessionListOperation` takes no second argument, and a restated optional `signal` fails `prove-e37.ts`, so nothing is widened in change A. `session-bridge.ts` keeps `list: (input) => ctx.session.list(input)`. |
| `clearSessionBridge` (change A) | `src/v2/setup.ts:536`; `prove-thread-tool.ts:372,379`; `prove-context-revalidate.ts:189`; `prove-context-bridge.ts:107,196`; `prove-context-failure-pack.ts:190` | Optional instance argument. No argument clears the active bridge, as today. `prove-context-bridge.ts:184-188` installs a replacement before cleanup, so `:188` is an assertion, not a clear call; it needs the hoist and the `=== direct` assertion listed in A3. The remaining zero-argument call sites pass unchanged. |
| `refreshStop` and `plugin.dispose` bounds (change B) | `src/v2/setup.ts:862-877` only | Bounds are races, not signature changes; the returned cleanup still resolves. |
| `scripts/live-entry-sync.ts` (new) | `build-v2.mjs` | `scripts/` is already in the `prefixes` array of `scripts/release/public-files.json`, so `check-public-tree` needs no new entry. The file never enters the bundle. |
| Live sync | build only | Always on; no environment switch. The build compares bytes and renames atomically. |
| `scripts/release/pack.sh` | release packaging | Reads `dist/index.js`, `dist/global.js`, the wasm sources, and the root documents; the new helper is not packaged, so no manifest change. |
| Live-entry readers | `release-smoke.sh:118`; `prove-v2-independence.ts:80`; `prove-bundle-freshness.ts:47`; `prove-model-failover-e2e.ts:19,201`; `prove-independence-boot.ts:19,93`; `prove-global-boot.ts:21,279,313`; `measure-context-baseline.ts:46`; `install-global.ts:38` (unaffected; global install stays removed) | `release-smoke` refuses a live entry that differs from `dist/index.js`, so it never boots a stale copy. `prove-bundle-freshness` asserts byte equality. The others consume the current live entry after the build syncs it. |
| `tests/` | none | The directory does not exist; the proofs are the test surface. |

Deliberately not touched: `prove-global-install.ts` never reads the live entry,
although its default build writes it like any other build;
`tools/tawa/health.ts`, `hooks/tool-execute.ts`, `hooks/session.ts`, and
`hooks/guards/dispatch-guards.ts` keep calling `getUsageLedger()` per event, so an
identity-scoped clear only changes what happens when an old cleanup passes its
own instance; `prove-call-depth-clamp.ts` and the docs experiment receipt are
not edited; `sourceDigest()` does not hash the new helper, which is correct
because the helper never changes bundle bytes.

Two couplings deserve an explicit guard in the proofs:
1. `prove-bundle-freshness.ts` and `prove-global-install.ts` spawn
   `npm run build`, which syncs the live entry atomically. No proof sets a
   skip switch because none exists.
2. `prove-v2-independence.ts:112-115` requires exactly one live entry. On a
   built workspace the entry already exists, so the assertion keeps its
   meaning.

Rollout:
0. **Owner authorization gate (rule 5) — CLEARED 2026-11-16.** The owner
   authorized implementation with the instruction to proceed with the plan,
   given twice after this gate and the four trades were described;
   that instruction is recorded here as the explicit authorization for change A,
   change B, and the four rule-5 trades as written: the guard window, the ask
   permission bound, the bounded teardown versus in-flight reload ordering, and
   atomic replace versus build-triggered hot reload. Proceed in the order below,
   A then B; stop and report if a trade has to be widened beyond this text.
1. Change A with its proofs. On a live host, stop the host before a build whose
   bytes differ; the atomic rename is safe for a loaded entry on Linux, but the
   Windows lane may refuse an open file. Start the host again afterwards: if its
   watcher ignores the rename, the old bundle stays loaded until that restart,
   and `host-refresh.sh:276,303` is what notices the mismatch. On a fresh clone, run one default
   build first so `prove-v2-independence.ts:112-115` has an entry. Proofs may
   run after that build; they read the synced live entry.
2. After change A lands, run one default build and
   `npm run host:refresh -- --verify-only`. The reload now carries the
   reconcile fix; if the watcher ignored the rename (A1 does not claim it),
   `--verify-only` reports the stale live bundle and
   `npm run host:refresh -- --restart` is the fallback before anything is
   judged.
3. Change B with its proofs.
4. Final: `npm run typecheck`, `npm run check:rules`, the targeted proofs,
   `npm run gate:fast`, `npm run gate:proofs`, and `npm run ci`.

No state migration is involved.

---

## 8. Residual risks

- The exact await that blocked at 14:33 stays unidentified until change A
  ships. The reconcile log attributes the pass to its start site
  (`src/v2/setup.ts:547`) with pages, rows, duration, and aborted; change B's
  breadcrumbs and watchdog name the rest.
- Host-side location-lock serialization remains a hypothesis. Change A reduces
  the exposure without proving the mechanism. The page bound is an upper bound
  only while the event loop is responsive, and a timed-out `session.list` is
  abandoned, not cancelled: the request keeps running and may still hold the
  host lock this plan hypothesises.
- Owner authorization required (rule 5): the registration bound weakens the
  budget and fan-out block for a session absent from `load()` for up to pages
  times `pageTimeoutMs` (50 s at defaults). The plan records the trade; it does
  not self-authorize it. If the owner does not authorize it, change A must
  keep `start()` awaiting `reconcile()` and the freeze risk stays.
- During the reconcile window, a session missing from the two files `load()`
  reads (`.1` and the active file) has no snapshot, so `sessionBudgetGuard`
  returns null (`src/hooks/guards/dispatch-guards.ts:59`) and the fan-out block
  is off (`tool-execute.ts:193-196`). Its spend becomes visible when its page
  is fetched and emitted or on its next usage event, whichever comes first; a
  zero-counter session entry is skipped, so that session waits for its next
  event; a session created after its page was fetched waits for that event; an aborted
  page ends the pass without reaching later pages; and rows that live only in a
  rotated backup keep persisted spend without a snapshot. The fan-out detector
  still observes every dispatch; only the block waits. The window is bounded by
  pages times `pageTimeoutMs` and named by the reconcile log. The proof asserts
  that the `load()` baseline survives and that a later-page session moves from
  `undefined` to defined after `reconcile()` settles. This is the rule-5 trade
  recorded in Decisions; owner authorization is required.
- The 5 s refresh bound changes `prove-e38.ts:261,265` from an unbounded wait
  to a bounded one; an in-flight reload longer than 5 s is abandoned and
  logged, and the tool disposer still runs after the abort. This is the third
  rule-5 trade: bounded cleanup versus the reload-before-tool-dispose order.
  The new control covers that path.
- If `plugin.dispose()` exceeds 5 s and is abandoned, the waited-on host
  dispose does not run; `releaseClaim` and `resetAllState` already ran
  synchronously before `ensureReady()` (`plugin-init.ts:1115-1125, 1139`), so
  the claim is released and state reset. The cost is the skipped host dispose;
  the alternative is the 30 s hang.
- B2's 2 s ask bound can disable every confirmation for a session when the
  host is slow; it is a rule-5 trade and requires explicit owner authorization
  in the rollout gate. The abandonment is logged at error.
- A reload of an out-of-order ledger file can lower the turn today; this is a
  pre-existing defect, not caused by the move, and is out of scope (rule 4).
- Proof shards can build `dist/` and read the live entry concurrently. That
  race predates this plan; change A's atomic rename removes the torn
  live-entry read, while the shared `dist/` build race remains.
- On a local MSYS shell `cmp` can be absent; the smoke exits 3 (fail-closed).
  No `release-smoke` step runs on Windows CI (`scripts/windows-ci.ps1`), so this
  is local-only. The hard compare can also turn the pre-existing concurrent
  `dist/` build race into a gate failure where the old copy step silently
  passed; the race itself is unchanged.
- A1 cannot force the host to reload. The first replace still emits watch events
  (E2) but a second replace on the same un-re-armed watch is silent (E7), so a
  host that does not re-arm keeps the old bundle until the next restart;
  `host:refresh -- --verify-only` notices it by comparing the live bundle sha
  with the entry (`host-refresh.sh:272-274,299-301`), with `:276,303` as the
  no-fingerprint fallback. This is the fourth rule-5 trade; rollout step 1
  restarts the host after a content-changing build.
- If the host is not stopped before the first content-changing build of change
  A, one reload still occurs. Change A includes the reconcile fix in that same
  build, so the prime suspect is already removed; reverting A restores the
  trigger.
- The old relay keeps running until change B. Its rows become no-ops after
  change A (disposed guard), and the host tolerates it behind the 8 s race, but
  it is wasted work.
- Line 613 cannot be cancelled or bounded without losing the registration
  handle; a hang there remains a host-side defect to report upstream.
- `load()` still parses up to 64 MB on the init path. It is the baseline and is
  measured, not moved.
- The runtime scripts and wasm copies at `build-v2.mjs:142-169` are still
  written in place. They are not a reload trigger, but they are non-atomic.
- Same-token double registration is unverified until the change B check runs.
- The 2026-11-07 experiment receipt's synchronous reconcile assertion
  (`docs/experiments/receipts/2026-11-07-p2-isolated-experiments.ts:94-99`)
  becomes vacuous after change A; it is a historical, ungated receipt and is not
  edited.
- The Windows rename path is covered by an injected seam only; the native lane
  prints `skipped`.
- Out of scope, recorded for follow-up: per-location event scoping and dedupe,
  graceful shutdown flush (SIGINT/SIGTERM/beforeExit), and full
  identity-scoped singletons beyond bridge, ledger, and shadow. Also
  pre-existing and not caused by this plan: `docs/validation.md:27` says "The
  fourteen steps" while the fast stage has 16 (`scripts/gate-manifest.json`
  `fast`), to be corrected with the first documentation touch after approval
  (rule 4 keeps it out of change A).

---

## 9. Commit note

When change A is committed, add `docs/plan-freeze-hardening-2026-11-15.md` to
the `internal` array in `scripts/release/public-files.json`, matching the other
`docs/plan-*.md` entries. Do not add it before the file is tracked:
`check-public-tree` rejects an internal entry that is listed but not tracked.
