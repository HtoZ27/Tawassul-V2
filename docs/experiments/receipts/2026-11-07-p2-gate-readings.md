# P2 decision gate — readings from the real ledger

- Date: 2026-11-07T04:26Z
- Verdict: **three of the six gate readings are settled with real data; three still need the
  forward window.** Nothing in this receipt enforces anything: the ledger and the detectors remain
  shadow-only.
- Base revision: `b4a0680`.
- Runtime: Bun 1.3.14 on Linux x64.
- Script: `docs/experiments/receipts/2026-11-07-p2-gate-readings.ts`.
- Command: `bun docs/experiments/receipts/2026-11-07-p2-gate-readings.ts`

## Method

The live file `~/.local/share/tawassul-v2/usage-ledger.jsonl` and its `.1` rotation are copied into
a fresh `mkdtemp` directory; only the copy is parsed. The script runs the shipped
`UsageLedger.start()`/`summary()` and, over the same copied rows, takes the latest cumulative
snapshot per session to compute the cache-read share. The directory is removed in `finally`.

Cache-read share per session is `cache.read / (input + cache.read)`, which is exactly the ledger's
`contextSize` denominator. Both a session median and a token-weighted total are printed, because
the gate does not define which aggregate to use.

## Gate table

| Reading | Threshold | Measured | Verdict |
| --- | --- | --- | --- |
| `p99(root)` | < 300k weighted tokens cancels P5 | 22,292,966.6 | does not fire; P5 stays |
| echo-flagged sessions | < 2 in 30 sessions keeps the echo detector shadow-only | 0 flagged, but only 1 forward session | not decidable yet |
| repeat false positives | > 5% of healthy sessions requires digest recalibration before P3 | 0 flagged; no false-positive denominator in one session | not decidable yet |
| cached schema share | > 90% keeps Option 11 as hygiene and uncounted | weighted 93.19%, session p50 89.94%, p90 95.89%, 11/23 sessions at or above 90% | fires on the weighted total; Option 11 stays hygiene |
| orphan rate (no `parentID`) | > 1% makes C4 unreliable and forces C3 | 0 orphans + 0 unknown lineage across 23 sessions = 0% | does not fire; lineage is usable on this sample |
| event loss during reload | > 5% makes the ledger estimate-only | 1 `unobserved` row in 326 usage rows = 0.31%; 0 `resync` rows | does not fire; the single boot gap is labelled |

## Readings in context

- 335 rows at 2026-11-07T04:25:57Z: 326 `usage`, 6 `injection`, 0 `shadow`, 0 `noagent`.
- 23 sessions: 9 roots, 14 children, 0 lineage unknown, 0 orphan children.
- Root billable p50/p90/p99: 1,896,313 / 22,292,966.6 / 22,292,966.6.
- Child billable p50/p90/p99: 305,277.8 / 582,082.6 / 679,631.
- Shadow counters: `repeatSessions` 0, `echoSessions` 0, `fanoutSessions` 0.
- One `unobserved` row, at turn 119 of the live session, and no `resync` row.

The cache-share split is the only borderline reading: the weighted total clears 90% because the
long live session dominates, while the session median sits at 89.94%. The gate should use the
weighted total, since the question is how much of the actual token spend is already served from
cache; the median is recorded so the choice is explicit rather than hidden.

## Live report (real host)

The plugin's own `health` tool, called in this session at 2026-11-07T05:25Z, printed:

```
## Usage ledger
- Sessions: 23 (roots 9 / children 14, orphans 0)
- Weighted tokens p50/p90/p99: root 1,896,313/22,292,967/22,292,967 · child 305,278/582,083/679,631
- Rows: 336 usage, 9 injection (26,913 B) · backfilled 0 · unobserved 1
- No-agent calls: 0
- Shadow: repeat 0 / echo 0 / fan-out 0 session(s), 0 row(s)
- Unit: mixed · priced 1 / unpriced 22 · cost_unpriced
- Ledger: ~/.local/share/tawassul-v2/usage-ledger.jsonl (last event 2026-11-07T05:25:25.376Z)
```

The block agrees with the script's independent aggregation. Two details are worth recording:

- The injection total grew from 17,942 B to 26,913 B because a third boot added another three
  rows (196 + 1,841 + 6,934), so the boot count is visible directly in the byte total.
- `backfilled 0` was the process-scoped counter: the reload had restored all 23 sessions, so this
  boot backfilled nothing new. `summary().backfilledSessions` now counts restored sessions whose
  history came from `session.list`, so the same file prints 23 after the next boot. The proof adds
  `reload restores the backfilled count` (five backfilled sessions survive a reload), which is why
  the ledger proof moved from 122 to 123 assertions.

## What still blocks the gate

Echo and repeat false positives are per-session shape readings, and the forward sample is one live
session (this conversation) on top of 23 backfilled sessions whose per-turn shape cannot be
reconstructed from the database. Those two rows stay open until 30 forward sessions or
2026-11-13T20:47:01Z, whichever comes first.

## Reproduce

```
bun docs/experiments/receipts/2026-11-07-p2-gate-readings.ts
```

The script prints the reading time, the row and session counts, the root p99, the cache-share
block, the `unobserved` ratio, and the three shadow counters. Counts drift between runs because
the host appends on every usage event; the script prints current values rather than pinned ones.
