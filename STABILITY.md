# Tawassul V2 — Stability Triage

Status: 2026-10-29 · `npm run verify` green · `npm run gate:proofs` 102
proofs · **0 open register entries** · dependency position refreshed
2026-11-13 (`@opencode/plugin` 2.3.0, 44 tools)

Purpose: one prioritized view across every fix, filtered to the single question
that matters for day-to-day use — **does this stop the plugin from working,
lose data, or report success when it failed?**

## Where the fixes actually live

All 87 issue entries are in `ISSUES.md`, and none is open. `PLAN.md`,
`TRIAGE.md`, `CUTOVER.md`, `RECOVERY-20261025.md`, `DECOUPLING.md`, and
`SHARED.md` are historical records: they describe work already done or
decisions already taken. `VERIFICATION-20261026.md` is the evidence ledger
behind the register. The "huge number spread across documents" collapses to one
file with 87 entries, all closed.

## The filter

The 24 open items of 2026-10-27 were not the same kind of problem:

| Tier | Question it answers | Open 2026-10-27 | Open now |
| --- | --- | --- | --- |
| S0 | Does the plugin work at all? | 1 | 0 |
| S1 | Does it lose or corrupt data silently? | 0 | 0 |
| S2 | Does it tell the truth about what happened? | 0 | 0 |
| S3 | Does it start reliably and quickly? | 2 | 0 |
| S4 | Can it be made to do something it should not? | 3 | 0 |
| S5 | Can we prove any of the above? | 13 | 0 |
| S6 | Does install and upgrade work? | 5 | 0 |

**Stability is S0 + S1: 0 items.**

## How the last 24 closed

| Tier | Entries | Disposition |
| --- | --- | --- |
| S0 | `G-13` | fixed 2026-10-28; `npm run host:refresh` verifies a fresh plugin init after a build |
| S3 | `I-08`, `I-10` | done 2026-10-29; the global bundle boot cost is measured and a successful host boot is automated |
| S4 | `E-30`, `E-37`, `E-39` | done 2026-10-29; the patch prefix escape, the type shim, and the SSRF boundary are closed, none by editing a `bash` permission entry |
| S5 | `E-07`, `E-32`, `E-40`, `E-41`, `G-05`…`G-08`, `G-10`…`G-12`, `I-09`, `I-11` | done 2026-10-29; each has a gate-wired proof or a recorded policy decision, and the proof catalog pins the exact set |
| S6 | `I-02`, `I-03`, `I-04`, `I-05`, `I-06` | done or resolved 2026-10-28/29; installer host discovery, purge scope, wasm pruning, `--force` backup, and wasm auto-install are covered |

The `E-30`, `E-37`, `E-39`, `E-40`, and `E-41` closures landed in
`edb163e` and `bfc9b6c`; `V-13` closed as a documented project-only boundary
in `03d8d4a`. The remaining closures are in the same 2026-10-29 batch.

## What the register does not cover

These are outside the plugin code and are not open defects:

- **Host-bound entries:** `S-042`, `S-046`, `S-048`, and `S-051` in the frozen
  `SHARED.md` need a host API or contract that `@opencode/plugin` still does
  not expose. The plugin fails closed or approximates; `G-3` lists the
  follow-ups to reassess on the next host release.
- **Owner-owned workspace residue:** ten `tawassul.js.pre-refresh-*` copies,
  twelve `*.retired-20261024` files, and five `dist`-only package dirs remain
  in the owner's other projects. The owner declined agent deletion on
  2026-10-29 and will replace the v1-loaded plugin with v2 in each project
  manually. No agent touches a file outside this tree.
- **`docs/FUTURE-WORK-PLAN.md`:** its counts and anchors are re-measured but
  the file belongs to another session and is not edited or committed here.

## Acceptance per closure

A closure is done only when all four hold:

1. the cited defect has a proof that fails on the previous commit and passes
   on this one;
2. `npm run verify` is green;
3. the fixed path is exercised on the supported host, or the limitation is
   documented as a boundary with a fail-closed contract;
4. the register entry moves to `done` with the commit and the evidence line.

## Current position

All seven tiers are closed. The register has 0 open entries. The live host is
on `@opencode/plugin` 2.3.0, the plugin boots 44 tools, and the remaining work
is owner-gated workspace replacement and host-bound follow-ups, not code.
