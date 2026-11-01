# Validation model

Tawassul V2 validates through isolated proof processes, not through a
`tests/` directory. This is a deliberate choice recorded by `E-41`.

## How the gate runs

`npm run ci` runs three stages in order, each step in its own process:

| Stage | What it runs | Why it is separate |
| --- | --- | --- |
| `gate:fast` | rule gate, shell syntax, typecheck, config, facts, contract, parity, proof catalog | fast feedback without touching host state |
| `gate:proofs` | every `scripts/prove-*.ts` file, one child process each | a failure cannot leak environment, locks, or module state into the next proof |
| `gate:smoke` | build, release smoke, global boot, independence boot | proves the shipped bundles, not only the source tree |

`scripts/prove-proof-catalog.ts` pins the proof file list and the
`gate:proofs` step count. A new proof that is written but not wired into
`scripts/gate-manifest.json` fails the catalog, and a proof wired twice fails
as well.

The current totals are <!-- generated:proof-files -->156<!-- /generated --> proof files: <!-- generated:proof-steps -->153<!-- /generated --> in `gate:proofs`, <!-- generated:fast-proof-steps -->1<!-- /generated --> in `gate:fast` (the catalog), and <!-- generated:smoke-proof-steps -->2<!-- /generated --> boot proofs in `gate:smoke`.

The <!-- generated:proof-steps -->153<!-- /generated --> proof steps take about <!-- generated:proof-seconds -->330<!-- /generated -->s in one pass (the shard estimates total). `scripts/proof-shards.json`
splits them into four balanced shards from recorded step durations (<!-- generated:shard-seconds -->82.6<!-- /generated -->s each)
so a developer can run one shard at a time: `npm run gate:proofs:1` through
`gate:proofs:4`, or `npm run gate:proofs -- --shard 3 --nice 10 --timings`.
A shard writes `.opencode/state/gate-proofs-<shard>.json`, and the catalog fails
when a shard misses a step, assigns a step twice, or its npm script is missing.
`gate:proofs` stays the full <!-- generated:proof-steps -->153<!-- /generated -->-step run, which is what CI and a release use.

For a local run that must not occupy the session, `npm run gate:proofs:bg`
starts `scripts/gate-proofs-bg.sh` detached; it runs the four shards one at a
time, refuses a second start while the worker is alive, reclaims a stale lock
only after its pid is gone, and records `summary.tsv` plus one log per shard.
`gate:proofs:bg:status`, `gate:proofs:bg:wait`, and `gate:proofs:bg:stop`
manage that worker. Do not launch the four shard scripts in parallel: that
recreates the CPU spike the split removes.

## Why there is no separate unit runner

Every proof is an assertion-level program:

- it imports the shipped module, calls the real function, and asserts the
  observable result;
- it exits non-zero on the first failure, so the gate sees the failure the
  same way it sees a compiler error;
- it creates its own state root (or uses a temporary directory), so it does
  not depend on the developer's live workspace;
- it prints one `PROOF PASS` line with the assertion count, which makes the
  coverage visible in the gate transcript.

A second runner would duplicate the same assertions behind another entry
point, while adding a second place to wire, pin, and isolate. The proof gate
already runs on every `ci`, so a regression cannot merge without failing it.

## Named cases

The four cases that `E-41` originally asked for are covered directly:

| Case | Proof | Assertions | What it pins |
| --- | --- | --- | --- |
| `C-03` | `scripts/prove-c03.ts` | 19 | a missing or unrecognized agent cannot bypass the consent gate; the question reaches the root session through the ask channel |
| `E-12` | `scripts/prove-e12.ts` | 15 | `saveState()` resolves only after the observed generation is on disk, including a mutation during an in-flight save |
| `E-14` | `scripts/prove-e14.ts` | 11 | the v2 `execute.after` status decides success, not the presence of output; untagged results keep the string fallback |
| `E-19` | `scripts/prove-e19.ts` | 11 | an oversized output keeps its head, tail, exact removed count, and marker; a secret in the head is redacted |

`scripts/prove-v2-compat.ts` holds the adapter contract that once encoded the
multi-part loss from `E-16`; it now asserts part preservation.

## Adding a proof

1. Write `scripts/prove-<name>.ts` with a local `assert` helper and a final
   `PROOF PASS` line.
2. Add one entry to the `proofs` stage in `scripts/gate-manifest.json`.
3. Add the file to `PINNED_PROOF_FILES` in
   `scripts/prove-proof-catalog.ts` and advance `PINNED_PROOF_STEPS`.
4. Add the step to one shard in `scripts/proof-shards.json`; the catalog
   requires the shards to cover every step exactly once.
5. Run `npm run verify` and `npm run gate:proofs`.
5. Update the proof totals in `AGENTS.md`, `README.md`, and
   `REMAINING-WORK.md` in the same commit.

## Limits

The proof gate is not a fuzzer and does not replace a type checker. Type-level
contracts are checked by `tsc --noEmit` in `gate:fast`, and the runtime paths
are checked by the proofs. Host-bound behaviour that the plugin cannot observe
is recorded in `docs/SHARED-PARITY.md` instead of being asserted against a
mock that would only prove the mock.

Cold-boot acceptance is out of scope for v2 (owner decision 2026-10-30,
`E-56`). The v1 M3 scorecard remains the recorded measurement: 10 of 14 rows
are `overall=FAIL`, with `N2` in every failing row. v2 keeps
`scripts/boot-scorecard-v2.sh` for window scoring but ships no cold-boot runner
and makes no N1-N5 claim.
