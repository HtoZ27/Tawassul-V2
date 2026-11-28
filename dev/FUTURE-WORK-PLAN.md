# Future Work Plan — in-place repair of Tawassul V2

Status: temporary repair register, closed 2026-11-01; never committed to the repository. Every wave and experiment in it is closed and G-005 is verified; what remains is the release track in section 12 plus the deferred items in section 6.
Superseded on the host-version track 2026-11-13: the installed host and the
registry's `auditedThrough` are `2.3.0`, and the floor is `2.2.1`. The body
stays as the closed 2026-11-01 record.
Owner: the owner (working copy, not a repository artifact).
Created: 2026-10-27.
Review points: see section 9. The closing audit ran on 2026-11-01; the list stays as the re-audit checklist for any future change to the shipped surface.

Start gate (2026-10-31, historical): the parallel repair session declared done at commit 9d9e36c, so the counters in section 3 were frozen at that commit (136 proof scripts, 133 manifest steps, 44 tools). Wave 0 items 1, 2, 3, 5, 6 and 7 re-measured the tree on 2026-10-31: 141 proof scripts, 138 manifest steps, 44 tools. The live tree now generates 156 proof files and 153 manifest steps from `scripts/gate-manifest.json`; read any counter from its generator, never from prose.

This file is the durable register of the repair plan decided on 2026-10-27, re-audited on 2026-10-29. It records the measured baseline, the wave order, the open forks, the withdrawn claims, the stale documented claims, and the post-repair audit checklist. Nothing in this file authorizes work by itself; the goal ledger (G-005) drives execution and decisions are cited by title, because record ids were renumbered after the session-merge incidents (sidecar DB split, direct SQL merge; the renumbered ledger still carries 15x duplicated titles with 495 ids).

Revision 2026-10-30 (section 11) narrows execution to a pilot, gates deferred decisions on isolated experiments, and supersedes conflicting scope bullets in sections 4-6.

Revision 2026-10-31 (section 13) closes the host-version track, retires E2 and D2, rejects the displacement of tool descriptions into skills, records unconditional end-user skill freedom, and replaces the disk-copy delivery of shipped skills with in-process registration. Sections 1, 3-6, 8-9 and 11-12 are read through it.

Revision 2026-11-12: the owner ordered a twelve-skill expansion. The E1 cap on expansion is superseded. The roster, the eval design and the acceptance gates are recorded in the decision ledger (Twelve-skill expansion adopted) and in the expansion plan.

## 1. Standing decisions

- Repair the running Tawassul V2 tree in place. The sibling plugin tree was rejected and cancelled on 2026-11-01; it is not a fallback, not deferred and not a future program (decision: repair-in-place adopted).
- The plugin ships only agent-necessary procedural skills and acts as the platform the end user grows skills through. End-user freedom is unconditional: any SKILL.md the user places in .opencode/skills or any other host-discovered path is theirs, with no prefix, no approval, no plugin code path and no plugin-side gate. The plugin never reads, renames, blocks or overrides a user skill (decision: skills are user-owned platform content, agents fully dynamic; reaffirmed 2026-10-31).
- Shipped skills are procedures only. No binding constraint, prohibition or tool contract lives in a shipped skill. Shipped skills carry the tawassul- prefix only to avoid registry collisions (same decision as above).
- Skill descriptions are permanent context and are measured, not capped. The description is what lets the agent decide to load a skill, so it is written for clarity and trigger coverage, and its byte cost is recorded as a budget line. No wave truncates a description to hit a character target, and no proof fails a skill for length alone (decision: description clarity over byte target, 2026-10-31).
- Binding constraints stay inline: every prohibition, prerequisite and contract remains verbatim in the tool description or in the always-injected concordance path. A pointer that names a skill is not retention (decision: constraint retention, 2026-10-31).
- Host support is a floor, not a range: >=2.2.0 is enforced, newer versions warn and run untested, and the plugin does not track or gate upstream releases (decision: host floor only, 2026-10-31).
- Agents stay dynamic through the addagent roster. Zero static agent md files are shipped (same decision as above).
- Wave order is measurement-first: no content ships before the measurement floor exists (decision: wave order inverted to measurement-first; two claims withdrawn).
- Reviewer independence and shipped markdown content are plan-gated, not merely described (decisions: round-2 amendments; code review passed with two refinements).
- The zero-src claim is retired on 2026-10-31: in-process skill registration needs one additive module, so Wave 1a adds that module and nothing else under `src/`. Wave 0 still touches `src/` by design to repair measurement, and Wave 1b was closed at E5 at option A, so no second preventive module lands (decision: registration, 2026-10-31; Wave 1b closed 2026-11-01).
- The installed host is expected to be ahead of the audited constant: the installed host is 2.2.5. Verification runs on whatever host is installed at the time. The plan never asks the owner to install an older or newer version, and no wave updates the audited constant (decision: host floor only, 2026-10-31).
- Execution waited for the parallel repair session, which declared done at commit 9d9e36c. While any other session changes the tree, this plan is read-only; counters are re-measured only after that session declares done (decision: start gate, 2026-10-31; gate closed at 9d9e36c).

## 2. Plan-of-record references

- G-004: the original alternative design (nine-skill methodology kernel and sibling tree). Closed as completed on 2026-10-30 after the in-place scope decision; its design evidence remains the base for the skill and eval waves.
- G-005: this plan, tracked as goal with items per wave and DoD per gate. Closed `verified` on 2026-11-01 at 100 percent of items and 29 of 29 criteria; section 9.1 records the six amended criteria and their evidence.
- Decisions are cited by title; the numbered ids below are the renumbered ledger equivalents recorded on 2026-10-29 after the session-merge incidents (sidecar DB split; direct SQL merge recovery):
  - Repair-in-place adopted (renumbered id R-056); the sibling tree alternative was rejected and cancelled on 2026-11-01, and no part of it is scheduled (decision 2026-11-01).
  - Skills are user-owned platform content, agents fully dynamic (R-057).
  - Wave order inverted to measurement-first, two claims withdrawn (R-058).
  - Evaluated corrections adopted into the plan of record (R-059).
  - Round-2 amendments from the code-reading analyst evaluations (R-060).
  - Code review confirmed round-2 claims with two refinements (R-061).
- Host contract source: UPSTREAM.md and src/upstream/registry.json. The enforced policy is a floor: >=2.2.0, no ceiling, no upstream tracking. The registry's auditedThrough 2.2.1 is a frozen historical note, not a support promise, and no wave updates it when a new release appears. The installed host is 2.2.5 and runs above the floor by design. This plan never modifies the host; the host path (desktop CLI runner) is OpenCode territory.
- Evaluations recorded: eval-aa4d0c09 (round 1, 12 issues) and eval-d06c8d6c (round 2, 12 issues, cumulative ledger 38 merged).
- Atomic analyst evaluations, rounds 1-2: mimo, deepseek, beam-free and glm returned full verdicts; pickle returned a recorded NO-GO dissent; gemini could not deliver (round 1 quota exhaustion, round 2 output quarantined by the safety filter for hidden unicode characters in output).
- Round 3 (2026-10-31, whole-plan evaluation, one complete task per agent): mimo, glm, beam-free and pickle returned verdicts with file-level evidence. mimo failed once on a network error and succeeded on retry. gemini returned a verdict without line-level evidence and asserted matches that the source contradicts, so the round is recorded as unusable rather than as a dissent.

## 3. Verified baseline

Every number below was checked against the source at the start of the repair, not estimated. Two of the original plan numbers were wrong and are recorded here as corrected. The section is a dated snapshot, not a live pin: rows that later work superseded carry a "Superseded" note, section 13 records the applied corrections, and any number that a proof now generates is read from that proof instead.

| Item | Verified value | Evidence |
| --- | --- | --- |
| System concordance text | about 10 lines, roughly 0.7 to 1.1 KB, injected once per session with dedup guards on the message path and on the compaction path. The earlier 29 KB per-message figure was wrong. | src/hooks/message-updated.ts lines 534-543 and 736-749; src/hooks/session.ts lines 308-312 |
| i18n en.json, 41 KB | runtime lookup table compiled into the bundle. Never injected into the model prompt. Context weight is zero; report it as bundle and RSS weight only. | src/translations.ts line 1; the JSON table is compiled into dist/index.js |
| 44 tool descriptions | measured, not estimated: the build logs the full schema payload bytes and tokens on every schema change. The existing primitive measures the whole JSON schema, so a description-only diet needs its own primitive. | src/v2/adapters.ts lines 51-57; src/v2/setup.ts line 526; scripts/release-smoke.sh line 177 |
| Registered skill descriptions | Superseded 2026-11-01: at the pre-repair measurement the plugin registered no skills; the live set is four skills and 376 description bytes in total, checked against `skills/manifest.json` by `prove-skills-manifest` (section 13.3). A skill description is permanent context: every registered description is injected in the skill list while the body loads only on demand. Reference sets, measured 2026-10-31: `oh-my-opencode-slim-3.0.6` spends 2,473 characters in total across 12 skill files (mean about 206, largest 407); `superpowers-7.0.1` spends 2,319 characters across 15 skill files (mean about 155, largest 375). Neither reference caps a description; both let it carry the trigger conditions. | description lines under oh-my-opencode-slim-3.0.6/src/skills/*/SKILL.md and superpowers-7.0.1/skills/*/SKILL.md, measured with a per-file frontmatter length scan |
| Session digest injection | goal digest plus top-10 importance-weighted records plus handoffs. Grows with live session state and is not part of any published baseline. | src/hooks/session.ts lines 299-349; src/services/importance-decay.ts |
| Actual-host smoke | exits 4 unless the direct tool import registers exactly 44 tools, and greps a count-bearing boot marker from the log. | scripts/release-smoke.sh lines 124, 146, 177-193 |
| prove-e27 fixture | a stub binary fixture writes that boot marker to test smoke failure semantics. The real tripwire is the direct import in release-smoke.sh; both now consume the generated name-set hash plus a coarse floor. | scripts/prove-e27.ts line 40; scripts/release-smoke.sh lines 124, 177 |
| Handoff entry schema | carries no model field. The only model reference is reroutedModel. Pre-run model comparison between agent names is therefore not possible from the payload. | src/context/types.ts lines 36-64 |
| Dispatch feedback machinery | capability comparison plus error/warn/info feedback with strictness gating already exists and is the natural insertion point if prevention is ever chosen. | src/tools/handoff.ts lines 550-604 |
| Observed models | agentModelMap records the last observed provider/model per agent. It is last-writer-wins by design (delete then set), so it cannot prove that a reviewer never ran on the implementer model. A per-turn history is required before any retro-probe claims enforcement. | src/hooks/message-updated.ts lines 709-714; src/context/managers/ModelManager.ts line 16 |
| Per-tool invocation logging | tool-run-log records tool, agent, sessionId, argsHash, status, timestamp and turn per run. This is the correct source for hot and cold ranking. | src/services/tool-run-log.ts |
| Tool-run model field | the entry carries tool, agent, sessionId, argsHash, status, timestamp, turn and optional input or error. It carries no model field, so implementer and reviewer models cannot be compared from that store alone. | src/services/tool-run-log.ts lines 18-31 |
| activity-metrics | consumes five lifecycle event types with durationMs-or-0 and tool-or-unknown. It is lifecycle telemetry, not per-tool invocation data. Repairing it for ranking was the wrong plan; it is now either a hygiene fix or retired from ranking use. | src/bootstrap/service-factory.ts lines 385-406 |
| State directory resolution | global scope already resolves to globalConfigDir()/tawassul-v2-state and would pass any worktree-survival proof trivially. Project scope returns the working-directory stateDir unchanged, so the ledger dies with the worktree, matching the flaw attributed to Superpowers. | src/utils/path-resolver.ts lines 98-101; src/context-class.ts line 418 |
| Gitignore state exclusion | .opencode/ is ignored in full, and goals, timeline, mission-board, sagas, handoff-ledger.jsonl and metrics are excluded, so nothing recovers them after a worktree change and no versioned shipped content can live under .opencode/. Generated runtime staging under .opencode/tawassul-runtime/ is not source, holds only wasm and db assets, and is rebuilt on the next build; shipped skills live in the bundle. | .gitignore lines 1-15 |
| Shipped content location | decided 2026-10-31, revised the same day: repository-root `skills/` is the versioned source of truth, outside `.opencode/` and outside `src/`. Content is registered in-process through `ctx.skill.transform`, never copied into `.opencode/skills/` or any user skills directory. Project mode stages only plugin-owned runtime assets under the gitignored `.opencode/tawassul-runtime/`; global mode stages wasm and db assets under `$TAWASSUL_GLOBAL_DIR/tawassul-runtime/`, each recorded in the installer marker and removed on uninstall. Superseded by E4 (2026-11-01): the content lives in the bundle, so no skills directory is staged in either scope. Commands are registered through `ctx.command.transform`, so no command markdown path is needed. Pattern adopted from `oh-my-opencode-slim-3.0.6` (in-process, never disk-copied, same-name user skill wins) and `superpowers-7.0.1` (root `skills/` source). | .gitignore line 1; build-v2.mjs lines 127-140 (current runtime staging pattern; E4 confirmed that no skills directory is staged); oh-my-opencode-slim-3.0.6/src/v2/setup.ts lines 2736-2811; oh-my-opencode-slim-3.0.6/src/cli/custom-skills.ts lines 44-137 |
| Skill enforcement | Superseded 2026-11-01: four skills register in-process at boot through `ctx.skill.transform` (`src/skills/pilot.ts`), and no skill displaces a tool description. At the pre-repair measurement the plugin registered no skills and called no skill API. The pre-repair no-op skill guard was retired under Wave 2 item 7, so no skill gate remains in the tree. The host does expose in-process registration at the enforced floor: `ctx.skill` with `transform/add/update/remove/reload` and `ctx.command` with `transform`, both present in `@opencode/plugin@2.2.0`. No skill allow-list, counter or precedence rule exists in the plugin. | src/skills/pilot.ts; node_modules/@opencode/plugin/dist/promise/plugin.d.ts line 51; skill.d.ts lines 1-15; command.d.ts lines 1-22; verified against the published 2.2.0 tarball |
| Global installer verify | Superseded by E4 (2026-11-01): `tawassul-runtime/VERSION` is a per-file ownership ledger, one path and sha256 per owned file, and uninstall removes only marker-listed files (`prove-global-install`, 188 assertions). At the pre-repair measurement no per-file ledger existed for distributed content. | scripts/install-global.ts lines 1111-1213 |
| Host acceptance policy | a floor, not a range: isSupportedHost rejects only versions below 2.2.0 and accepts every newer version. A host above the local HOST_AUDITED constant (2.2.1) warns and runs; that constant is informational, is not a support promise and is not updated per release. The installed host is 2.2.5 and runs with that warning by design. The 3.x refusal claimed in earlier revisions does not exist in code. | scripts/install-global.ts lines 22-23, 162-167, 184; src/upstream/registry.json line 4 |
| Proof count | Superseded 2026-11-01: the live count is generated from `scripts/gate-manifest.json` and stands at 156 proof files and 153 manifest steps; the figures below are the Wave 0 measurement. Measured 2026-10-31 at the Wave 0 tree (based on 9d9e36c, uncommitted): 141 proof scripts and 138 manifest steps, split into four balanced shards plus a detached sequential worker (`gate:proofs:bg` with `:status`, `:wait`, `:stop`). The count-bearing docs (AGENTS.md, README.md, TRIAGE.md, docs/VALIDATION.md, docs/portable-context-handoff.md) now carry generated markers checked by `scripts/generate-proof-count.ts --check`, so the old 132/135/97/25 literals no longer drift. The pre-Wave-0 measurement at 9d9e36c was 136 proof scripts and 133 manifest steps; Wave 0 added prove-tool-name-hash, prove-context-baseline, prove-tool-run-ranking, prove-record-digest-dedupe and prove-dispatch-model. This counter was volatile during correction: the parallel repair session added proofs while this plan was being edited, and the manifest count rose from 102 to 133 in one day (126 at 8c58269, 131 at 4567372, 132 at 7bad75c, 133 at 9d9e36c). PLAN.md line 261 and CUTOVER.md line 141 keep 25-proof counts inside historical Day-6 passages. This row drifted within 24 hours of the previous audit, which is why section 9 item 1 now requires a dated re-measure. | scripts/gate-manifest.json proofs array length; scripts/prove-*.ts glob count; package.json lines 13-21 |
| Rules gate scope | .ts, .mjs and .json under src, scripts and tests plus two root files. Shipped markdown is outside the gate. | scripts/check-v2-rules.mjs lines 1-10 |

## 4. Waves

Status 2026-11-01: every wave in this section is closed. Waves 0, 1a, 2, 3 and 4 landed, Wave 1b closed at option A, and the five experiments in section 11 are closed or retired. G-005 is verified at 100 percent of items and 29 of 29 criteria. The text below is the design record for what was built; section 6 lists the items that stay deferred.

### Wave 0 — measurement floor and gate hygiene

Runs first and blocks all content waves.

Revision 2026-10-30: split into 0A measurement and 0B guard. Revision 2026-10-31 retires the host-range item (section 13). The dispatch model field is part of 0A because the reviewer-independence gate cannot read a model that the payload never carried.

1. The 44-count tripwire becomes a generated name-set hash plus a coarse floor sanity check. The count-bearing boot marker is regenerated so no fixed literal remains, the stub fixture is kept consistent, and the documented literal is updated. The literal lived in 17 lines across five files (measured 2026-10-31: 9 executable sites and 10 user-facing messages, 19 occurrences): scripts/release-smoke.sh, scripts/prove-e27.ts, scripts/prove-global-boot.ts, scripts/prove-independence-boot.ts and scripts/prove-task-control.ts; all 17 lines now consume the generated hash and count. A name-set hash is stronger than a count and still permits a deliberate tool change. One script rewrites the hash, the boot marker and the fixture together, and the diff is reviewed as part of the wave.
2. Single measurement source: hot and cold ranking from tool-run-log. activity-metrics stays lifecycle telemetry with a duration hygiene fix or is retired from ranking use. A proof refuses any third measurement source.
3. Context baseline in measured bytes: the 44 tool schemas through measureSchemaPayload, a separate description-text primitive for the diet target (the existing primitive measures the whole JSON schema), the session digest composition, and the concordance at its measured once-per-session weight. i18n is excluded from the context budget and reported as bundle weight. The baseline is written to a dated, read-only artifact under `docs/experiments/baselines/` and every later proof cites that artifact, not a live store. Wave 0 creates that directory and its dated read-only convention before the first artifact is written, so no later proof assumes the directory exists. The same artifact records the permanent cost of the registered skill set: one description-text line per skill plus the total, in bytes and estimated tokens. That number is a recorded budget and a review input, not a pass or fail threshold.
4. Retired 2026-10-31: the host acceptance range, the ceiling and the six-family single-sourcing are closed. The policy is a floor of 2.2.0; the warning tier above the local audited constant is cosmetic, is not updated per release and is not a support promise. The state-schema guard stays for data safety; no host matrix and no upstream tracking remain.
5. The published proof count is generated from gate-manifest.json.
6. Record-store digest guard, before the context baseline freezes: the live session-record store carries 495 records whose decision titles repeat 15 times after the merge incidents. The digest already indexes by id, so id-based dedupe is a no-op against repeated titles. The proof therefore asserts three separate facts: distinct ids are never merged even when titles match; repeated titles are annotated in the digest instead of collapsed; and the hidden-tail accounting counts distinct ids. No record is deleted, hidden from its store, or merged, and no content hash may collapse two distinct ids.
7. Dispatch payload gains provider and model fields for the implementing and reviewing agents, and the tool-run log gains a model field per invocation so the comparison has a per-turn source. A proof reads the payload and fails when the reviewer model equals the implementer model. Ledger entries written before the fields exist are read as unknown, never back-filled, and never rejected by the proof. The Wave 4 retro-probe reads the per-turn history, not the last-writer-wins agentModelMap.

### Wave 1a — pilot content, additive registration

Revision 2026-10-30: ships a pilot, not the full set. The pilot is the experiment that decides the final size. Revision 2026-10-31 replaces the zero-src rule: in-process registration needs one additive module and its wiring, so Wave 1a allows that module and nothing else under `src/`. Existing tools, agents, descriptions and the 44-tool name set stay untouched. `.opencode/` is gitignored and is a runtime surface, not a source location.

1. Pilot only: four procedural skills plus one command (the fourth, `tawassul-integration-engineer`, was added by the owner on 2026-11-01). Each skill carries a multi-step procedure that a tool description should not hold. No skill displaces, shadows or replaces a tool description, and none carries a binding constraint. Tools are never converted into skills. The command is registered through `ctx.command.transform` as a code definition, not a markdown file; no file-discovery path is assumed.
2. A skills manifest at `skills/manifest.json` with per-skill fields: id, directory, procedure scope, the tool calls the procedure sequences, eval id, load-rate threshold and kill criterion. A proof validates the manifest against the id set actually registered at boot, referenced tool names against the real registry, and eval ids against `docs/experiments/evals.json`, and refuses any skill whose text states a prohibition, a prerequisite or a tool contract. That eval ledger is defined in this wave, because no skill eval ledger exists today: an entry carries skill id, fixture name, receipt path and verdict, and a skill that declares an eval id without a matching entry fails the proof. A skill with no eval id is recorded as pending for Wave 4 instead of being validated against a file that does not exist. Pilot skills carry a behavioral eval and a measured load rate before the wave closes.
3. A markdown branch in the rules gate for shipped content only: Arabic scan over raw text, comment scan limited to HTML comment syntax, code fences excluded by an explicit rule, scoped to repository-root `skills/**` only, because commands are code definitions and not markdown files. Frozen documents such as SHARED.md stay outside the branch, and user-authored skills are never scanned, rejected or rewritten.
4. The user-growth contract and the tawassul- prefix rule are stated on surfaces the user and the agent always see: README plus one short line in the always-injected concordance. A skill body is not an accepted home for the contract, because a body loads only when the skill is invoked and may never be read. The contract states that user skills are unconditional: the plugin never reads, gates, prefixes or overrides them, and any conflict between a user skill and a shipped invariant is resolved by the user, not by the plugin. A bootstrap skill, if shipped, explains the procedure only.
5. The minimum-inline rule is declared now and enforced in Wave 2: every binding constraint or prohibition stays verbatim in the tool description or in the always-injected concordance path. A pointer to a skill is not accepted as retention, because a pointer can be ignored and cannot be measured.
6. Reviewer independence is a structural text rule at dispatch: the reviewer agent differs from the implementer agent in base specialization and does not share the dynamic sentinel. The rule is defined once here and referenced by Wave 0 item 7 and Wave 4 item 5.
7. Command names use the `tawassul-` prefix, matching shipped skills, so a user command cannot collide with a shipped one. User commands remain unrestricted.
8. The installer ownership ledger was delivered by E4 on 2026-11-01: `tawassul-runtime/VERSION` is the ledger, one path plus sha256 per owned file, covering the bundle, four wasm assets and five db payloads, with stale-asset pruning driven by the marker. Skills and commands are compiled into the bundle rather than staged under `tawassul-runtime/skills/`, so the bundle hash and `contentSha` cover them and no second source of truth exists. E1 closed on 2026-10-31 and declined the nine-skill and four-command expansion, so the remaining five skills and three commands are not scheduled. They are not part of this wave. The runtime staging writes only plugin-owned files, never touches `.opencode/skills/` or a user skills directory, and is removed by uninstall in global mode or replaced by the next build in project mode. No build step may delete or rewrite a user-authored skill or command.
9. Registration failure isolation: every `draft.add` runs inside its own try/catch, and a rejected skill is logged and skipped while the rest of the registered set, every tool and the plugin itself keep working. One malformed skill must never disable the plugin or remove the bootstrap path. The registration proof adds an intentionally invalid skill and asserts that the failure is contained.
10. The README skill table is generated from `skills/manifest.json`, like the proof count, and a proof fails when the table and the manifest disagree. A hand-written table is not accepted: oh-my-opencode-slim README states eight bundled skills while its registry lists 11 and its tree holds 12 SKILL.md files.

### Wave 1b — preventive guard, closed at option A

- Option A, recommended: no src change. The structural text rule plus the Wave 4 retro-probe carries enforcement until violations are actually observed.
- Option B: one small guard inside validateHandoffInput, reusing the existing feedback and strictness machinery at src/tools/handoff.ts lines 550-604, rejected when the reviewer slot shares base specialization or the dynamic sentinel with the implementer. This renames the wave Wave 1b and adds a second module under `src/` on purpose.
- Decision owner: the user. Decision gate: E5 (section 11) records whether the retro-probe observed violations before this fork is opened.
- Closed at E5 (D5) on 2026-11-01: option A. The retro-probe observed zero violations, so no preventive code lands in `src/` and this fork is not open.

### Wave 2 — gated context diet

1. Numeric closure target, frozen by E1 on 2026-10-31 before slimming starts: at least 20 percent fewer description-text bytes (20,267 → 16,213 exact; the rounded 80 percent point is 16,214), measured by the description-only primitive, with no increase in the top-8 hot-tool retry rate and no binding constraint removed under the constraint-retention proof. The exact percentage and any recalibration are recorded in section 11. Schema bytes are reported alongside but never substitute for the description metric.
2. Every tool description is slimmed as a prose edit under the minimum-inline contract. No constraint moves into a skill, and no description is shortened by deleting a prohibition, a prerequisite or a failure mode.
3. Closure metric: top-8 hot-tool retry counters from tool-run-log against the frozen baseline artifact. Token deltas alone never close the wave. The constraint-retention proof runs per slimmed tool and is the only accepted evidence that a dropped sentence was not load-bearing.
4. A live reload probe in an isolated boot using the smoke pattern: tool count before and after, the new tool callable, no duplicate registration, and the new schema visible in the following injection. A failure retires lazy registration for good and Wave 2 ships slimming alone.
5. The name-set hash tripwire from Wave 0 is what keeps the gate green here; the count never returns as a literal.
6. Compaction payload recheck (upstream follow-up 59020): when the running host starts session history at the latest completed compaction, the context baseline and digest weights are re-measured on the live host before this wave closes; the numbers from Wave 0 remain valid only for the host build they measured.
7. The no-op skill guard is retired here unless a real gate replaces it. The guard returns null on every path and only logs, so a warning-only logger is not accepted as enforcement (decision 13.1 item 8).

### Wave 3 — structural guards

1. First deliverable: the state-root naming-key design document, approved before any code. It covers the host project identity as the project-scope key, the canonical-path fallback when the host reports no project id, a boot-time sync window, single-writer arbitration for project-scope writes, a pre-migration backup, mid-window write handling, a rollback path, HMAC key continuity, the migration window, and the config split that keeps `opencode.json` and `tawassul.json` in place. Decision gate: E3 (section 11).
2. Second: the survival proof that earns its name, booting two working directories against the same host project identity and asserting the same ledger in project scope. Global-scope passes are declared coverage theater and are not accepted.
3. Retired 2026-10-31: capability degradation and the host-range matrix are withdrawn. The state-schema guard stays and is a data-safety check, not a version policy.
4. Snapshot boundary: code-state-auto is demoted so the native undo does not double-capture. Done 2026-11-01, `prove-snapshot-boundary`.
5. Native agents.compaction.model for cheaper summaries.
6. Dead-path cleanup.
7. W2 reachability audit: what a normal session actually touches of the 65k LOC tree, measured. Done 2026-11-01, `prove-reachability-audit`: 97.45 percent of lines. W2 remains deferred and is now measured rather than assumed.

### Wave 4 — behavioral gate

1. Decision gate E5 (section 11) fixes the gate:evals time and token budget, the fixture set and the model pair for the reviewer probe before the stage is written.
2. A separate gate:evals stage with an explicit time and token budget, fixed serialized fixtures, recorded receipts and flake tracking. It runs on the release path only. verify and gate:proofs stay eval-free, and incremental passes may squash to changed-skill evals.
3. Per-skill behavioral evals close the remaining eval rows from the manifest, and the `docs/experiments/evals.json` ledger defined in Wave 1a is updated with a verdict and a receipt for every row; pilot skills already closed in Wave 1a.
4. A skill-discovery probe over the registered set: ids, staged paths and the host skill list, with no disk copy under a user skills directory.
5. A review-independence retro-probe over per-turn records: the dispatch payload model and the tool-run model for the same turn. A reviewer run on the implementer model is flagged. The last-writer-wins agentModelMap is not an accepted source for this probe.
6. The REPAIR document: wave verification matrix, corrected measured baseline, withdrawn-claims appendix, and the state-root naming-key decision with its window.
7. A skill load-rate probe: for every shipped skill, the share of relevant sessions in which the body was actually loaded. A skill below its declared threshold is retired to inline prose.

## 5. Verification matrix

Every proof in this table is registered, passing and counted by `gate:proofs` as of 2026-11-01 (153 steps); the Notes column records what each one asserts.

| Wave | Proof to register in gate-manifest.json | Notes |
| --- | --- | --- |
| Wave 0 | prove-tool-run-ranking | hot/cold table from tool-run-log, refuses third measurement sources |
| Wave 0 | prove-context-baseline | measured bytes and estimated tokens via measureSchemaPayload, a separate description-text metric, plus digest and concordance composition, all written to a dated baseline artifact. The artifact also carries the registered skill description bytes with a per-skill breakdown; a missing measurement fails, while a size above the recorded budget only opens a review |
| Wave 0 | prove-tool-name-hash | generated name-set hash plus coarse floor; fails on any add, remove or rename until the hash is regenerated |
| Wave 0 | prove-record-digest-dedupe | distinct ids are never merged even when titles match; repeated titles are annotated; hidden-tail counts distinct ids; no record is deleted or hidden |
| Wave 0 | prove-dispatch-model | dispatch payload and tool-run entry carry provider and model for implementer and reviewer; reviewer model equality fails; pre-field entries read as unknown |
| Wave 1a | prove-skills-manifest | `skills/manifest.json` matches the id set registered at boot; procedure scopes and referenced tool names against the real registry; eval ids against `docs/experiments/evals.json`; refuses any skill that states a constraint or prohibition |
| Wave 1a | prove-skill-registration | boot registers exactly the manifest ids; zero writes under any user skills directory; a same-name user skill wins; the generated tool name-set hash and every description are unchanged; one intentionally invalid skill is rejected without disabling the plugin, dropping a tool or losing the rest of the registered set |
| Wave 1a | prove-md-gate | Arabic, comment syntax, fenced-exclusion and scope behavior |
| Wave 1a | prove-pilot-eval | every pilot skill executes its procedure and calls the tools it sequences, with a recorded load rate; the aggregate spans one receipt per eval |
| Delivered E4 | prove-global-install (ledger half) | `tawassul-runtime/VERSION` records every owned file with a path and a sha256, the bundle, four wasm assets and five db payloads, with stale-asset pruning driven by the marker; the installed bundle embeds every shipped skill and command, so no separate skills ledger exists |
| Delivered E4 | prove-global-install (uninstall half) | a user skill, a user command and a runtime file the installer did not write survive `--uninstall`; an unmarked target is refused without `--force`; the user config, database and backups stay byte-identical |
| Wave 2 | prove-context-diet | at least 20 percent fewer description-text bytes against the frozen baseline artifact plus unchanged hot-tool retry counters; closed 2026-11-01 at 4,120 bytes cut (20.329 percent), 37 assertions |
| Wave 2 | prove-constraint-retention | per slimmed tool, the agent still refuses the prohibited action and still states every prerequisite, verified behaviourally and not by byte count |
| Wave 2 | prove-reload-live | count, callability, no duplicates, next-injection visibility; no skip path, and a failure retires lazy registration |
| Wave 3 | prove-state-root-survival | two working directories, same host project identity, same ledger, project scope |
| Wave 3 | prove-state-root-rollback | boot-time sync window, conflict archive and HMAC continuity across the migration |
| Retired E2 | prove-capability-degradation | withdrawn with the host matrix 2026-10-31; the state-schema guard is covered by prove-state-root-rollback and the boot capability log |
| Wave 3 | prove-snapshot-boundary | registered 2026-11-01, 8 assertions: auto capture is off unless `TAWASSUL_CODE_STATE_AUTO` is exactly 1, ignores non-mutating and failed runs, captures once per debounce window, and carries the last tool |
| Wave 3 | prove-reachability-audit | registered 2026-11-01, 13 assertions: the import graph from `src/index.ts` reaches 342 of 358 files and 97.45 percent of lines, 116 dynamic imports are counted, and the recorded audit at `docs/experiments/baselines/2026-11-01-reachability.json` is rechecked |
| Wave 4 | gate:evals stage | budget fixed by E5, receipts and flake tracking |
| Wave 4 | prove-review-independence-retro | per-turn model mismatch across implementer and reviewer runs from the dispatch payload and the tool-run entry; agentModelMap snapshots are rejected as a source |
| Wave 4 | prove-skill-load-rate | every shipped skill met its declared load-rate threshold; a skill below threshold is retired to inline prose |
| Wave 4 | prove-skill-discovery | registered skills appear in the host skill list with ids and staged paths; no shipped content exists under a user skills directory |

## 6. Forks, deferred items and what stays out of scope

Section 11 is the decision register: every deferred decision below named the isolated experiment that had to run before it was taken, and each experiment is now closed or retired. The 2026-10-31 governance items name an owner action instead, because no experiment can assign ownership of this file.

- W2 (65k LOC maintenance surface): deferred, now measured. `prove-reachability-audit` shows a normal session reaches 342 of 358 src files and 97.45 percent of non-blank lines (58,697 of 60,231), so the deferral is a decision about the whole tree, not a claim that a small hot path carries production behaviour.
- W7 (session forensics as a capability): not claimed. The forensics skill is a documented reading path over timeline, handoff ledger and the tawassul log.
- pickle NO-GO dissent: recorded. Its simplify-Wave-4 remedy was weighed at E5 and the gate kept a hard budget instead: 90 s and 256 MB, one process per fixture, no retries, and a twice-flaking fixture quarantined with a receipt.
- Multi-host behaviour: out of scope. The production host remains the Desktop with its sidecar. No host matrix is recorded; the floor is tested by release-smoke and host:refresh only.
- gemini evaluation: undelivered in rounds 1-2 for operational reasons; in round 3 it returned a verdict without line-level evidence and with fact-check rows the source contradicts, so that round is recorded as unusable rather than as evidence.
- Fork and rewind semantics upstream (registry PR 58865, follow-up 4): the host can fork or rewind from any message while plugin state has no message anchor, so the behaviour of goals and handoffs after a fork is undefined by the host contract. Settled with the Wave 3 state-root work and recorded at E3 on 2026-11-01; it stays a documented boundary, not an open question.
- Record-store title duplication (measured 2026-10-29): 495 records with decision titles repeated 15 times after the session-merge renumbering incidents. Wave 0 item 6 gates the digest on three read-time rules: distinct ids are never merged, repeated titles are annotated, and the hidden tail counts distinct ids. No record is deleted, hidden from its store, or merged. Store-level cleanup is not planned.
- Compaction payload recheck (registry PR 59020, follow-up 5): history starts at the latest completed compaction after a host upgrade; baselines re-measure before Wave 2 closes. The condition never fired: the installed host stayed on 2.2.5, the same build the baseline measured, so the 2026-11-01 re-measure keeps the comparison valid. A future host upgrade re-runs the recheck before the next wave or release is marked verified.
- Installer ownership ledger and global scope: closed at E4 on 2026-11-01. The marker is the ledger, uninstall removes only marker-listed files, and both are covered by `prove-global-install` (188 assertions) plus the isolated `global-boot` smoke. A real global install is not run before release: project scope stays the supported path, and the release plan schedules the live install after `0.1.0-experimental` is verified.
- Shipped content location (decided 2026-10-31, revised the same day): repository-root `skills/` is the versioned source; content is registered in-process through `ctx.skill.transform`, never copied into `.opencode/skills/` or a user skills directory. Commands use `ctx.command.transform`. Pattern taken from `oh-my-opencode-slim-3.0.6`, which registers bundled skills in-process and lets a same-name user skill win, after retiring its own disk-copy sync.
- Plan status (owner decision, 2026-10-31): this file is a temporary repair register. It is never staged, committed or treated as a repository artifact. Wave closures and decisions are recorded in the goal ledger, not in git. No wave may require this file to be versioned, and no commit may include it.
- End-user skill freedom (2026-10-31): unconditional. No wave, proof or gate may restrict, prefix, validate or block a user-authored skill.
- Shipped-skill opt-out (proposed 2026-10-31, not adopted): a user setting that disables a shipped id only, never reads or alters a user-authored skill and never becomes an allow-list. Decided at E1 with D1: not adopted. The only opt-out is a same-name user skill, which the plugin must let win.

## 7. Withdrawn claims

- Sibling plugin tree (2026-11-01). Rejected and cancelled, not deferred; the 7-hub tool refactor is not a future program, and no wave schedules any part of it.
- Durable state across a working-directory change. Withdrawn as a general claim; proven for project scope only by `prove-state-root-survival` (E3, 2026-11-01).
- Session forensics as a new capability. Repositioned as a documented reading path over existing stores.
- i18n slimming as a context-diet gain. Excluded from the context budget and reported as bundle weight only.
- The 29 KB per-message concordance figure. Corrected to the measured once-per-session weight in section 3.

## 8. Stale documented claims corrected when the waves landed

| Document | Stale claim | Corrective action |
| --- | --- | --- |
| TRIAGE.md | 25 proof files at line 36 and 97 proof steps at line 125, both below the measured 133 manifest steps | done 2026-10-31: generated proof count markers |
| PLAN.md | 25 proofs at line 261 inside the Day-6 log | done 2026-11-01: the Day-6 log marks the 25-proof run as historical and points at `prove-proof-catalog` |
| CUTOVER.md | 25 proofs at line 141 inside the Day-6 log, plus historical v2.1.4 smoke lines 15 and 33 | done 2026-11-01: the Day-6 log marks the 25-proof run and the v2.1.4 smoke as historical and points at `prove-proof-catalog` |
| docs/UPSTREAM-EVAL-2.2.3-2.2.5.md | 43 tools at lines 13 and 25 inside a dated 2026-10-31 receipt | done 2026-10-31: marked as the pre-task_control value, pinned by the generated tripwire |
| README.md | line 196 and line 211 state 132 proofs, and line 212 records a 56.7s shard duration; both are stale against the 133-step tree and the 65-74s measured shards | done 2026-10-31: generated proof count and generated shard duration |
| AGENTS.md | line 76 states 132 proofs and the four shards | done 2026-10-31: generated proof count |
| This plan's own section 3 | any number that drifts | done 2026-10-31, superseded 2026-11-01: the dated re-measure then read 141 proof files / 138 manifest steps, and the live tree now generates 156 files / 153 steps; every superseded row in section 3 carries a note |

The corrective action is generated-from-manifest, not hand-edited, so the next wave cannot reintroduce the drift.

## 9. Post-repair review instructions

This file is re-opened for audit after every wave closure and once more after the program ends. The audit must verify all of the following and record results against this file. Closing audit 2026-11-01: every item below is satisfied, with items 10 and 15 carrying their amended evidence, and the list stays as the re-audit checklist for any future change that touches the shipped surface.

1. Re-run the full baseline measurement and compare it with section 3 in three separate passes: (a) counters such as manifest steps, proof files and tool count; (b) count-bearing text literals such as the registered-tools marker and the release-smoke count; (c) line citations, which are re-resolved against the tree at audit time and cited by symbol or block, never trusted as fixed line numbers. Any drift updates section 3 with a dated re-measure before any new claim is made. A row older than the last wave closure is treated as unverified.
2. Every proof named in section 5 exists, is registered in gate-manifest.json, runs in isolation, and passes in its assigned shard.
3. The ledger survives the two-working-directory test with the same host project identity, in project scope.
4. An isolated global install and uninstall, using a temporary global root, leaves zero orphan files, and user-dropped skill content survives uninstall. Satisfied 2026-11-01: `prove-global-install` (188 assertions) and the E4 receipt cover it; a live global install stays on the release track.
5. The review-independence retro-probe reports zero violations across a recorded sample of dispatches.
6. The gate:evals stage completed within its declared time and token budget, with no flake-driven release blocks unrecorded.
7. The generated proof count matches the tree and every document in section 8 has been regenerated, not hand-edited. Historical Day-6 log lines in PLAN.md and CUTOVER.md stay marked as history.
8. Shipped marks pass the markdown branch of the rules gate, and the boot registration log distinguishes shipped ids from user content. The branch never scans, rejects or rewrites a user-authored skill.
9. The minimum-inline contract holds: no binding constraint or prohibition exists only in a skill.
10. RULES.md hygiene: memory checks recorded before every heavy step, heavy operations sequential, and /tmp/opencode cleaned after every run.
11. Every deferred decision cites its experiment id from section 11, and the experiment receipt is linked before the decision is taken. A decision recorded without a receipt is reopened.
12. Constraint retention: every slimmed tool description still carries every prohibition and prerequisite verbatim, proven per tool, not by byte count.
13. Skill load rate: every shipped skill met its declared load-rate threshold; any skill below threshold was retired to inline prose.
14. Host policy: no ceiling, no upstream tracking, no release-following obligation and no six-family range literal was reintroduced by a wave.
15. Skill description cost: the dated baseline artifact records one measured line per skill registered on its measurement date plus the total, and the live set is checked against `skills/manifest.json`; the audit reviews every current description for trigger clarity and intelligibility. Length is never truncated mechanically to meet a byte budget. A description that no longer tells the agent when to use the skill is a defect even when it fits a target, and a longer description that keeps the trigger clear is accepted with its cost recorded.
16. Registration failure isolation: an intentionally malformed skill is rejected, logged and skipped while every tool, the rest of the registered set and the plugin stay operational.

## 10. Execution rules carried from AGENTS.md and RULES.md

- English only in code, strings, tool descriptions and docs. Arabic is forbidden. The release track schedules one amendment after the release-plan fixes: the scan exemption for `src/i18n/*.json` only, never for code or docs.
- No comments in code, including JSDoc and empty comments. Only the permitted directive shapes survive.
- Memory cap check before every heavy step: stop and clean if available memory is below 1.5 GB.
- Heavy operations are sequential: verify, ci, builds and test suites run one at a time.
- Clean temporary artifacts after every run, including /tmp/opencode.
- npm run verify after each wave; npm run ci before each wave commit; prove:independence before structural waves.
- gate:proofs:bg runs the four shards sequentially in a detached worker; use :status and :wait before closing a wave, and :stop on abort. This satisfies the sequential heavy-operation rule without freezing the session.
- This plan is a working copy: never stage, add or commit it. REMAINING-WORK.md may declare it read-only from the ledger, but the owner may correct it at any time; wave results live in the goal ledger.
- The parallel repair session declared done at 9d9e36c. Re-measure every counter and re-read this file before the first wave action; a count measured before that point is not a baseline. If another session starts changing the tree, wait for it to declare done again.

### 9.1 Acceptance-criteria amendments — approved 2026-11-01

Six goal-ledger criteria for G-005 were written against assumptions that later decisions retired. The owner approved the wording below on 2026-11-01. It replaces the criterion text for adjudication, and the goal ledger records each criterion as met against the evidence in the last column.

| Ledger criterion (as written) | Adopted wording | Evidence |
| --- | --- | --- |
| Wave 1 items change zero existing source files and pass npm run verify | Wave 1 passes `npm run verify` and names every changed source file; the zero-src assumption is withdrawn | commit `e10baec` lists all 116 changed files, 43 of them under `src/`; `npm run verify` green at `b14f9f8` |
| Wave 1a items change zero existing source files while Wave 0 touches src only for measurement repair, superseding the older Wave-1 zero-src wording | Wave 1a names every `scripts/` and content change plus the additive `src/` registration module; zero-src is withdrawn | `e10baec` names the registration module (`src/skills/pilot.ts`), the manifest, the fixtures and the proofs; no changed file is left unnamed |
| Wave 1a changes zero files under src/ and names every scripts/ or content change explicitly | Duplicate of the row above: met under the same amended wording | the same commit and the same file list |
| Wave 3 guarded by capability probes and dedicates one proof per structural change | Wave 3 dedicates one proof per structural change; host capability probes are retired by D2 | `prove-state-root-survival` (44), `prove-state-root-rollback` (74), `prove-snapshot-boundary` (8), `prove-reachability-audit` (13); D2 retired in section 4 |
| Every shipped skill names the tool descriptions it displaces; one failing the membership test is demoted to user content | Every shipped skill declares its scope and the tool cluster it sequences; no skill displaces or shadows a tool description | `skills/manifest.json` carries `scope` and `tools` per skill; `prove-skills-manifest` (96); displacement rejected in section 13 |
| Reviewer independence enforced structurally at dispatch (different base specialization, no shared dynamic sentinel) and retrospectively in Wave 4 via observed agentModelMap and the tool-run log, superseding the pre-run model-differs wording | Reviewer independence is enforced at dispatch through the payload join key and checked retrospectively against the observed reviewer model per turn; `agentModelMap` is a rejected source | `prove-review-independence-retro` (19); `2026-11-01-e5-pairs.json`; D5 in section 4 |

## 11. Isolation experiments and decision gates (2026-10-30)

This section is the decision register for everything the plan defers. Each experiment runs in isolation: a copied workspace, separated `XDG_*` roots, a separate `OPENCODE_DB`, and a plugin build under test. No experiment mutates the live host, the live state root, or the global install; the only permitted live-host action is the read-only compaction re-measure named in Wave 2 item 6. Experiments run one at a time to respect the 1.5 GB memory cap.

Until an experiment closes, the default is the smaller scope and the current floor. An experiment that cannot produce evidence leaves its decision closed at the default, not open indefinitely. Status 2026-11-01: E1, E3, E4 and E5 closed, E2 and D2 retired, and no experiment remains open.

### E1 — skill pilot and context overhead (closed 2026-10-31)

| Field | Detail |
| --- | --- |
| Question | Do the three pilot skills get loaded and followed often enough to justify their context cost, and does the description diet reduce bytes without losing compliance? |
| Method | Isolated workspace with the built plugin; three procedural pilot skills and one `tawassul-` command registered in-process; the installed host (currently 2.2.5) run with a timestamped transcript. Verify the installed host exposes `ctx.skill.transform` with `add()` and `ctx.command.transform`; verify that a user skill with the same name wins over the registered one; verify whether the host reads `path` after registration or only `content`; verify that boot creates no file under any user skills directory. The 2.2.0 floor is a declared compatibility promise backed by the published type surface, not a runtime test matrix, and no older host is installed for testing. Measure discovery, body load rate, whether the procedure was executed, description-text bytes before and after through the description-only primitive, and top-8 hot-tool retry counters from `tool-run-log` across at least three fixture sessions with skills on and off. |
| Evidence | Transcript excerpts, capability table, precedence table, path-semantics result, load-rate table, procedure-execution table, bytes table, description clarity review table, retry table, and the registered id list with staged paths. |
| Decides | Three versus nine skills, one versus four commands, the exact Wave 2 description-byte target (floor 20 percent), the reviewed description budget per skill expressed as a measured range with a clarity review rather than a hard per-description character cap, and whether Wave 1b has any observed violation to answer. |
| Fallback | If the floor host lacks the registration API, or a registered skill wins over a same-name user skill, the pilot ships zero skills and the procedures stay inline. It never falls back to copying files into a user skills directory. If a skill is not loaded in a majority of relevant fixture sessions, it is retired to inline prose or dropped. If the diet loses compliance, the target is lowered. Expansion never proceeds on assumption. |

#### D1 decision — closed 2026-10-31

| Field | Decision |
| --- | --- |
| Pilot size | Keep the three skills. No expansion to nine. The owner added a fourth on 2026-11-01 (`tawassul-integration-engineer`) with its own eval, fixture and receipt; the nine-skill expansion stays declined. |
| Command count | Keep the one `tawassul-goals` command. No expansion to four. |
| Wave 2 target | At least 20 percent fewer description-text bytes: the rounded 80 percent point is 16,214 bytes (a 4,053-byte cut); the exact-ratio integer floor is 16,213 bytes (a 4,054-byte cut). Schema bytes (13,868) are reported alongside and never substitute. |
| Description budget | 91–100 bytes per skill and 285 total, reviewed for clarity; no hard per-description character cap. |
| Shipped-skill opt-out | Not adopted. A same-name user skill wins and is the only opt-out. |
| Wave 1b | No registration or precedence violation. The three-skill and one-command pilot stands; the observed defects are tool-surface defects, not expansion evidence. |
| Evidence | `docs/experiments/receipts/2026-10-31-e1.md`; corrected baseline `docs/experiments/baselines/2026-10-31-context-baseline.json`. |

### E2 — retired 2026-10-31

The host matrix is withdrawn with the ceiling policy. The only remaining question, whether the floor version boots and registers every tool, is already covered by release-smoke and host:refresh. No experiment runs, no receipt is written, and D2 is closed. The state-schema guard stays and is tested by the Wave 3 rollback proof, not by a version matrix.

### E3 — state-root naming key (closed 2026-11-01)

| Field | Detail |
| --- | --- |
| Question (original) | Is a normalized git remote a stable project identity across two working directories, and what happens when it is absent, changed, or shared by two repositories? |
| Question (verified) | Does the host already expose a stable project identity across worktrees, clones and symlinks, and can the state root be keyed on it without moving configuration? |
| Method | A live host probe with a main checkout, a `git worktree`, a separate clone, a no-git directory and a symlink showed one host `project.id` for the first three and distinct path-derived ids for the last two. The plugin now resolves `location.project.id` first, then `project.canonical`, then `project.directory`, then the working directory; it syncs the legacy workspace root into `v2DataRoot()/projects/<key>/` at boot with a backup, a journal and a conflict archive, and keeps `stateDir` on the workspace so `opencode.json` and `tawassul.json(c)` never move. |
| Evidence | `scripts/prove-state-root-survival.ts` (44 assertions) and `scripts/prove-state-root-rollback.ts` (49 assertions), both in `gate-manifest.json`; `docs/STATE-ROOT-DESIGN.md`; the host-identity probe recorded in the design's section 2. |
| Decides | The project-scope key (host identity), the canonical-path fallback, the boot-time sync window, the conflict rule, the rollback path and HMAC continuity. Wave 3 proceeds. |
| Fallback (not taken) | Keep the current working-directory key, keep the durability claim withdrawn, and document the limitation. No migration runs without a passing rollback. |

### E4 — installer ledger and global scope (closed 2026-11-01)

| Field | Detail |
| --- | --- |
| Question | Can the installer record a per-file ownership ledger, verify it, and uninstall without touching user content in an isolated global directory? |
| Method | Point `TAWASSUL_GLOBAL_DIR` at a temporary root, install, verify that the marker records every owned file with a path and a sha256 and that the installed bundle embeds every shipped skill and command, drop a user skill and a user command in the user's own skills directory, run `verify:global`, boot the plugin and confirm the registered id set, uninstall, then compare the file manifest before and after. |
| Evidence | Manifest diff, marker contents, and the verify output. |
| Decides | The ledger shape, uninstall semantics, and whether a real global install is approved. |
| Fallback | Keep the global install disabled and ship project scope only. |

### E5 — eval budget and reviewer independence (closed 2026-11-01)

| Field | Detail |
| --- | --- |
| Question | What time and token budget keeps `gate:evals` under release tolerance, and does the retro-probe observe any reviewer running on the implementer model? |
| Method | Run the pilot eval fixtures in isolation with fixed serialized inputs, record wall time, tokens and receipts per fixture, then sample per-turn dispatch payloads and `tool-run-log` entries and compare implementer and reviewer models for the same turn. `agentModelMap` is not a source for this comparison. |
| Evidence | Budget table per fixture, flake log, and the violation count with the sampled dispatch ids. |
| Decides | The `gate:evals` budget, the model pair for the reviewer probe, the eval-squash policy, and Wave 1b option A or B. |
| Fallback | Keep `gate:evals` release-only with a fixed hard cap, and keep Wave 1b at option A unless a violation is observed. |

#### Wave 2 closure — 2026-11-01

| Field | Measured |
| --- | --- |
| Description text | 20,267 → 16,147 bytes, a 4,120-byte cut and 20.329 percent |
| Frozen target | 16,213 exact; 66 bytes of headroom, no recalibration |
| Grown descriptions | 0 of 44 |
| Constraint retention | 11 tools, 103 pinned phrases, 11 live executor refusals, 395 assertions |
| Top-8 hot-tool retries | 0 → 0; the two discarded-run retries are disclosed in the receipt and are guard and path artifacts |
| Reload probe | 44 → 44 tools, one callable synthetic tool, no duplicate, schema visible in the following injection |
| Skill gate | retired; no warning-only logger shipped in its place |
| Receipt | `docs/experiments/receipts/2026-11-01-wave2-context-diet.md`, retries in `2026-11-01-wave2-retries.json`, baseline in `2026-11-01-context-baseline.json` |

#### Owner-directed skill addition — 2026-11-01

| Field | Detail |
| --- | --- |
| Source | the owner's own `universal-code-integration-engineer` skill, rewritten to the shipped-skill contract |
| Change | the doctrine is preserved in its fourteen themes and rewritten without a prohibition, prerequisite or tool contract; a six-step procedure sequences `goal`, `show_board`, `timeline`, `record` and `handoff` |
| Context cost | 91 description bytes, inside the D1 band; the registered skill total moves 285 → 376 bytes |
| Eval | `integration-engineer-basic`: one fixture session, six replayed calls, one live load on an isolated host with the forced skill call, 1/1 loaded |
| Receipt | `docs/experiments/receipts/2026-11-01-integration-engineer-eval.json` |
| Scope | this is an owner addition, not the nine-skill expansion that E1 declined; the command count stays 1 |

### Decision gates

| Gate | Experiment | Decision it closes | Blocks |
| --- | --- | --- | --- |
| D1 | E1 (closed 2026-10-31) | pilot size 3 and command count 1 held; Wave 2 target 16,214 bytes. The owner added a fourth skill on 2026-11-01 (`tawassul-integration-engineer`), with its own eval, fixture and receipt | Wave 1a expansion stopped, Wave 2 unblocked |
| D2 | retired | host policy is a floor set on 2026-10-31 | nothing |
| D3 | E3 (closed 2026-11-01) | state-root key, fallback, migration and rollback | Wave 3 items 1 and 2 |
| D4 | E4 (closed 2026-11-01) | installer ledger and global scope | nothing; the two installer proofs landed inside `prove-global-install`, and a live global install stays on the release track |
| D5 | E5 (closed 2026-11-01) | eval budget, reviewer model pair, Wave 1b fork closed at option A | Wave 4 |

Receipts are written as dated English markdown files under `docs/experiments/`, one file per experiment, and linked from the goal ledger item that the experiment closes. A receipt records the commands, the isolated roots, the raw measurements and the verdict. The plan is re-audited after each gate.

---

## 12. After 0.1.0 — release and distribution track

The repair waves above stay focused on the running tree. The release track is
separate and starts only after the `0.1.0-experimental` public tree is verified.
Its plan of record is `docs/RELEASE-0.1.0-PLAN.md`.

| Item | Trigger | Deliverable |
| --- | --- | --- |
| Arabic review | release-plan fixes land (owner decision 2026-11-01) | the English-only gate is lifted after the release-plan fixes, then the `ar` bundle lands. The track stays blocked until then because `src/i18n/*.json` is scanned and any Arabic string fails check:rules |
| Remaining languages | `ar` unblocked and complete | `fr`, `es`, `zh-CN`, `ru` at heading parity |
| macOS validation | a real macOS host | install, keyring, host discovery and manual maintenance receipt |
| Windows validation | a real Windows host (OpenCode v2 ships Windows x64 and ARM64 CLI builds and Windows Desktop builds) | native lane receipt: install, wasm staging, `icacls` key ACL, host discovery and a `health` snapshot; WSL2 stays the Linux lane |
| Scheduler parity | macOS receipt | a launchd design or an explicit manual-only decision |
| Stable API | 0.1.x feedback | freeze tool names and state schema, or publish a migration policy |
| npm distribution | explicit owner decision | publish scope, provenance and a `beta` dist-tag |
| Live global install | release candidate verified | run against the real global directory now that E4 covers the ledger and uninstall in isolation, and record the install, verify and uninstall transcripts |

None of these may reopen the retired v1 channel. None may move work back into
Wave 1a or Wave 2 without a new experiment receipt.

Canary feedback was cancelled by the owner on 2026-11-01; no `canary` dist-tag is planned.

### Reference solutions from `oh-my-opencode-slim-3.0.6` (2026-11-01)

The owner asked how that project solves the remaining points. Each row records the mechanism found in its tree and whether this tree adopts it.

| Point | What the reference project does | What this tree adopts |
| --- | --- | --- |
| Arabic review | ships docs translations only (`README.fa-IR.md`, `README.ja-JP.md`, `README.ko-KR.md`, `README.zh-CN.md`) and keeps runtime strings English; there is no runtime translation table in `src/` | docs first: a translated README and release notes carry no gate risk. The runtime `ar` bundle still needs the English-only rule amended for `src/i18n/*.json`, which the owner schedules after the release-plan fixes |
| npm distribution | publishes last, after the annotated tag and the GitHub release exist (`docs/release.md`); beta uses `npm publish --tag beta`; `preversion` and `prepublishOnly` run release guards; `latest` is never used as provenance | the same order: tag, release, then publish; a beta dist-tag for prereleases; and a release-artifact proof over `dist/global.js` before the first publish |
| Release artifact guard | `scripts/verify-release-artifact.ts` fails on dev-machine absolute paths in `dist`, missing packaged files and a stale package surface | adopt the shape: `prove-release-artifact` asserts the bundle is self-contained, has no home-directory path, and matches the hashes the installer records |
| Stable API | `docs/opencode-v2-compatibility.md` pins the consumed host surface, states which older hosts are unsupported, and `src/v2/mirror-conformance.ts` fails `typecheck` when the mirror drifts | adopt a compatibility document pinned at the 2.2.0 floor plus a compile-time conformance check for the consumed `ctx.skill` and `ctx.command` surface |
| macOS | prebuilt native archives per platform; the plugin never claims automation the host cannot provide | keep the manual lane the installer already prints, and treat install, `--verify` and doctor output as the real receipt |
| Windows | ships an `x86_64-pc-windows-msvc` archive and preserves the native path flavor in resolution | adopt native support, not the binary: OpenCode v2 publishes Windows x64 and ARM64 CLI builds and Windows x64 and ARM64 Desktop builds, so a native host loads the plugin without WSL2, and the plugin is a JavaScript bundle that needs no POSIX tool at runtime. The installer and database lane are POSIX-bound, so the release plan's WP5a adds the `win32` branch (`where`, `icacls` key ACL, no database payload, no trigger, no `dbSmoke`); today `preflightLaptop()` has no `win32` branch and would report missing Linux binaries instead, which is the defect that work package fixes |
| Scheduler parity | no launchd, cron or systemd entry; one companion process owns background work | not transferable. The choice stays between a launchd design and an explicit manual-only decision |
| Host compatibility CI | scheduled checks against pinned and latest host versions | rejected: the host policy is a floor with no upstream tracking (section 1), so a latest-host job would contradict a standing decision |
| Live global install | installs from the published package, not from a dev tree | adopt the ordering: install from the published tarball in an isolated root first, then run the live global install and record the transcripts |

---

## 13. Revision 2026-10-31 — atomic re-evaluation and supersessions

A whole-plan evaluation ran as one complete task per analyst, without decomposition. mimo, glm, beam-free and pickle returned verdicts with file-level evidence; gemini returned a verdict without line-level evidence and is recorded as unusable. The findings below are applied in this revision.

### 13.1 Decisions

1. Displacement is rejected. No shipped skill replaces, shadows or trims a tool description, and tools are never converted into skills. Skills carry procedures only. There is no code path that removes a description when a skill exists; four skills register in-process and none of them alters a tool description. The pre-repair no-op skill guard was retired under Wave 2 item 7, so no skill gate remains in the tree. The host does expose in-process registration (ctx.skill.transform and ctx.command.transform at the 2.2.0 floor), which the plan uses for delivery only. Skills add context; they do not displace it. Independent confirmation: oh-my-opencode-slim-3.0.6 keeps its code tools with self-contained descriptions, ships 12 workflow skills, defines a skill as an instruction layer that guides tool use, and states that no skill runs a process.
2. Enforcement stays inline. Every binding constraint lives in the tool description or in the always-injected concordance path. Pointers to skills are not retention and are not accepted.
3. End-user skill freedom is unconditional. The plugin never reads, prefixes, gates or overrides a user-authored skill. The per-agent skill allow-list model used by oh-my-opencode-slim (skills, skills_add, skills_remove, disabled_skills, skills_include_local) is explicitly not adopted, because it restricts user skills and contradicts this decision. A same-name user skill wins over a shipped one, and the plugin must never win that collision.
4. Host policy is a floor. >=2.2.0 is enforced; any newer version, including the installed 2.2.5, runs with a cosmetic warning and is not audited per release. No wave tracks upstream releases and no wave updates the audited constant. E2 and D2 are retired; Wave 0 item 4 and Wave 3 item 3 are withdrawn.
5. Verification must measure behaviour, not only bytes. The matrix gains constraint retention and skill load rate.
6. Shipped content has a versioned source and an in-process delivery path. Repository-root `skills/` holds shipped content; `.opencode/` is runtime only. Registration uses `ctx.skill.transform` and `ctx.command.transform`; nothing is copied into `.opencode/skills/` or a user skills directory. Content ships inside the bundle, so neither mode stages a skills directory; E4 confirmed that the marker covers the bundle hash and `contentSha` instead. The layout is adopted from `superpowers-7.0.1` (root `skills/`) and `oh-my-opencode-slim-3.0.6` (in-process registration, never disk-copied, same-name user skill wins).
7. Verification measures the registered set, not a copied tree. A boot proof asserts that the manifest ids equal the ids the host registered and that no file appears under a user skills directory.
8. The no-op skill guard is retired, and no real gate replaced it; `src/hooks/guards/skill-gate-guard.ts` no longer exists in the tree. A logger named gate is worse than no gate, because it reads as enforcement in the audit.
9. Skill description cost is measured, never mechanically capped. The description is the only text the model sees before deciding to load a skill, so truncating it to a byte target makes the skill unintelligible and defeats its purpose. Wave 0 measures the registered description bytes and records them as a budget line; review judges clarity and trigger coverage, not length. Reference sets: oh-my-opencode-slim spends 2,473 characters across 12 skills and superpowers spends 2,319 across 15, with no per-description cap in either.
10. Registration is failure-isolated. Each `draft.add` is wrapped so one rejected skill cannot disable the plugin. This follows `superpowers-7.0.1`, whose source records that an escaping error yields "Plugin disabled after skill.transform failed" and takes the bootstrap path with it.

### 13.2 Baseline corrections applied

| Was | Now | Evidence |
| --- | --- | --- |
| 42 tools | 44 tools | scripts/release-smoke.sh lines 124, 177; scripts/prove-e27.ts line 40; commit 7bad75c |
| 105 proof scripts / 102 manifest steps | 141 proof scripts / 138 manifest steps at the Wave 0 tree (based on 9d9e36c), four shards plus a detached worker; the pre-Wave-0 count was 136/133 at 9d9e36c, and the live tree now generates 156/153 | scripts/gate-manifest.json; scripts/prove-*.ts glob count; package.json lines 13-21 |
| build copies skills into `.opencode/skills/` | in-process registration with no staged skills directory | oh-my-opencode-slim-3.0.6/src/v2/setup.ts lines 2736-2811; .gitignore line 1; E4 receipt |
| measureSchemaPayload used for description bytes | separate description-only primitive | src/v2/adapters.ts lines 51-57 |
| agentModelMap at message-updated.ts 690-695 | 709-714, last-writer-wins | src/hooks/message-updated.ts lines 709-714 |
| tool-run log as a model source | it carries an optional per-invocation model; pre-field entries load as unknown | src/services/tool-run-log.ts; scripts/prove-dispatch-model.ts |
| any 3.x refused | no ceiling in code; floor only | scripts/install-global.ts lines 162-167, 184 |
| skill descriptions left out of the context baseline | registered description bytes measured per skill and in total, with no hard per-description cap | oh-my-opencode-slim-3.0.6/src/skills; superpowers-7.0.1/skills; measured 2026-10-31 |
| eval ids checked against an eval ledger | the ledger is defined in Wave 1a at `docs/experiments/evals.json`; an absent ledger is no longer assumed | docs/experiments does not exist on 2026-10-31 |

### 13.3 Carried-forward items, settled 2026-11-01

Every item below is settled. The list is kept so that none of them silently returns as open work.

- State-root migration: done 2026-11-01 — host project identity is the key, the workspace root stays the config root, the project root carries persistence, the boot-time sync writes a backup, a journal and a conflict archive, rollback is explicit, and HMAC continuity is proven by prove-state-root-rollback.
- Record-store digest: done 2026-10-31 — distinct ids are never merged, repeated titles are annotated, the hidden tail counts distinct ids, and no record is hidden or deleted (prove-record-digest-dedupe).
- Ledger back-compatibility for the new dispatch model fields: done 2026-10-31 — pre-field entries load as unknown and are never back-filled or rejected (prove-dispatch-model).
- In-process registration: confirmed on the installed host 2.2.5 on 2026-10-31 — `ctx.skill.transform=1`, `ctx.command.transform=1`, one skill registration and `command-registration=ok`. The 2.2.0 floor remains a declared type-surface promise; no older host is installed for testing.
- The parallel repair session declared done at 9d9e36c. Wave 0 items 1 and 3 changed the tree and re-measured section 3 on 2026-10-31 (138 proof scripts, 135 manifest steps, 44 tools); the 9d9e36c values stay the pre-Wave-0 reference.
- User-skill precedence is proven live on 2.2.5 (2026-10-31): a same-name user skill wins and the plugin entry stays silent. If a future host resolves the registered skill first, registration is disabled for colliding names; it never falls back to disk copies.
- The Arabic translation track in section 12 stays blocked until the release-plan fixes land; the owner decided on 2026-11-01 that the English-only gate is then lifted for `src/i18n/*.json`, and until that amendment merges the row stays blocked.
- Skill description budget values, per skill and in total, are reviewed at E1: 91–100 bytes per skill and 285 bytes for the three-skill set. The owner addition of 2026-11-01 keeps the band at 91 bytes and moves the live total to 376 across four skills. The dated artifacts record the set at their measurement dates (three skills, 285 bytes), each measurement date carries exactly one artifact, and the live set is checked against `skills/manifest.json` by `prove-skills-manifest`. No hard per-description cap is adopted, because a truncated description can stop the agent from recognising when the skill applies.
- Shipped-skill opt-out is decided at E1: not adopted. Any future implementation touches shipped ids only and must never read, gate or modify a user-authored skill.
- README skill table generation lands with Wave 1a item 10 and is verified against the manifest, never hand-edited.
- The tool-count literal moved twice in one day: 42 to 43 at 8c58269 (thread) and 43 to 44 at 7bad75c (task_control). Before any numeric claim, the count must be generated from TAWASSUL_TOOL_NAMES and compared with the boot marker, the smoke script and the fixtures; a hand-edited literal is not accepted.
