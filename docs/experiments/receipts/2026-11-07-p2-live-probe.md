# P2 live host probe — real usage rows and a real repeat trip

- Date: 2026-11-07 (UTC)
- Verdict: **pass, 3 consecutive runs.** The built plugin, running inside an isolated OpenCode
  host, wrote real `usage` rows and a real `repeat` shadow trip while serving five identical shell
  calls. The event source is now proven end to end, not only in-process.
- Base revision: `745c885`.
- Runtime: OpenCode 2.2.5 desktop CLI (audited 2.2.1), Bun 1.3.14, Linux x64.
- Model: `opencode/big-pickle` (`cost 0`, so every row is `cost_unpriced`).
- Script: `docs/experiments/receipts/2026-11-07-p2-live-probe.ts`.
- Command: `bun docs/experiments/receipts/2026-11-07-p2-live-probe.ts`

## Isolation

The probe creates a fresh `mkdtemp` root and points the host at it: `HOME`, `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OPENCODE_DB`, `TAWASSUL_HMAC_KEY_DIR`,
`TAWASSUL_V2_STATE_DIR`, `TAWASSUL_LOG_FILE`, `TAWASSUL_N2_LOG`, and `TAWASSUL_USAGE_LEDGER`. The
workspace gets its own `opencode.json`, a copy of `.opencode/plugins/tawassul.js`, and a symlink to
`.opencode/node_modules`. The host runs `--standalone` with `TAWASSUL_WATCHER=off` and
`TAWASSUL_REGISTER_TRIGGERS=off`. The root is deleted in `finally`.

Prerequisite: a built `.opencode/plugins/tawassul.js` (`npm run verify` builds it).

## Prompt

> Use the shell tool five separate times. Each call must run exactly `printf p2-live`. Do not loop,
> do not combine them, and make one tool call per step. After the fifth call, reply exactly:
> `LIVE-DONE`

## Results

| Run | Exit | Rows | Usage | Shadow | No-agent | Repeat trip | Final reply |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0 | 8 | 6 | 2 | 0 | count 5, `tripped: true` | `LIVE-DONE` |
| 2 | 0 | 8 | 6 | 2 | 0 | count 5, `tripped: true` | `LIVE-DONE` |
| 3 (repo-relative script) | 0 | 8 | 6 | 2 | 0 | count 5, `tripped: true` | `LIVE-DONE` |

Run 1 readings, straight from the JSONL:

| Turn | Raw input | Delta input | Delta output | Delta cache read | Billable delta | Context size |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 258 | 258 | 9 | 256 | 292.6 | 514 |
| 2 | 6,378 | 6,120 | 42 | 1,792 | 6,341.2 | 8,426 |
| 3 | 22,533 | 16,155 | 42 | 1,792 | 16,376.2 | 26,373 |
| 4 | 22,745 | 212 | 42 | 17,792 | 2,033.2 | 44,377 |
| 5 | 23,066 | 321 | 42 | 17,792 | 2,142.2 | 62,490 |
| 6 | 23,404 | 338 | 42 | 17,920 | 2,172 | 80,748 |

The turn-2 delta (`6120/42/69/1792`) is byte-identical to the host's own `step_finish` token
payload for that step, which proves the ledger prices the event stream rather than a re-estimate.
`delta.reasoning` stays inside `output`; `contextSize = input + cache.read`.

## Shadow reading

The two shadow rows are the balanced pair:

```json
{"kind":"shadow","detector":"repeat","tripped":false,"count":3,"detail":{"tool":"bash","agentMissing":false,"blockedByCurrentGuard":false}}
{"kind":"shadow","detector":"repeat","tripped":true,"count":5,"detail":{"tool":"bash","agentMissing":false,"blockedByCurrentGuard":false}}
```

Call three shows the plugin's own loop guard reacting to the repetition: the shell output carries
`[tawassul] loop guard: "bash" returned an identical result 3 times ...`. The model ignored the
advisory and made calls four and five anyway, and the shadow detector recorded the trip. That is the
intended split: the loop guard is the existing enforcement, the shadow row is the new read-only
measurement.

`noagent` is zero because this host path populates `input.agent` (consistent with Probe 0 Q7), so
the D12 record path did not fire in this run; its policy decision remains open.

## Limits

- One root session, one model, no child dispatch, no handoff chain.
- The rows are `cost_unpriced` by construction, so this proves weights and deltas, not catalog cost.
- Three runs are a smoke proof, not the 7-day or 30-session P2 window; the gate stays open.
- The probe asserts row shape, session identity, units and the repeat trip. It does not assert
  p50/p90/p99, which need many more sessions.
