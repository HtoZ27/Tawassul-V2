# P2 echo length and context-window default

- Date: 2026-11-07 (UTC)
- Verdict: **applied and proven.** The echo detector counts a turn only when its trimmed text
  reaches 200 characters, and the context window now trusts a host declaration verbatim, fills from
  the catalog only when the host is silent, and falls back to 200k instead of 128k.
- Base revision: `92a1a3d` plus the working-tree change set described here.
- Runtime: Bun 1.3.14, Node 24.3.0, Linux x64.
- Receipt script: `docs/experiments/receipts/2026-11-07-p2-echo-length-window.ts`.
- Command: `bun docs/experiments/receipts/2026-11-07-p2-echo-length-window.ts`
- Gate: `npm run verify` passed (`GATE PASS: fast (16 step(s), 19174ms)` plus the build);
  `npm run ci` passed (`GATE PASS: fast + proofs + smoke`, 179 proof steps in 397658 ms and
  6 smoke steps in 191902 ms).

## Echo readings

| Case | Turns | Result |
| --- | --- | --- |
| identical `ok` replies | 40 | 0 rows |
| exactly 200 characters | 12 | 1 trip at turn 12, `chars=200`, `minChars=200` |
| 199 characters | 30 | 0 rows |
| 11 long, one short, 11 long | 23 | 0 rows; the short turn breaks the run |
| the same run plus one long turn | 24 | 1 trip at the twelfth long turn after the break |
| 11 long, one short tool turn, 12 long | 24 | 1 trip; the tool reset happens before the length check |

The check sits in `flushEcho` after the `hadTool` branch and after the empty-normalized skip:
a short turn clears the streak and the comparison text, so only a consecutive run of eligible
turns can trip. The trip detail carries the text length and the minimum.

## Window readings

| Input | Result | Why |
| --- | --- | --- |
| no host, no catalog | 200000 | labelled default |
| host 96k | 96000 | host verbatim |
| host 200k | 200000 | host verbatim |
| host 1M | 1000000 | no upper clamp |
| host 12M | 12000000 | no upper clamp |
| host 1999 | 200000 | below the 2,000 sanity floor |
| host 2000 | 2000 | floor is inclusive |
| host 2500.7 | 2500 | fractional value is floored |
| host `"200000"` or `-1` | 200000 | not a usable declaration |
| catalog `deepseek-chat` | 64000 | catalog fills a silent host |
| catalog 200k entry, host 1M | 1000000 | host wins over the catalog |
| reserve at 200k | 50000 | `min(max(16k, W/4), W/2)` |

The regression the clamp caused is explicit in the proof: `computeBudget(128000, 100000)`
overflows, while `computeBudget(1000000, 100000)` fits.

## Collateral proof update

`scripts/prove-thread-tool.ts` used two 50k messages (100k of history) to force a transfer. That
fixture overflowed a 128k window (`reserve 32k`, negative room) but fits a 200k window
(`reserve 50k`, 50k of room), so the proof failed with the new default until the fixture was raised
to two 90k messages (180k of history). The proof now passes and still asserts one successor, one
prompt, and an unmutated source. This is evidence that the default actually changed, not only that
the constant moved.

## Files

- `src/services/usage-shadow.ts`: `SHADOW_ECHO_MIN_CHARS`, `echoMinChars`, the length boundary,
  and `chars`/`minChars` in the trip detail.
- `src/services/context-pack/types.ts`: `WINDOW_SANITY_FLOOR = 2000`,
  `DEFAULT_CONTEXT_WINDOW = 200000`; `MIN_TRUSTED_WINDOW` removed.
- `src/services/context-pack/accounting.ts`: host verbatim, catalog filler, 200k default, no
  `Math.min(host, priced)`, default reserve.
- `src/hooks/message-updated.ts`: `DEFAULT_CONTEXT_MAX_TOKENS = 200000`.
- `scripts/prove-context-budget.ts`, `scripts/prove-usage-shadow.ts`, `scripts/prove-thread-tool.ts`.
- `docs/plan-token-burn-control.md` (Revision 2.4), `docs/portable-context-handoff.md`,
  `docs/UPSTREAM-EVAL-2.2.3-2.2.5.md`.

## Not changed

The 50k tool-output cap, the absence of a static price registry, shadow-only enforcement, the P2
window, the D12 warn-first policy, and the Option 8 rejection.
