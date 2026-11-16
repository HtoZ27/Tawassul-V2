# P2 isolated experiments — real payloads, shadow sink, hook, health

- Date: 2026-11-07 (UTC)
- Verdict: **pass.** Four independent in-process experiments exercise the shipped code with the
  real Probe 0 payloads, a real ledger file, the real tool hook, and the real health tool.
- Base revision: `5e29a79` plus the uncommitted D12 no-agent change.
- Runtime: Bun 1.3.14 on Linux x64; every experiment runs in a fresh `mkdtemp` directory that is
  removed in `finally`.
- Script: `docs/experiments/receipts/2026-11-07-p2-isolated-experiments.ts` (53 assertions).
- Command: `bun docs/experiments/receipts/2026-11-07-p2-isolated-experiments.ts`

## Why these experiments

The gate proofs use synthetic payloads. These experiments replay the ten real
`session.usage.updated` payloads captured by Probe 0 and the two real `session.get` snapshots,
then drive the real shadow detectors, the real `tool.execute.before` hook, and the real `health`
tool against a real JSONL file. They are the bridge between "the unit tests pass" and "the host
plumbing works".

## Experiment A — replay the ten real usage payloads

Input: `q1_q2_q3_q8_usage` and `q2_q5_q6_gets` from
`2026-11-06-token-usage-probe.json`. The root events are ids 0-5 and 8-9; the child events are 6-7;
the child `parentID` is the real root session.

| Reading | Result |
| --- | --- |
| Events accepted | 10 / 10 |
| Root cumulative billable | 94,694 (`70484 + 402 + 238080 * 0.1`) |
| Child cumulative billable | 39,419 (`39363 + 56`) |
| Child depth and parent | depth 1, parent `ses_e4fa35e16ffe7C44xW2CkbwKLj` |
| Root depth | 0 |
| Context size at the end | 308,564 (`70484 + 238080`) |
| JSONL rows | 10, one per event |
| Last root raw input | 70,484 |
| Last root input delta | 138 (`70484 - 70346`) |
| Last root cache delta | 51,072 (`238080 - 187008`) |
| Last root row billable | 5,260.2 (delta, not cumulative) |
| Cost label | `costUnpriced: true`, `weights.source: "default"` |
| Summary | 2 sessions, 1 root, 1 child, unit `weighted_tokens`, root p50 94,694, child p50 39,419 |

## Experiment A2 — reload plus real `session.list` backfill

A second ledger opens the same file and receives the two real `session.get` snapshots through
`listSessions`. Result: 10 rows, 0 `unobserved`, 0 backfilled. A matching history snapshot
reconciles rather than duplicating.

## Experiment B — shadow detectors sink four rows

| Step | Result |
| --- | --- |
| Five identical `shell` repeats | one warning at 3, one trip at 5 |
| Twelve identical no-tool turns | one echo trip, count 12 |
| Six identical `task` dispatches | one fan-out trip, count 6 |
| Observations | 4 |
| Persisted shadow rows | 4 |
| Distinct detectors | 3 |
| Summary | repeat 1 / echo 1 / fan-out 1 session |

## Experiment C — the real before hook records a no-agent call

`createToolExecuteBeforeHook` is invoked with a minimal context that carries a real
`PipelineState`. The first call has no agent; the second carries `dev`.

| Reading | Result |
| --- | --- |
| Row written for the no-agent call | 1, `kind: "noagent"`, tool `bash`, real session id |
| Summary count | 1 |
| Agent-bearing call adds a row | no, count stays 1 |
| File mode | `0600` |

The pipeline logs `▶ [bash] ?: printf p2`, which shows the call passed the recording point and
continued into the normal path.

## Experiment D — the health tool renders the block

A live ledger is seeded with two real payloads, one no-agent row, and one row per detector. The
real `buildHealthTool` renders:

```
## Usage ledger
- Sessions: 1 (roots 1 / children 0, orphans 0, lineage unknown 1)
- Weighted tokens p50/p90/p99: root 20,220/20,220/20,220 · child n/a/n/a/n/a
- Rows: 2 usage, 0 injection (0 B) · backfilled 0 · unobserved 0
- No-agent calls: 1
- Shadow: repeat 1 / echo 1 / fan-out 1 session(s), 3 row(s)
- Unit: weighted_tokens · priced 0 / unpriced 1 · cost_unpriced
- Ledger: /tmp/.../health.jsonl (last event 2025-10-09T08:53:20.000Z)
```

`lineage unknown 1` is correct here: the health ledger has no `session.get` resolver, so the root
depth is unknown and the count says so instead of inventing depth 0.

## Limits

These experiments do not run the host. They prove the shipped functions, the hook, the file
format, the reload path, and the report; the live host run is a separate experiment. They also do
not produce `input.agent === undefined` from a real dispatch, so the no-agent row is proven at the
hook boundary, not from a host event.
