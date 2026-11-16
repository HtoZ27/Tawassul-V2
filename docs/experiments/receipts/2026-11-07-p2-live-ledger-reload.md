# P2 live ledger reload — the shipped parser reads the real file

- Date: 2026-11-07T04:07Z
- Verdict: **pass.** A copy of the live ledger reloads through `UsageLedger.start()` and reproduces
  the independent read: same sessions, same root/child percentiles, same injection bytes.
- Base revision: `dbdb2ba`.
- Runtime: Bun 1.3.14 on Linux x64.
- Script: `docs/experiments/receipts/2026-11-07-p2-live-ledger-reload.ts`.
- Command: `bun docs/experiments/receipts/2026-11-07-p2-live-ledger-reload.ts`

## Method

The live file `~/.local/share/tawassul-v2/usage-ledger.jsonl` and its `.1` rotation (when present)
are copied into a fresh `mkdtemp` directory. Only the copy is opened: `UsageLedger.start()` parses
it, `summary()` is printed as JSON, `dispose()` runs, and the directory is removed in `finally`.
The live host keeps writing to the original throughout; the source is never opened for writing.

## Readings at 2026-11-07T04:06-04:07Z

| Field | Value |
| --- | --- |
| Rows | 312 (was 299 at 03:26Z) |
| `usage` rows | 306 |
| `injection` rows | 6 |
| Injection bytes | 17,942 |
| `shadow` rows | 0 |
| `noagent` rows | 0 |
| Sessions | 23 |
| Roots / children | 9 / 14 |
| Lineage unknown | 0 |
| Priced / unpriced sessions | 1 / 22 |
| Unit | `mixed` |
| Root p50 / p90 / p99 | 1,896,313 / 22,292,966.6 / 22,292,966.6 |
| Child p50 / p90 / p99 | 305,277.8 / 582,082.6 / 679,631 |
| Last event | 2026-11-07T04:06:20.936Z |

The row count moves because the live host appends on every usage event; the distribution is stable
because it is computed from the latest cumulative snapshot per session.

## What this proves

| Path | Covered by the real file |
| --- | --- |
| Backfill rows | 24 rows with `source: "session.list"` |
| Live rows | 282 rows with `source: "event"` at the time of the check |
| Injection audit | 6 rows, three sources, two boots |
| Boot gap | the `unobserved` row at turn 119 of the live session |
| Priced row | one backfilled session with `costUnpriced: false` and `unit: "mixed"` |
| Rotation | `.1` is read first when it exists |

The summary matches the independent Python aggregation recorded in
`2026-11-07-p2-live-window-state.md` for sessions, roots, children, percentiles, and injection
bytes, so the parser and the arithmetic agree on real data.

## Limits

- This is a reload of a snapshot, not a restart of the host; the host's own reload path is covered
  by the gate proof and by the boot-gap row above.
- The file is live, so the exact row count changes between runs; the script prints the current
  numbers rather than pinning them.
- The priced session is backfilled history from another project and its model is outside the
  pricing catalog, so the row still carries `weights.source: "default"`.
