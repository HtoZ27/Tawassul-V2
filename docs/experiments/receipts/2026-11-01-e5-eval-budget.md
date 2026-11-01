# E5 — eval budget and reviewer independence

- Date: 2026-11-01
- Host: OpenCode 2.2.5 (the only installed host); no second host was booted
- Build under test: HEAD `e10baec` (the committed Wave 1a/2/3 tree)
- Runtime: bun 1.3.14; node v26.13.0
- Isolation: the pilot eval replay ran in its own process; the reviewer sample is a read-only read of the live tool-run log. No live state file, host session or global install was written.

## Question

What time and memory budget keeps `gate:evals` inside release tolerance, and does a retro-probe observe any reviewer turn running on the implementer model?

## Budget measurement

The pilot eval is the offline replay in `scripts/prove-pilot-eval.ts`: it parses each shipped `SKILL.md` procedure, replays the authored fixture transcript against the declared tool argument schemas, and reads the recorded receipt. It performs no network call and needs no host boot, so the measurement is the floor for any `gate:evals` stage that keeps the replay and adds live probes on top.

| Run | Wall time | Peak RSS | Assertions | Output digest |
| --- | --- | --- | --- | --- |
| 1 | 0.14 s | 72,412 KB | 71 | `a4cfdcbdd0338de2d6278a5b712da68d` |
| 2 | 0.13 s | 72,972 KB | 71 | `a4cfdcbdd0338de2d6278a5b712da68d` |
| 3 | 0.16 s | 72,204 KB | 71 | `a4cfdcbdd0338de2d6278a5b712da68d` |

Three consecutive runs produced byte-identical output and the same 71 assertions. Flake log: 3 runs, 0 flakes, 0 retries.

### Per-fixture cost

Serialized bytes are the fixture file size; the token column is the `bytes / 4` estimate used by the context baseline, not a tokenizer count.

| Fixture | Skill | Bytes | Est. tokens | Sessions | Replayed calls |
| --- | --- | --- | --- | --- | --- |
| `goal-review-basic` | `tawassul-goal-review` | 1,095 | 273 | 1 | 8 |
| `handoff-triage-basic` | `tawassul-handoff-triage` | 875 | 218 | 1 | 7 |
| `context-continue-basic` | `tawassul-context-continue` | 855 | 213 | 1 | 6 |

| Procedure | Bytes |
| --- | --- |
| `skills/tawassul-goal-review/SKILL.md` | 926 |
| `skills/tawassul-handoff-triage/SKILL.md` | 730 |
| `skills/tawassul-context-continue/SKILL.md` | 624 |
| Total procedure text | 2,280 |

Total replayed fixture weight is 2,825 bytes (706 estimated tokens) against 2,280 bytes of procedure text. The replay receipt is 2,328 bytes.

## Reviewer-independence retro-probe

Source: `.opencode/tool-run-log.json`, the live per-tool log in the workspace, read without modification. Every entry records the agent, the session, the turn and, for recent entries, the model that executed the tool.

| Measure | Value |
| --- | --- |
| Entries sampled | 1,500 |
| Entries carrying a model | 1,215 |
| Sessions | 2 |
| Turns in the long session | 201 |
| Turns where both the implementer and the reviewer ran a tool | 39 |
| Same-model turns (violations) | 0 |

Observed model per agent on the joined turns:

| Agent | Role on the turn | Observed model | Entries |
| --- | --- | --- | --- |
| `build` | implementer | `opencode/deepseek-v4.1-flash-free` | 1,105 |
| `plan` | reviewer | `nvidia/stepfun-ai/step-5-preview` | 110 |

Sampled turn ids (`sessionId`, `turn`): `ses_e6e5598cfffe1itgwN0w3m2qzr` turns 19 through 60, 39 pairs, all with different provider and model. The full pair table is in `2026-11-01-e5-pairs.json`.

### Dispatch-payload coverage

The persisted handoff payloads in `.opencode/tawassul-state.json` were decoded read-only with the existing HMAC key: 1,000 entries, 0 carrying `implementer` or `reviewer`, and 0 carrying `sessionId` or `turn`. These entries predate the payload fields. The retro-probe therefore joins through the tool-run log, which already carries the executed model per turn, and the payload fields are exercised only by `prove-dispatch-model` and the handoff tool assertions today.

This is an observability gap, not a violation: no same-model turn was observed in the sample, and the structural resolver records both refs at every dispatch site (`handoff` tool, service factory, discussion callback).

## D5 decision

| Field | Decision |
| --- | --- |
| `gate:evals` budget | Hard cap 90 s wall time and 256 MB peak RSS for the whole stage; the offline replay is the mandatory core, live probes are additive and each carries a 30 s ceiling. |
| Retry and squash policy | No retries. One process per fixture. A fixture that flakes twice is quarantined with a receipt rather than retried inside the gate. |
| Reviewer model pair | Implementer `dev` (`google/gemini-flash-lite-latest`) against reviewer (`opencode/big-pickle`) in the roster, and the observed live pair `build` (`opencode/deepseek-v4.1-flash-free`) against `plan` (`nvidia/stepfun-ai/step-5-preview`). The probe requires provider and model to differ, never a specific pair. |
| Wave 1b fork | Option A. No violation observed in 39 joined turns, so no preventive fork is opened. |
| Wave 4 requirement | Persist `sessionId` and `turn` (or an equivalent join key) on the dispatch payload so the retro-probe reads the payload directly instead of the tool-run log, and add the deterministic join fixture to `gate:evals`. |
| Fallback (not taken) | Keep `gate:evals` release-only with a fixed hard cap and keep Wave 1b at option A. |

Evidence: `2026-11-01-e5-pairs.json` (39 joined turns) and the three run logs quoted above; commands `bun scripts/prove-pilot-eval.ts` three times and a read-only decode of the live state and tool-run log.
