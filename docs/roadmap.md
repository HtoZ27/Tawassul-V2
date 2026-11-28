# Roadmap

This page states what is shipped, what is next, and what is deliberately out of
scope. A dated promise is not made here; each item names the condition that
closes it.

## Shipped

`0.1.8-experimental` is the current public release, built on the first public
release `0.1.0-experimental`. It carries:

- Eight specialist agents and `tawa` routing, with a roster that is seeded on
  first boot.
- The full tool surface: reading, AST queries, dependency maps, search, git
  diffs, web fetches, and the orchestration tools.
- The goal ledger, mission boards, checkpoints, memory records, discussions and
  context packs.
- Project-local state with an HMAC signature, a quarantine for refused files,
  and a read-only degradation path when the state directory cannot be written.
- A release installer for project and global discovery, with a native Windows
  lane for the bundle and wasm.
- A standalone database maintenance lane: five scripts and a `MAINTENANCE`
  marker, a systemd timer or tagged cron line, coexistence with the plugin, and
  a doctor report for both markers.
- English documentation, a JSON Schema for the configuration, and a
  reproducible release artifact.

## Next

| Item | Condition to close |
| --- | --- |
| Arabic and further language translations | The ten core documents pass heading, command and link parity under `docs/i18n/` |
| Package registry publication | An owner decision to publish; the tarball is already built and verified |
| A hosted documentation site | A generator is chosen and the source documents stay canonical |
| A Windows database maintenance lane | The POSIX-only database scripts gain a supported Windows path with a native receipt |
| A macOS scheduler | An installer-managed `launchd` job is shipped and verified |
| Post-release project metadata | Repository protections, release notes and Discussions are configured on the public remote |

## Queued behind the current fix lane

Nothing on this page starts before the fixes in flight on the separate session
have landed and the release gate is green. The items are ordered by defect, not
by theme, and each closes on a proof rather than a date. A capability that is
not broken is not listed, and a missing feature is not a defect.

### Baseline before any hardening

Record what the current release actually does before changing it: token and cost
per task from the cost tracker and the usage ledger, task success, rework and
wall time from `report` and the timeline, on one single-agent arm and one
Tawassul arm running the same tasks.

**Closes when:** `metrics.json` carries a baseline row both arms can be compared
against. If the comparison shows no gain, the later items are re-scoped rather
than executed.

### Bounded fail-closed in the tool gate

The `execute.before` bridge in `src/v2/setup.ts` reports an unexpected failure
and continues. Matching the block error by name is forced by the module
boundary; the decision to continue is not. The security model states that a
denied call performs no partial write and that a tool cannot widen its own
access, and validation states that an unexpected condition is a failure, not a
skip.

The fix is a single explicit read-only allow-list. A tool outside that list is
denied when the gate cannot decide, so a mutating call never runs on an
unclassified error. A full fail-closed policy is rejected because it would
disable read-only tools on a transient bootstrap fault, which trades one
feature for another.

**Closes when:** `prove-failclosed-deny` denies a mutating tool after an
unexpected bridge error, `prove-failclosed-readonly` keeps an allow-listed
read-only tool working, and the full proof gate passes.

### Accounting units and synthetic counts

Two defects, one seam. `computeBudget` subtracts a byte count from a token
window, so the two sides of the subtraction are not the same unit. The
`AGENT_SUCCESS` path derives `inputTokens` as `outputTokens x 1.5`, an invented
ratio rather than a measurement.

The host already reports real usage through `V2SessionInfo.tokens` and
`session.usage.updated`, so the work is to prefer measured values where they
exist, convert the window once at the boundary, and label every row as measured
or estimated. A tokenizer and an estimator cache are rejected: neither is
needed to make the units agree.

**Closes when:** `prove-context-window-units` shows a computed budget never
exceeding the window it came from, and every ledger row carries a
measured/estimated label.

### Checkpoint integrity

A checkpoint can be restored after its snapshot has been edited with no
detection. Store a content hash at creation, verify it at restore, and refuse a
mismatch. Checkpoints written before the hash existed are read as legacy with a
warning; there is no schema migration.

**Closes when:** `prove-checkpoint-integrity` fails to restore a snapshot whose
content was edited after it was taken.

### Advisory lock coverage

Test first, then fix only what the test proves broken. The lock already carries
an owner, an expiry, a heartbeat and stale recovery, so a rewrite is not
assumed to be needed.

**Closes when:** `prove-lock-lost-update` and `prove-lock-stale-recovery` pass.
If both already pass, the item is closed as covered with no code change.

## Explicitly out of scope

The queued items above are deliberately narrow. These are rejected rather than
deferred, because none of them closes a defect.

- A command-line interface beyond `install.sh` and `doctor`.
- A hosted service, telemetry, or a remote state store. State stays local.
- Storing, proxying, or logging a provider credential.
- Widening a host permission. The guard narrows what a tool may do; it never
  expands it.
- A second plugin copy in one workspace, or a compatibility target for the
  retired first-generation plugin.
- A directory reorganisation of `src/v2/`. The files are large but the seams
  are not proven wrong, and a move is not a fix.
- A token estimator, a tokenizer cache, or a new accounting subsystem. The host
  reports measured usage; the work is to use it and label the rest.
- Adaptive routing, task complexity scoring, or an agent performance dashboard.
  A new routing engine is a feature, not a repair.
- A security agent. The roster is eight base agents and the guard is in the
  tool gate, not in a role.
- New agents or new tools before a listed proof turns red.

## How work is decided

An item moves from this page to a release only when it has a proof or a receipt
that names its evidence. Until then it is a direction, not a commitment. Known
defects and their workarounds live in [known issues](known-issues.md); design
boundaries live in [limitations](limitations.md).

---

[Documentation index](README.md)
