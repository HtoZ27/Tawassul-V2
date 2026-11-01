# Wave 2 — gated context diet

- Date: 2026-11-01 (UTC)
- Host: opencode v2.2.5 at `~/.config/ai.opencode.desktop/cli/2.2.5-x64/opencode-cli`
- Build under test: HEAD `9d9e36c` plus the uncommitted Wave 1a and Wave 2 tree; `dist/index.js` and `.opencode/plugin/tawassul.js` rebuilt at 2,051,519 bytes
- Runtime: bun 1.3.14, node v26.13.0
- Scope: Wave 2 items 1–7 of `docs/FUTURE-WORK-PLAN.md`. This receipt does not touch E1 defect fixes, `G-006`, or the release track.

## Verdict

Wave 2 closes. The description diet cut 4,120 bytes, which is 20.329 percent of the frozen 20,267-byte baseline, and it clears the exact target by 66 bytes. No description grew, every binding constraint survived the retention proof with a real executor refusal behind it, the live reload probe passes, the retirement of the no-op skill guard is complete, and the top-8 hot-tool retry table stays at the frozen zero.

## Description diet — item 1, 2 and 3

Method: the description-only primitive (`measureDescriptionText`) over a boot of the built plugin in an isolated workspace, the same primitive that produced the frozen 2026-10-31 baseline. Schema payload, concordance and skill lines are reported alongside and never substitute for the description metric.

| Metric | Frozen 2026-10-31 | 2026-11-01 | Delta |
| --- | --- | --- | --- |
| Description-text bytes | 20,267 | 16,147 | −4,120 (−20.329%) |
| Frozen target | 16,213 exact | 16,147 | 66 bytes of headroom |
| Tools measured | 44 | 44 | 0 |
| Schema payload bytes | 13,868 | 13,868 | 0 |
| Concordance bytes | 881 | 881 | 0 |
| Registered skills | 3 (285 bytes) | 3 (285 bytes) | 0 |
| i18n bundle | 42,754 bytes | 42,754 bytes | 0 |

Per-tool cut, all eleven slimmed under the minimum-inline contract with no constraint moved into a skill:

| Tool | Before | After | Cut |
| --- | --- | --- | --- |
| handoff | 2,675 | 1,122 | 1,553 |
| kick | 1,276 | 802 | 474 |
| override | 1,012 | 619 | 393 |
| record | 866 | 529 | 337 |
| goal | 1,878 | 1,564 | 314 |
| discussion | 687 | 387 | 300 |
| evidence | 632 | 457 | 175 |
| addagent | 1,235 | 1,068 | 167 |
| timeline | 596 | 437 | 159 |
| evaluationreport | 804 | 673 | 131 |
| thread | 1,000 | 883 | 117 |

Zero tools grew. The name-set hash tripwire and the generated tool count stay green, so the wave never reintroduces a literal count (item 5).

Proof: `scripts/prove-context-diet.ts`, 37 assertions. It re-measures the live surface, asserts the measured set is at or below 16,213 bytes, asserts the cut reaches the frozen floor, asserts no description grew, and asserts every frozen top-8 retry row did not increase.

## Constraint retention — item 2 and 3

Frozen fixture: `docs/experiments/fixtures/constraint-retention.json`, schema version 1, eleven tools, 103 pinned phrases across prohibitions, prerequisites and failure modes, plus one prohibited or incomplete input per tool.

Proof: `scripts/prove-constraint-retention.ts`, 395 assertions, all passing. It holds that the fixture covers exactly the eleven slimmed tools, that every pinned phrase still appears in the live description after whitespace normalization, and that each tool still refuses its probe through the live V2 executor rather than on prose inspection. Refusals observed:

| Tool | Probe | Refusal |
| --- | --- | --- |
| handoff | create without task and context | `To create a new handoff, specify \`to\`, \`task\`, and \`context\`.` |
| goal | close a goal whose items are open | `Close rejected` |
| kick | remove the default `@tawa` | `Cannot delete default agents: @tawa` |
| addagent | create a `tawa-` prefixed agent | `Cannot create an agent with a "tawa" prefix` |
| override | call with no action | `Invalid override usage` |
| thread | read a three-character digest | `Invalid digest: expected 64 lowercase hex characters.` |
| record | write with no title and detail | `Must specify \`type\`, \`title\`, and \`detail\`.` |
| evaluationreport | write with no issues | `Must pass \`issues\`` |
| discussion | call with no action | `Invalid input for tool "discussion"` |
| evidence | call with no action and no discussion | `Invalid input for tool "evidence"` |
| timeline | pass an unknown view | `Invalid input for tool "timeline"` |

## Live reload probe — item 4

Proof: `scripts/prove-reload-live.ts`, 30 assertions, all passing. In one isolated boot it asserts the tool count before and after a host reload (44 to 44), the same name set, no duplicate registration, a stable schema fingerprint, a plugin tool callable through the rebuilt registry, a synthetic tool added through `transform`, that the synthetic tool survives a reload without duplicating, that it stays callable, that the following injection carries its schema and required field, and that disposing it restores the count and the name set. The failure mode named in item 4 was not observed, so lazy registration stays.

## Retry counters — item 3

Receipt: `docs/experiments/receipts/2026-11-01-wave2-retries.json`, schema version 1. Frozen baseline is the E1 table; closure is four isolated stages (`goal-review`, `handoff-triage`, `context-continue`, `diagnostics`) run one at a time under `/tmp/opencode/w2-live/roots`, with `XDG_*`, `TAWASSUL_HMAC_KEY_DIR` and `OPENCODE_DB` redirected under the same root.

| Tool | Baseline calls | Baseline retries | Closure calls | Closure retries |
| --- | --- | --- | --- | --- |
| bash | 41 | 0 | 5 | 0 |
| goal | 20 | 0 | 9 | 0 |
| thread | 13 | 0 | 7 | 0 |
| skill | 6 | 0 | 3 | 0 |
| read | 5 | 0 | 1 | 0 |
| show_board | 5 | 0 | 2 | 0 |
| record | 4 | 0 | 4 | 0 |
| status | 4 | 0 | 1 | 0 |

Top-8 retry total: 0 to 0. Retries are recomputed from the `run.out` transcript, because the tool-run-log flush lags the transcript and drops the tail when a run ends before a state save. Two discarded runs carry one retry each and are reported in the receipt rather than dropped: a plugin burst-guard denial from parallel tool calls, and a model path guess outside the isolated workspace. Neither follows from a description edit. The retained prompts require one tool call per message, which removes both artifacts.

## Skill-gate retirement — item 7

`src/hooks/guards/skill-gate-guard.ts` is deleted. The `skillGateGuard` stage and the `setSkillGateEnabled` export are gone from `src/hooks/validation-pipeline.ts`, and the `skillGate` innovation wiring is gone from `src/bootstrap/service-factory.ts`. `scripts/prove-e11.ts` now covers the capability seeding it actually tests, 18 assertions, all passing. No warning-only logger remains as a substitute for enforcement.

## Compaction payload recheck — item 6

The trigger is a host that starts session history at the latest completed compaction after a host upgrade. The installed host is still 2.2.5, the same build the Wave 0 baseline measured, and no upgrade was observed in this window, so the condition did not fire. The 2026-11-01 baseline was re-measured on that build with the same primitive and the same isolated method, which keeps the comparison valid. `scripts/prove-context-baseline.ts` passes 40 assertions against the new artifact. If the host is upgraded mid-wave, the recheck re-runs before the wave is marked verified.

## Gate evidence

- `npm run gate:fast` — PASS, 10 steps, 19,538 ms
- `npm run gate:proofs` — PASS, 145 steps, 278,994 ms
- `npm run build` — PASS, `dist/index.js` and `.opencode/plugin/tawassul.js` at 2,051,519 bytes
- `npm run generate:proof-count` — 148 proof files, 145 proof steps, five documents updated

## Safety

Every run wrote only under `/tmp/opencode/w2-live/roots/<stage>`. The live host, the live state root, the user skills directory and the global install were not touched. No push, no `install:global`, and no edit under the v1 tree. `docs/FUTURE-WORK-PLAN.md` stays unstaged.
