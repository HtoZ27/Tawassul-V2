# Echo threshold replay: keep 200 and fix the tool-only reset

- Date: 2026-11-07 (UTC)
- Verdict: **keep 200 characters.** Across 31 real sessions and 6,038 assistant messages,
  no threshold from 1 to 200 characters produced a single echo trip. The 200-character floor is
  not what suppresses the detector; the twelve-consecutive-similar-tool-free-turn shape is absent.
  The replay did find one real defect: a tool-only assistant message never reset the streak. It is
  fixed and proven.
- Base revision: `c9a792d` plus the change set described here.
- DB snapshot: `/tmp/opencode/echo-exp.C4MO/live.db`, a read-only copy of the live database
  (153,464,832 bytes, 2026-11-07 11:09).
- Script: `docs/experiments/receipts/2026-11-07-p2-echo-replay.ts`.
- Command: `TAWASSUL_ECHO_DB=/tmp/opencode/echo-exp.C4MO/live.db bun docs/experiments/receipts/2026-11-07-p2-echo-replay.ts`

## Method

The script copies the snapshot into a fresh `mkdtemp` directory and opens only the copy, read-only.
For every assistant message in the project it takes the last non-blank text part, because the
detector's `pending` map keeps the last `session.text.ended` text per message, and records
`chars = text.trim().length` and whether the message has any tool part.

Two reset models are replayed:

- `current`: the shipped pre-fix behavior, where a tool-only message is skipped and does not reset.
- `fixed`: a tool-only message resets the streak, as the plan's Q15 decision requires.

Thresholds 1, 40, 80, 120, and 200 characters are compared with the shipped trip length (12) and
overlap (0.8). The model is also checked against the shipped `UsageShadow` class for the fixed
variants, so the replay is not only a second implementation of the same rules.

## Results

| Variant | Tripped sessions | Trips | Near-miss (6-11) |
| --- | --- | --- | --- |
| current-200 | 0 | 0 | 0 |
| fixed-200 | 0 | 0 | 0 |
| fixed-120 | 0 | 0 | 0 |
| fixed-80 | 0 | 0 | 0 |
| fixed-40 | 0 | 0 | 0 |
| current-80 | 0 | 0 | 0 |
| fixed-1 | 0 | 0 | 0 |
| current-1 | 0 | 0 | 0 |

The model and the shipped detector agree at every fixed threshold:

```
chars=200 model=0 shipped=0 match
chars=120 model=0 shipped=0 match
chars=80 model=0 shipped=0 match
chars=40 model=0 shipped=0 match
chars=1 model=0 shipped=0 match
```

Session shape at the top of the history:

| Session | Assistant messages | Text messages | Tool-only | Text-only at 200+ chars | Best streak |
| --- | --- | --- | --- | --- | --- |
| `ses_e50c38b2ef...` | 2,580 | 378 | 2,187 | 96 | 1 |
| `ses_e58bb996af...` | 2,176 | 187 | 1,984 | 39 | 1 |
| `ses_e5a512321f...` | 561 | 51 | 509 | 21 | 1 |

Every session has a best streak of 1 at every threshold, including 1 character. The shape the
detector wants does not occur in this history, so lowering the floor cannot recover a detection
that the floor is blocking.

### Why the 1.0 pairs are not echo

There are 687 consecutive text pairs. The maximum similarity is 1.0, but the pair is the 14-character
text `"\n\n<|DSML| calls>\n"` repeated in `ses_e50c38b2ef...`: 57 messages carry that text, and 56
of them also carry a tool part. The detector's `hadTool` branch resets the streak for a tool-bearing
message, so these pairs never form a run. The one message with that text and no tool part is a single
3,171-character response, not a loop.

The meaningful comparison is the 69 consecutive **text-only** pairs. Their maximum similarity is
**0.0846** (a 671-character report against a 1,083-character report). That is far below 0.8. The
echo detector is not failing because its floor is high; it is failing because the project history
contains no repeated tool-free text.

## Cost reading

The reply length is not a cost proxy. In `ses_e50c38b2ef...`, the first cumulative ledger snapshot
is 56,993,529 context tokens; the next turns re-read 123,842, 127,753, 128,533, 129,533, and 131,413
tokens (`delta.input + delta.cacheRead`). A twelve-turn short loop at roughly 124k tokens per turn
would re-read about 1.49M tokens, while a 200-character reply is roughly 50 tokens. The floor is a
false-positive control, not a cost measure.

## Decision

1. **Keep `SHADOW_ECHO_MIN_CHARS = 200`.** Lowering it to 40, 80, or 120 changes no observed result;
   it only increases the future false-positive surface for short acknowledgements.
2. **Fix the tool-only reset.** `session.tool.called` now clears the streak, the comparison text, and
   the tripped flag immediately. A tool-only message is a tool turn, and Q15 says a tool turn resets
   the run. The old path could only inflate a streak.
3. **Do not add near-miss rows.** The maximum observed streak is 1, so a six-to-eleven instrument
   would be empty in this history. The replay script is the cheaper forward probe: rerun it on the
   next snapshot instead of storing a row per session.
4. **Do not add an `echo-short` detector now.** The only short repeats in the history are tool-bearing
   parser artifacts; the Q15 rule resets them, and a cost-conditioned detector would need a different
   signature. Revisit only if a forward replay shows a short text-only run or a high-context session
   with repeated short text.
5. **Keep the detector shadow-only.** The P2 gate and its 30-session window are unchanged.

## Proof

`scripts/prove-usage-shadow.ts` is now 97 assertions. The new case sends eleven long tool-free turns,
one tool-only message with no text event, and eleven more long turns; the pre-fix code tripped on the
first turn after the tool-only message, and the fixed code stays at zero until the twelfth turn of the
fresh run:

- `a tool-only message breaks the streak without adding a text turn`
- `a fresh run after a tool-only message trips`

Gate:

- `npm run verify`: `GATE PASS: fast (16 step(s), 18722ms)` plus the build.
- `npm run ci`: `GATE PASS: fast + proofs + smoke`; fast 24,133 ms, 179 proof steps in 391,245 ms,
  6 smoke steps in 336,651 ms.

## Files

- `src/services/usage-shadow.ts`: the tool-only reset.
- `scripts/prove-usage-shadow.ts`: 97 assertions.
- `docs/experiments/receipts/2026-11-07-p2-echo-replay.ts`: the replay.
- `docs/plan-token-burn-control.md`: Revision 2.5, Section 19.
- `docs/experiments/receipts/2026-11-07-p2-echo-threshold-replay.md`: this receipt.
