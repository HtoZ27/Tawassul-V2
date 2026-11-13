# P4 context-pressure calibration

- Date: 2026-11-13T12:00Z
- Verdict: the 70/85/95 thresholds and the 12,000-character cap are calibrated against the
  completed window. The measured distribution confirms both, so no value changes.
- Base revision: `e6bff64`
- Runtime: Bun 1.3.14 on Linux x64
- Script: `docs/experiments/receipts/2026-11-13-p4-context-calibration.ts`
- Command: `bun docs/experiments/receipts/2026-11-13-p4-context-calibration.ts`

## Method

The script reads the live ledger at `~/.local/share/tawassul-v2/usage-ledger.jsonl` and collects
the session IDs that carry usage rows. It then opens the host database read-only (`OPENCODE_DB`, or
the default v2 lane database) and reads the assistant messages of those sessions. For each message
it computes the same measured total the hook uses, `input + output + reasoning + cache.read +
cache.write`, resolves the model window with `resolveMaxContextTokens`, and takes the maximum fill
per session. A tool output is a non-task tool part in a message at or above 70% fill; its length is
the sum of its text parts. Percentiles use the ledger's own rank rule.

The window is complete: 79 sessions carry assistant tokens, above the 30-session floor. The host
database only holds the messages of the current lane, so the sample is the sessions that share this
database, not all 218 ledger sessions.

## Session fill

| Reading | p50 | p75 | p85 | p90 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Session max fill | 25.41% | 82.43% | 86.46% | 90.13% | 100.00% | 100.00% |

Sessions at or above 70% / 85% / 95%: 21 / 17 / 4 of 79.

The distribution is bimodal. Short sessions sit under 25%; long sessions form a cluster above 82%.
The 70% threshold falls in the gap between p70 (65.47%) and p75 (82.43%), and 85% and 95% sit at
p84 and p95. The three thresholds are the boundary of the long cluster, not arbitrary values.

## Deferral cap

| Reading | p90 | p99 | max |
| --- | ---: | ---: | ---: |
| High-context tool output (chars) | 3,638 | 13,011 | 51,512 |

High-context outputs: 6,130. Above 12,000 chars: 77 (1.26%). The 1.5x reading is 19,517 chars.

## Decision

- The 70/85/95 thresholds stay. They map to p73 / p79 / p95 of session max fill and separate the
  long cluster from the rest of the window.
- The 12,000-character cap stays. It sits just below the p99 of high-context outputs (13,011) and
  truncates 77 of 6,130 outputs, the extreme tail. Deferral is not data loss: the full output is
  written to a pointer and a bounded summary is injected, so the 1.5x rule's "do not punish a
  legitimate session" concern does not apply the same way it does to a hard budget.
- The 1.5x rule is not applied to the percentage thresholds. The window is bounded at 100%, so
  1.5 x p99 = 150% would disable the nudge entirely. The 1.5x reading for the cap, 19,517 chars, is
  recorded here but not adopted: it would weaken the burn control at the 70% boundary without
  preventing data loss.

`npm run gate:fast` and `scripts/prove-context-pressure.ts` remain the integration receipts; this
calibration changes no constant, so the proof's 82 assertions are unchanged.
