# Token-Burn Control — Design Dossier for Multi-Model Review

Status: proposal only. Nothing in this document is implemented.
Date: 2026-11-05
Target: Tawassul V2, this tree, OpenCode host >= 2.2.0
Audience: independent models and agents asked to score the options and produce a verdict.

## How to use this document

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
| `src/hooks/guards/dispatch-guards.ts:41` | calls `checkCap(agent, depth, 0, 0)` — subagent and token branches are dead |
| `src/hooks/guards/dispatch-guards.ts:213-227` | `budgetGuard` assigns a tier from `analyzeEffort(desc)` then checks `remaining` |
| `src/hooks/tool-execute.ts:265-287` | `consume(agent, sessionID)` on every tool of a named agent; `refund` on heartbeat failure |
| `src/services/context-nudges.ts:3-7` | thresholds 0.70 / 0.85 / 0.95 |
| `src/services/context-nudges.ts:21-24` | cooldown 60 s, one fire per severity tier |
| `src/hooks/message-updated.ts:452-475` | nudge evaluated only when `role === "user"`, using an estimate from the priority index |
| `src/bootstrap/event-integrations.ts:226-238` | cost recorded as `outputTokens = outputLength x factor`, `inputTokens = outputTokens x 1.5` |
| `src/bootstrap/plugin-init.ts:1231` | event hook handles `session.error`, `session_idle`, free-limit; no usage event |
| `src/services/cost-transparency/tracker.ts:57` | `recordOperation` exists and supports `cacheReadTokens` |
| `src/context/config-schema.ts:16-20` | `adaptiveBudgets`, `budgetStepPercent`, `budgetCeilingFactor`, `budgetTiers` |
| `src/hooks/PipelineState.ts:31` | `MAX_EXEMPT_CALLS = 20` |
| `src/hooks/guards/dispatch-guards.ts:242-258` | `callDepth` increments the parent session only; exempt recon does not increment |

### 3.2 Defect inventory

| ID | Defect | Evidence | Consequence |
| --- | --- | --- | --- |
| D1 | Budget multiplies with fan-out | key is `agent@session`, `iteration-budget.ts:80-83` | 5 agents = 5 independent budgets; children each get a fresh 60 |
| D2 | Token and subagent caps are dead | `checkCap(..., 0, 0)`, `dispatch-guards.ts:41` | the two fields specifically meant for this problem never fire |
| D3 | No consumer for host usage | `grep "usage.updated" src/` returns zero | the authoritative token numbers are unused |
| D4 | Context nudge is user-turn-only and estimated | `message-updated.ts:452-458` | blind to S1, and measures text length, not billed tokens |
| D5 | Cost telemetry is fabricated | `event-integrations.ts:226-232` | no decision can be based on current cost reports |
| D6 | No identical-repeat detection | absent | S2 burns unbounded |
| D7 | No no-progress detection | absent | S1 burns unbounded |
| D8 | Nudge does not trigger compaction or deferral | `context-nudges.ts` only logs or injects text | warning without mechanism |
| D9 | `consume` counts spend-neutral and spend-increasing tools identically | `tool-execute.ts:268` | the quota blocks a final report as readily as a new subagent |

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
| 8 Host-native | 1 | 1 | 5 | 5 | 5 | 1 | 1 | 2.30 | disqualified (efficacy) |
| 9 Composite | 5 | 4 | 4 | 5 | 2 | 5 | 5 | 4.30 | passes |

Sensitivity note: if false-positive safety is weighted at 30 and efficacy at 15, Option 6 ties Option 9. If implementation cost is weighted at 25, Option 6 wins outright. The case for Option 9 therefore rests on one claim: that a slow, non-repeating burn is real enough to justify the extra machinery. Evaluators should attack that claim first.

---

## 7. Recommended composite (author's position)

### 7.1 Components

1. **UsageLedger** — new, small. Subscribes to `session.usage.updated`. Keeps per session: total tokens, total cost, last `input` (context size), turn count, tool count, child set, last progress timestamp. Reconciles from `session.get` on boot. Writes JSONL for calibration.
2. **Context pressure** — feeds the existing `ContextNudgeManager` with real `input` tokens and evaluates on every turn, not only user turns. At 80% enables tool-result deferral; at 90% requests summarize/save.
3. **Session burn budget** — a session-level aggregate (fixes D1) with zones at 50 / 75 / 90%. Amber: one advisory. Orange: block new `task` dispatches and defer large results. Red: block new spend only; edits, writes, and reports stay allowed.
4. **Shape guards** — identical repeat (3rd returns cached, 5th errors), no-progress echo (12 turns), fan-out (8 concurrent, 6 near-duplicates in 10 minutes).
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
- If fewer than 2 echo events occur in 30 sessions, the echo detector is dead weight; keep it in shadow.
- If the repeat detector fires on more than 5% of legitimate sessions, the digest rule is too strict.

---

## 10. Validation plan

Chaos scenarios, each a proof:

| Scenario | Expected |
| --- | --- |
| 200 assistant turns, no tools, output < 5% of input | echo detector trips at the configured turn |
| Same tool + args + result 20 times | 3rd returns cached, 5th errors |
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
| 0 | Commit the existing 19-file guard change set separately | clean base | revert the commit |
| 1 | `UsageLedger` + JSONL + shadow report; no enforcement | 7 days of data, report command works | delete the service and its hook |
| 2 | Fix D2 (feed `checkCap`), wire context pressure to real tokens, evaluate on assistant turns | context nudge fires on a synthetic echo loop | feature flag off |
| 3 | Shape guards: repeat, echo, fan-out, output cap | all chaos proofs pass, zero false positives on replay | flag off |
| 4 | Session budget zones, calibrated from phase 1 | < 1% legitimate Orange, 0 legitimate Red | flag off |

Config keys (all optional, all defaulting to the balanced preset): `usageGovernor.enabled`, `.mode` (shadow|enforce), `.preset`, `.rootBudget`, `.childBudget`, `.contextThresholds`, `.repeat`, `.fanOut`, `.echo`, `.outputCap`.

---

## 12. Open questions for evaluators

Answer each with a position and a reason.

1. Should the control unit be tokens, cost, turns, context size, or a composite? Why?
2. Should the budget scope be the session aggregate, the per-agent key, or the tree? If tree, how do you solve lineage and restart?
3. Is the "slow, non-repeating burn" a real risk in this workload, or a hypothetical used to justify extra code?
4. Should identical-repeat reuse the cached result (3rd call) or hard-fail immediately? What does that do to legitimate retries after an edit?
5. Is "output < 5% of input for 12 turns" the right echo signature, or is there a better one?
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
| Dead cap call | `src/hooks/guards/dispatch-guards.ts` | 41 |
| Tier assignment | `src/hooks/guards/dispatch-guards.ts` | 213-227 |
| Per-tool consumption | `src/hooks/tool-execute.ts` | 265-287 |
| Depth semantics | `src/hooks/guards/dispatch-guards.ts` | 242-258 |
| Depth constant | `src/hooks/guards/shared/limits.ts` | 12-19 |
| Context nudge thresholds | `src/services/context-nudges.ts` | 3-7, 21-24 |
| Nudge evaluation | `src/hooks/message-updated.ts` | 452-475 |
| Fabricated cost | `src/bootstrap/event-integrations.ts` | 226-238 |
| Event hook | `src/bootstrap/plugin-init.ts` | 1231 |
| Cost tracker API | `src/services/cost-transparency/tracker.ts` | 57-102 |
| Config schema | `src/context/config-schema.ts` | 14, 16-20 |
| Exempt calls | `src/hooks/PipelineState.ts` | 31 |
| Known constraints | `TRIAGE.md` | 116-125 |
| Prior plan, closed | `docs/FUTURE-WORK-PLAN.md` | section 4 |

## Appendix C — Glossary

- **S1 / S2 / S3**: the three failure signatures in Section 1.1.
- **Ledger**: the per-session record of host-reported usage.
- **Shadow mode**: compute and log interventions without enforcing them.
- **New spend**: an action that increases future token cost (a dispatch, or a large read).
- **Spend-neutral**: an action that does not increase future cost (an edit, a write, a report).
- **Echo loop**: repeated assistant output with no tool activity and a large re-read context.
