# Token-Burn Control — Design Dossier for Multi-Model Review

Revision: 2.4. Revision 1 (2026-11-05) is preserved in Sections 0-13. Revision 2 added Section 14:
the re-evaluation against the post-R1 tree, the four structural findings, Option 11 (fixed-cost
diet), the canonical accounting formula, the revised execution order, and Probe 0. Revision 2.1
added Section 15: the consolidated five-agent review, the score spread, the confirmed and refuted
findings, the defects the review found, the options it added, the corrected accounting unit, and
the final recommendation. Revision 2.2 adds Section 16: the second five-agent review, the
corrections it confirmed, the D13 config conflict, the sensitivity recomputation, the P2/P3
shadow-instrumentation fix, and the four additional Probe 0 questions. Revision 2.3 adds Section 17:
the third five-agent review, the D13 reconciliation decision (K3 is the host ceiling; the knob
is clamped at the wiring point), the Probe 0 Q13-Q16 scope corrections, the D6/D11 wording
narrowing, and the depth-guard scope note. Revision 2.4 adds Section 18: the owner's 2026-11-07
corrections, the 200-character floor for the echo detector, and the 200k default context window
with host declarations taken verbatim. No Revision 1, 2, 2.1, 2.2, or 2.3 item is removed; every
correction is appended and marked with its revision.
Status: D13 and the P2 ledger shadow slice are implemented and proven; enforcement remains
proposal only.
Date: 2026-11-07 (Revision 2.4, echo-length and window-default note)
Target: Tawassul V2, this tree, OpenCode host >= 2.2.0
Audience: independent models and agents asked to score the options and produce a verdict.

## How to use this document

0. Read Section 14 first for the Revision 2 re-evaluation, then Section 15 for the first consolidated
   five-agent review, then Section 16 for the second review and the shadow-instrumentation
   correction, then Section 17 for the third review and the D13 reconciliation. Sections 0-13 are
   the Revision 1 dossier and are scored as written; Section 14 states what the re-evaluation
   corrected, what it adds, and which findings the five-agent review must attack; Sections 15-17
   record what the reviews confirmed, refuted, and changed. The operative recommendation is
   Section 15.5 as amended by 16.3 and 17.3, not Section 7.

1. Read Section 0 (hard constraints) first. Any option that violates one is disqualified, regardless of score.
2. Read Section 3 (current code). The code map is factual and was read from the tree on 2026-11-05.
3. Score every option in Section 5 independently. Do not assume the recommendation in Section 7 is correct.
4. Answer the questions in Section 12. Cite file and line where the dossier makes a code claim you can check.
5. State explicitly what evidence would change your verdict.

The author of this dossier also wrote the recommended option. Treat Section 7 as a biased party's argument, not as a finding.

---

## 0. Hard constraints from the owner

| ID | Constraint | Source |
| --- | --- | --- |
| K1 | No role-based guard conditions. Agents find ways around them. | Owner instruction |
| K2 | No routine tool-call quota as the primary control. | Owner instruction |
| K3 | `MAX_CALL_DEPTH = 3` and the `callDepth` semantics are not to be redesigned. Host nesting must equal 3. | Owner instruction |
| K4 | The `maxCallDepth` schema bound stays 1..20. It is a config knob, not an immutable constant. | Owner instruction, `src/context/config-schema.ts:14` |
| K5 | A failure message must name only targets the caller can actually reach (`@explore` / `@general` where applicable). | Owner instruction |
| K6 | `firstResponseGuard` (initial report before any dispatch) stays. | Owner instruction |
| K7 | Code, strings, and docs are English. | `AGENTS.md` rule 1 |
| K8 | No new runtime dependency for this feature. | `AGENTS.md` build rules |
| K9 | Nothing is implemented while the session is in plan mode. | Harness instruction |

---

## 1. Problem statement

### 1.1 Three observed failure signatures

The host's own issue tracker is the strongest evidence because it is the runtime we ship on.

| Signature | Mechanism | Real report | Numbers |
| --- | --- | --- | --- |
| S1 Echo loop (text only) | Assistant emits messages repeatedly with no tool calls; each turn re-reads a large cached context | opencode #43028 | 2253 assistant messages vs 26 user; input 187,625,605; cache_read 278,806,144; ~251k cached tokens per message every 10-20 s |
| S2 Identical repeat | Same tool, same arguments, same result, repeated | opencode #31942 | 277 calls to `resource_list` with no circuit breaker |
| S3 Fan-out explosion | Many sub-sessions spawned, often near-duplicate work | opencode #40175 | thousands of unbounded sub-sessions; quota exhaustion then host OOM |

Related reports: #49042 (500+ steps, zero user input), #46249 (reasoning loop before acting), #49008 (assistant replies to itself), #45989 (retry loop on rate limit), #20166 / #13577 (repeated requests), #30649 (unbounded `cache.read` growth), #45249 (auto-compaction never fires), #36033 / #26627 (endless loop, massive consumption).

### 1.2 Why a tool-call quota is the wrong primary instrument

Four of the seven worst reports above contain no meaningful tool activity. A counter that increments on tool calls is blind to S1, which is the largest observed burn (466M tokens in one session). A quota also punishes legitimate deep work and is trivially bypassed by splitting a task across agents.

### 1.3 Where the money actually goes

In #43028, `cache_read` (278M) exceeds fresh `input` (187M). The dominant cost is re-reading an oversized context on every turn, not executing a tool. Therefore the highest-leverage control is context size, and the second is the number of turns that re-read it. Tool count is at best a proxy.

---

## 2. Evidence base

### 2.1 Framework mechanisms (verified from primary docs)

| Framework | Mechanism | Value | Confidence |
| --- | --- | --- | --- |
| OpenAI Agents SDK | `max_turns` then `MaxTurnsExceeded` | 10 | verified |
| LangGraph | `recursion_limit` | 25 super-steps | verified |
| CrewAI | `max_iter` / `max_rpm` / `max_execution_time` | 20 / unset / unset | verified |
| CrewAI | identical-call stop: same tool + args + result | 5x, fixed, not configurable | verified |
| CrewAI | deferred tool results | result > 25% of context window -> preview + temp file | verified |
| CrewAI | `respect_context_window` | summarize before overflow | verified |
| AutoGen | `max_tool_iterations` | 1 by default | verified |
| AutoGen | `TokenLimitedChatCompletionContext` | token-bounded context | verified |
| smolagents | `max_steps` | 20 | documented default, re-verify |
| Pydantic AI | `UsageLimits` | `request_limit=50`, `tool_calls_limit`, input/output/total token limits, `cost_limit` | verified |
| Pydantic AI | `per_request_input_tokens_limit` + `count_tokens_before_request` | per-request guard, optional pre-flight counting | verified |
| Google ADK | `LoopAgent.max_iterations` + `actions.escalate` | example uses 5 | verified |
| Anthropic | effort scaling | simple: 1 agent / 3-10 calls; comparison: 2-4 agents / 10-15 each; complex: 10+ | verified |

### 2.2 Research and practitioner evidence

| Source | Finding | Relevance |
| --- | --- | --- |
| Anthropic, multi-agent research system | token usage explains ~80% of performance variance; single agent ~4x chat tokens; multi-agent ~15x; early versions spawned 50 subagents for simple queries | fan-out is the second-largest lever |
| Anthropic, context engineering | compaction, structured note-taking, tool-result clearing, just-in-time retrieval, subagent summaries of 1,000-2,000 tokens; "context rot" | context control is the first lever |
| s1, arXiv 2501.19393 | budget forcing: cap thinking tokens, force final answer; scaling saturates around 6x | a hard cap too early costs quality; saturation is real |
| TALE, arXiv 2412.18547 | estimate a token budget per problem from reasoning complexity; cuts over-thinking | budgets should scale with task complexity, not role |
| runguard.dev (practitioner) | ADK `max_iterations` misses non-progress loops, back-delegation, and parallel spawn limits | a single stop signal is insufficient |

### 2.3 What the evidence does and does not support

Supported:
- every production framework has a last-resort step ceiling;
- per-request context limits and deferral appear in at least two independent frameworks;
- identical-call detection appears in CrewAI and in smolagents' system prompt;
- fan-out needs a breadth control in addition to a depth control.

Not supported:
- any universal numeric budget. Every framework picks a round number. The correct value is workload-specific and must be measured.
- role-based thresholds. No framework surveyed does this.
- the claim that a tool-call quota prevents the worst burns. The host data contradicts it.

---

## 3. Current implementation (read from this tree)

### 3.1 Behaviour map

| Location | Behaviour |
| --- | --- |
| `src/services/iteration-budget.ts:5-6` | `DEFAULT_PARENT_LIMIT=90`, `DEFAULT_SUBAGENT_LIMIT=60` |
| `src/services/iteration-budget.ts:85-87` | 90 applies only to `TAWA_AGENT`; every other agent gets 60, including a non-tawa root caller |
| `src/services/iteration-budget.ts:80-83` | budget key is `agent@session` |
| `src/services/iteration-budget.ts:11-16` | tiers: shallow 60, moderate 100, deep 160, analyze-first 320 |
| `src/services/iteration-budget.ts:25-26` | adaptive: +50% per exhaustion, ceiling 4x |
| `src/services/iteration-budget.ts:129-149` | `consume` grows the limit, then blocks when exhausted |
| `src/services/iteration-budget.ts:194` | `DEFAULT_CAP = { maxDepth: 3, maxSubagents: 5, maxTokens: 10000 }` |
| `src/services/iteration-budget.ts:196-200` | `setCap` has no callers |
| `src/services/iteration-budget.ts:206-212` | `checkCap(agent, depth, subagentCount, tokens)` |
| `src/hooks/guards/dispatch-guards.ts:42` | calls `checkCap(agent, depth, 0, 0)` — subagent and token branches are dead |
| `src/hooks/guards/dispatch-guards.ts:207-221` | `budgetGuard` assigns a tier from `analyzeEffort(desc)` then checks `remaining` |
| `src/hooks/guards/tool-loop-guard.ts:9-16,193-207` | repeat-result counter: every successful result for a named agent is recorded and warned at 3 when the result is a string; failures reset the run; the block at 4 is limited to `REPEAT_BLOCK_TOOLS` (`read|grep|glob`); window 8 (Revision 2.2; narrowed 2.3) |
| `src/hooks/guards/tool-loop-guard.ts:123-127` | no-progress counter, fed only from the tool-failure branch at `tool-execute.ts:581`; it cannot see a tool-free S1 echo (Revision 2.2) |
| `src/hooks/tool-execute.ts:265-287` | `consume(agent, sessionID)` on every tool of a named agent; `refund` on heartbeat failure |
| `src/services/context-nudges.ts:3-7` | thresholds 0.70 / 0.85 / 0.95 |
| `src/services/context-nudges.ts:21-24` | cooldown 60 s, one fire per severity tier |
| `src/hooks/message-updated.ts:449-475` | nudge evaluated only when `role === "user"`, using an estimate from the priority index |
| `src/bootstrap/event-integrations.ts:226-238` | cost recorded as `outputTokens = outputLength x factor`, `inputTokens = outputTokens x 1.5` |
| `src/bootstrap/plugin-init.ts:1230` | event hook handles `session.error`, `session_idle`, free-limit; no usage event |
| `src/services/cost-transparency/tracker.ts:57` | `recordOperation` exists and supports `cacheReadTokens` |
| `src/context/config-schema.ts:16-20` | `adaptiveBudgets`, `budgetStepPercent`, `budgetCeilingFactor`, `budgetTiers` |
| `src/hooks/PipelineState.ts:42` | `MAX_EXEMPT_CALLS = 20` |
| `src/hooks/guards/dispatch-guards.ts:236-252` | `callDepth` increments the parent session only; exempt recon does not increment |
| `docs/experiments/receipts/2026-11-05-schema-payload.json` | live tool-schema payload: 44 tools, 24,513 bytes, 6,129 estimated tokens per request (Revision 2) |
| `src/hooks/session.ts:291-373,431,524` | compaction digest, Session Index, and recent decisions are injected into context; only the Session Index has a 90k compaction-time ceiling; the digest, decisions, and R1 clause are unmeasured (Revision 2.1) |
| `docs/plan-report-path-to-tawa.md` Section 4.3 | the R1 report clause is injected on every routed dispatch; its recurring token cost is unmeasured (Revision 2) |

### 3.2 Defect inventory

| ID | Defect | Evidence | Consequence |
| --- | --- | --- | --- |
| D1 | Budget multiplies with fan-out | key is `agent@session`, `iteration-budget.ts:80-83` | 5 agents = 5 independent budgets; children each get a fresh 60 |
| D2 | Token and subagent caps are dead | `checkCap(..., 0, 0)`, `dispatch-guards.ts:42` | the two fields specifically meant for this problem never fire |
| D3 | No consumer for host usage | `grep "usage.updated" src/` returns zero | the authoritative token numbers are unused |
| D4 | Context nudge is user-turn-only and estimated | `message-updated.ts:452-458` | blind to S1, and measures text length, not billed tokens |
| D5 | Cost telemetry is fabricated | `event-integrations.ts:226-232` | no decision can be based on current cost reports |
| D6 | Identical-repeat blocking covers only read-only search tools | `tool-loop-guard.ts:9-16,193-207`; every successful result for a normalized agent is recorded and warned at 3 (`tool-execute.ts:564-575`), the warning is appended only when the result is a string (`:574`), and failures reset the run (`:577-580`); `REPEAT_BLOCK_TOOLS` is `read/grep/glob` | non-read loops (`bash`, MCP) are warned but never blocked; failed repeats are not counted; assistant-turn echo is uncovered; S2 is only partially covered (Revision 2.2; narrowed 2.3) |
| D7 | The no-progress counter is tool-failure-only | `tool-loop-guard.ts:123-127`; the sole call is `tool-execute.ts:581` | a tool-free S1 echo never increments it; "absent" was too strong, "covered" is too strong (Revision 2.2) |
| D8 | Nudge does not trigger compaction or deferral | `context-nudges.ts` only logs or injects text | warning without mechanism |
| D9 | `consume` counts spend-neutral and spend-increasing tools identically | `tool-execute.ts:268` | the quota blocks a final report as readily as a new subagent |
| D10 | The permanent schema payload has no owner in this plan | `docs/experiments/receipts/2026-11-05-schema-payload.json`: 24,513 B / 6,129 tokens for 44 tools; the archived 13,868 B undercounts because it used the src zod instance | the largest fixed per-request cost is absent from the option space (Revision 2) |
| D11 | Dispatch results are uncapped | `TASK_TOOL_NAMES` at `security-policy.ts:14`; the 50k truncation excludes all three at `tool-execute.ts:771-772`; `!quarantineApplied` at `:771` is a second bypass | a `task`, `handoff`, or `fasttrack` result can enter the parent arbitrarily large, and quarantined output bypasses the same cap (Revision 2.2; widened 2.3) |
| D12 | A missing agent is a total budget bypass | `tool-execute.ts:265` wraps `consume`; dedup at `:200` and the loop guard at `:217` also require `normalizedAgent` | no-agent calls skip dedup, loop guard, and budget while the pipeline still runs (Revision 2.2) |
| D13 | `checkCap`'s depth branch duplicates `MAX_CALL_DEPTH` and silently diverges from the knob | depth guard at `dispatch-guards.ts:39-41`, `checkCap(..., 0, 0)` at `:42` (the guard is `task`-only, `:32`); `DEFAULT_CAP.maxDepth = 3` at `iteration-budget.ts:194`; knob 1..20 at `config-schema.ts:14`, wired at `src/context/facades/config-facade.ts:60` and `src/hooks/guards/shared/limits.ts:12-15` | at 4+, the guard passes depth 4 and `checkCap` rejects it with "max depth (3)"; the knob is silently clamped, the subagent and token branches stay dead, and two sources disagree. Reconciliation: K3 is the ceiling; the knob is clamped at the wiring point (17.3) (Revision 2.2; resolved 2.3) |
| D14 | The usage event is ephemeral and carries no agent | `event-manifest.d.ts:1136`; payload at `:1120-1132` | no replay after a disconnect; lineage must come from `session.get`; every gap must be labelled (Revision 2.2) |

### 3.3 What already works and must not be broken

- Adaptive budget growth and tier assignment already implement a crude effort scaling. Any new design should reuse `assignTier`, not replace it.
- `ContextNudgeManager` already has the right shape: thresholds, cooldown, one fire per tier, bounded history. It needs a better input, not a rewrite.
- `callDepthGuard`, `MAX_EXEMPT_CALLS`, and `commitCallDepthEffect` are correct for what they do. Do not touch them.
- The uncommitted 19-file change set (guard messages, depth parity, new `task-targets.ts`, `prove-guard-routing.ts`) is unrelated. It should be committed first so this work has a clean base.

---

## 4. Design axes

Every architecture in Section 5 is a bundle of choices on these axes. Enumerating the axes is what makes the option space complete.

### Axis A — Measurement source

| ID | Option | Note |
| --- | --- | --- |
| A0 | none | status quo for tokens |
| A1 | text-length estimate | current cost path; cheap, wrong |
| A2 | host `session.usage.updated` | authoritative, per event, zero extra requests |
| A3 | `session.get` polling | authoritative but laggy and costs a request |
| A4 | A2 + A3 reconciliation on boot | restart-safe |
| A5 | provider billing API | not exposed to the plugin; out of scope |

### Axis B — Control unit

B1 tool calls (current) · B2 model turns · B3 tokens · B4 cost in USD · B5 context size · B6 wall-clock time · B7 composite.

### Axis C — Scope

C1 per call (no state) · C2 per agent per session (current) · C3 per session aggregate · C4 per session tree · C5 per project · C6 global.

### Axis D — Intervention shape

D1 hard block · D2 advisory only · D3 graduated zones · D4 adaptive growth (current) · D5 rate limit (tokens per minute) · D6 circuit breaker (open/half-open/closed) · D7 session pause · D8 model downgrade · D9 forced handoff or compaction.

### Axis E — Trigger type

E1 absolute quota · E2 rate or anomaly · E3 identical repeat · E4 no-progress loop · E5 fan-out breadth or duplication · E6 context pressure · E7 predictive forecast.

### Axis F — Enforcement point

F1 `tool.execute.before` · F2 dispatch guard on `task` only · F3 `message.updated` · F4 event hook · F5 host config · F6 prompt or tool-description advisory.

### Axis G — Persistence

G1 in-memory map (current) · G2 JSONL append log · G3 state DB · G4 reconstruct from host on boot · G5 G1 + G4.

### Axis H — Fan-out control

H1 depth only (current, fixed) · H2 concurrent live children cap · H3 total children per session · H4 near-duplicate task detection · H5 budget inheritance (child draws from parent) · H6 child output cap · H7 child time-box.

### Axis I — Context control

I1 percentage nudge (current) · I2 tool-result deferral (>X% of window) · I3 stale tool-result clearing · I4 subagent output cap · I5 compaction trigger · I6 just-in-time retrieval · I7 tool-schema diet (permanent context) · I8 cross-turn result cache keyed by path+mtime.

### Axis J — Failure semantics

J1 block all tools · J2 block new spend only (dispatch + large reads), allow finish/report · J3 advisory and continue · J4 pause the session for the user · J5 force handoff · J6 downgrade model.

### Axis K — Rollout policy

K1 default on with enforcement · K2 shadow mode (measure, log, no enforcement) · K3 opt-in, default off · K4 per-project config, global default.

---

## 5. Candidate architectures

Each option is scored in Section 6. Options 0 and 8 are included for completeness even though they are expected to fail the gate.

### Option 0 — Do nothing
- Bundle: A0/B1/C2/D4/E1/F1/G1.
- Mechanism: keep the current adaptive tool-call budget.
- Catches: a very long single-agent tool spree.
- Misses: S1, S2, S3, context growth, cache.read cost.
- Pros: zero risk, zero cost. Cons: the observed 466M-token failure remains possible.
- Effort: none.

### Option 1 — Fix the dead fields only
- Bundle: A1/B3+C3/D3/E1/F2/G1.
- Mechanism: feed `checkCap` real counters (subagent count from `callDepth` state; tokens from a per-session counter incremented on tool calls) and keep everything else.
- Catches: crude fan-out and crude token volume.
- Misses: S1 (no tools), and the token counter is still an estimate.
- Pros: two lines plus a counter; no new service. Cons: a fictional measurement driving a real block; high false-positive risk.
- Effort: S.

### Option 2 — Shape guards only, no numeric budgets
- Bundle: A2/B2+D3/E3+E4+E5/F1+F2/G1.
- Mechanism: three behavioural detectors with no token accounting:
  - identical signature: same tool + canonical args + same result digest; 3rd call returns the cached result, 5th returns an error;
  - no-progress: 12 consecutive turns with no tool call, no file change, and output < 5% of input;
  - fan-out: 6 children in 10 minutes with >= 80% task-text similarity, or 8 concurrent live children.
- Catches: S1, S2, S3 exactly.
- Misses: a slow burn that never repeats (300 distinct expensive reads), and a single enormous context.
- Pros: no quotas at all; matches K2 precisely; near-zero false positives. Cons: no global ceiling; requires the usage ledger anyway for the echo detector.
- Effort: M.

**Revision 2.2 note.** Two changes to this option are required. The `output < 5% of input` clause is
superseded: even with fresh input as the denominator, a legitimate long-context turn can satisfy
it, so the P3 detector triggers on no tool call + no file change + n-gram overlap, and keeps the
ratio only as a diagnostic. The third-call cache is restricted to read-only tools (`read`, `grep`,
`glob`, and similar); for `write`, `edit`, `bash`, `task`, `handoff`, and `fasttrack`, identical
args can meet a changed filesystem or child state, so the guard hard-fails or returns a warning
with a pointer, never a cached success.

### Option 3 — Host ledger + graduated session budget
- Bundle: A2/A4 + B3/B5 + C3 + D3 + E1/E6 + F4/F1 + G5.
- Mechanism: subscribe to `session.usage.updated`; maintain per-session totals and last `input` (context size); enforce zones at 50 / 75 / 90% of a session budget; block only new spend in the red zone.
- Catches: slow burn, echo loops, oversized contexts.
- Misses: identical repeats that are individually cheap, near-duplicate fan-out.
- Pros: measures what is billed; restart-safe via `session.get`; graduated. Cons: one number to calibrate; risk of a false positive on a legitimate long session.
- Effort: M.

### Option 4 — Hard turn circuit breaker
- Bundle: A1/B2/C3/D1/E1/F1/G1.
- Mechanism: stop the session after N turns (10 / 20 / 60 presets), regardless of cost.
- Catches: S1 and any runaway.
- Misses: cheap-but-long sessions are over-blocked; expensive single turns are under-blocked.
- Pros: simplest possible. Cons: exactly the blunt quota the owner rejected; high false positives.
- Effort: S.

### Option 5 — Cost-based budget
- Bundle: A2/B4/C3/D3/E1/F4/G5.
- Mechanism: use the host's `cost` field instead of tokens.
- Catches: everything tokens catch, and prices reflect the actual model.
- Misses: free or unpriced models report zero; cost is model-dependent so a fair default is hard.
- Pros: directly what the user pays. Cons: not portable across models; `cost` may be unknown.
- Effort: M.

### Option 6 — Context-first only
- Bundle: A2/B5/C3/D3/E6/F3+F1/G2.
- Mechanism: no session budget. Only per-request context control: nudge at 65%, defer results > 10% of window at 80%, force summarise/save at 90%; plus subagent output cap and stale-result clearing.
- Catches: the dominant cost driver (cache.read), and indirectly S1 because a smaller context makes a loop cheaper but not impossible.
- Misses: fan-out of many small contexts; a text loop still runs, just cheaper.
- Pros: highest leverage per line of code; zero quota philosophy; low false positives. Cons: no global stop; does not bound total spend.
- Effort: S-M.

### Option 7 — Tree-scoped token accounting
- Bundle: A2/B3/C4/D3/E1/F2+F4/G3.
- Mechanism: maintain a root session id per tree and charge every descendant to the root budget.
- Catches: fan-out multiplication precisely.
- Misses: nothing extra, but implementation is fragile.
- Why it was previously rejected: `callDepth` is per session and a child starts at 0, so lineage is not authoritative; `input.agent` can be absent; process restart loses the map; the tree key is not present in the usage event.
- Pros: conceptually the cleanest answer to D1. Cons: fail-open on every one of the above.
- Effort: L.

**Revision 2 note:** the rejection reason above is superseded. `session.created` carries
`data.parentID` (`event-manifest.d.ts:320,410`) and `session.get` returns `parentID`
(`promise/generated/types.d.ts:3062-3064`; call at `promise/client.d.ts:213`), so lineage is
available and restart-safe through a lazy lookup. The
remaining question is runtime reliability, which Probe 0 answers. Option 7 is reopened for the
five-agent review; see Section 14.2.4.

### Option 8 — Delegate to the host
- Bundle: A5/B2/C3/D1/E1/F5/G1.
- Mechanism: rely on an OpenCode config key for max turns or token budget.
- Feasibility: the only relevant host key found is `experimental.subagent_depth`. No `maxTurns` or token budget key is present in the schema used by this tree.
- Verdict: not implementable today. Included so evaluators can confirm or refute.

### Option 9 — Composite (recommended by the author)
- Bundle: A2/A4 + B3 primary, B2/B5 secondary + C3 (with C2 retained for tiering) + D3/D4 + E1/E3/E4/E5/E6 + F4/F1/F2/F3 + G5 + H2/H4/H6 + I2/I3/I4/I5.
- Mechanism: Option 3 as the ceiling, Option 2 as the behavioural layer, Option 6 as the context layer. One ledger feeds all three.
- Catches: S1, S2, S3, slow burn, context bloat, fan-out multiplication.
- Misses: nothing observed, but it is the largest change and the hardest to reason about.
- Pros: each layer covers another's blind spot; the ledger is shared so cost is paid once. Cons: most code; most configuration surface; risk of interaction bugs.
- Effort: L.

### Option 10 — Shadow-first wrapper (policy, not architecture)
- Bundle: K2 applied to any of 2, 3, 6, or 9.
- Mechanism: compute every threshold and log every would-be intervention, but enforce nothing for a fixed period; then calibrate and flip.
- Pros: turns every default into a measured number; no user-visible false positives during calibration. Cons: no protection during the shadow period.
- Effort: S on top of the chosen architecture.

### Option 11 — Fixed-cost diet (added in Revision 2)
- Bundle: static, outside the runtime axes. It is measured as B5 (context size), scoped C6
  (global payload), and enforced at build time on the F6 surface (tool descriptions and schemas).
- Mechanism: measure the live per-request payload (44 tools, 24,513 B, 6,129 tokens), set a
  measured target, and cut it: shorter parameter descriptions, removal of duplicated hints,
  consolidation of overlapping tools, and lazy or grouped tool exposure where the host supports
  it. Pin the result with a live measurement in `prove-context-diet.ts` instead of the frozen
  literal, and add byte budgets for the plugin's own injections (compaction digest, Session Index,
  R1 clause).
- Catches: the steady-state cost that every session pays on every request; it makes every other
  control cheaper to run because the baseline is smaller.
- Misses: S1, S2, S3. It does not stop a loop; it lowers the price of each iteration.
- Pros: no behaviour change, no false positives, deterministic, measurable before and after,
  no runtime state, no new dependency. Cons: it does not bound total spend, and every schema byte
  is functional, so the cut must be argued tool by tool.
- Effort: M.
- Score under the existing weights (illustrative): efficacy 2, bypass 5, false-positive 5,
  constraints 5, cost 4, observability 4, restart 5 -> weighted 4.10. If Option 9's efficacy is
  corrected from 5 to 4 for the C3/D1 defect, Option 9 scores 4.05. The missing option then
  outranks the recommendation; the five-agent review should attack that result, not accept it.

  **Revision 2.1 correction.** The 4.10 is not a valid ranking against Option 9 or any other
  architecture. Section 6 disqualifies any option with efficacy < 3, and Option 11 is scored 2 by
  its own row. Four reviewers scored efficacy 2; reviewer 2 scored 1. Option 11 is therefore
  reclassified as a **complementary Layer 0 phase with its own metric** (bytes and tokens saved
  per request), not as a candidate architecture. Its 18.4% target cut (24,513 -> 20,000 B, about
  1,128 tokens per request) is worth about 112,800 raw tokens over 100 requests, or 7.5% of a 1.5M
  budget, if the schema is uncached. If it is cached at `w_read = 0.10`, the same cut is about
  11,280 weighted tokens (0.75%); because the first request is uncached, the exact figure is about
  12,300 (0.82%). Quote the conditional pair, not one number. Do it for latency and cache
  behaviour, not as the primary stop.

---

## 6. Decision matrix

Weights sum to 100. Scores are 1-5.

| Criterion | Weight |
| --- | --- |
| Efficacy against S1/S2/S3 | 25 |
| Bypass resistance | 20 |
| False-positive safety | 20 |
| Fit to owner constraints K1-K6 | 15 |
| Implementation cost (5 = cheapest) | 10 |
| Observability | 5 |
| Restart resilience | 5 |

Gate: an option is disqualified if efficacy < 3 or constraint fit < 4.

| Option | Eff | Bypass | FP | Constraints | Cost | Obs | Restart | Weighted | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 Do nothing | 1 | 1 | 5 | 5 | 5 | 1 | 5 | 3.00 | disqualified (efficacy) |
| 1 Dead fields | 2 | 2 | 4 | 4 | 5 | 1 | 2 | 2.95 | disqualified (efficacy) |
| 2 Shape only | 3 | 3 | 4 | 5 | 3 | 3 | 2 | 3.45 | passes |
| 3 Ledger + budget | 4 | 4 | 3 | 4 | 3 | 5 | 5 | 3.80 | passes |
| 4 Turn breaker | 3 | 3 | 2 | 3 | 5 | 3 | 2 | 2.95 | disqualified (fit) |
| 5 Cost budget | 4 | 4 | 3 | 4 | 3 | 4 | 4 | 3.70 | passes |
| 6 Context only | 3 | 4 | 5 | 5 | 3 | 3 | 2 | 3.85 | passes |
| 7 Tree scope | 3 | 2 | 3 | 3 | 2 | 3 | 1 | 2.60 | disqualified (fit) |
| 8 Host-native | 1 | 1 | 5 | 5 | 5 | 1 | 1 | 2.80 | disqualified (efficacy) |
| 9 Composite | 5 | 4 | 4 | 5 | 2 | 5 | 5 | 4.30 | passes |
| 11 Fixed-cost diet | 2 | 5 | 5 | 5 | 4 | 4 | 5 | 4.10 | complementary (gate-exempt) |

Sensitivity note: if false-positive safety is weighted at 30 and efficacy at 15, Option 6 ties Option 9. If implementation cost is weighted at 25, Option 6 wins outright. The case for Option 9 therefore rests on one claim: that a slow, non-repeating burn is real enough to justify the extra machinery. Evaluators should attack that claim first.

**Revision 2 corrections to this section.** Option 8's weighted total is 2.80, not 2.30: 25 + 20 +
100 + 75 + 50 + 5 + 5 = 280. The verdict is unchanged. The sensitivity note is not reproducible as
stated: moving 15 points from efficacy to cost (efficacy 10, cost 25) leaves 100 total and makes
Options 6 and 9 tie at 3.85; it does not make Option 6 win outright. This tie assumes the
then-uncorrected efficacy 5; at efficacy 4 the same offset gives Option 6 the win, 3.85 to 3.75
(Revision 2.2 correction below; annotated in 2.3). Finally, if Option 9's
efficacy is corrected from 5 to 4 because C3 does not fix D1 (Section 14.2.1), its total falls to
4.05, below Option 11's 4.10. These corrections do not rewrite the original rows; they are the
Revision 2 reading of them.

**Revision 2.1 note — the five-agent review.** Five independent recomputations put the passing
architecture scores at: Option 2 median 3.60 (range 3.25-3.90), Option 3 median 3.80 (3.50-3.80),
Option 6 median 3.65 (3.60-3.85), Option 7 median 3.35 (2.70-3.50), Option 9 median 3.85
(3.60-4.05). The spread is wider than the gap between the top rows, so the matrix supports "Option
9 is at or near the top", not "Option 9 beats Option 6". Option 11 is 4.10 in four reviews and
3.85 in one; four reviews score efficacy 2 and one scores 1, so the gate disqualifies it as an
architecture. It is retained as a complementary phase. Option 10 has no row and is a rollout
modifier, not an option. The first sensitivity clause is also still unreproducible: at efficacy 15
and false-positive 30 (the other weights unchanged), Option 9 is 4.20 and Option 6 is 4.05; they
do not tie. Only the cost-25 clause, with the offset taken from efficacy, ties at 3.85 (efficacy 5;
at efficacy 4 it is a 3.85-3.75 win, per the Revision 2.2 correction; annotated in 2.3). No original
row is deleted; this is the review's reading of it.

**Revision 2.2 correction — sensitivity recomputed with the corrected efficacy.** The Revision 2
paragraph above and the Revision 2.1 note both mix the uncorrected efficacy 5 with the corrected
efficacy 4. Recompute with Option 9 at efficacy 4 (the C3/D1 correction, Section 14.2.1) and the
other weights unchanged: at efficacy 15 / false-positive 30, Option 6 is 4.05 and Option 9 is
4.05, a tie; at efficacy 10 / cost 25, Option 6 is 3.85 and Option 9 is 3.75, so Option 6 wins
outright. The original Section 6 sensitivity note therefore holds once Option 9's efficacy is
corrected, and the Revision 2.1 sentence above that called the first clause unreproducible is
withdrawn. Option 11's 4.10 stays gate-exempt: the 4.10 vs 4.05 comparison is a metric comparison,
not a ranking.

---

## 7. Recommended composite (author's position)

### 7.1 Components

1. **UsageLedger** — new, small. Subscribes to `session.usage.updated`. Keeps per session: total tokens, total cost, last `input` (context size), turn count, tool count, child set, last progress timestamp. Reconciles from `session.get` on boot. Writes JSONL for calibration.
2. **Context pressure** — feeds the existing `ContextNudgeManager` with real `input` tokens and evaluates on every turn, not only user turns. At 80% enables tool-result deferral; at 90% requests summarize/save.
3. **Session burn budget** — a session-level aggregate (fixes D1) with zones at 50 / 75 / 90%. Amber: one advisory. Orange: block new `task` dispatches and defer large results. Red: block new spend only; edits, writes, and reports stay allowed.
   **Revision 2 correction:** a session-level aggregate fixes the per-agent split inside one
   session, not fan-out across child sessions. Each child is a separate session with its own
   budget. D1 requires C4 (tree) or H5 (budget inheritance); see Section 14.2.1.
4. **Shape guards** — identical repeat (3rd returns cached, 5th errors; read-only results only, never a cached success for a write), no-progress echo (12 turns with no tool call, no file change, and n-gram overlap), fan-out (8 concurrent, 6 near-duplicates in 10 minutes).
5. **Subagent output cap** — child results entering the parent context are capped at 2,000 tokens with a pointer to the child session.
6. **Honest cost** — replace the fabricated estimate in `event-integrations.ts` with host numbers; keep the estimate only as a labelled fallback.

### 7.2 Escalation ladder

| Zone | Trigger | Action |
| --- | --- | --- |
| Green | < 50% of budget, context < 65% | measure only |
| Yellow | 50-75%, or context 65-80% | one advisory per zone entry |
| Orange | 75-90%, or context 80-90% | block new dispatches; defer results > 10% of window |
| Red | >= 90% | block new spend only; allow finish and report |
| Shape trip | repeat 5x, echo 12 turns, fan-out 8/6 | targeted stop with a specific message |

### 7.3 Threshold presets

| Parameter | Conservative | Balanced | Strict |
| --- | --- | --- | --- |
| Context nudge / defer / save | 0.75 / 0.88 / 0.95 | 0.65 / 0.80 / 0.90 | 0.55 / 0.70 / 0.85 |
| Root budget (tokens) | 3,000,000 | 1,500,000 | 750,000 |
| Child budget (tokens) | 800,000 | 400,000 | 200,000 |
| Zone edges | 0.60 / 0.85 / 0.95 | 0.50 / 0.75 / 0.90 | 0.40 / 0.65 / 0.85 |
| Identical repeat reuse / stop | 4 / 6 | 3 / 5 | 2 / 4 |
| Concurrent children | 12 | 8 | 6 |
| Duplicate fan-out | 8 in 10 min, 90% similar | 6 in 10 min, 80% similar | 4 in 10 min, 70% similar |
| Subagent output cap (tokens) | 4,000 | 2,000 | 1,500 |
| Echo turns | 20 | 12 | 8 |
| Hard turn backstop | none | 80 | 40 |

All values are provisional and must be replaced by measured p99 values after the shadow period.

### 7.4 Failure semantics

- Red zone blocks only actions that increase future spend: `task`, `handoff` to a new agent, and reads larger than 20% of the window.
- Edits, writes, `record`, and the final report are never blocked. An agent must always be able to land its work.
- If usage events are missing, the governor fails open with a loud warning. It must never silently pretend to measure.

### 7.5 What it deliberately does not do

- It does not touch `MAX_CALL_DEPTH`, `callDepth`, or host nesting.
- It does not add a role condition.
- It does not replace the adaptive tier budget; it adds a session-level aggregate and leaves per-agent tiering in place.
- It does not lower any existing limit by default.

---

## 8. Rejected designs and the exact reason

| Design | Reason |
| --- | --- |
| Per-call hard quota | Bypassable by fan-out; blind to S1; blocks legitimate work (K2). |
| Role-based caps (tawa 20, others 5) | Bypassable and explicitly rejected by the owner (K1). |
| Tree-scoped call accounting | Lineage is not authoritative: child `callDepth` starts at 0, `input.agent` may be absent, restart loses the map (Option 7). |
| Kill all tools at the limit | Traps the agent before it can write its result (D9). |
| Lowering `MAX_CALL_DEPTH` | Out of scope (K3); depth is not the burn driver. |
| A second, independent budget subsystem | Two controllers would fight; the tree already has `iteration-budget.ts` with adaptive growth. |
| Removing the existing budget entirely | Loses the only last-resort stop before the new ledger is proven. |

---

## 9. Calibration protocol

1. Ship the ledger in shadow mode (Option 10). No enforcement.
2. Log one JSONL record per usage event: `ts, sessionID, agent, depth, input, output, reasoning, cacheRead, cacheWrite, cost, turn, contextSize`.
3. After 7 days and at least 30 sessions, compute p50 / p90 / p99 of session totals separately for root and child.
4. Set root budget = p99(root) x 1.5, child = p99(child) x 1.5.
5. Acceptance: fewer than 1% of legitimate sessions enter Orange; zero legitimate sessions enter Red.
6. Re-check weekly; the numbers are expected to move with model and workload changes.

Falsification criteria:
- If p99(root) is below 300k, the budget layer is unnecessary and Option 6 should win.
- If fewer than 2 echo-flagged sessions occur in 30 sessions, the echo detector is dead weight; keep it in shadow.
- If the repeat detector fires on more than 5% of legitimate sessions, the digest rule is too strict.

**Revision 2.2 note.** An echo event is one session with at least one flagged turn; raw flagged
turns are reported separately so a single runaway session cannot look like two events. The P2
shadow run supplies this reading before P3 enforcement.

**Revision 2 addition — calibrate from history, not only from waiting.** `session.list` returns
`SessionInfo[]` with cumulative `tokens` and `cost`, so the first p50/p90/p99 distribution can be
computed from existing sessions before the 7-day shadow window ends. The JSONL remains the source
for per-turn shape (repeat, echo, fan-out), which history cannot reconstruct. The 7-day window
stays as the forward sample; it is no longer the only source.

---

## 10. Validation plan

Chaos scenarios, each a proof:

| Scenario | Expected |
| --- | --- |
| 200 assistant turns, no tools, no file change, n-gram overlap | echo detector trips at the configured turn |
| Same read-only tool + args + result 20 times | 3rd returns cached, 5th errors |
| Same write tool + args + result 20 times | 3rd warns or hard-fails, never a cached success |
| 50 children, 80% duplicate task text | dispatch refused after the configured cap |
| 300 distinct large reads, no repetition | session budget reaches Orange, no false shape trip |
| Legitimate 200-call, 400k-token session | no trip at any layer |
| Restart mid-session | ledger reconstructs from `session.get` |
| Missing usage events | fail open with a warning, no silent zero |
| Missing `input.agent` | session-level accounting still covers it |

Gates: `npm run gate:fast`, the four proof shards, `gate:smoke`, and `npm run verify`. New proofs must be registered in `scripts/gate-manifest.json`, `scripts/proof-shards.json`, and the catalog.

---

## 11. Implementation phases

| Phase | Content | Exit criterion | Rollback |
| --- | --- | --- | --- |
| 0 | Commit the existing 19-file guard change set separately (Revision 2: completed in `545f185`..`e329e8b`) | clean base (met) | revert the commit |
| 1 | `UsageLedger` + JSONL + shadow report; no enforcement | 7 days of data, report command works | delete the service and its hook |
| 2 | Fix D2 (feed `checkCap`), wire context pressure to real tokens, evaluate on assistant turns | context nudge fires on a synthetic echo loop | feature flag off |
| 3 | Shape guards: repeat, echo, fan-out, output cap | all chaos proofs pass, zero false positives on replay | flag off |
| 4 | Session budget zones, calibrated from phase 1 | < 1% legitimate Orange, 0 legitimate Red | flag off |

Config keys (all optional, all defaulting to the balanced preset): `usageGovernor.enabled`, `.mode` (shadow|enforce), `.preset`, `.rootBudget`, `.childBudget`, `.contextThresholds`, `.repeat`, `.fanOut`, `.echo`, `.outputCap`.

**Revision 2.2 note on Phase 2.** The D2 half does not run in Phase 2. Its counters come from the
ledger (P2) and its depth branch must be reconciled with the `maxCallDepth` knob (D13), so D2 moves
to P3 after the ledger gate. Revision 2.3 fixes the reconciliation in 17.3: the knob is clamped at
the wiring point. Phase 2 keeps the context half only. The shape detectors run in shadow during
Phase 1 (P2) and enforce in Phase 3 (P3).

**Revision 2 execution order.** The original phases stay as written. Revision 2 moves the
fixed-cost diet ahead of the ledger and inserts a probe and a decision gate:

| Revision 2 order | Phase | Content | Gate |
| --- | --- | --- | --- |
| P0 | Probe 0 | one isolated root + child run, plus the Q13 4-deep chain; sixteen questions in Section 14.8 | receipt with sixteen answers |
| P1 | Fixed-cost diet (Option 11) | measure the live schema, set a target, cut, pin the live measurement, budget the plugin's own injections | live schema measured and pinned; description and injection budgets |
| P2 | Ledger shadow (original Phase 1) | `UsageLedger`, JSONL, historical backfill, self-injection audit, shadow repeat/echo/fan-out detectors | 7 days or 30 sessions, report command works, shadow readings exist |
| P3 | Behavioural guards (original Phase 3) | enforce repeat, echo, fan-out, output cap with a durable pointer; D2 after the ledger gate | chaos proofs pass; zero false positives on replay |
| P4 | Context pressure (original Phase 2, context half) | feed real host fields to the nudge; evaluate every turn | nudge fires on a synthetic echo loop |
| P5 | Budget (original Phase 4) | C4 if Probe 0 proves lineage and child usage, else C3; unit from Section 14.6 | p99 gate from Section 9; stop if p99(root) < 300k |

---

## 12. Open questions for evaluators

Answer each with a position and a reason.

1. Should the control unit be tokens, cost, turns, context size, or a composite? Why?
2. Should the budget scope be the session aggregate, the per-agent key, or the tree? If tree, how do you solve lineage and restart?
3. Is the "slow, non-repeating burn" a real risk in this workload, or a hypothetical used to justify extra code?
4. Should identical-repeat reuse the cached result (3rd call) or hard-fail immediately? What does that do to legitimate retries after an edit?
5. Is "output < 5% of input for 12 turns" the right echo signature, or is there a better one? (Revision 2.2: the ratio is a diagnostic; the trigger is no tool call + no file change + n-gram overlap.)
6. Should fan-out control be a concurrency cap, duplicate detection, budget inheritance, or all three?
7. Does a child session draw from the parent budget? If yes, how is that expressed without a tree key?
8. What should happen when `session.usage.updated` is missing or delayed? Fail open, fail closed, or degrade to estimates?
9. Verify at runtime: does the host emit usage events for subagent sessions with the child sessionID? If not, the ledger is blind to children.
10. Verify at runtime: is `input.agent` present for root callers? This determines whether a non-tawa root really gets 60 rather than 90.
11. Should `consume` count read-only tools at all, or only spend-increasing tools?
12. Should the subagent output cap truncate or reject? Truncation loses information; rejection wastes the child's work.
13. How does this interact with host auto-compaction, given reports that compaction sometimes never fires (#45249)?
14. Should enforcement be on by default, shadow-only, or opt-in?
15. Is there a simpler design that catches S1, S2, and S3 with less than half the code? If yes, describe it.

Revision 2 adds five questions:

16. Does the live schema payload (24,513 B, 6,129 tokens, 44 tools) justify a fixed-cost diet
    before any runtime control? Is it sent on every request, and how much of it is cached?
17. Is `tokens.input` inclusive of `cache.read`? The answer decides both the context-size formula
    and whether the echo signature can use `output / input` without false positives.
18. Should the budget count `cache.read` at full weight, at a price weight, or use `cost` directly?
    What is the default when the provider price is unknown?
19. Can tree accounting be rebuilt from `session.created.parentID` plus a lazy `session.get`?
    What happens when a child has no `parentID`, and how is that recorded?
20. Is a child-output cap implementable without a child-session read surface? If not, what durable
    pointer replaces the "pointer to the child session"?

---

## 13. Review protocol and scoring sheet

For each option, record:

```
Option: ___
Efficacy (1-5): ___
Bypass resistance (1-5): ___
False-positive safety (1-5): ___
Constraint fit (1-5): ___
Implementation cost (1-5): ___
Observability (1-5): ___
Restart resilience (1-5): ___
Gate passed: yes/no
Strongest argument for: ___
Strongest argument against: ___
Evidence that would change my verdict: ___
```

Adversarial prompts to run against every option:

- "Describe the cheapest way an agent defeats this control without violating any rule."
- "Describe a legitimate workflow this control would block."
- "Describe the smallest code change that would make this control vacuous."
- "What happens on process restart, missing agent name, missing usage event, and two concurrent roots?"
- "Does this control still work if the agent uses `handoff` instead of `task`?"

**Revision 2 instruction for the five-agent review.** Score the original options as written and
then score Option 11. Do not accept the Revision 2 corrections on authority: re-read the cited
files and the receipt. The four findings in Section 14.2 are the intended targets. Record for each
whether it is confirmed, refuted, or inconclusive, and state what evidence would change the verdict.

---

## 14. Revision 2 — re-evaluation and revised vision

### 14.1 Scope and method

Revision 2 re-reads the tree at HEAD `c14aa1b` after the report-path work landed (`d50e8e8`,
`e329e8b`). Every code claim in Revision 1 was re-checked; the Revision 1 line references still
resolve. Three new facts were measured or read from the host schema:

**Revision 2.1 correction.** The line-reference claim above is false. `checkCap` is at
`dispatch-guards.ts:42`, not 41; `budgetGuard` starts at `:207`, not 213; the depth commit is
`:236-252`, not 242-258; `MAX_EXEMPT_CALLS` is `PipelineState.ts:42`, not 31; and `SessionInfo`
is in `promise/generated/types.d.ts:3062-3064`, not in `promise/client.d.ts:3062` (that file is
346 lines). The call is `promise/client.d.ts:213`. Appendix B carries the corrected map.

- the live tool-schema payload is **24,513 bytes / 6,129 estimated tokens for 44 tools**
  (`docs/experiments/receipts/2026-11-05-schema-payload.json`), not the archived 13,868 bytes;
- `session.usage.updated` exists with `sessionID`, `cost`, and
  `tokens{input, output, reasoning, cache{read, write}}` (`event-manifest.d.ts:1097-1145`);
- `session.get` returns cumulative `tokens` and `cost` plus `parentID`, and `session.list`
  returns `SessionInfo[]`, so history can be used for calibration.

Nothing in Revision 1 is removed. The findings below are additions and in-place corrections.

### 14.2 The four structural findings

#### 14.2.1 C3 does not fix D1

Section 7.1 item 3 says a session-level aggregate "fixes D1". It does not. `C3` is one budget per
session; every child is a separate session with its own budget. The bundle has `C3` plus `H2`,
`H4`, and `H6`, but no `H5` (budget inheritance) and no `C4` (tree). Five children still mean five
budgets. The change fixes the per-agent split inside one session, not fan-out multiplication.

Consequence for the matrix: if Option 9's efficacy is corrected from 5 to 4, its weighted total is
4.05, not 4.30. It still passes the gate and still leads Option 6 (3.85), but the margin is one
point, not the margin the dossier claims. The correct fix is `C4` or `H5`; Probe 0 decides whether
`C4` is reliable.

**Revision 2.1 correction.** "One point" is wrong. 4.05 - 3.85 = 0.20 weighted points, and
4.10 - 4.05 = 0.05 against Option 11 (gate-exempt; a metric comparison, not a ranking). Both gaps
are inside the matrix's resolution: one point on any criterion moves a total by 0.05-0.25. The
five-agent review did not overturn the D1 finding; it confirmed it and rejected the margin
language.

#### 14.2.2 The largest fixed cost is missing from the option space

The measured schema payload is 6,129 tokens per request. At 100 requests that is **612,900
tokens**, about **41% of the 1.5M balanced root budget** if the budget counts cache reads. This is
not a pathological loop; it is the steady-state price of the tool surface. The dossier mentions
`I7` as an axis item and never turns it into an option, a defect, or a phase. Revision 2 adds
`D10`, Option 11, and P1.

The archived 13,868 B cannot be used for this argument. The receipt explains that the archived
measurement used the src zod instance, which drops property descriptions; the shipped hook sends
24,513 B. The gate must measure the live collection, not the frozen literal.

**Revision 2.1 correction — two units, two answers.** The 41% is the raw-token figure with
`cache.read` at full weight. Under the weighted formula in Section 14.6 (`w_read = 0.10`), 100
requests cost `6,129 + 99 x 613 = 66,816` weighted tokens, about **4.5%** of the 1.5M budget. If
the provider caches the schema, the weighted figure is the budget-relevant one; if it does not,
41% is real. The receipt measures the serialised collection, not transmission, and records no
cache-hit share, so both figures are conditional. State both; never quote 41% as the budget
share without saying "raw, uncached". The 18.4% target cut is worth about 112,800 raw tokens over
100 requests (7.5% of 1.5M) if uncached, or about 11,280-12,300 weighted tokens at `w_read = 0.10`
if cached (the first request is uncached); the weighted figure is 0.75-0.82%. Quote the
conditional pair, not one number.

#### 14.2.3 Measurement semantics are undefined, and the echo signature can misfire

The dossier never states whether `tokens.input` includes `cache.read`. That single ambiguity
changes two designs:

- **Context size.** If `input` excludes cache, context is `input + cache.read`; if it includes
  cache, context is `input`. Reading the wrong one understates or double-counts pressure.
- **Echo signature.** "output < 5% of input" is safe only when `input` means fresh input. With a
  100k-token cached context and 500 output tokens, the ratio is 0.5%; a healthy long-context
  session would satisfy the signature on every turn and trip after 12 turns.

The same problem applies to the budget: summing `input + cache.read` at equal weight overstates
the cost of cached context. Section 14.6 fixes the formula. Probe 0 resolves the field semantics
before any code is written.

#### 14.2.4 Option 7's rejection reason is stale

Revision 1 rejects tree accounting because "lineage is not authoritative: child `callDepth` starts
at 0, `input.agent` may be absent, restart loses the map". The first and third points are no
longer true of the host:

- `session.created` carries `data.parentID` (`event-manifest.d.ts:320,410`);
- `session.get` returns `parentID` (`promise/generated/types.d.ts:3062-3064`; the call is
  `promise/client.d.ts:213`; Revision 2.1 corrects the Revision 2 citation, which pointed at a
  346-line file);
- a lazy lookup rebuilds the map after restart: first sight of a session -> `session.get` ->
  `parentID` -> recurse.

`callDepth` is still not lineage, but it is not the only source. Option 7 is reopened; the open
question is runtime reliability of `parentID` for every child, not the existence of the field.

### 14.3 Minor corrections

| # | Revision 1 statement | Revision 2 reading |
| --- | --- | --- |
| 1 | Option 8 weighted total 2.30 | 2.80; the arithmetic is 25 + 20 + 100 + 75 + 50 + 5 + 5; the verdict is unchanged |
| 2 | "cost weighted at 25 -> Option 6 wins outright" | under the natural offset (efficacy 10, cost 25) Options 6 and 9 tie at 3.85; the note must state the offsetting weight |
| 3 | Phase 0 commits the 19-file change set | completed in `545f185`..`e329e8b`; the tree is clean apart from the uncommitted report-path doc change |
| 4 | "reconcile from `session.get` on boot" | `SessionBridge` exposes `create/prompt/context/wait/modelList` only; `get` and `list` must be added |
| 5 | child output cap "with a pointer to the child session" | no child-session read surface exists; the cap needs a durable pointer (a file or the context-pack store), not a session id |
| 6 | root budget 1.5M tokens | express the default as a multiple of the model window or as a USD ceiling; 1.5M is 7.5 windows at 200k and 1.5 windows at 1M |
| 7 | Phase 1 -> Phase 4 is linear | add a decision gate after the ledger; Section 9's falsification criteria can cancel the budget phase |
| 8 | calibrate after 7 days and 30 sessions | `session.list` gives cumulative totals for existing sessions; backfill first, then use the forward sample for per-turn shape |
| 9 | the plan measures host burn only | it must also measure the plugin's own injections: schema, compaction digest, Session Index, and the R1 clause |
| 10 | "turn" in the echo detector | undefined; define it as a completed assistant response with no tool call, not a raw message count |

**Revision 2.1 corrections to rows 5 and 9.**

- **Row 5 is half wrong.** A child read surface does exist: `ctx.session.context({ sessionID })`
  is exposed by `session-bridge.ts:11` and `v2/types.ts:91`. What is unproven is whether it
  returns the final child message and survives compaction and restart. Separately, the existing
  50,000-character truncation explicitly excludes `task` (`tool-execute.ts:771-772`), so child
  results entering the parent are uncapped today. The durable pointer remains the right
  mechanism, but the premise "no read surface" is refuted by the tree.
- **Row 9 overstates the gap.** The Session Index already has a 90,000-token hard ceiling with
  page halving (`session.ts:144-146, 468-481`) and injected-token soak logging. The uncapped
  surfaces are the compaction digest, the goal digest, recent decisions, and the R1 clause. Say
  that, not "no budget measures the injections".

**Revision 2.2 correction to row 2.** With Option 9's efficacy corrected to 4, the natural offset
(efficacy 10, cost 25) gives Option 6 385 and Option 9 375, so Option 6 wins outright. The tie at
3.85 holds only with the uncorrected efficacy 5. Row 2's conclusion is restored, not because the
offset is absent but because the efficacy correction moves Option 9 down by 25 weighted points.

### 14.4 The revised solution — pay once, measure honestly, bound last

The revised architecture has four layers, ordered by leverage and by how much each depends on
unproven runtime behavior.

**Layer 0 — Fixed-cost diet (P1).** Cut the payload every request pays before adding any runtime
control. Target the 24,513 B schema first, then the plugin's own injections. This layer is
deterministic, has no false positives, and makes every later control cheaper to run. It is the only
layer that pays back immediately.

**Layer 1 — One ledger, honest accounting (P2).** A single `UsageLedger` subscribed to
`session.usage.updated`:

- stores the latest cumulative snapshot per session and derives deltas from consecutive snapshots;
  it never sums cumulative payloads;
- computes the formula in Section 14.6 and logs both raw fields and the weighted total;
- resolves lineage from `session.created.parentID` first and a lazy `session.get` on miss;
- backfills the first distribution from `session.list`;
- audits the plugin's own injected bytes as a separate line;
- runs the P3 repeat, echo, and fan-out detectors in shadow, with no blocking, so the P2 gate has
  readings;
- writes JSONL only. No enforcement.

**Layer 2 — Behavioural guards (P3).** Repeated call, echo, fan-out, and output cap. No budgets.
The echo signature uses no tool call + no file change + n-gram overlap; the fresh-input ratio is a
diagnostic, not a trigger, and a turn is a completed assistant response with no tool call. The
output cap writes the full child result to a durable pointer and injects a bounded summary plus the
pointer; it never truncates in place. D2 is folded here only after the P2 gate: feed the ledger's
`maxSubagents` and `maxTokens` counters, and reconcile the `checkCap` depth branch with
`MAX_CALL_DEPTH` (D13) before enabling it; the resolution is the wiring-point clamp in 17.3.

**Layer 3 — Conditional budget (P5).** Only if the ledger's p99 data supports it. Scope `C4` if
Probe 0 proves child usage events and `parentID`; otherwise `C3`, stated as such. Unit: cost first,
weighted tokens second. Defaults expressed as a multiple of the model window or a USD ceiling.
Zones 50 / 75 / 90; red blocks new spend only; edits, writes, `record`, and the final report stay
allowed. Handoff stays allowed when the target is cheaper, otherwise it is warned, not blocked;
a red session must not be trapped.

**Layer 4 — Rollout.** Shadow first, then enforce per project. K1-K9 are unchanged. The budget
phase is the only phase that can be cancelled by its own data.

### 14.5 Option 11 in full — the fixed-cost diet

- **Measure.** Replace the frozen literal in `prove-context-diet.ts` with a live collection of the
  registered schemas, as the continuity plan's W20 requires, and pin the result in a receipt.
  Record per-tool bytes, not only the total.
- **Target.** First cut: 24,513 B -> 20,000 B (18.4%). Reassess after the cut; do not set the
  final target before the per-tool ledger exists.
- **Method.** Remove duplicated hints, shorten parameter descriptions that repeat the tool
  description, consolidate overlapping tools where the surface allows it, and use lazy or grouped
  exposure only if the host supports it. Every removed byte must be argued against the retry
  receipts (`docs/experiments/receipts/2026-11-01-wave2-retries.json`): if a cut raises retries,
  it is not a cut.
- **Second front.** Bound the plugin's own injections: compaction digest, Session Index, recent
  decisions, and the R1 clause. Each gets a byte budget and a proof. The R1 clause is small but
  recurring; measure it once and record it.
- **Risk.** Schema bytes are functional. A removed hint can cause a wrong call, which costs more
  than the bytes saved. The retry receipts are the guard.

### 14.6 Canonical accounting formula

Define the unit before building the budget. The ledger records both the raw fields and the
weighted total:

```
fresh_input = input - cache.read   if Probe 0 shows input includes cache
            = input                if Probe 0 shows input excludes cache

reasoning_extra = 0        if the provider includes reasoning in output (default, conservative)
                = reasoning if the provider reports reasoning separately

billable = fresh_input
         + output
         + reasoning_extra
         + cache.read  * w_read
         + cache.write * w_write

w_read  = price(cache.read)  / price(input)   default 0.10 when unknown
w_write = price(cache.write) / price(input)   default 1.25 when unknown

context_size = fresh_input + cache.read
```

**Revision 2.1 correction.** The Revision 2 block double-counted `cache.read` when `input`
already includes it, and it added `reasoning` unconditionally. The block above fixes both: it
subtracts the cached portion before adding the weighted cache term, and it gates reasoning behind
a provider flag that defaults to "included in output" so the estimate errs low rather than high.
The raw fields stay in the ledger; only `billable` is derived.

Rules:

- never sum cumulative snapshots; keep the latest per session and derive deltas;
- record `cost` from the event as the authoritative cross-check; when `cost > 0` and differs from
  the weighted estimate by more than 20%, log a reconciliation warning and trust `cost`;
- the budget unit is cost first, weighted tokens second;
- an unknown price never silently becomes zero; it becomes the default weight and is labelled.

**Revision 2.1 corrections to these rules.**

- "Cost first" is valid only when `cost > 0`. The configured roster includes
  `opencode/mimo-v2.6-flash-free` and `opencode/deepseek-v4.1-flash-free`
  (`opencode.json:850,2416,8790`), whose `Money.USD` cost is zero. A cost-only budget is vacuous
  on them. The rule becomes: **cost when priced, weighted tokens when `cost = 0`, and a
  `cost_unpriced` label on every such row**. Never let zero mean "free of budget".
- The 0.10 / 1.25 defaults are Anthropic-shaped, not universal. OpenAI-style cached-input
  discounts differ, and free models have no price. Keep the defaults as fallbacks, but derive
  `w_read` and `w_write` from the model catalog when a price exists, and label every derived
  weight with its source.
- `reasoning` and `output` are both present in the event (`event-manifest.d.ts:1126-1127`) with
  no documented disjointness. Do not add both blindly. The provider flag above is mandatory.
- The 20% reconciliation rule trusts `cost` when they disagree, but it cannot run when `cost = 0`.
  In that case the weighted total is the only number, and it must be labelled an estimate.

### 14.7 Revised execution order and decision gate

The original phase table in Section 11 stays as written. Revision 2 order:

| Order | Phase | Content | Gate |
| --- | --- | --- | --- |
| P0 | Probe 0 | isolated root + child, plus the Q13 4-deep chain; sixteen questions in 14.8 | receipt with sixteen answers |
| P1 | Fixed-cost diet | Option 11, including the live schema measurement and injection budgets | live schema pinned; per-tool ledger; retry receipts unchanged |
| P2 | Ledger shadow | original Phase 1 plus backfill, self-injection audit, and shadow repeat/echo/fan-out detectors | 7 days or 30 sessions; report works; shadow readings exist |
| P3 | Behavioural guards | original Phase 3; enforce the detectors the P2 gate sets to enforce; D2 after the ledger gate and the D13 reconciliation (clamp at the wiring point, 17.3) | chaos proofs; zero false positives on replay |
| P4 | Context pressure | original Phase 2, context half | nudge fires on a synthetic echo loop using real fields |
| P5 | Budget | original Phase 4; C4 if the probe supports it, else C3 | Section 9 gate: p99(root) < 300k cancels P5 |

The gate after P2 answers four numbers: p99(root), p99(child), echo-flagged sessions per 30
sessions, and the repeat detector's false-positive rate. P5 proceeds only if the slow,
non-repeating burn is visible in the data. P1, P2, and P4 proceed regardless; P3 proceeds but uses
the gate readings to decide whether each detector enforces or stays in shadow.

**Revision 2.2 — shadow instrumentation and the D2 deferral.** The echo and repeat readings come
from detectors P2 runs in shadow, not from P3. P3 is after the gate, so without shadow
instrumentation the gate would have no data; enforcement stays in P3. An echo event is one session
with at least one flagged turn; raw flagged turns are reported separately. D2 is deferred to
post-P2 for the same reason: the subagent and token counters are ledger outputs, and the `checkCap`
depth branch must first be reconciled with `MAX_CALL_DEPTH` (D13). P3's exit criterion is
unchanged. Revision 2.3 resolves the reconciliation in 17.3: the knob is clamped at the wiring
point, so the guard and `checkCap` agree and neither `MAX_CALL_DEPTH` nor `callDepth` changes.

**Revision 2.1 correction — the gate must use the budget's unit.** `p99(root) < 300k` is written
in raw tokens while Section 14.6 declares cost first. Restate the gate in the same unit as the
budget: `p99(root)` in USD when `cost > 0`, otherwise in weighted tokens, with 300k weighted
tokens as the provisional equivalent (20% of the 1.5M default). The number is a placeholder until
P2 measures the distribution; it is not derived. The gate also needs four additional readings:
cached share of the schema, orphan rate (child with no `parentID`), event-loss rate during a
plugin reload, and the plugin's own injected bytes per request.

### 14.8 Probe 0 — the first runtime experiment

Run one isolated host session with separated `XDG_*` state and a separate `OPENCODE_DB`. Root
reads a large known file, then dispatches one child with a known output. Capture every
`session.usage.updated` and the matching `session.get` snapshots. Three sub-runs are added in
Revision 2.3 because the base run cannot reach them: a scripted 4-deep `task` chain for Q13
(root -> child -> grandchild -> great-grandchild, non-exempt target), one assistant turn with no
tool call for Q15, and five identical `bash` calls for Q16. Q14 needs only one `handoff` return to
confirm there is no second truncation. The rest of Probe 0 stays one root and one child.

| # | Question | Why it decides | Outcome |
| --- | --- | --- | --- |
| 1 | Does the ephemeral `session.usage.updated` reach `plugin.event`? | the ledger's only push source | if no, fall back to `session.get` polling |
| 2 | Cumulative or delta? | summing cumulative payloads double-counts | cumulative -> store the latest; delta -> sum |
| 3 | Do child sessions emit usage with the child `sessionID`? | fan-out visibility | if no, P5 is rejected; guards only |
| 4 | Does `tokens.input` include `cache.read`? | context formula and echo safety | sets `context_size` and the ratio's denominator (diagnostic only) |
| 5 | Does `session.get(root).tokens` aggregate children? | may remove the need for a tree map | if yes, poll the root; if no, map the tree |
| 6 | Is `parentID` present and stable for every child? | `C4` feasibility and restart safety | if yes, reopen Option 7; if no, `C3` only; one child makes this provisional |
| 7 | Is `input.agent` populated for root callers and for every tool call? | a missing agent skips `consume` entirely (`tool-execute.ts:265`), not just the tier | if it can be absent, record a `no-agent` bypass line and choose fail-open or fail-closed explicitly |
| 8 | Does `cost` register > 0 on the configured models, including the free tier? | Option 5 and the "cost first" rule collapse at zero | if zero, weighted tokens are the unit and every row is labelled `cost_unpriced` |
| 9 | Does `ctx.session.context(childID)` return the child's final message, and does it survive compaction and restart? | the output cap needs a durable read path | if yes, a file pointer is optional; if no, the pointer is mandatory |
| 10 | Does a `task`, `handoff`, or `fasttrack` result reach `output.output` at return, or is it already truncated? | all three are in `TASK_TOOL_NAMES` (`security-policy.ts:14`) and excluded from the 50k cap (`tool-execute.ts:771-772`) | if full, capture and summarise at return; if truncated, the child must write the full result before returning |
| 11 | What share of the 24,513 B schema is provider-cached on repeated requests? | decides whether the 41% raw figure or the ~4.5% weighted figure is the budget number | if cached > 90%, Option 11 is hygiene, not savings; if uncached, the 41% stands |
| 12 | Is `agents.<name>.steps` honoured at runtime as a host-side stop? | Option 8 was dismissed without testing the host config surface | if honoured, re-score Option 8; if not, the dismissal stands |
| 13 | With `maxCallDepth` set to 4..20, does the fourth nested `task` dispatch (non-root caller, non-exempt target) pass the depth guard at `dispatch-guards.ts:39-41` and then reach `checkCap` at `:42`? | the knob raises `MAX_CALL_DEPTH`, but `checkCap` reads `DEFAULT_CAP.maxDepth` (`iteration-budget.ts:194`); D13. Needs the 4-deep `task` chain above; the guard is `task`-only (`:32`) and `@explore`/`@general` targets are exempt up to `MAX_EXEMPT_CALLS` (`:35-37`) | if rejected at `:42`, the depth branch silently clamps the knob and must be reconciled before D2; if blocked at `:39`, the knob-to-`MAX_CALL_DEPTH` wiring is broken; if allowed, the knob is already authoritative |
| 14 | Is there any truncation between the child's return and `output.output` for `task`, `handoff`, or `fasttrack`, beyond the 50k cap that already excludes them (`tool-execute.ts:771`)? | the code settles the cap: all three are excluded (`security-policy.ts:14`); the open question is a second truncation path | if none, the cap at return is the only bound; if another path exists, document it and cap there too |
| 15 | Does the host surface a completed assistant turn with no tool call before the next request is billed? | the echo detector needs an observation point earlier than the next billable request | if yes, hook it; if no, the detector is retrospective and cannot prevent the next turn |
| 16 | When a non-read tool (for example `bash`) repeats five times with identical args and result, does the current guard block it? | `REPEAT_BLOCK_TOOLS` is `read|grep|glob` only, and `isRepeatResultBlocked` returns null otherwise (`tool-loop-guard.ts:9-16,200`); code-answered: no, the probe confirms the wiring only | if no (expected), P3 must widen the set and the shadow detector must count non-read repeats |

Q6's "every child" reading is provisional on one child; the orphan rate and the event-loss rate
are measured across the P2 window, not by this probe. Q13-Q16 were added in Revision 2.2.
Revision 2.3 narrows their scope: Q13 runs in the separate 4-deep chain, is `task`-only, and needs
a non-exempt target; Q14 is code-answered for the cap and only searches for a second truncation;
Q16 is code-answered for the block and only confirms the runtime wiring. The probe is still
sixteen questions.

The probe receipt goes to `docs/experiments/receipts/2026-11-06-token-usage-probe.md` (created
2026-11-06; findings in 17.7). No ledger code is written before the receipt exists. The probe is
an experiment, not a proof of the final design; it answers only the sixteen questions above.

### 14.9 What Revision 2 does not change

- K1-K9 are unchanged. No role guard is added. `MAX_CALL_DEPTH` and `callDepth` are untouched.
- No new runtime dependency; the ledger is a file plus an event subscription.
- The report path (R1) remains the chosen channel. Deferred items in that plan stay in that plan;
  this plan does not reopen them.
- The canary channel remains cancelled.
- Nothing is implemented until the owner leaves plan mode.

### 14.10 What the five-agent review must attack

1. **The fixed-cost claim.** Is the 24,513 B schema really sent on every request, and how much of
   it is cached? If the cached share is high, the 41% figure falls and Option 11's efficacy score
   must fall with it.
2. **The D1 correction.** Does `C3` really leave child sessions unbounded, or does the host charge
   child usage to the parent session's totals? Probe 0 question 5 settles it.
3. **The accounting formula.** Are the default weights (0.10 / 1.25) defensible, or should the
   budget use `cost` only?
4. **The echo signature.** Is fresh-input output ratio a safe signature, or does it still fire on
   legitimate long-context work? Name the counterexample.
5. **The output cap.** Is a durable pointer implementable without a child-session read surface,
   and does the pointer survive compaction and restart?

Each finding must be recorded as confirmed, refuted, or inconclusive, with the file or receipt
that decides it.

**Revision 2.1 verdicts from the five reviews.**

| Claim | Verdict | Deciding evidence |
| --- | --- | --- |
| 1. Fixed cost | Measurement confirmed; budget share conditional | receipt: 24,513 B / 6,129 tokens; 41% raw vs ~4.5% weighted; cached share unmeasured |
| 2. D1 correction | Confirmed on the plugin side; host side inconclusive | `iteration-budget.ts:80-83` keys `agent@session`; no tree aggregate; Probe 0 Q5 decides host roll-up |
| 3. Accounting formula | Refuted as stated; corrected in 14.6 | 0.10/1.25 are not universal; free models cost zero; `cache.read` and `reasoning` double-count risks |
| 4. Echo signature | Confirmed unsafe as written | a 100k cached context with 500 output tokens is 0.5%, not an anomaly; use no-tool + no-file-change + n-gram overlap |
| 5. Output cap | Refuted in part | `session-bridge.ts:11` exposes `context`; `task` bypasses the 50k cap at `tool-execute.ts:771-772`; durability is the open question |

---

## 15. Revision 2.1 — consolidated five-agent review

### 15.1 Roster and score spread

Five independent reviewers scored Revision 2.0 before any edit. Reviewer 1 was
`analyst-deepseek`; reviewer 2 `analyst-pickle`; reviewer 3 `analyst-beam-free`; reviewer 4
`analyst-glm-5.3-flash-free`; reviewer 5 `analyst-mimo`. Each recomputed the matrix from the
weights in Section 6. The table reports the median and range, not an average, and keeps the
individual totals so the spread is visible.

| Option | R1 | R2 | R3 | R4 | R5 | Median | Range | Gate reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 Do nothing | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 | 3.00 | 0.00 | fail efficacy |
| 1 Dead fields | 2.60 | 2.75 | 2.95 | 2.95 | 2.95 | 2.95 | 0.35 | fail efficacy |
| 2 Shape only | 3.90 | 3.60 | 3.45 | 3.25 | 3.70 | 3.60 | 0.65 | passes |
| 3 Ledger + budget | 3.75 | 3.50 | 3.80 | 3.80 | 3.80 | 3.80 | 0.30 | passes |
| 4 Turn breaker | 2.95 | 2.95 | 2.95 | 2.95 | 2.95 | 2.95 | 0.00 | fail fit |
| 5 Cost budget | 2.80 | 3.45 | 3.70 | 3.70 | 3.45 | 3.45 | 0.90 | passes only when cost > 0 |
| 6 Context only | 3.65 | 3.65 | 3.85 | 3.60 | 3.85 | 3.65 | 0.25 | passes; one dissent |
| 7 Tree scope | 3.45 | 3.50 | 2.70 | 3.35 | 3.10 | 3.35 | 0.80 | reopened; scope variant |
| 8 Host-native | 2.80 | 2.80 | 2.80 | 2.80 | 2.80 | 2.80 | 0.00 | fail efficacy |
| 9 Composite | 3.85 | 3.80 | 4.05 | 3.60 | 4.05 | 3.85 | 0.45 | passes |
| 10 Shadow wrapper | - | 3.60 | 3.65 | - | 3.20 | 3.60 | 0.45 | modifier, not architecture |
| 11 Fixed-cost diet | 4.10 | 3.85 | 4.10 | 4.10 | 4.10 | 4.10 | 0.25 | complementary, gate-exempt |

Three readings follow from the table:

- **Option 11 is not an architecture.** Four reviewers scored efficacy 2 and reviewer 2 scored 1;
  Section 6 disqualifies efficacy < 3 either way. The 4.10 is retained only as a fixed-cost score
  with a separate metric. It cannot be compared with Option 9's 3.85.
- **Option 9 leads, but not by a margin the matrix can resolve.** The median gap over Option 6 is
  0.20; one point on any criterion moves a total by 0.05-0.25. The matrix supports "Option 9 is at
  or near the top", not "Option 9 beats Option 6".
- **Option 10 has no row.** Reviewers 2, 3, and 5 scored it only as a standalone and disqualified
  it; reviewers 1 and 4 did not score it. It is a rollout modifier, not an option.

### 15.2 Confirmed findings

The review confirmed the following. "Reviews" counts the reviewers who raised the finding
independently; the evidence column is the deciding file or receipt.

| # | Finding | Reviews | Evidence | Applied correction |
| --- | --- | --- | --- | --- |
| 1 | Revision 2.0 marked Option 11 "passes" with efficacy 2 | 4/5 scored 2, 1/5 scored 1; 4/5 flagged the contradiction | Section 6 gate plus the Option 11 row | Reclassified as Layer 0 with a separate bytes/tokens metric |
| 2 | Option 10 has no matrix row | 4/5 | the matrix has 11 rows; Section 5 has 12 options | Treated as a rollout modifier, not a scored option |
| 3 | D6/D7 are overstated: repeat and no-progress detection already exist | R1, R2 | `tool-loop-guard.ts:9-16, 193-207, 234-245` | Rewritten as a coverage gap; Option 2b added |
| 4 | A child read surface exists | 5/5 | `session-bridge.ts:11`, `v2/types.ts:91` | Section 14.3 row 5 corrected; durability remains a probe question |
| 5 | `task`, `handoff`, and `fasttrack` results bypass the 50k truncation cap | R2; verified at HEAD | `tool-execute.ts:771-772`; `TASK_TOOL_NAMES` at `security-policy.ts:14` | New defect D11; cap every dispatch tool with a durable pointer |
| 6 | 41% and ~4.5% are different units | 4/5 | Section 14.2.2 vs Section 14.6 | Both figures stated; budget uses weighted/cost |
| 7 | Line references drifted | 4/5 | `checkCap` 42, `budgetGuard` 207, depth 236-252, `MAX_EXEMPT_CALLS` 42, `SessionInfo` generated 3062 | Section 14.1 and Appendix B corrected |
| 8 | The Session Index already has a 90k ceiling | R1, R2, R4 | `session.ts:144-146, 468-481` | Claim narrowed to digest, goal, decisions, R1 clause |
| 9 | A missing `input.agent` skips `consume` entirely | R1, R2, R5; R3 partially | `tool-execute.ts:265` inside `if (normalizedAgent)` | New defect D12; record the bypass and choose semantics |
| 10 | `checkCap`'s depth branch is inert at the default and conflicts with a raised `maxCallDepth` | R1; verified, then corrected in Revision 2.2 | `dispatch-guards.ts:39-42` passes `currentDepth, 0, 0`; `iteration-budget.ts:194` caps depth at 3 | New defect D13; reconcile the depth branch before D2 |
| 11 | Caching repeated `write`/`edit` results is unsafe | R1, R2, R4, R5 | identical args can meet a changed filesystem | Cache only read-only tools; hard-fail or pointer otherwise |
| 12 | Option 5 collapses on free models | R1, R2, R5 | `opencode.json:850,2416,8790`; `Money.USD` zero | Cost only when `cost > 0`; weighted fallback labelled |
| 13 | The first sensitivity clause is still wrong | R4, R5 | efficacy 15 / FP 30 gives Option 9 = 4.20, Option 6 = 4.05 with efficacy 5 | Revision 2.2: withdrawn; with efficacy 4 the clause reproduces (4.05 tie) |
| 14 | `session.usage.updated` is ephemeral | R2, R3, R5 | `event-manifest.d.ts:1136` | Ledger reconciles on reload; event-loss metric added |
| 15 | The R1 clause is per routed dispatch, not per turn | R2, R3, R4 | `dispatch-guards.ts:277,284-286`; `routing.ts:4-6` | Scope corrected; measure but do not prioritise |
| 16 | The nudge still lacks a mechanism | R5 | `message-updated.ts:459-470` | D8 remains open; P4 must add an action, not only a warning |
| 17 | `sweepStaleBudgets` evicts by insertion order | R3 | `iteration-budget.ts:179-184` | New defect D17; use last-used order |
| 18 | K7 dedupe can be re-injected after 16 blocks | R2 | `session.ts:289-303` | New defect D18; record the reset |
| 19 | The schema receipt predates the audit HEAD | R4, R5 | receipt commit `ef0bdd5`; plan HEAD `c14aa1b` | Re-measure at HEAD in P1 before setting the target |
| 20 | Option 8 was dismissed without probing host `steps` | R4 | `promise/generated/types.d.ts:3180,3532` | Added Probe 0 Q12; do not re-score before it |

**Revision 2.2 corrections to this table.** Row 13 is withdrawn: with Option 9's corrected
efficacy 4, the first sensitivity clause reproduces (Option 6 4.05, Option 9 4.05), and the
cost-25 clause gives Option 6 the win, 3.85 to 3.75. Row 10's earlier "unreachable" wording is
narrowed: `checkCap` is inert at the default `maxCallDepth = 3`, but when the knob is raised to
4..20 its depth branch fires and caps the dispatch back at 3, so the knob is defeated rather than
unused. Row 5's surface is the full `TASK_TOOL_NAMES` set, not only `task`. Row 1's score is 4/5
at efficacy 2 and 1/5 at 1, not 5/5 at 2. All other rows stand. Revision 2.3 adds: row 10's conflict
is resolved in 17.3 (K3 is the host ceiling; the knob is clamped at the wiring point), so D13 is
a documented clamp rather than an open conflict.

### 15.3 Refuted or contested claims

| Claim | Status | Why |
| --- | --- | --- |
| "No child-session read surface exists" | Refuted | `ctx.session.context({ sessionID })` is bridged and typed; the open question is durability, not existence |
| "Option 11 outranks Option 9" | Refuted as a ranking | Option 11 fails the efficacy gate; the two rows measure different things |
| "C3 fixes D1" | Refuted | Confirmed by all five; a child is a separate session, so C3 leaves fan-out unbounded |
| "41% of the root budget" | Refuted as universal | True only for raw tokens with no cache weighting; ~4.5% under the weighted formula, conditional on cached share |
| "Option 9 should be built as one bundle" | Contested | Median 3.85, but the gap is inside the noise; the bundle contains C3, which does not fix D1; land the parts sequentially |
| "Option 6 is dominated by Option 11" | Contested | R4 scores efficacy 2 and disqualifies it; the other four score 3. Context pressure changes context size, not schema bytes, so the two are not substitutes |
| "Option 7 is disqualified" | Refuted | `parentID` exists on `session.created` and `SessionInfo`; four of five reviewers pass it. It is a scope variant of Option 3, not a standalone architecture |
| "Option 2 catches all three signatures today" | Contested | Median 3.60; the repeat half exists for `read|grep|glob` only, and the echo half is unproven until Probe 0 Q4 |

### 15.4 New defects and options found by the review

**New defects.**

- **D11 — dispatch results are uncapped.** The 50,000-character truncation excludes every tool
  in `TASK_TOOL_NAMES` — `task`, `handoff`, and `fasttrack` (`security-policy.ts:14`; condition at
  `tool-execute.ts:771-772`). This is the exact surface S3 uses: a child can return an arbitrarily
  large result into the parent, and `handoff`/`fasttrack` can do the same. Cap every dispatch
  result at return, write the full text to a durable file, and inject a bounded summary plus the
  path.
- **D12 — a missing agent is a total budget bypass.** `consume` runs only inside
  `if (normalizedAgent)` (`tool-execute.ts:265`). When `input.agent` is absent, the dedup guard,
  the loop guard, and the budget are skipped, and the pipeline still runs. This is not the
  60-vs-90 tiering question in Section 12; it is a fail-open. Record every `no-agent` call in the
  ledger and decide explicitly whether to default, deny, or warn.
- **D13 — the `checkCap` depth branch conflicts with `maxCallDepth`.** The depth guard checks
  `currentDepth > MAX_CALL_DEPTH` before calling `checkCap(input.agent, currentDepth, 0, 0)`
  (`dispatch-guards.ts:39-42`). At the default `maxCallDepth = 3`, `checkCap` is inert because the
  guard has already blocked depth 4. When the knob is raised to 4..20 (`config-schema.ts:14`;
  `config-facade.ts:60`; `limits.ts:12-15`), the fourth nested dispatch passes the guard and is
  then rejected by `DEFAULT_CAP.maxDepth = 3` (`iteration-budget.ts:194`): the knob raises
  `MAX_CALL_DEPTH` and `checkCap` silently caps it back. `maxSubagents` and `maxTokens` stay dead
  until the ledger supplies counters, and `setCap` has no callers. D2 is a redefinition, not a
  two-line feed; reconcile the depth branch with `MAX_CALL_DEPTH` first. Revision 2.3 resolves this
  in 17.3: K3 is the ceiling, the knob is clamped at the wiring point, and the two sources agree.
- **D14 — the usage event is ephemeral.** `durability: "ephemeral"` (`event-manifest.d.ts:1136`)
  means no replay after a disconnect, and the payload carries no `agent`. The ledger must
  reconcile through `session.get` on reload and label every gap; it cannot assume a complete
  stream.
- **D15 — the accounting formula double-counted.** Fixed in Section 14.6: subtract the cached
  portion when `input` includes it, and gate `reasoning` behind a provider flag. The original
  block also assumed `cost` is always meaningful; free models break that assumption.
- **D16 — the 90k ceiling is a ceiling, not a budget.** 90,000 tokens is 45% of a 200k window.
  The Session Index is bounded, but the bound is too high to count as a per-request budget.
- **D17 — stale-budget eviction is insertion-ordered.** `sweepStaleBudgets` deletes the oldest
  inserted keys, not the least recently used (`iteration-budget.ts:179-184`), so an active
  long-lived session can lose its counters while an idle one keeps them.
- **D18 — K7 dedupe resets after 16 blocks.** `K7_MAX_BLOCKS = 16` (`session.ts:289`); after the
  reset the same digest can be injected again. The claim that the digest is permanently deduped
  is too strong.

**Options the review added (unscored in 2.1; candidates for Revision 3).**

- **Option 2b — widen the existing guard.** Extend `REPEAT_BLOCK_TOOLS` beyond `read|grep|glob`,
  add an assistant-turn echo detector, and add a concurrent-child cap beside the existing agent
  locks. This reuses shipped code and is the cheapest S1/S2 control in the tree.
- **Option 12 — model downgrade.** The only lever that lowers dollars per turn rather than turn
  count. It is absent from the matrix even though the roster mixes priced and free models.
- **Option 13 — prompt-prefix stabilisation.** If schema or digest ordering changes between
  turns, provider prompt caching is defeated. It is measurable and cheap, and it belongs in the
  same fixed-cost family as Option 11.
- **H5 — budget inheritance.** Named as the correct D1 fix in Section 14.2.1 but never offered as
  an option. Add it as a scope variant: a child draws from the resolved root, not from a new
  session budget.
- **11+6 without a budget.** The landing zone if P2 cancels P5: fixed-cost diet plus context
  pressure, with shape guards on top and no numeric budget.

### 15.5 Revised recommendation

The five reviews converge on a sequence, not a single architecture.

1. **P0 — Probe 0 v2.** Sixteen questions (Section 14.8). No ledger code before the receipt.
2. **P1 — Fixed-cost hygiene (Option 11).** Outside the architecture matrix. Re-measure at HEAD,
   record per-tool bytes, keep the retry receipts unchanged, and set the target after the
   measurement. It is not the primary control.
3. **P2 — Ledger shadow (Option 3 measurement half, Option 10 modifier).** Add `get`/`list` to
   `SessionBridge`; store raw fields plus the corrected `billable`; backfill from `session.list`;
   reconcile on reload; label `cost_unpriced` rows; run the repeat, echo, and fan-out detectors in
   shadow so the gate has readings.
4. **P3 — Shape guards (Option 2 + Option 2b).** Enforce after the P2 gate: widen the existing
   repeat guard, add a turn-level echo detector with no-tool + no-file-change + n-gram overlap,
   cap concurrent children, and cap every dispatch result (`task`, `handoff`, `fasttrack`) with a
   durable pointer.
5. **P4 — Context pressure (Option 6).** Feed real host fields to the nudge, evaluate every turn,
   and never force compaction inside the red zone; the digest itself can add up to 90k tokens.
6. **P5 — Conditional budget.** Use C4 if Probe 0 Q3 and Q6 prove child usage and stable
   `parentID`; otherwise C3 with D1 explicitly open. Unit: cost when `cost > 0`, weighted tokens
   otherwise. Red blocks new spend only; edits, writes, the final report, and a handoff to a
   cheaper target stay allowed.

Option 9 is not the primary. Its median 3.85 is inside the matrix's resolution, it bundles C3
(which does not fix D1), and its layers are better landed sequentially. Build its parts, not the
bundle.

**Decision gate after P2, in the budget's unit.**

The readings come from the detectors P2 runs in shadow; P3 enforcement is downstream of this gate.

| Reading | Threshold | Action |
| --- | --- | --- |
| `p99(root)` | < 300k weighted tokens as the provisional equivalent; use USD when `cost > 0` | cancel P5 |
| echo-flagged sessions | < 2 in 30 sessions | keep the echo detector shadow-only in P3; do not enforce |
| repeat false positives | > 5% of healthy sessions | recalibrate the digest before P3 enforcement |
| cached schema share | > 90% | Option 11 stays hygiene; do not count its savings |
| orphan rate (no `parentID`) | > 1% | C4 unreliable; C3 only |
| event loss during reload | > 5% | ledger is estimate-only; no enforcement |

### 15.6 Residual disagreements

- **Order of P2 and P3.** R1 and R2 put guards before the ledger; R3, R4, and R5 put the diet and
  ledger first. Revision 2.2 resolution: the detectors run in shadow during P2 and enforce in P3.
  This gives the gate P2 readings without moving P3 ahead of the ledger. P1 stays independent; if
  the schema diet is blocked by schema ownership, start the P2 shadow instrumentation early.
- **Option 6 efficacy.** R4 scores it 2 and disqualifies it; the other four score 3. Resolution:
  keep 3 for now and record the dissent. If P2 shows context pressure is fully explained by the
  fixed-cost diet, drop it to 2 in Revision 3.
- **Option 7 status.** R3 scores it 2.70 and disqualifies it; the other four pass it. Resolution:
  do not score it as a standalone architecture. Treat it as the C4 scope variant of Option 3,
  gated by Probe 0.
- **Option 11 score.** R2 scores 3.85 with efficacy 1; the other four score 4.10 with efficacy 2.
  Resolution: the exact number is moot because the gate disqualifies it; use the separate
  bytes/tokens metric.

### 15.7 What Revision 2.1 does not change

- K1-K9 are unchanged. No role guard is added. `MAX_CALL_DEPTH` and `callDepth` are untouched.
- The canary channel remains cancelled.
- Deferred items in the report-path plan stay in that plan; this plan does not reopen them.
- No Revision 1 or Revision 2 item is removed; the review adds Section 15 and inline corrections.
- Nothing is implemented. The review was read-only and did not run the host.

### 15.8 Verdict-changing evidence

Ranked by leverage:

1. **Probe 0 Q3, Q5, Q6.** Child usage emission, root roll-up, and stable `parentID` decide
   C4/C3/guards-only.
2. **Probe 0 Q4.** Whether `tokens.input` includes `cache.read` decides the context formula and
   whether the output/input ratio is usable as a diagnostic at all.
3. **Probe 0 Q11.** The measured cached share decides whether the schema costs 41% raw or ~4.5%
   weighted, and whether Option 11's cut is worth 0.75% or 7.5%.
4. **P2 distribution.** If `p99(root)` is below 300k, P5 is cancelled exactly as Section 9 says.
5. **Probe 0 Q7 and Q8.** A missing agent or a zero cost changes the failure semantics and the
   budget unit.
6. **A measured retry increase after the schema cut.** If the diet raises retries, it is not a
   diet and P1 must be reverted.
7. **Probe 0 Q13 and Q16.** The `maxCallDepth`/`checkCap` conflict and non-read repeat coverage
   decide whether D2 is a fix or a regression, and how far P3 must widen the guard.
8. **Probe 0 Q15.** A pre-billing assistant-turn observation point decides whether the echo
   detector can act before the next request or only report after it.

---

## 16. Revision 2.2 — second five-agent review

### 16.1 Roster and method

Five independent reviewers read Revision 2.1 in a second round, one at a time. The roster was the
same as Section 15.1: R1 `analyst-deepseek`, R2 `analyst-pickle`, R3 `analyst-beam-free`,
R4 `analyst-glm-5.3-flash-free`, R5 `analyst-mimo`. The instruction was to accept a correction
only with a file:line, a receipt, or a runnable experiment; otherwise to state "No better
alternative found." No plan item was removed.

| Reviewer | Verdict | Better architecture? | Main contribution |
| --- | --- | --- | --- |
| R1 analyst-deepseek | accept with corrections | No | sequencing correction; code re-check |
| R2 analyst-pickle | accept with corrections | No | sequencing correction; guard coverage |
| R3 analyst-beam-free | accept; no errors found | No | no new defect; no better alternative |
| R4 analyst-glm-5.3-flash-free | accept with corrections | No | arithmetic and citation audit; one false claim (16.4) |
| R5 analyst-mimo | accept with corrections | No | `P0 -> P1 -> P3' shadow -> P2 -> gate -> P4 -> P5`; D2 deferral |

Consensus: no reviewer produced a better architecture. One sequencing correction was supported by
the code and is adopted in 16.3.

### 16.2 Confirmed corrections

| # | Correction | Evidence | Applied in |
| --- | --- | --- | --- |
| 1 | `checkCap`'s depth branch is not unreachable; at `maxCallDepth >= 4` it caps depth back to 3 | `dispatch-guards.ts:39-42`; `iteration-budget.ts:194`; `config-schema.ts:14` | D13, 15.2 row 10, Probe 0 Q13 |
| 2 | The 50k truncation excludes `handoff` and `fasttrack` too | `security-policy.ts:14`; `tool-execute.ts:771` | D11, 15.2 row 5, Probe 0 Q14 |
| 3 | Repeat blocking covers only `read`, `grep`, and `glob`; every successful result for a named agent is recorded, and the warning appends at 3 when the result is a string (narrowed in 2.3) | `tool-loop-guard.ts:9-16`; `tool-execute.ts:217,564-575` | D6, Option 2b, Probe 0 Q16 |
| 4 | The no-progress counter is fed only by the tool-failure branch | `tool-loop-guard.ts:123-127`; `tool-execute.ts:581` | D7 |
| 5 | Option 11 was scored efficacy 2 by four reviewers and 1 by one | Section 15.1 rows | 15.1, 15.2 row 1 |
| 6 | `6,129 + 99 x 613 = 66,816`, not 66,800; the first request is uncached | arithmetic | 14.2.2, Option 11 note |
| 7 | Option 11's savings are conditional: 7.5% raw if uncached; 0.75-0.82% weighted at `w_read = 0.10` | 14.2.2, 14.6 | Option 11 note |
| 8 | The original sensitivity clauses hold with Option 9 efficacy 4: 4.05 vs 4.05 at efficacy 15 / FP 30, and Option 6 wins 3.85 to 3.75 at efficacy 10 / cost 25 | Section 6 weights | 15.2 note, Section 6 |
| 9 | The output/input ratio is a diagnostic, not the echo trigger | 14.2.3 | Option 2 note, 15.5 |
| 10 | The gate needs P2 shadow readings because P3 is after the gate | sequencing | 14.7, 15.5, Section 11 |

### 16.3 Adopted sequencing change — shadow instrumentation

The second round found one sequencing defect that the first round missed. Section 14.7 put echo
and repeat readings in the P2 gate but put the detectors in P3, after the gate. R1 proposed
`P0 -> (P1 || P3a) -> P2 -> P4 -> P5`; R5 proposed `P0 -> P1 -> P3' shadow -> P2 -> gate -> P4 ->
P5`. Both separate detector implementation from enforcement. Revision 2.2 adopts the smaller
form:

| Phase | Runs | Enforces |
| --- | --- | --- |
| P2 | ledger, backfill, self-injection audit, and the repeat/echo/fan-out detectors in shadow | nothing |
| Gate | reads the shadow distribution | cancels P5 if `p99(root)` is below the threshold; sets each detector to enforce or stay shadow |
| P3 | the same detectors plus the output cap | each detector the gate sets to enforce; the dispatch output cap unconditionally |

D2 is deferred to post-P2 because its subagent and token counters are ledger outputs, and its
depth branch diverges from the config knob (D13). This removes the circular dependency without
moving P3 ahead of the ledger. Revision 2.3 resolves D13 in 17.3: the knob is clamped at the
wiring point, so the depth guard and `checkCap` agree.

### 16.4 Rejected claims

- **R4's `promise/client.d.ts` claim is rejected.** The file exists (346 lines), and line 213 is
  `get: (input: SessionGetInput) => Promise<SessionInfo>`. `promise/generated/client.d.ts:226`
  exposes the same `get`; both citations resolve. The Revision 2.1 citation at
  `promise/client.d.ts:213` stands.
- **No architecture replacement was accepted.** No reviewer supplied a file:line, receipt, or
  runnable experiment that makes another option beat the sequence in 15.5. Option 9 remains a
  source of parts, not the primary bundle.
- **Option 11 is not re-scored.** The efficacy gate still disqualifies it as an architecture; the
  second round did not produce a new measurement that changes the gate.
- **Out of scope.** G-006, WP13, and WP14 are not imported. The canary channel stays cancelled.
  The R5 deferral stays in `docs/plan-report-path-to-tawa.md`; this plan does not reopen it.

### 16.5 Probe 0 gains four questions

Q13-Q16 in Section 14.8 cover the `maxCallDepth`/`checkCap` conflict, the `handoff`/`fasttrack`
output surface, the pre-billing observation point for the echo detector, and non-read repeat
coverage. The probe is now sixteen questions. Q6's "every child" claim is provisional on one
child; orphan and event-loss rates come from the P2 window.

### 16.6 What Revision 2.2 does not change

- K1-K9 are unchanged. No role guard is added. `MAX_CALL_DEPTH` and `callDepth` are untouched.
- The canary channel remains cancelled.
- Deferred items in the report-path plan stay in that plan; this plan does not reopen them.
- No Revision 1, 2, or 2.1 item is removed; Section 16 and inline corrections are additive.
- Nothing is implemented. The review was read-only and did not run the host.

---

## 17. Revision 2.3 — third five-agent review

### 17.1 Roster and method

Five independent reviewers read Revision 2.2 in a third round, one at a time. The roster was the
same as Sections 15.1 and 16.1: R1 `analyst-deepseek`, R2 `analyst-pickle`, R3 `analyst-beam-free`,
R4 `analyst-glm-5.3-flash-free`, R5 `analyst-mimo`. Each read the same restricted ranges and the
cited source lines, and was asked to verify six claims against the tree, not against the plan's
authority: D13, D11, D6/D7, the arithmetic, the shadow sequencing, and Probe 0 Q13-Q16, plus only
the new inconsistencies introduced by Revision 2.2. R1's first attempt stalled and was cancelled;
the retry completed and is the record below. The review was read-only; no host run and no edits.

| Reviewer | Verdict | Better architecture? | Main contribution |
| --- | --- | --- | --- |
| R1 analyst-deepseek | accept with corrections | No | D13 mechanism gap; Q13 scope; Q14/Q16 code settlement; depth-guard scope |
| R2 analyst-pickle | accept with corrections | No | Q13 target dependence; citation precision; D11 quarantine; P3 gate-row contradiction |
| R3 analyst-beam-free | accept with corrections | No | Q13 scope; D13 safe mechanism |
| R4 analyst-glm-5.3-flash-free | accept with corrections | No | Q13 third outcome; full citation paths; one false claim (P2 gate cell) |
| R5 analyst-mimo | accept with corrections | No | D13 target behaviour; probe recipe; `task`-only depth; D6 wording |

Consensus: all five accept with corrections and none produced a better architecture. All five
confirm that Q13 cannot be answered by the one-root/one-child run. Three (R1, R3, R5) confirm that
D13 names no reconciliation mechanism; R2 adds a citation-precision defect. Three (R1, R2, R5)
confirm that D6 overstates recording coverage. R2 adds the quarantine bypass to D11. R4 raises a
P2 gate-cell claim that the tree refutes (17.4).

### 17.2 Confirmed corrections

| # | Correction | Evidence | Applied in |
| --- | --- | --- | --- |
| 1 | Q13 needs a scripted 4-deep `task` chain; the one-root/one-child run cannot reach depth 4. It is `task`-only and needs a non-exempt target | `dispatch-guards.ts:32,38-42`; 14.8 recipe | 14.8 recipe, Q13 |
| 2 | Q13 gains a third outcome: blocked at `:39` means the knob wiring is broken | `dispatch-guards.ts:39-42` | Q13 |
| 3 | D13 cites `:39-41` for the guard and `:42` for `checkCap`, and uses full paths for the clamp wiring | `dispatch-guards.ts:39-42`; `src/context/facades/config-facade.ts:60`; `src/hooks/guards/shared/limits.ts:12-15` | D13, Q13 |
| 4 | D13 reconciliation: K3 is the host ceiling; clamp `min(knob, 3)` at the wiring point; the schema stays 1..20; `MAX_CALL_DEPTH` and `callDepth` are untouched | 17.3; `config-schema.ts:14`; `limits.ts:12-15`; `iteration-budget.ts:194` | D13, 14.7, 16.3, 17.3 |
| 5 | D6: recording is per successful result for a named agent; the warning appends only when the result is a string; failures reset the run | `tool-execute.ts:564-580` | D6, 3.1 row, 16.2 row 3 |
| 6 | D11: `!quarantineApplied` is a second bypass of the 50k cap | `tool-execute.ts:771` | D11 |
| 7 | 16.3's P3 row: enforcement is per detector as the gate sets it; only the output cap is unconditional | 15.5 gate table; 14.7 | 16.3 |
| 8 | The probe recipe must add the Q13 chain, the Q15 no-tool turn, and the Q16 `bash` repeats; Q14 needs one `handoff` return | 14.8 | 14.8 recipe |
| 9 | Q14 is reframed as a second-truncation search; Q16 is marked code-answered and only confirms wiring | `security-policy.ts:14`; `tool-loop-guard.ts:200` | Q14, Q16, 14.8 note |
| 10 | The repeat block is a counter threshold: four prior identical results, the fifth call is refused | `tool-loop-guard.ts:13,201-202` | 17.3 note |
| 11 | Section 6's cost-25 sentence assumes efficacy 5; at efficacy 4 the same offset is 3.85 to 3.75 | Section 6; 16.2 row 8 | Section 6 annotations |
| 12 | D13's `config-facade` and `limits` citations need full paths | `src/context/facades/config-facade.ts:60`; `src/hooks/guards/shared/limits.ts:12-15` | D13 |

### 17.3 Adjudications

**D13 — the chosen reconciliation.** K3 and K4 are read as written and are not restated. K3 fixes
the host ceiling at 3. K4 fixes the accepted request range at 1..20 and the schema bound; it says
the knob is configurable, not that the host must honour a request above its own ceiling. The two
are consistent once the knob is treated as a request and K3 as the host ceiling. The knob already
lowers nesting for values 1..2 today, so "must equal 3" is read as the default and the upper bound,
not as a ban on lowering; no amendment is implied.

The fix is applied at the single wiring point, `src/context/facades/config-facade.ts:60`:
`setMaxCallDepth(Math.min(c.maxCallDepth, 3))`. Then `MAX_CALL_DEPTH` is always at most 3 and
`checkCap`'s `DEFAULT_CAP.maxDepth = 3` can never disagree with the guard. No change is made to
`checkCap`, `MAX_CALL_DEPTH`, `callDepth`, or the schema. The clamp is not silent: the config
description states that values above 3 are bounded by the host ceiling, and the load path logs the
requested and effective values.

Rejected alternatives:

- Let the knob win. `MAX_CALL_DEPTH` would become 4..20 and host nesting would exceed 3, violating K3.
- Keep the current silent clamp. The guard and `checkCap` disagree, which is the exact defect D13 records.
- Restate K3 as "default 3". The plan cannot restate an owner constraint; only the owner can.

Consequence: D13 becomes a documented clamp, not a conflict. Knob values 4..20 are accepted by the
schema and bounded by K3; values 1..2 lower the ceiling and 3 is the default. D2 can follow the
ledger gate once the clamp is single-sourced. This is the only reading under which both K3 and K4
remain literally true.

**Depth-guard scope — `task` only.** `callDepthGuard` returns early unless `input.tool === "task"`
(`dispatch-guards.ts:32`). `handoff` and `fasttrack` do not dispatch a nested child from the current
turn; they record a handoff for another agent (`src/tools/handoff.ts`), so `callDepth` does not
track them. The three-tool surface shares the output cap (D11), not the depth ceiling. This is
recorded so the split is explicit rather than implicit; if a future runtime makes a handoff a
synchronous nested call, the depth guard must cover it. No D19 is added, because the tree does not
show a nested-session path for either tool.

**Probe 0 scope.** Q13 runs in the separate 4-deep chain, with a non-root caller and a non-exempt
target; the base run stays one root and one child. Q13's three outcomes are distinct: rejected at
`checkCap` means the clamp is real; blocked at the guard means the knob wiring is broken; allowed
means the knob is authoritative and D13 is only a citation defect. Q14 is code-answered for the
cap and only looks for a second truncation. Q16 is code-answered for the block and only confirms
the runtime wiring. The question count stays sixteen.

**Repeat-block timing.** `REPEAT_RESULT_BLOCK_AT = 4` is compared against the count of prior
identical results before the call (`tool-loop-guard.ts:201-202`), so the fifth identical call is
refused, not the fourth. The dossier's "block at 4" is a counter threshold, not a call index.

**Sensitivity annotation.** Section 6's cost-25 sentence was written with the uncorrected efficacy
5 and gives a 3.85 tie; with Option 9 at efficacy 4 the same offset gives Option 6 the win, 3.85 to
3.75. The Section 6 paragraph and the 2.1 note are annotated in place; 16.2 row 8 remains the
operative statement.

### 17.4 Rejected claims

- **R4's P2 gate-cell claim is rejected.** The P2 row of the 14.7 table (line 911 in Revision 2.2)
  already reads "7 days or 30 sessions; report works; shadow readings exist". The "live schema
  pinned; per-tool ledger; retry receipts unchanged" text is the P1 row (line 910 in Revision 2.2).
  No stale P2 cell exists.
- **"Revision 2.2 violates K3/K4" is rejected as a violation.** R2 conceded that a mechanism-free
  "reconcile" cannot breach either constraint. The defect was a missing mechanism, now supplied in
  17.3; the constraints themselves were never edited.
- **"The sensitivity numbers are unverifiable" is not a defect.** R2 could not recompute the
  Section 6 weights inside its read range and labelled the result unverified, not wrong. R4 and R5
  recomputed the pairs independently and matched 16.2 row 8.
- **R1's Q14/Q16 code settlement is accepted as framing, not removal.** Both questions stay in
  Probe 0; their outcomes now confirm wiring rather than discover a policy.
- **R1's D19 proposal is not adopted as a defect.** The offered alternative, an explicit scope
  note, is adopted in 17.3 because `handoff`/`fasttrack` do not create a nested `callDepth` path in
  this tree.

### 17.5 What Revision 2.3 does not change

- K1-K9 are unchanged. No role guard is added. `MAX_CALL_DEPTH` and `callDepth` are untouched; the
  clamp is applied at the wiring point, not inside either.
- The schema bound stays 1..20; the knob is a request bounded by K3, not an immutable constant.
- The canary channel remains cancelled.
- The R5 deferral stays in `docs/plan-report-path-to-tawa.md`; this plan does not reopen it.
- G-006, WP13, and WP14 are not imported.
- No Revision 1, 2, 2.1, or 2.2 item is removed; Section 17 and inline corrections are additive.
- Except for D13, nothing is implemented. The review was read-only and did not run the host.
  D13 landed after the review; its implementation, proof, and receipt are recorded in 17.6.

### 17.6 D13 implementation note (2026-11-06)

D13 is implemented on top of the review. No other plan item is changed.

| Item | Result |
| --- | --- |
| Resolver | `src/hooks/guards/shared/limits.ts:15-20` adds `HOST_CALL_DEPTH_CEILING = 3` and `resolveMaxCallDepth`; the setter is unchanged |
| Wiring | `src/context/facades/config-facade.ts:61-70` resolves the request, logs the clamp, and calls `setMaxCallDepth` once |
| Description | `src/context/config-schema.ts:14-19`, the regenerated `tawassul.schema.json`, and `docs/configuration.md` state the 3 ceiling |
| Proof | `scripts/prove-call-depth-clamp.ts`, 250 assertions, gate step `call-depth-clamp`; 177 proof steps and 180 proof files |
| Receipt | `docs/experiments/receipts/2026-11-06-d13-call-depth-clamp.md` |
| Evidence | `npm run verify` GATE PASS; shard 4 passed all 46 steps, including the new proof |

The proof covers knob values 1..20, absent, zero, negative, `NaN`, `±Infinity`, fractional, and
out-of-range inputs; the real load path; the schema bounds; and the real depth guard at ceilings
1..3 for prior depths 0..20, with `checkCap` agreement at every allowed depth. It also reproduces
the pre-fix divergence at knob 5. Probe 0 Q13 still requires its own live host receipt; this note
does not claim a host run.

### 17.7 Probe 0 findings (2026-11-06)

Probe 0 is complete for the sixteen questions. Receipt:
`docs/experiments/receipts/2026-11-06-token-usage-probe.md`. Fifteen questions have answers; Q13 is
answered by correction, and Q9/Q11/Q12 adjust assumptions without changing a plan item. No plan
item is removed, no ledger code is written, and K3/K4 and the `callDepth` semantics are unchanged.

| Item | Live finding | Effect |
| --- | --- | --- |
| Q13 | The four-deep chain is not constructible. `callDepth` is keyed per session and starts at 0 in a child, so each level dispatches at depth 1; sequential dispatches decrement after return (`tool-execute.ts:515-527`). A non-root caller may only target `explore`/`general` (`security-policy.ts:97-108`), and those are exempt (`dispatch-guards.ts:34-37`); any other target is rejected by `taskToolAuthorizationGuard` (`:155`). A child's first action is blocked by `firstResponseGuard` (`resource-guards.ts:25-26`). Four parallel root dispatches passed the ceiling of 3 because validation and commit are not atomic (`q13c`). | The three outcomes in the Q13 row collapse. D13's clamp to 3 is still correct; a dispatch with a session counter of 3 is rejected at `dispatch-guards.ts:39-41` before `checkCap` at `:42`, but a chain never reaches that counter. The row stays as written; this table is the correction. |
| Q9 | `session.context(child)` returns the stored final message after a host restart, but a manual compaction replaces the message window with a generated `compaction` summary. The summary contained the marker in this run; exactness is not guaranteed. | Capture at return or a durable file pointer is mandatory for exact child output. This strengthens Q10's return-time capture path. |
| Q10, Q14 | `task` and `handoff` returned full payloads at 3.5k characters; the 50k cap excludes all three tools (`tool-execute.ts:771-772`). `fasttrack` shares the exclusion but was not executed. | No second truncation path below 3.5k. The 50k boundary stays code-settled. |
| Q11 | The 24,513 B schema is fully inside the cached prefix once warm: a bare request reported `cache.read 51,200` against `input 280`, and `cache.write` stayed 0. | Option 11 is hygiene, not savings; the 41% figure is a cold-start share. |
| Q12 | `steps: 2` stopped the turn after one tool step with the host message `!!!!!Maximum steps for this agent have been reached`. | Option 8 must be re-scored; it is a host-side step cap, not a token cap. |
| Q15 | `session.text.ended` and `session.usage.updated` arrive before `session.execution.succeeded` and before any next request; no `session.idle` fires in `run` mode. | The echo detector can hook `session.text.ended`. |
| Q16 | Five identical `shell` calls all completed. | P3 must widen the repeat set and the shadow detector must count non-read repeats, as planned. |
| Cost | Every event reported `cost 0` on `opencode/big-pickle`, including children and compaction. | Weighted tokens are the unit; rows are labelled `cost_unpriced`. |

### 17.8 P2 ledger shadow — first slice (2026-11-06)

P2 is **partially executed**. The ledger core, JSONL, historical backfill, reload reconciliation,
the self-injection audit, the health report, and the shadow repeat/echo/fan-out detectors are
implemented and proven. The 7-day / 30-session window started on 2026-11-06T20:47Z and has not
completed, so the P2 gate remains open and no enforcement is claimed. Receipts:
`docs/experiments/receipts/2026-11-06-p2-usage-ledger.md`,
`docs/experiments/receipts/2026-11-06-p2-usage-shadow.md`,
`docs/experiments/receipts/2026-11-07-d12-no-agent-row.md`,
`docs/experiments/receipts/2026-11-07-p2-isolated-experiments.md`,
`docs/experiments/receipts/2026-11-07-p2-live-probe.md`,
`docs/experiments/receipts/2026-11-07-p2-history-calibration.md`,
`docs/experiments/receipts/2026-11-07-p2-live-ledger-reload.md`, and
`docs/experiments/receipts/2026-11-07-p2-gate-readings.md`.

| Item | Implementation | Evidence |
| --- | --- | --- |
| Event source | `session.usage.updated` is parsed from the raw stream in `src/v2/setup.ts`; Q1 and Q2 hold | `parseUsageEvent` proof branches |
| Snapshots and deltas | latest cumulative per session; deltas derived from consecutive snapshots; a shrinking snapshot is a labelled `resync` | cumulative, delta, and resync assertions |
| Unit | `billable = input + output + cache.read * 0.10 + cache.write * 1.25`; `reasoning` stays inside `output`; `contextSize = input + cache.read` (Q4) | arithmetic assertions |
| Cost label | `cost 0` produces `costUnpriced: true`; priced sessions produce `false` (Q8) | priced/unpriced assertions |
| Lineage | recursive `session.get` parent walk on first sight; depth 0/1/2; a resolver failure emits the row with `depth: null` and counts `lineageUnknown` (Q5, Q6) | live-lineage and fail-open assertions |
| Backfill | `session.list` paged 500 at a time, newest first, up to 10 pages; zero-usage sessions skipped; brief pages supply parent depth; unknown parents count as orphans | two-page backfill assertions |
| Reload | reads the `.1` rotation file and the active file; restores sessions, turns, and injection totals; the first post-restart delta reconciles against the persisted snapshot | reload and rotation assertions |
| Boot gap | a list snapshot above the persisted counter writes an `unobserved` row with only the missing delta | gap assertions |
| Injection audit | `digest`, `context`, and `session_index` bytes recorded from `src/hooks/session.ts` into `kind: "injection"` rows | injection assertions |
| No-agent audit | every tool call without `input.agent` records a `kind: "noagent"` row from `src/hooks/tool-execute.ts`; the count appears in health (D12's record half; the default/deny/warn policy stays open) | no-agent assertions |
| Repeat shadow | per session and tool, warning at 3, trip at 5; failed calls and calls without a session are ignored; no blocking | repeat assertions |
| Echo shadow | `session.text.ended` per assistant message, flushed on `session.usage.updated`; 80% trigram overlap for 12 consecutive no-tool turns; a tool turn resets the streak (Q15); Revision 2.4 adds the 200-character floor, so a shorter turn is not counted and breaks the run | echo assertions plus the length cases |
| Fan-out shadow | `task`, `handoff`, and `fasttrack` dispatch text clustered by 80% similarity inside a 10-minute window; trip at 6 | fan-out assertions |
| Sink | every observation becomes a `kind: "shadow"` JSONL row and a health reading; reload restores the row and session counts | ledger-sink and reload assertions |
| Report | `health()` prints the whole `## Usage ledger` block; a real host call at 2026-11-07T05:25Z returned 23 sessions (9 roots / 14 children, 0 orphans), root 1,896,313/22,292,967/22,292,967 and child 305,278/582,083/679,631 weighted tokens, 336 usage plus 9 injection rows at 26,913 B, and 0 shadow sessions; the backfilled count is cumulative across reload (23) rather than per boot | live health call plus reload assertion |
| Calibration from history | a read-only copy of the v2 lane DB gives the first distribution without waiting: project roots 1,896,313 / 22,292,966.6 / 22,292,966.6 billable (n=4), children 305,277.8 / 582,082.6 / 679,631 (n=14); `p99(root)` is far above 300k, so Option 6's falsification does not fire; the sample is below 30 sessions, so the gate stays open | `2026-11-07-p2-history-calibration.md` |
| Live window | the desktop host runs the built ledger: 299 rows at 2026-11-07T03:26Z (293 usage, 6 injection at 17,942 B), 23 backfilled sessions plus 1 live session, 1 `unobserved` boot-gap row, and 0 shadow trips; the window started 2026-11-06T20:47Z | `2026-11-07-p2-live-window-state.md` |
| Live reload | a copy of the real ledger reloads through `UsageLedger.start()`: 312 rows at 2026-11-07T04:07Z (306 usage, 6 injection at 17,942 B), 23 sessions (9 roots / 14 children), 1 priced and 22 unpriced, `unit: mixed`, root p50/p90/p99 1,896,313 / 22,292,966.6 / 22,292,966.6, child 305,277.8 / 582,082.6 / 679,631 — identical to the independent aggregation | `2026-11-07-p2-live-ledger-reload.md` |
| Gate readings | against the live ledger at 2026-11-07T04:26Z: `p99(root)` 22,292,966.6 does not cancel P5; weighted cache-read share 93.19% keeps Option 11 as hygiene; orphan rate 0/23 = 0% leaves C4 usable; event loss 1 `unobserved` in 326 usage rows = 0.31% does not fire; echo and repeat false positives still need the forward window | `2026-11-07-p2-gate-readings.md` |
| Proof | `scripts/prove-usage-ledger.ts`, 123 assertions, gate step `usage-ledger`; `scripts/prove-usage-shadow.ts`, 80 assertions (95 after Revision 2.4), gate step `usage-shadow`; 179 steps and 182 files | `npm run verify` GATE PASS |

The shadow detections are now live readings rather than an implementation gap: the root/child p99
split, the orphan count, `unobserved` rows during reload, injected bytes per source, repeat and
fan-out flagged sessions, and echo streaks are all recorded. The parser is checked against the
real file too: reloading a copy of the live ledger reproduces the independent aggregation exactly
(312 rows, 23 sessions, same percentiles, same 17,942 injected bytes). The first distribution is no
longer blocked on the window either: a read-only copy of the lane DB yields root p99 22.29M and
child p99 679.6k billable with four project roots, enough to reject Option 6's falsification but
not to set budgets, since the project sample is 18 sessions. The same live copy settles three more
gate rows: the weighted cache-read share is 93.19% (Option 11 stays hygiene), the orphan rate is 0
of 23 sessions, and event loss is one `unobserved` row in 326 usage rows (0.31%). Two readings
still require the forward window:
echo-flagged sessions per 30 sessions and the repeat detector's false-positive rate. Cached-schema
share is settled by Q11 (repeat requests hit the cache in full, so Option 11
stays hygiene). Catalog-derived cache weights and the 20% cost reconciliation warning are deferred
until a priced model is observed; until then every weight is labelled `source: "default"` and
every zero-cost row is `cost_unpriced`.

The detectors enforce nothing: they only emit rows. Deleting `src/services/usage-ledger.ts`,
`src/services/usage-shadow.ts`, their setup wiring, the session-hook audit calls, and the
tool-hook observers is the rollback, matching the plan's Phase 1 rollback row.

The event source is proven end to end as well: three isolated live-host runs wrote six `usage` rows
each from the real `session.usage.updated` stream, priced the host's own `step_finish` deltas
exactly, and tripped `repeat` at five identical shell calls (warning at three). Those runs also
showed `noagent: 0` because the host populated `input.agent` on that path, so the D12 policy
decision stays open while the record path remains proven at the hook boundary. The desktop host
itself now runs the same build: its ledger holds 299 rows (293 usage, 6 injection), 23 backfilled
sessions, one live session, and one real `unobserved` boot-gap row, with zero shadow trips so far.

---

## 18. Revision 2.4 — owner corrections (2026-11-07)

Two owner decisions from 2026-11-07 are applied. Both are additive: no earlier item is removed,
the detectors stay shadow-only, and the P2 gate stays open.

### 18.1 Echo minimum length: 200 characters

Problem: `gramsOf` falls back to unigrams for texts under three tokens, so two identical short
replies ("ok", "done") have similarity 1.0. Twelve such turns could trip the echo detector with no
context re-read, which is the false-positive shape the gate is meant to measure.

Decision (owner): a turn counts only when its trimmed text reaches 200 characters.

Implementation (`src/services/usage-shadow.ts`): `SHADOW_ECHO_MIN_CHARS = 200`, an `echoMinChars`
option, and a length check in `flushEcho` after the `hadTool` branch and after the empty-normalized
skip. A shorter turn is not counted, clears the streak and the comparison text, and is therefore a
hard boundary: only a consecutive run of eligible turns can trip. The trip detail carries `chars`
and `minChars` for after-the-fact adjudication. The boundary is inclusive: exactly 200 characters
counts; 199 does not.

Consequences:
- A short turn never extends a streak, even when it is identical to its neighbours.
- A tool turn still resets first, independent of its text length.
- The detector remains shadow-only; the P2 gate denominator (sessions with a 12-turn run) is
  unchanged, but the eligible-turn definition now includes the length floor.
- Residual: an echo of long text separated by short turns is not counted; that pattern emits less
  text than the one the detector targets, and the repeat detector does not cover it either.

### 18.2 Context window: host verbatim, 200k default

Problem: `resolveModelWindow` used `priced = pricingWindow(...) ?? MIN_TRUSTED_WINDOW` and then
`Math.min(host, priced)`. An uncatalogued model that the host reported at 1M was computed at 128k,
so the pack/transfer gate fired far too early; `message-updated.ts` used the same 128k as its nudge
denominator.

Decision (owner): 128k is obsolete as a default. The weakest good coding model has 200k and new
models reach 1M, so the default must not cap a larger host declaration. There is no static price
registry gate on the ledger path: an unknown model runs with default weights and `cost_unpriced`,
never a refusal. The legacy cost tracker still throws for an unknown id, but its only caller passes
the catalogued `unattributed` id inside a fail-open catch, so no unknown model reaches that branch
today.

Precedence:
1. `TAWASSUL_MAX_CONTEXT_TOKENS` where that override already exists (the nudge path).
2. The host's `limit.context`, verbatim, at or above the 2,000-token sanity floor; no upper clamp.
3. The pricing catalog, only as filler when the host is silent.
4. `DEFAULT_CONTEXT_WINDOW = 200000`, labelled as a default.

Implementation:
- `src/services/context-pack/types.ts`: `MIN_TRUSTED_WINDOW` (128k) is replaced by
  `WINDOW_SANITY_FLOOR = 2000` and `DEFAULT_CONTEXT_WINDOW = 200000`.
- `src/services/context-pack/accounting.ts`: `resolveModelWindow` returns the host value verbatim,
  then the catalog value, then the default; the non-integer and upper-bound checks are gone;
  `resolveReserve` uses the 200k default for a non-finite or non-positive window.
- `src/hooks/message-updated.ts`: `DEFAULT_CONTEXT_MAX_TOKENS = 200000`; the catalog still fills a
  known model, and the environment override still wins.
- Reconciliation is still skipped unless a catalog price and a host `cost > 0` both exist.

Consequences: a host 1M declaration with 100k of history no longer overflows (the old 128k clamp
did); the reserve at the 200k default is 50k; a 200k host declaration and a 96k host declaration
are both trusted; a new model absent from the catalog packs against its host window instead of a
fixed 128k. The nudge path still sees no host limit (the hook has no model list), so it uses the
catalog and then the 200k default; that gap is a reading, not a clamp.

### 18.3 Proofs

- `scripts/prove-context-budget.ts`: 200k fallback, 96k/200k/1M/12M host pass-through, the 2,000
  floor boundary, fractional flooring, string/negative rejection, catalog fill, host-over-catalog,
  the 50k reserve at 200k, the 1M no-overflow case, the old 128k clamp overflow, and the nudge
  default/catalog/env precedence.
- `scripts/prove-usage-shadow.ts`: 95 assertions, including 50 identical short replies (no trip),
  a short turn breaking an 11-turn run, a short tool turn still resetting, exactly 200 characters
  tripping at 12, and 30 turns at 199 characters never tripping.
- Receipt: `docs/experiments/receipts/2026-11-07-p2-echo-length-window.md` and its script.

### 18.4 What Revision 2.4 does not change

The 50k tool-output cap, the absence of a price registry, shadow-only enforcement, the P2 window
(30 sessions or 2026-11-13T20:47Z), the D12 warn-first policy, the Option 8 rejection, and the
repeat distinct-turn rule remain as in Revision 2.3.

---

## Appendix A — Evidence with numbers

| Claim | Number | Source | Confidence |
| --- | --- | --- | --- |
| Multi-agent token multiplier | ~15x chat | Anthropic, multi-agent research system | verified |
| Single agent multiplier | ~4x chat | same | verified |
| Performance variance explained by tokens | ~80% | same | verified |
| Early subagent over-spawn | 50 for a simple query | same | verified |
| Effort scaling, simple | 1 agent, 3-10 calls | same | verified |
| Effort scaling, comparison | 2-4 agents, 10-15 calls each | same | verified |
| Effort scaling, complex | 10+ agents | same | verified |
| Subagent summary size | 1,000-2,000 tokens | Anthropic, context engineering | verified |
| CrewAI identical-call stop | 5x, fixed | CrewAI docs | verified |
| CrewAI deferral threshold | 25% of window | CrewAI docs | verified |
| CrewAI max_iter | 20 | CrewAI docs | verified |
| AutoGen max_tool_iterations | 1 | AutoGen docs | verified |
| Pydantic request_limit | 50 | Pydantic AI docs | verified |
| OpenAI max_turns | 10 | OpenAI Agents SDK docs | verified |
| LangGraph recursion_limit | 25 | LangGraph docs | verified |
| Google ADK max_iterations | 5 in the example | ADK docs | verified |
| s1 saturation | ~6x | arXiv 2501.19393 | verified |
| Echo loop size | 2253 assistant msgs, 466M tokens | opencode #43028 | verified |
| Identical MCP loop | 277 calls | opencode #31942 | verified |
| Fan-out OOM | thousands of sub-sessions | opencode #40175 | verified |

## Appendix B — Code map

| Concern | File | Lines |
| --- | --- | --- |
| Budget limits and growth | `src/services/iteration-budget.ts` | 5-6, 25-26, 129-149 |
| Budget key | `src/services/iteration-budget.ts` | 80-83 |
| Dead caps | `src/services/iteration-budget.ts` | 194, 206-212 |
| Dead cap call and depth guard | `src/hooks/guards/dispatch-guards.ts` | 39-42 |
| Cap knob | `src/context/config-schema.ts`; `src/hooks/guards/shared/limits.ts` | 14; 12-15 |
| Tier assignment | `src/hooks/guards/dispatch-guards.ts` | 207-221 |
| Per-tool consumption | `src/hooks/tool-execute.ts` | 265-287 |
| Missing-agent bypass | `src/hooks/tool-execute.ts` | 265 |
| Repeat and no-progress guards | `src/hooks/guards/tool-loop-guard.ts` | 9-16, 123-127, 193-207; wired at `tool-execute.ts:217,581` |
| Dispatch output cap exclusion | `src/hooks/tool-execute.ts`; `src/security-policy.ts` | 771-772; 14 |
| Depth semantics | `src/hooks/guards/dispatch-guards.ts` | 236-252 |
| Depth constant | `src/hooks/guards/shared/limits.ts` | 12-19 |
| Context nudge thresholds | `src/services/context-nudges.ts` | 3-7, 21-24 |
| Nudge evaluation | `src/hooks/message-updated.ts` | 449-475 |
| Fabricated cost | `src/bootstrap/event-integrations.ts` | 226-238 |
| Event hook | `src/bootstrap/plugin-init.ts` | 1230 |
| Cost tracker API | `src/services/cost-transparency/tracker.ts` | 57-102 |
| Config schema | `src/context/config-schema.ts` | 14, 16-20 |
| Exempt calls | `src/hooks/PipelineState.ts` | 42 |
| Known constraints | `TRIAGE.md` | 116-125 |
| Prior plan, closed | `docs/FUTURE-WORK-PLAN.md` | section 4 |
| Live schema payload | `docs/experiments/receipts/2026-11-05-schema-payload.json` | 24,513 B / 6,129 tokens, 44 tools |
| Usage event | `node_modules/@opencode/schema/dist/event-manifest.d.ts` | 1097-1145; durability `ephemeral` at 1136 |
| Session totals and parent | `node_modules/@opencode/client/dist/promise/generated/types.d.ts` | 3062-3064; call at `promise/client.d.ts:213` |
| Session bridge methods | `src/v2/session-bridge.ts` | 11-24 (type), 28-42 (install) |
| Session Index ceiling | `src/hooks/session.ts` | 144-146, 468-481 |
| Plugin injections | `src/hooks/session.ts` | 291-373, 431, 524 |

## Appendix C — Glossary

- **S1 / S2 / S3**: the three failure signatures in Section 1.1.
- **Ledger**: the per-session record of host-reported usage.
- **Shadow mode**: compute and log interventions without enforcing them.
- **New spend**: an action that increases future token cost (a dispatch, or a large read).
- **Spend-neutral**: an action that does not increase future cost (an edit, a write, a report).
- **Echo loop**: repeated assistant output with no tool activity and a large re-read context.
- **Fixed-cost diet**: reducing the bytes every request pays before any loop starts (tool schema, injected digests).
- **Weighted tokens**: tokens multiplied by a price ratio so cached reads are not counted like fresh input.
- **Durable pointer**: a file or context-pack entry that holds a full result when the injected summary is capped.
