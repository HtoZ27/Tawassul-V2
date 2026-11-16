# Wave 4 — behavioral gate

- Date: 2026-11-01
- Host: OpenCode 2.2.5
- Build under test: HEAD `8a8b89e` plus the Wave 4 gate tree; `npm run verify` rebuilt `dist/index.js` and `dist/global.js` at content SHA `acf8cb8d4c91`
- Runtime: bun 1.3.14
- Scope: E5 decision, dispatch payload join key, the three behavior probes, and the `gate:evals` stage. Wave 4 closes with this receipt.

## Delivered

| Item | State | Evidence |
| --- | --- | --- |
| E5 budget and model pair | closed | `2026-11-01-e5-eval-budget.md`, D5: 90 s / 256 MB, no retries |
| Dispatch payload join key | done | `sessionId` and the dispatch `turn` on every handoff created by the tool; `ToolRunLog.currentTurn` reads the last recorded turn per session |
| `prove-review-independence-retro` | registered, 19 assertions | joins the first reviewer run at or after the dispatch turn, flags an implementer-model run, reads a missing run as unknown, and rejects `agentModelMap` |
| `prove-skill-load-rate` | registered, 27 assertions | goal-review 1/1, handoff-triage 1/2, context-continue 1/1 against a 0.5 threshold each |
| `prove-skill-discovery` | registered, 32 assertions | manifest ids, names, descriptions, staged paths and bodies; no write under a workspace skills directory; boot log names the shipped ids |
| `gate:evals` stage | done | `evals` stage in `scripts/gate-manifest.json`, `scripts/run-pilot-evals.ts` as the single entry, `scripts/gate-budgets.json` with the D5 budget, enforced by `scripts/gate.ts` |
| Budget assertions | done | `prove-proof-catalog` pins the stage, the entry point, the 90 s / 256 MB budget, and asserts `ci` and `gate` stay eval-free; `prove-gate-budget` proves a passing stage, a wall breach, an RSS breach and an unmeasured budget |
| `prove-gate-budget` | registered, 9 assertions | a stage inside budget passes, 1 ms wall fails, 1 MB RSS fails, and a stage with no RSS budget reports no peak |
| REPAIR document | done | `docs/REPAIR.md` |

## Eval stage

The stage runs one fixture in one child process: `scripts/run-pilot-evals.ts` executes `scripts/prove-pilot-eval.ts` and requires its full 71-assertion result. The eval runner is deliberately not a `prove-` file, so the catalog invariant "each proof file is wired into exactly one gate step" still holds.

```
GATE evals: 1 step(s), budget 90000ms / 256MB
EVAL PASS: pilot fixture, 71 assertions, 141ms
PASS eval-pilot
GATE BUDGET: evals peak RSS 71MB of 256MB
GATE PASS: evals (1 step(s), 179ms)
```

Measured against the D5 budget: 179 ms of 90,000 ms wall and 71 MB of 256 MB peak RSS, with no retry.

Separation: `ci` and `gate` run `fast + proofs + smoke` only. `gate:evals` is a release-path stage, matching the E5 decision, and `prove-proof-catalog` fails if either umbrella starts including it.

## Gate result

- `npm run gate:fast`: PASS, 10 steps, 15.8 s, 154 proof files and 151 manifest steps.
- `npm run gate:proofs`: PASS, 151 steps, 290,795 ms.
- `npm run verify`: PASS, plus the build at content SHA `acf8cb8d4c91`.
- `npm run gate:evals`: PASS, 1 step, 179 ms, peak RSS 71 MB.

## Resources

- Memory floor checked before the heavy stages: 3.9 GB available against the 1.5 GB floor.
- Heavy stages ran sequentially: `gate:fast`, `gate:proofs`, `verify`, `gate:evals`.
- Scratch under `/tmp/opencode` and the per-step RSS probe file were removed after each run.

## Flake tracking

Three consecutive runs of the fixture during this wave all returned 71 assertions with identical output, at 141–179 ms. No flake was observed, and the stage has no retry by design, so a flake fails the release path and is recorded here rather than retried away.

## Remaining outside Wave 4

- Real global install, distribution and release verification: the release track. D4 keeps project scope as the default and defers any live install.
- New skills: each needs its own manifest row, eval id and receipt before it ships.
