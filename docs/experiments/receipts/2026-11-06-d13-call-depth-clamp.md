# D13 call-depth clamp — isolated proof

- Date: 2026-11-06 (UTC)
- Verdict: **pass.** The `maxCallDepth` request is clamped at the single wiring point to the
  host ceiling of 3, the depth guard and `checkCap` now agree for every allowed depth, and the
  loader logs the requested and effective values when a clamp occurs.
- Base revision: `f9f339a`.
- Runtime: Bun 1.3.14 on Linux x64; available memory 2,618 MB before the run.
- Proof: `scripts/prove-call-depth-clamp.ts`, 250 assertions, gate step `call-depth-clamp`.

## Change under proof

| File | Change |
| --- | --- |
| `src/hooks/guards/shared/limits.ts:15-20` | adds `HOST_CALL_DEPTH_CEILING = 3` and `resolveMaxCallDepth`; the setter is unchanged |
| `src/context/facades/config-facade.ts:61-70` | resolves the request, logs a clamp, and calls `setMaxCallDepth` once |
| `src/context/config-schema.ts:14-19` | documents the ceiling in the schema description |
| `tawassul.schema.json` | regenerated from the schema source |
| `docs/configuration.md` | states the ceiling and uses a value inside it in the example |

The resolver returns `undefined` for an absent, non-finite, zero, or negative request, so the
current ceiling is left untouched. A positive finite request is `min(requested, 3)`.

## Method

The proof runs in one isolated child process through the gate:

```
bun scripts/gate.ts proofs --only call-depth-clamp
```

It covers four layers.

1. **Resolver matrix.** Every knob value 1..20 maps to `min(value, 3)`. Edge inputs are
   `undefined`, `0`, `-1`, `NaN`, `+Infinity`, `-Infinity`, `21`, `100`, `1.5`, `2.5`, and `3.5`.
2. **Schema bounds.** The schema accepts 1..20 and fractional values inside the range, and
   rejects 0 and 21 (K4 is unchanged).
3. **Real load path.** `configLoadConfig` is called with a fake context for every knob value.
   Each call asserts the applied `MAX_CALL_DEPTH`, the clamp log for values above 3, and the
   absence of a clamp log for 1..3. Invalid requests are checked twice: at startup they leave 3,
   and on reload they leave a previously applied 2 untouched. Fractional requests are checked
   through the same path.
4. **Guard and cap agreement.** For ceilings 1, 2, and 3, every prior depth 0..20 is staged on a
   real `PipelineState` and the real `callDepthGuard` is invoked. The expected result is
   `depth <= ceiling`; every allowed depth must also return `null` from `checkCap`. The message
   for a blocked depth must name the effective ceiling.

The proof also stages the defect itself: with the setter called directly at 5 (the pre-fix
wiring), depth 4 is not rejected by the `MAX_CALL_DEPTH` branch, but `checkCap` rejects it with
`max depth (3)`, so the caller sees 3 while the knob says 5.

Branch coverage outside the depth matrix: an `explore` target inside the exempt budget, the same
target after the exempt budget is exhausted, a root-like caller, a non-`task` dispatch, and a
dispatch without a session id.

Static assertions pin the single wiring point: the facade contains exactly one
`setMaxCallDepth` call, no raw `setMaxCallDepth(c.maxCallDepth)`, the ceiling is a named constant,
and the clamp expression appears once in the resolver.

## Results

| Case | Observed |
| --- | --- |
| Knob 1..20 through the loader | `1, 2, 3, 3, ... 3`; every value above 3 logs the clamp |
| Knob absent | 3 |
| Knob 0, negative, `NaN`, `±Infinity` | current ceiling unchanged; startup stays at 3 |
| Knob 1.5 / 2.5 | applied unchanged |
| Knob 3.5 / 21 / 100 | applied as 3 and logged |
| Guard at ceiling 1, 2, 3, depths 1..21 | allowed exactly up to the ceiling |
| `checkCap` at every allowed depth | `null` |
| Uncapped setter at 5, depth 4 | `MAX_CALL_DEPTH` branch passes; `checkCap` rejects with `max depth (3)` |
| Exempt `explore`, prior depth 20 | allowed inside the budget |
| Exempt budget exhausted, prior depth 20 | blocked with `cannot exceed 3` |
| Root-like, non-`task`, no session id | guard returns no error |
| Gate step | `PASS call-depth-clamp`, `GATE PASS: proofs (1 step(s), 184ms)` |

## What this does not prove

- Probe 0 Q13 still needs a live host run with a scripted 4-deep `task` chain, a non-root caller,
  and a non-exempt target. This receipt proves the deterministic wiring that makes Q13's
  `checkCap` outcome unreachable; it does not replace the host receipt.
- The knob still accepts 1..20 at the schema and at the setter. The clamp is applied only at the
  configuration load path; a direct caller of `setMaxCallDepth` can still raise the value. The
  proof asserts that single-source boundary instead of hiding it with a second clamp.
- No live config, state, host, or install was touched.

## Cleanup

The scratch log `/tmp/opencode/d13-proof.log` was removed after the run. No other temporary files
were created.
