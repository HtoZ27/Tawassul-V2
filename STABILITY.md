# Tawassul V2 — Stability Triage

Status: 2026-10-26 · HEAD `b55f9df` · gate `npm run ci` rc=0

Purpose: one prioritized view across every open fix, filtered to the single
question that matters for day-to-day use — **does this stop the plugin from
working, lose data, or report success when it failed?**

## Where the fixes actually live

All 99 issue entries are in `ISSUES.md`. `PLAN.md`, `TRIAGE.md`,
`CUTOVER.md`, `RECOVERY-20261025.md`, `DECOUPLING.md`, and `SHARED.md` are
historical records: they describe work already done or decisions already
taken. The one exception was `SHARED.md` S-057, which had never been
registered; it is now `P-11`, and S-053's guard-fixture remainder is `G-14`.
`VERIFICATION-20261026.md` is the evidence ledger behind the
register. So the "huge number spread across documents" collapses to one file
with 99 entries, of which **39 are open**.

## The filter

39 open items sound like 39 problems. They are not the same kind of problem:

| Tier | Question it answers | Count |
| --- | --- | --- |
| S0 | Does the plugin work at all? | 1 |
| S1 | Does it lose or corrupt data silently? | 0 |
| S2 | Does it tell the truth about what happened? | 6 |
| S3 | Does it start reliably and quickly? | 9 |
| S4 | Can it be made to do something it should not? | 6 |
| S5 | Can we prove any of the above? | 13 |
| S6 | Does install and upgrade work? | 4 |

**Stability is S0 + S1: 1 item.** S2 decides whether you can trust what you
see. S3 through S6 matter, but none of them makes a working session fail.

---

## S0 — the plugin does not work (1)

| ID | Defect | Why it blocks |
| --- | --- | --- |
| `G-13` | The live host keeps pre-build code until restart | Every fix above appears not to work until the host is restarted. Operational, not code. |

## S2 — features silently dead or lying (6)

`E-18` hook errors swallowed, guard fails open ·
`E-02` config hook unbridged, permission repair missing · `E-25` AskChannel
fabricates an answer at capacity · `E-29` one failing request trips the web
breaker for 60 s · `E-33` client shim
no-ops · `E-36` failed crawl returned as success.

## S3 — boot and startup (9)

`B-01` schema work duplicated · `B-02` retry window hides tools for ~10 s ·
`B-03` 3.1 MB pretty-printed run log parsed at boot · `B-05` schema payload
unmeasured · `D-05` doctor census gap · `G-04` no boot budget proof ·
`I-07` no bundle freshness check · `I-08` global boot cost unmeasured ·
`I-10` successful host boot is manual.

## S4 — security (6)

`C-03` no-agent sessions skip every guard · `P-10` `permissionGuard` bash
branch dead · `E-28` `patch`/`apply_patch` absent from `BLOCKED_TOOLS` ·
`E-30` `applyPatch` prefix escape · `E-37` type shim weaker than the host
contract · `E-39` SSRF check is pre-flight only.

Owner constraint: none of these may be fixed by editing a `bash` permission
entry, and no hook may turn a `bash` infrastructure error into a hard block.

## S5 — evidence (13)

`E-32`, `E-40`, `E-41`, `E-07`, `G-05`, `G-06`, `G-07`, `G-08`, `G-10`,
`G-11`, `G-12`, `I-09`, `I-11`.

## S6 — install and parity (4)

`I-02`, `I-03`, `I-05`, `I-06`.

---

## The two clusters

The 12 entries in S0–S2 are not 12 independent jobs. They collapse into two
engineering clusters, each of which is one coherent change.

| Cluster | Members | One change |
| --- | --- | --- |
| **Persistence** | `E-12`, `E-13`, `E-20`, `E-21`, `E-22`, `D-05` | Make save/load/flush one generation-aware path: write before you report, quarantine instead of rolling back, await every flush. |
| **Guards** | `C-03`, `P-10`, `E-18`, `E-25`, `E-28` | One guard chain on every path, capability seeded at boot, fail closed on decisions and open on infrastructure. |

## Execution order

**Wave 0 — in parallel with everything (1 day).** `E-41`: invert the proofs
that assert defects as expected behaviour. The first inversion is done —
`prove-v2-compat.ts` now asserts part preservation and `E-16` is closed. The
remaining targeted cases (C-03, E-12, E-14, E-19) land with their
fixes. Without this, every later wave can be "verified" green while the bug is
still there.

**Wave 1 — make it usable (S0, 3–4 days).** `E-12` + `E-13` as the start of
the persistence cluster. Restart the host after each build (`G-13`) and
confirm against a live session, not a proof.

**Wave 2 — stop losing data (S1, 4–6 days).** Closed: the persistence
cluster (`E-20`, `E-21`, `E-22`, `P-08`, `P-09`), `E-19`, `E-23`, `E-24`, and
the stores cluster (`B-11`, `B-12`). No S1 item is open.

**Wave 3 — stop lying (S2, 3–4 days).** Telemetry (`E-14`, `E-27`, `E-31`)
is closed, `E-15` forwards the v2 text and tool events to the stream, `E-17`
validates arguments against the real schema, `E-34` applies the message-level
mutations back to the request, `E-35` carries the tool title through the result
bridge, and `E-38` closes the bridge by awaiting the refresh before disposal.
Next are the guards (`E-18`, `E-02`, `E-25`), then the three small tool fixes
(`E-29`, `E-33`, `E-36`).

**Wave 4 — boot (S3, 2 days).** `B-01`, `B-02`, `B-03`, `B-05`, then the
proofs `G-04`, `I-07`, `I-08`, `I-10`.

**Wave 5 — security (S4, 2–3 days).** `C-03`, `P-10`, `E-28`, `E-30`,
`E-37`, `E-39`.

**Wave 6 — evidence and install (S5 + S6, 2 days).** Everything that remains.

## Acceptance per wave

A wave is done only when all four hold:

1. the cited defect has a proof that fails on the previous commit and passes
   on this one;
2. `npm run verify` is green;
3. a live host session exercises the fixed path — not a synthetic event;
4. the register entry moves to `done` with the commit and the evidence line.

## What not to start now

`S5` and `S6` are real but do not change whether the plugin works. `E-40`
(shell comments) and `E-41` are the only two worth doing early, and `E-41`
is in Wave 0 for a reason. `I-02`…`I-06` affect the optional global install,
which is deferred under `I-01`, so they cannot affect a project-scoped user
today.

## Current position

- Wave 0: in progress — `prove-v2-compat` (E-16), `prove-e11` (E-11),
  `prove-c02` (C-02), and `prove-e12` (E-12) landed; the remaining targeted
  cases are C-03, E-14, and E-19.
- Wave 1: `E-26` (iteration budget), `E-11` (skill gate), and `C-02` (consent
  loop) are closed. `E-26` is not in S0–S2 because it blocked long tasks, not
  normal use.
- Closed since this triage: `P-11` (S2) and `G-14` (S5) on 2026-10-26 — the
  provider-aware model advisory plus the `kick` variant derivation, and the
  generation-guard WAL snapshot fixture; `E-16` (S1) — the write-back now
  preserves every part; `E-11` (S0) — capabilities seed from the roster,
  persist with the state file, and an empty record fails open with a warning;
  `C-02` (S0) — the bridge seeds the real parts, the deferred consent path is
  reachable, and a live ask/answer/execute proof lands a real `git push`;
  `E-12` (S0) — `saveState()` now awaits its generation, and a real `SIGKILL`
  immediately after `record()` keeps the record; `E-13` (S0) — a rejected
  state file is quarantined, never rotated over `.bak.0`, and recovery from a
  backup is writable again; `E-20` (S1) — `destroy()` awaits every async
  cleanup callback, so the ledger and timeline tails flush; `E-21` (S1) — the
  shutdown flush makes one final forced write and reports a terminal failure;
  `E-22` (S1) — the dropped-handoff penalty is
  computed before the shutdown flush, so it survives a restart; `P-08` (S1) —
  every rejected state copy is preserved under a distinct name and the
  quarantine keeps the five newest; `P-09` (S1) — the legacy lookup picks the
  newest existing candidate and prefers the non-retired directory on a tie;
  `E-19` (S1) — oversized tool output keeps its head and tail under an exact
  truncation marker, and the privacy path redacts the full text instead of
  dropping the tail; `E-23` (S1) — goal mutations queue in-process and then
  wait out the file lock, so parallel mutations are neither lost as `locked`
  nor allowed to clone the same snapshot; `E-24`
  (S1) — saga ids seed from the journal directory and the journal writes
  atomically, so a restart cannot overwrite the previous recovery record;
  `B-11` (S1) — the predictive router no longer timestamps its export, so an
  unchanged state stops rewriting the file and growing backups; `B-12` (S1) —
  `panic` refuses to clear when its backup fails, reports a missing state file
  honestly, and caps its backup family at three; `E-14` (S2) — the v2
  `execute.after` status decides success, so a failed tool no longer counts as
  a success and can trip the loop guard; `E-27` (S2) — the smoke gate requires
  a model reply and only tolerates an explicit provider refusal, so a plugin
  that hangs after boot fails it; `E-31` (S2) — the event hub and the context
  share one path-backed metrics collector, so dead-letter and backpressure
  counters are observable; `E-15` (S2) — the adapter maps the v2 text and tool
  families, so the console stream sees live tool output on the supported host;
  `E-17` (S2) — `makeV2Tool` parses arguments against the tool's own schema
  before dispatch, so invalid input throws instead of reaching a handler;
  `E-34` (S2) — the `chat.message` bridge applies role, agent, model, and text
  changes back to the host request; `E-35` (S2) — the v2 result carries the
  tool title in `tawassul.title` metadata, and the after hook reads and
  rewrites it, so titles are no longer dropped; `E-38` (S2) — the schema
  refresh exposes a done promise and a stop that awaits it, and dispose stops
  it before any registration cleanup, so a reload cannot outlive the tool
  domain.
- The two open goals in the ledger (`G-001`, `G-002`) both sit in Wave 1 and
  Wave 2 and should be re-scoped to the wave boundaries above.
