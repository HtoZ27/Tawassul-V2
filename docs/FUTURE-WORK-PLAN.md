# Future Work Plan — in-place repair of Tawassul V2

Status: plan of record, active.
Owner: plan.
Created: 2026-10-27.
Review points: see section 9. This document is re-opened and audited after every wave and again after the repair program ends.

This file is the durable register of the repair plan decided on 2026-10-27. It records the measured baseline, the wave order, the open forks, the withdrawn claims, the stale documented claims, and the post-repair audit checklist. Nothing in this file authorizes work by itself; the goal ledger (G-005) drives execution and the decision register (R-022 through R-028) records the rationale.

## 1. Standing decisions

- Repair the running Tawassul V2 tree in place. A new sibling plugin tree was evaluated and is deferred, not cancelled (R-022).
- The plugin ships only the agent-necessary skill set and acts as the platform the end user grows skills through: any SKILL.md placed by the user in .opencode/skills works through native discovery with no prefix and no plugin code path (R-023).
- Shipped skills carry the tawassul- prefix only, and only to avoid registry collisions (R-023).
- Agents stay dynamic through the addagent roster. Zero static agent md files are shipped (R-023).
- Wave order is measurement-first: no content ships before the measurement floor exists (R-024).
- Reviewer independence and shipped markdown content are plan-gated, not merely described (R-026, R-027).
- The zero-src claim is rescoped: Wave 1a is zero src, while Wave 0 touches src by design to repair measurement and the optional Wave 1b is an explicit small src change (R-027).

## 2. Plan-of-record references

- G-004: the original alternative design (nine-skill methodology kernel and sibling tree). Superseded by repair-in-place; its DoD criteria remain as the design evidence base.
- G-005: this plan, tracked as goal with items per wave and DoD per gate.
- R-022 repair-in-place adopted.
- R-023 skills as user-owned platform content, agents dynamic.
- R-024 wave order inverted to measurement-first, two claims withdrawn.
- R-025 evaluated corrections adopted into the plan of record.
- R-026 round-2 amendments from the code-reading analyst evaluations.
- R-027 code review confirmed all round-2 claims with two refinements.
- Evaluations recorded: eval-aa4d0c09 (round 1, 12 issues) and eval-d06c8d6c (round 2, 12 issues, cumulative ledger 38 merged).
- Atomic analyst evaluations: mimo, deepseek, beam-free, glm returned full verdicts; pickle returned a recorded NO-GO dissent; gemini could not deliver (round 1 quota exhaustion, round 2 output quarantined by the safety filter for hidden unicode characters in output). gemini is an open slot for a future round if the quota and filter permit.

## 3. Verified baseline

Every number below was checked against the current source, not estimated. Two of the original plan numbers were wrong and are recorded here as corrected.

| Item | Verified value | Evidence |
| --- | --- | --- |
| System concordance text | about 10 lines, roughly 0.7 to 1.1 KB, injected once per session with dedup guards on the message path and on the compaction path. The earlier 29 KB per-message figure was wrong. | src/hooks/message-updated.ts lines 493-524 and 715-741; src/hooks/session.ts lines 307-312 |
| i18n en.json, 41 KB | runtime lookup table compiled into the bundle. Never injected into the model prompt. Context weight is zero; report it as bundle and RSS weight only. | src/translations.ts line 1; build-v2.mjs line 89 |
| 42 tool descriptions | weight not currently published. The measurement primitive exists already: bytes plus estimated tokens by byte length over four. | src/v2/adapters.ts lines 51-57 |
| Session digest injection | goal digest plus top-10 importance-weighted records plus handoffs. Grows with live session state and is not part of any published baseline. | src/hooks/session.ts lines 299-349; src/services/importance-decay.ts |
| Actual-host smoke | exits 4 unless the direct tool import registers exactly 42 tools, and greps a count-bearing boot marker from the log. | scripts/release-smoke.sh lines 120, 159-168 |
| prove-e27 fixture | a stub binary fixture writes that boot marker to test smoke failure semantics. The real tripwire is the direct import in release-smoke.sh; both need the count relaxed to a range. | scripts/prove-e27.ts line 40; scripts/release-smoke.sh line 165 |
| Handoff entry schema | carries no model field. The only model reference is reroutedModel. Pre-run model comparison between agent names is therefore not possible from the payload. | src/context/types.ts lines 36-64 |
| Dispatch feedback machinery | capability comparison plus error/warn/info feedback with strictness gating already exists and is the natural insertion point if prevention is ever chosen. | src/tools/handoff.ts lines 549-604 |
| Observed models | agentModelMap records the actually-used provider/model per agent during the session. This is the real source for retrospective review-independence enforcement. | src/hooks/message-updated.ts lines 690-695 |
| Per-tool invocation logging | tool-run-log records tool, agent, sessionId, argsHash, status, timestamp and turn per run. This is the correct source for hot and cold ranking. | src/services/tool-run-log.ts |
| activity-metrics | consumes five lifecycle event types with durationMs-or-0 and tool-or-unknown. It is lifecycle telemetry, not per-tool invocation data. Repairing it for ranking was the wrong plan; it is now either a hygiene fix or retired from ranking use. | src/bootstrap/service-factory.ts lines 388-406 |
| State directory resolution | global scope already resolves to globalConfigDir()/tawassul-v2-state and would pass any worktree-survival proof trivially. Project scope returns the working-directory stateDir unchanged, so the ledger dies with the worktree, matching the flaw attributed to Superpowers. | src/utils/path-resolver.ts lines 98-101; src/context-class.ts line 418 |
| Gitignore state exclusion | goals, timeline, mission-board, sagas, handoff-ledger.jsonl and metrics are excluded from git, so nothing recovers them after a worktree change. | .gitignore lines 1-14 |
| Global installer verify | bundle hash, byte size and host support only. No per-file ownership ledger exists for distributed content. | scripts/install-global.ts lines 479-518 |
| Host version pin | declared in three announced places and additionally embedded as literals elsewhere: the launcher script, the installer, the smoke script, the doctor script as warn-only, test vectors and the package host dependency. | scripts/opencode-v2-iso.sh lines 210-211; scripts/install-global.ts lines 20-22; scripts/release-smoke.sh lines 27-29; scripts/doctor-v2.sh lines 424-427 |
| Proof count | 87 proof scripts and 87 manifest steps, while five documents still state 25. | scripts/gate-manifest.json; README.md line 79; AGENTS.md line 72; TRIAGE.md line 125; PLAN.md line 255; CUTOVER.md line 137 |
| Rules gate scope | .ts, .mjs and .json under src, scripts and tests plus two root files. Shipped markdown is outside the gate. | scripts/check-v2-rules.mjs lines 1-10 |

## 4. Waves

### Wave 0 — measurement floor and gate hygiene

Runs first and blocks all content waves.

1. Single measurement source: hot and cold ranking from tool-run-log. activity-metrics stays lifecycle telemetry with a duration hygiene fix or is retired from ranking use. A proof refuses any third measurement source.
2. Context baseline in measured bytes: the 42 tool schemas through measureSchemaPayload, the session digest composition, and the concordance at its measured once-per-session weight. i18n is excluded from the context budget and reported as bundle weight.
3. The 42-count tripwire is relaxed to a floor or range, the count-bearing boot marker is regenerated so no literal count remains, the stub fixture is kept consistent, and the documented literal is updated.
4. Host version pin is single-sourced to a generated constant and flows to every literal site: launcher, installer, smoke, doctor upgraded from warn to fail-closed, test vectors, package host dependency. One proof fails when any two sites disagree.
5. The published proof count is generated from gate-manifest.json.

### Wave 1a — shipped content, zero src

1. Nine agent-necessary skills plus four commands, one per tool-surface domain, each pointing at the tool descriptions it displaces.
2. A skills manifest with per-skill fields: id, displaced tool descriptions, eval id, and the scope decision. A proof validates the displaced list against the real tool registry and the eval id against the eval ledger. Shipped skills are marked eval-pending until Wave 4 closes their row.
3. A markdown branch in the rules gate: Arabic scan over raw text, comment scan limited to HTML comment syntax, code fences excluded by an explicit rule, scoped to the skills and commands paths only. Frozen documents such as SHARED.md stay outside the branch.
4. The user-growth contract and the tawassul- prefix rule are written into the bootstrap skill.
5. The minimum-inline rule is declared in the dispatch skill now and enforced in Wave 2: every binding constraint or prohibition stays verbatim in the tool description or gains an explicit pointer to the skill that carries it.
6. Reviewer independence is a structural text rule at dispatch: the reviewer agent differs from the implementer agent in base specialization and does not share the dynamic sentinel.
7. The installer gains a per-file ownership ledger written into the marker at install time. verify:global checks exactly that list for hashes and scope. uninstall removes only ledger-listed files. One proof installs user content plus shipped content, uninstalls, and asserts the user content survives.
8. The four commands are distributed and verified by the same mechanism.

### Wave 1b — preventive guard, optional fork

- Option A, recommended: no src change. The structural text rule plus the Wave 4 retro-probe carries enforcement until violations are actually observed.
- Option B: one small guard inside validateHandoffInput, reusing the existing feedback and strictness machinery at src/tools/handoff.ts lines 549-604, rejected when the reviewer slot shares base specialization or the dynamic sentinel with the implementer. This renames the wave Wave 1b and breaks the zero-src claim for Wave 1a on purpose.
- Decision owner: the user. Decision timing: before Wave 1b implementation, informed by whether Wave 4 retro-probe finds violations.

### Wave 2 — gated context diet

1. Every tool description is slimmed under the minimum-inline contract.
2. Closure metric: top-8 hot-tool retry counters from tool-run-log against the Wave 0 baseline. Token deltas alone never close the wave.
3. A live reload probe in an isolated boot using the smoke pattern: tool count before and after, the new tool callable, no duplicate registration, and the new schema visible in the following injection. A failure retires lazy registration for good and Wave 2 ships slimming alone.
4. The relaxed 42-count tripwire from Wave 0 is what keeps the gate green here.

### Wave 3 — structural guards

1. First deliverable: the state-root naming-key decision. Repository identity, such as the git remote, becomes the key for project-scope state. This includes the migration plan, a dual-read window, and HMAC key continuity.
2. Second: the survival proof that earns its name, booting two working directories against the same repo identity and asserting the same ledger in project scope. Global-scope passes are declared coverage theater and are not accepted.
3. Capability degradation replaces the hard host pin; the pin remains only for the state schema.
4. Snapshot boundary: code-state-auto is demoted so the native undo does not double-capture.
5. Native agents.compaction.model for cheaper summaries.
6. Dead-path cleanup.
7. W2 reachability audit: what a normal session actually touches of the 65k LOC tree, measured. W2 remains deferred and now measured rather than assumed.

### Wave 4 — behavioral gate

1. A separate gate:evals stage with an explicit time and token budget, fixed serialized fixtures, recorded receipts and flake tracking. It runs on the release path only. verify and gate:proofs stay eval-free, and incremental passes may squash to changed-skill evals.
2. Per-skill behavioral evals close the eval-pending rows from the manifest.
3. A skill-discovery probe.
4. A review-independence retro-probe comparing observed models per agent from agentModelMap against the tool-run log; a reviewer run on the implementer model is flagged.
5. The REPAIR document: wave verification matrix, corrected measured baseline, withdrawn-claims appendix, and the state-root naming-key decision with its window.

## 5. Verification matrix

| Wave | Proof to register in gate-manifest.json | Notes |
| --- | --- | --- |
| Wave 0 | prove-tool-run-ranking | hot/cold table from tool-run-log, refuses third measurement sources |
| Wave 0 | prove-context-baseline | measured bytes and estimated tokens via measureSchemaPayload, plus digest and concordance composition |
| Wave 0 | prove-host-pin-single-source | fails when any literal site disagrees, doctor included as fail-closed |
| Wave 0 | smoke tripwire relaxation | smoke script update with a floor or range; stub and docs consistent |
| Wave 1a | prove-skills-manifest | displaced lists against real tool registry, eval ids against eval ledger |
| Wave 1a | prove-md-gate | Arabic, comment syntax, fenced-exclusion and scope behavior |
| Wave 1a | prove-install-owner-ledger | marker records every distributed file with hashes |
| Wave 1a | prove-uninstall-preserves-user | user content survives uninstall; unlisted files never removed |
| Wave 2 | prove-context-diet | before and after bytes against the frozen baseline plus hot-tool retry counters |
| Wave 2 | prove-reload-live or documented skip | count, callability, no duplicates, next-injection visibility |
| Wave 3 | prove-state-root-survival | two working directories, same repo identity, same ledger, project scope |
| Wave 3 | prove-capability-degradation | degraded host keeps state schema and lock only |
| Wave 3 | prove-snapshot-boundary | no double capture against native undo |
| Wave 3 | prove-reachability-audit | W2 deferral measured |
| Wave 4 | gate:evals stage | budget declared, receipts and flake tracking |
| Wave 4 | prove-review-independence-retro | observed model mismatch across implementer and reviewer runs |
| Wave 4 | prove-skill-discovery | shipped skills discoverable with provenance tags |

## 6. Open forks and deferred items

- Wave 1b fork: prevention in src or retrospective only. Recommended A, decide after evidence from Wave 4.
- Sibling plugin tree: deferred, not cancelled. The 7-hub tool refactor from that design remains a possible future program, gated on the reachability audit from Wave 3.
- W2 (65k LOC maintenance surface): deferred. Wave 3 measures it rather than assuming it.
- W7 (session forensics as a capability): not claimed. The forensics skill is a documented reading path over timeline, handoff ledger and the tawassul log.
- pickle NO-GO dissent: recorded. Revisit its simplify-Wave-4 remedy when defining the gate:evals budget, specifically the option of squashing evals to a smoke-representative subset.
- Multi-host behaviour: out of scope. The production host remains the Desktop with its sidecar.
- gemini evaluation: undelivered in both rounds for operational reasons. Its slot remains open in any future round.

## 7. Withdrawn claims

- Durable state across a working-directory change. Withdrawn until the Wave 3 survival proof passes, and proven for project scope only.
- Session forensics as a new capability. Repositioned as a documented reading path over existing stores.
- i18n slimming as a context-diet gain. Excluded from the context budget and reported as bundle weight only.
- The 29 KB per-message concordance figure. Corrected to the measured once-per-session weight in section 3.

## 8. Stale documented claims to correct when the waves land

| Document | Stale claim | Corrective action |
| --- | --- | --- |
| README.md | 25 proofs at line 79, 42 tools at line 94 | generated proof count, range language |
| AGENTS.md | 25 proofs at line 72 | generated proof count |
| TRIAGE.md | 25 proofs at line 125 | generated proof count |
| PLAN.md | 25 proofs at line 255 | generated proof count |
| CUTOVER.md | 25 proofs at line 137 | generated proof count |
| This plan's own section 3 | any number that drifts | re-measure at each audit point |

The corrective action is generated-from-manifest, not hand-edited, so the next wave cannot reintroduce the drift.

## 9. Post-repair review instructions

This file is re-opened for audit after every wave closure and once more after the program ends. The audit must verify all of the following and record results against this file:

1. Re-run the full baseline measurement and compare it with section 3. Any drift updates section 3 before any new claim is made.
2. Every proof named in section 5 exists, is registered in gate-manifest.json, and runs in isolation.
3. The ledger survives the two-working-directory test with the same repo identity, in project scope.
4. A real isolated global install and uninstall leaves zero orphan files, and user-dropped skill content survives uninstall.
5. The review-independence retro-probe reports zero violations across a recorded sample of dispatches.
6. The gate:evals stage completed within its declared time and token budget, with no flake-driven release blocks unrecorded.
7. The generated proof count matches the tree and every document in section 8 has been regenerated, not hand-edited.
8. Shipped marks pass the markdown branch of the rules gate, and provenance tags distinguish shipped from user content.
9. The minimum-inline contract holds: no binding constraint or prohibition exists only in a skill.
10. RULES.md hygiene: memory checks recorded before every heavy step, heavy operations sequential, and /tmp/opencode cleaned after every run.

## 10. Execution rules carried from AGENTS.md and RULES.md

- English only in code, strings, tool descriptions and docs. Arabic is forbidden.
- No comments in code, including JSDoc and empty comments. Only the permitted directive shapes survive.
- Memory cap check before every heavy step: stop and clean if available memory is below 1.5 GB.
- Heavy operations are sequential: verify, ci, builds and test suites run one at a time.
- Clean temporary artifacts after every run, including /tmp/opencode.
- npm run verify after each wave; npm run ci before each wave commit; prove:independence before structural waves.
