# Wave 4 — behavioral gate (partial)

- Date: 2026-11-01
- Host: OpenCode 2.2.5
- Build under test: HEAD `d6bd9c8` plus the Wave 4 tree; `npm run verify` rebuilt `dist/index.js` and `dist/global.js` at content SHA `0f57573aa07a`
- Runtime: bun 1.3.14
- Scope: E5 decision, dispatch payload join key, and the three behavior probes. The `gate:evals` stage itself is not written yet.

## Delivered

| Item | State | Evidence |
| --- | --- | --- |
| E5 budget and model pair | closed | `2026-11-01-e5-eval-budget.md`, D5 |
| Dispatch payload join key | done | `sessionId` and the dispatch `turn` on every handoff created by the tool; `ToolRunLog.currentTurn` reads the last recorded turn per session |
| `prove-review-independence-retro` | registered, 19 assertions | joins the first reviewer run at or after the dispatch turn, flags an implementer-model run, reads a missing run as unknown, and rejects `agentModelMap` |
| `prove-skill-load-rate` | registered, 27 assertions | goal-review 1/1, handoff-triage 1/2, context-continue 1/1 against a 0.5 threshold each |
| `prove-skill-discovery` | registered, 30 assertions | manifest ids, names, descriptions, staged paths and bodies; no write under a workspace skills directory |
| REPAIR document | done | `docs/REPAIR.md` |

## Gate result

- `npm run gate:fast`: PASS, 10 steps, 16.4 s, 153 proof files and 150 manifest steps.
- `npm run gate:proofs`: PASS, 150 steps, 296,155 ms.
- `npm run verify`: PASS, 16.4 s plus the build at content SHA `0f57573aa07a`.

## Not done

- The separate `gate:evals` stage with enforced 90 s / 256 MB budget, flake tracking and squash policy. E5 fixed the numbers; the stage and its budget assertion remain.
- Per-skill evals beyond the three pilot rows. All three manifest skills already have a passing eval and a receipt, so no row is open; any new skill still needs its own row before shipping.

## Next

1. Add the `evals` stage to `scripts/gate-manifest.json` with the D5 budget, wire `gate:evals` in `package.json`, and assert the budget in a proof.
2. Re-run `gate:fast` and the three stage shards after the stage lands.
