# P2 live window state — the real host is collecting

- Date: 2026-11-07T03:26Z
- Verdict: **collecting, gate open.** The ledger built from `745c885` is live in the desktop host and
  has written 299 rows to the real ledger. The forward sample is one session and 6.66 hours old, so
  the 7-day / 30-session gate is not met.
- Base revision: `5cba023`.
- Runtime: OpenCode desktop CLI 2.2.6, Bun on Linux x64.
- Ledger: `~/.local/share/tawassul-v2/usage-ledger.jsonl`, 168,767 bytes.
- Host refresh check: `npm run host:refresh -- --verify-only` reports `OK mode=verify
  init=2026-11-07T03:25:06.006Z entry=2026-11-07T03:15:18Z`.

## Rows

| Reading | Value |
| --- | --- |
| Total rows | 299 |
| `usage` rows | 293 (269 `event`, 24 `session.list`) |
| `injection` rows | 6, 17,942 bytes |
| `shadow` rows | 0 |
| `noagent` rows | 0 |
| First row | 2026-11-06T20:47:01.363Z |
| Last row | 2026-11-07T03:25:48.074Z |
| Window span | 6.66 hours |

## Sessions

| Reading | Value |
| --- | --- |
| Sessions with usage | 23 |
| Roots / children | 9 / 14 |
| Lineage unknown | 0 |
| Sessions with live events | 1 (this conversation) |
| Backfilled sessions | 23 |
| Priced / unpriced rows | 1 / 292 |
| Weight source | `default` on all 293 |
| `resync` rows | 0 |
| `unobserved` rows | 1 |

This conversation alone accounts for 271 of the 293 usage rows, up to turn 270 and
`contextSize = 88,701,329`, which shows the event path and the delta math working on a long,
live session.

## Percentiles (cumulative session totals)

| Group | n | billable p50 | p90 | p99 |
| --- | --- | --- | --- | --- |
| Roots | 9 | 463,811.8 | 22,292,966.6 | 22,292,966.6 |
| Children | 14 | 305,277.8 | 582,082.6 | 679,631 |

The root p90 and p99 both equal the maximum because nine samples put the nearest-rank p90 at the
top index. The numbers agree with the history calibration receipt; the extra root in that receipt
(10 vs 9) was a zero-usage session that the ledger correctly skips.

## Injection audit (real bytes)

| Boot | `digest` | `context` | `session_index` | Total |
| --- | --- | --- | --- | --- |
| 2026-11-06T21:12:49Z | 196 B | 1,841 B | 6,934 B | 8,971 B |
| 2026-11-07T02:22:07Z | 196 B | 1,841 B | 6,934 B | 8,971 B |

Two boots, six rows, 17,942 bytes. The three sources are separately recorded, so the injection
share of the context is auditable per source rather than as one lump.

## Boot gap

One real gap row was written at turn 119 of this session: cumulative input 3,076,480, cache read
69,337,664, delta `input 440`, `output 101`, `cacheRead 140,416`, `billable 14,582.6`. It is
labelled `unobserved`, which is the designed behaviour when a list snapshot is ahead of the
persisted counter after a restart.

## Priced row

The backfill copied one priced session from another project:
`nvidia/meta/llama-3.2-90b-vision-instruct`, `cost = 0.0001582`, `billable = 367,009.2`, priced row
`costUnpriced: false`. The model is absent from `DEFAULT_PRICING_MODELS`, so the row still carries
`weights.source: "default"`; catalog weights and the 20% reconciliation remain deferred.

## Gate readings

| Criterion | Reading | Verdict |
| --- | --- | --- |
| 7 days | 6.66 hours | not met |
| 30 sessions in the forward sample | 1 live session | not met |
| 30 sessions including backfill | 23 | not met |
| Report command | `health` block implemented and proven | met |
| Shadow readings exist | isolated live probe tripped `repeat`; no real trip yet | partially met |

The window clock starts at 2026-11-06T20:47:01Z, so it completes at the earliest on
2026-11-13T20:47:01Z. The session floor is the binding constraint for the forward sample: the host
has produced one live session since the ledger started.

## Limits

- The 1 priced row comes from history, not the forward window.
- Zero shadow rows in real use; the detector proof is the isolated live probe, not this ledger.
- The ledger only sees what the desktop host emits; sessions served by another host or another
  database lane are not in this file.
