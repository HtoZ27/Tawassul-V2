# P2 usage ledger — first slice

- Date: 2026-11-06 (UTC)
- Verdict: **partial, by design.** The ledger core, JSONL, backfill, reload reconciliation,
  self-injection audit, and the health report are implemented and proven. The shadow
  repeat/echo/fan-out detectors and the 7-day or 30-session window are not; the P2 gate stays open.
- Base revision: `a0617c5`.
- Runtime: Bun 1.3.14 on Linux x64; the proof uses an isolated temporary directory.
- Proof: `scripts/prove-usage-ledger.ts`, 115 assertions, gate step `usage-ledger`.
- Gate: `npm run verify` passed (`GATE PASS: fast (16 step(s))` plus the build).
- Later slices: `2026-11-06-p2-usage-shadow.md` adds the shadow detectors; `2026-11-07-d12-no-agent-row.md` adds the no-agent rows. The proof now carries 122 assertions.

## Change under proof

| File | Change |
| --- | --- |
| `src/services/usage-ledger.ts` | new `UsageLedger`: parsing, cumulative snapshots, deltas, weighted billing, lineage, JSONL, rotation, backfill, reload, injection audit, summary |
| `src/v2/session-bridge.ts` | adds `get` and `list` to `SessionBridge` |
| `src/v2/types.ts` | narrow structural types for `session.get` and `session.list` |
| `src/v2/setup.ts` | installs the ledger, starts reload plus backfill before the event relay, feeds every raw event, disposes last |
| `src/hooks/session.ts` | records `digest`, `context`, and `session_index` injection bytes |
| `src/tools/tawa/health.ts` | adds the `## Usage ledger` report block |
| `scripts/gate-manifest.json`, `scripts/proof-shards.json`, `scripts/prove-proof-catalog.ts` | registers the proof as step 178 |

No existing limit, guard, `callDepth` semantic, or role condition changed. The 50k cap is untouched.

## Accounting decisions

Probe 0 settles the inputs:

1. `session.usage.updated` is the push source and carries cumulative counters (Q1, Q2). The ledger
   stores the latest snapshot per session and derives deltas; it never sums cumulative payloads.
2. `tokens.input` excludes `cache.read` (Q4), so `context_size = input + cache.read` and
   `fresh_input = input` without subtraction.
3. `cost` is 0 on the configured free models (Q8), so every such row is labelled `cost_unpriced`
   and the budget unit falls back to weighted tokens.
4. `session.get(root)` does not aggregate children (Q5), so a tree map is required. Lineage comes
   from `session.get(parentID)` on first sight; the parent walk stops at a root.
5. `parentID` survives a restart (Q6), so reload keeps the child split.

The row records raw cumulative counters, the derived delta, `billable`, `contextSize`, the cost
label, and the weights with their source. The formula matches plan Section 14.6:

```
billable = input + output + cache.read * 0.10 + cache.write * 1.25
```

`reasoning` is not added because the conservative default treats it as included in `output`. The
weights are labelled `source: "default"`; catalog-derived weights and the 20% cost reconciliation
warning remain open because no priced model has been observed yet.

## Method

The proof runs in one isolated child process through the gate:

```
bun scripts/gate.ts proofs --only usage-ledger
```

It covers the branches that decide behaviour:

1. **Parsing.** A valid usage event, an unrelated type, a missing token block, a missing session id,
   a non-object event, and negative, `NaN`, infinite, and non-numeric fields.
2. **Arithmetic.** Default and custom weights, reasoning exclusion, zero usage, context size,
   growth deltas, and a shrinking snapshot that becomes a labelled `resync`.
3. **Percentiles.** Empty, single-value, p50/p90/p99 nearest rank, and an empty set.
4. **Live lineage.** Root depth 0, child depth 1, grandchild depth 2 through a real recursive
   `session.get` walk, and the agent carried from the snapshot.
5. **Cumulative accounting.** The second event is priced from its delta, not from the cumulative
   snapshot; the persisted row carries the delta; a zero-cost session is `cost_unpriced`; a priced
   session is not.
6. **Persistence.** The file is `0600`; reload restores sessions, turns, and injection bytes; the
   first post-restart event derives its delta against the persisted snapshot and continues the
   turn count.
7. **Backfill.** Two pages through the cursor, 500 per page, newest first; zero-usage sessions are
   skipped; roots, children, grandchild depth, and an orphan with an unknown parent are separated;
   the p99 split comes from cumulative snapshots.
8. **Boot gap.** A list snapshot above the persisted counter emits an `unobserved` row with only
   the missing delta; a known session is reconciled, not backfilled.
9. **Fail-open.** A ledger without `session.list` still ingests; a `session.get` failure emits the
   row, leaves the depth unresolved, and counts the session as `lineageUnknown`.
10. **Injection audit.** Digest and index rows are recorded, non-finite and negative bytes are
    ignored, bytes round, and the totals survive reload.
11. **Rotation.** A one-byte cap rotates the active file to `.1`, and reload reads both files.
12. **Wiring.** Static assertions pin the setup install, relay feed, cleanup, bridge methods, health
    block, and session-hook sources.

## Results

```
PROOF PASS: usage ledger covers parsing, pricing, lineage, backfill, reload, gaps, injection, and rotation
```

`npm run verify` passed the 16-step fast gate and the build. The proof is registered as step 178
of 178 and file 181 of 181; `scripts/generate-proof-count.ts` updated the generated counts.

## What remains in P2

| Item | Status |
| --- | --- |
| Shadow repeat detector, including non-read tools | not implemented |
| Shadow echo detector on `session.text.ended` (Q15) | not implemented |
| Shadow fan-out detector on child dispatch text | not implemented |
| 7 days or 30 sessions of forward data | not started |
| p99(root), p99(child), echo-flagged sessions, repeat false-positive rate | pending |
| Orphan rate, event-loss rate, injected bytes per request | partially available: orphan count and `unobserved` rows exist; injected bytes are logged per source |
| Catalog-derived cache weights and cost reconciliation > 20% | blocked on a priced model observation |

The gate is not claimed. The ledger is shadow-only: it writes JSONL and a health report, and it
enforces nothing.

## How to inspect

`health()` prints the ledger block with sessions, roots, children, orphans, lineage unknowns,
p50/p90/p99 weighted tokens for root and child, row counts, injection bytes, backfilled and
unobserved counts, the unit, the priced/unpriced split, the path, and the last event time.

The JSONL path is `TAWASSUL_USAGE_LEDGER` when set, otherwise `usage-ledger.jsonl` under the v2
data root, with a `.1` rotation file. Rows are `kind: "usage"` or `kind: "injection"`. Usage rows
carry `raw`, `delta`, `billable`, `costCumulative`, `costUnpriced`, `contextSize`, `depth`,
`parentID`, `source`, `unobserved`, and `resync`.
