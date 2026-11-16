# Wave 3 closeout — snapshot boundary and reachability audit

- Date: 2026-11-01
- Host: OpenCode 2.2.5
- Build under test: HEAD `f17ac0c` plus the closeout tree; `npm run verify` rebuilt `dist/index.js` and `dist/global.js` at content SHA `430df854600e`
- Runtime: bun 1.3.14
- Scope: the two Wave 3 items that were named in the plan but had no proof, item 4 (snapshot boundary) and item 7 (W2 reachability audit). No other Wave 3 item is reopened.

## Why this receipt exists

Section 5 of the working register named `prove-snapshot-boundary` and `prove-reachability-audit` as Wave 3 proofs, and section 9 item 2 requires every named proof to exist. Neither proof existed, so the Wave 3 closure recorded earlier did not cover two of its own items. This closeout either builds them or records them as withdrawn. Both are now built.

## Item 4 — snapshot boundary

The action was already in place: `maybeAutoCapture` returns before any capture work unless `TAWASSUL_CODE_STATE_AUTO` is exactly `"1"`. The proof now pins that behaviour instead of asserting it in prose.

Method: a throwaway git repository under a temp root, `TAWASSUL_CACHE_DIR` redirected so snapshots land in the temp root, and one child process per case. Each case mutates a tracked file and calls `maybeAutoCapture`, then waits past the 500 ms debounce.

| Case | Result |
| --- | --- |
| switch unset | 0 snapshots |
| switch `0` | 0 snapshots |
| switch `1`, tool `read` | 0 snapshots |
| switch `1`, failed run | 0 snapshots |
| switch `1`, `edit` succeeds | 1 snapshot, label `auto:edit` |
| switch `1`, two mutations 100 ms apart | 1 snapshot, label `auto:write` |

The double-capture risk is therefore closed at the source: the native undo never runs against an automatic snapshot unless the operator opted in, and two rapid mutations collapse into one capture. Proof result: 8 assertions.

## Item 7 — W2 reachability audit

Method: a transitive static import graph from `src/index.ts` over every `.ts` file under `src/`, with `.js` specifiers mapped to `.ts`, directory indexes resolved, dynamic `import()` calls counted, and every relative specifier required to resolve.

| Measure | Value |
| --- | --- |
| Source files | 358 |
| Reachable files | 342 |
| Non-blank source lines | 60,231 |
| Reachable lines | 58,697 |
| Reachable share | 97.45 percent of lines, 95.53 percent of files |
| Dynamic import calls | 116 |

The finding is the point of the audit: a normal session reaches almost the whole tree, 97.45 percent of lines. W2 (the 65k LOC maintenance surface) therefore cannot be deferred on the theory that a small hot path carries production behaviour. The deferral stands, but it is now a measured decision: the whole tree is the surface, and shrinking it is a separate programme rather than a by-product of repair.

The measurement is recorded at `docs/experiments/baselines/2026-11-01-reachability.json`. The proof recomputes it on every run and fails when a relative import stops resolving, when the reachable share drops below 90 percent, or when the recorded artifact drifts by more than two points. Proof result: 13 assertions.

## Gates

- `npm run gate:fast`: PASS, 10 steps, 16.2 s, 156 proof files and 153 manifest steps.
- `npm run gate:proofs`: PASS, 153 steps, 301,221 ms.
- `npm run verify`: PASS, plus the build at content SHA `430df854600e`.
- `npm run gate:evals`: unchanged from the Wave 4 receipt.

## Resources

- Memory floor checked before the heavy stages: 3.8 GB available against the 1.5 GB floor.
- Heavy stages ran sequentially: `gate:fast`, `gate:proofs`, `verify`.
- Every temp root was removed by the proof's own `finally` block.
