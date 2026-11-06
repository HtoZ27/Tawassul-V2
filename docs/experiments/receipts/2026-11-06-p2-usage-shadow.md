# P2 shadow detectors — repeat, echo, and fan-out

- Date: 2026-11-06 (UTC)
- Verdict: **partial, by design.** The three shadow detectors and their ledger sink are
  implemented and proven. The 7-day or 30-session observation window has not run, so the P2 gate
  stays open and no enforcement is claimed.
- Base revision: `10e5dec`.
- Runtime: Bun 1.3.14 on Linux x64; the proof uses an isolated temporary directory.
- Proof: `scripts/prove-usage-shadow.ts`, 80 assertions, gate step `usage-shadow`.
- Gate: `npm run verify` passed (`GATE PASS: fast (16 step(s))` plus the build).

## Change under proof

| File | Change |
| --- | --- |
| `src/services/usage-shadow.ts` | new `UsageShadow`: repeat, echo, and fan-out detectors with bounded per-session state |
| `src/services/usage-ledger.ts` | `kind: "shadow"` rows, `recordShadow`, and summary counters for repeat/echo/fan-out sessions |
| `src/v2/setup.ts` | installs the shadow detectors, feeds every raw event, clears them before the ledger |
| `src/hooks/tool-execute.ts` | feeds `observeDispatch` before the call and `observeRepeat` after a successful repeat |
| `src/tools/tawa/health.ts` | adds the shadow line to the `## Usage ledger` block |
| `scripts/gate-manifest.json`, `scripts/proof-shards.json`, `scripts/prove-proof-catalog.ts` | registers the proof as step 179 |

No existing limit, guard, `callDepth` semantic, or role condition changed. Every detector is
observe-only: no tool is blocked, throttled, or rewritten.

## Detector thresholds

| Detector | Source | Balanced threshold | Notes |
| --- | --- | --- | --- |
| Repeat | tool result counts in `src/hooks/tool-execute.ts` | warn at 3, trip at 5 | per session and tool; failed calls and calls without a session are ignored; `agentMissing` is recorded because D12 leaves `input.agent` unreliable |
| Echo | `session.text.ended` per assistant message, flushed on `session.usage.updated` | 80% trigram overlap for 12 consecutive no-tool turns | a message with a tool call resets the streak; replaced text parts count once per message |
| Fan-out | dispatch text from `task`, `handoff`, and `fasttrack` | 80% overlap for 6 near-duplicate dispatches inside 10 minutes | cluster text is normalized; separate sessions keep separate clusters |

The thresholds come from the plan's balanced preset. They are constants in
`src/services/usage-shadow.ts`; the plan's configuration keys remain unimplemented because P2 has
no user-facing config.

## Method

The proof runs in one isolated child process through the gate:

```
bun scripts/gate.ts proofs --only usage-shadow
```

It covers the branches that decide behaviour:

1. **Similarity.** Identical text, disjoint text, a one-word edit above the overlap threshold,
   case and punctuation normalization, short tokens, empty inputs, whitespace collapse, and all
   `taskTextOf` fallbacks and their precedence.
2. **Repeat.** Counts 1 and 2 emit nothing; 3 warns without tripping; 4 emits nothing; 5 trips;
   6 does not duplicate; a different tool keeps its own state; a failed call and a call without a
   session are ignored; a missing agent is labelled.
3. **Echo.** A non-object event, a missing session, blank text, and an unrelated event are
   ignored; 11 identical no-tool turns do not trip; 12 trip; a longer streak does not duplicate;
   a tool turn resets the streak; a fresh streak trips again; alternating unrelated text never
   trips; repeated `session.text.ended` for one message counts once; the similarity is recorded.
4. **Fan-out.** Five duplicate dispatches do not trip; the sixth near-duplicate trips; a seventh
   does not duplicate; a non-dispatch tool and blank text are ignored; five distinct dispatches
   do not trip; an expired window starts a new cluster; another session keeps an independent
   cluster.
5. **Sink.** Every observation becomes a ledger row; the summary counts one session per detector;
   the echo row is persisted; reload restores the row and session counts; the integrated sink sees
   the warning, the trip, the echo, and the fan-out exactly once.
6. **Wiring.** Static assertions pin the setup install, relay feed, cleanup, the two tool-hook
   observers, the health line, and the plan status.

## Results

```
PROOF PASS: shadow detectors cover repeat, echo, fan-out, ledger rows, reload, and wiring
```

`npm run verify` passed the 16-step fast gate and the build. The proof is registered as step 179
of 179 and file 182 of 182.

## What remains in P2

| Item | Status |
| --- | --- |
| 7 days or 30 sessions of forward data | not started |
| Echo-flagged sessions per 30 sessions | pending the window |
| Repeat detector false-positive rate | pending the window |
| Catalog-derived cache weights | blocked on a priced model observation |
| Cost reconciliation above 20% | blocked on a priced model observation |

The readings that are already available are the root/child p99 split, the orphan count,
`unobserved` rows during reload, injected bytes per source, and the three shadow session counts.
The gate is not claimed. Deleting `src/services/usage-shadow.ts`, its setup wiring, and the two
tool-hook calls reverts the detectors; the ledger keeps working without them.
