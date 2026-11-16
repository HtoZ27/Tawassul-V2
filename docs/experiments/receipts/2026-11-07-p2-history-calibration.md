# P2 calibration from history — first p50/p90/p99 distribution

- Date: 2026-11-07 (UTC)
- Verdict: **directional distribution obtained; the P2 window stays open.** Revision 2 allows the
  first distribution to come from `session.list` history instead of waiting seven days, and this
  receipt records it. The sample has 18 usable project sessions (4 roots), so p90 and p99 are the
  sample maximum; the 7-day or 30-session forward window is still required before budgets are set.
- Base revision: `432727a`.
- Runtime: Bun 1.3.14 on Linux x64.
- Script: `docs/experiments/receipts/2026-11-07-p2-history-calibration.ts`.
- Command: `bun docs/experiments/receipts/2026-11-07-p2-history-calibration.ts`

## Method and safety

The live v2 lane database `~/.local/share/opencode/tawassul-v2/opencode.db` (153 MB) was copied
with its `-wal` (15 MB) and `-shm` files into a fresh `mkdtemp` directory, and only the copy was
opened. No second host was started, the live database was never opened by this process, and the
temporary copy is removed in `finally` (the script also refuses to run when the source is missing).

Only aggregate columns are read: `parent_id`, `directory`, `model`, `cost`, and the five token
counters. Session titles, prompts, messages, and parts are never selected.

The arithmetic matches the shipped ledger: `billable = input + output + cache_read * 0.10 +
cache_write * 1.25`, `contextSize = input + cache_read`, and the nearest-rank
`percentile()` used by `UsageLedger.summary()`.

## Population

| Scope | Sessions | Zero-usage | Roots | Children |
| --- | --- | --- | --- | --- |
| Whole v2 lane | 24 | 1 | 9 | 14 |
| This project (`Tawassul V2`) | 19 | 1 | 4 | 14 |

Zero-usage sessions are excluded, matching the backfill rule: the project sample is 18 sessions.

## Distribution (weighted tokens)

| Group | n | billable p50 | p90 | p99 | context p50 | context p99 | p99 x 1.5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Project roots | 4 | 1,896,313 | 22,292,966.6 | 22,292,966.6 | 8,085,342 | 147,653,025 | 33,439,449.9 |
| Project children | 14 | 305,277.8 | 582,082.6 | 679,631 | 1,912,967 | 4,312,439 | 1,019,446.5 |
| Whole-lane roots | 9 | 1,896,313 | 22,292,966.6 | 22,292,966.6 | 8,085,342 | 147,653,025 | 33,439,449.9 |
| Whole-lane children | 14 | 305,277.8 | 582,082.6 | 679,631 | 1,912,967 | 4,312,439 | 1,019,446.5 |

Project overall billable: p50 377,847, p90 11,618,844.8, p99 22,292,966.6.

The largest project root is 22.3M billable at 147.7M context; the next two are 11.6M and 1.9M. The
children cluster tightly (p50 to p99 spans 305k to 680k), which supports separate root and child
budgets instead of one shared number.

## Gate criteria

| Criterion | Reading | Verdict |
| --- | --- | --- |
| `p99(root) < 300k` means the budget layer is unnecessary (Option 6) | 22,292,966.6 | does not fire; the budget layer stays justified |
| Same test on context | 147,653,025 | does not fire |
| Echo: fewer than 2 flagged sessions in 30 | not reconstructible from history | forward window |
| Repeat: more than 5% of legitimate sessions | not reconstructible from history | forward window |

## Sample limits

- Four project roots: the nearest-rank p90 and p99 both land on the maximum. Treat the numbers as a
  ceiling, not a calibrated quantile. Nine roots across the lane do not change that.
- Session totals are cumulative snapshots, so they grow with conversation length; this is the
  plan's "session totals", not a per-turn cost.
- The database holds aggregates only. Repeat, echo, and fan-out need per-turn shape from the JSONL
  ledger, which history cannot reconstruct.
- The project sample is 18 sessions, below the plan's 30-session floor, and the forward window has
  not run.

## Priced-model reading

One priced session exists in the lane: `nvidia/meta/llama-3.2-90b-vision-instruct`,
`cost = 0.0001582`, tokens `input 315,338`, `output 24,404`, `cache_read 272,672`,
`cache_write 0`. It belongs to another project (`assets`), and the model is not present in
`DEFAULT_PRICING_MODELS`.

This project has **zero** priced sessions, so every project row stays `source: "default"` and
`cost_unpriced`. Catalog-derived cache weights and the 20% reconciliation warning remain deferred
here; adding the NVIDIA model to the catalog would need a price source before it can be trusted.

## Correction (2026-11-07, live ledger)

The live host's ledger disproved the assumption that `session.list` is project-scoped: its first
backfill copied **24 sessions from the whole v2 lane**, of which 23 carry usage (9 roots, 14
children). The primary distribution is therefore the whole-lane one, not the project subset:

| Group | n | billable p50 | p90 | p99 | p99 x 1.5 |
| --- | --- | --- | --- | --- | --- |
| Lane roots | 9 | 1,896,313 | 22,292,966.6 | 22,292,966.6 | 33,439,449.9 |
| Lane children | 14 | 305,277.8 | 582,082.6 | 679,631 | 1,019,446.5 |

The project-only rows above stay as a secondary view; the 300k falsification result is unchanged
(the lane maximum is also 22.29M). Because the backfill is lane-wide, the one priced session
(`nvidia/meta/llama-3.2-90b-vision-instruct`) does enter the ledger, but the model is still absent
from `DEFAULT_PRICING_MODELS`, so every derived weight remains `source: "default"` and the 20%
reconciliation cannot run on it.

Evidence: `docs/experiments/receipts/2026-11-07-p2-live-window-state.md`.

## Reproduce

```
bun docs/experiments/receipts/2026-11-07-p2-history-calibration.ts
```

The script prints the source path, the temp copy path, the population table, the four
distributions, the priced rows with a catalog-coverage flag, and the 300k test.
