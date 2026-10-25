# Tawassul V2 — Priority Plan to Cutover

Status date: 2026-10-24. Scope: make this tree the only runnable Tawassul
plugin, close the v2.1.4 compatibility gaps, and retire v1 to a read-only
reference. Every task below is ordered by risk to a live session, not by
effort.

## Already done (Day 0, 2026-10-24)

- Host compatibility with OpenCode v2.1.4: `@opencode/plugin` 2.1.4 in both
  manifests, v1 API removed from `.opencode/package.json`, content-only tool
  results (no `output` without an output schema).
- Deferred-schema readiness: `INIT_READY` probe, bounded initial wait, real
  schema mirror, `ctx.tool.reload()`; live boot reports 42 schemas.
- After-hook write-back and confirm-only ask bridge with forced
  `tawassul.ask`; N2 assistant-role gate; v1-only config keys removed.
- DB retention (S-040/S-041): `--event-only`, `--event-retention all|off`,
  dual `session_v2`+`session` backup probe, message prune no longer joins the
  legacy `session` table.
- Launcher: v1 maintenance fallback removed, binary pinned to 2.1.4, event
  prune runs pre-exec at the cap.
- Proofs: `prove:v2-compat`, `prove:db-retention`, `prove:first-boot`; full
  `npm run verify` green.

## Priority levels

- **P0** — can corrupt state, freeze a boot, or block cutover.
- **P1** — correctness or measurement gaps that make a cutover claim false.
- **P2** — parity/quality work that can follow cutover.

## Day map

| Day | Date | Priority | Theme | Exit condition |
| --- | --- | --- | --- | --- |
| 0 | Sat 2026-10-24 | P0 | Host compatibility + DB retention | done: verify + proofs green |
| 1 | Sat 2026-10-24 | P0 | State namespace + setup dedupe | done: helper + proof green; boot mtime snapshot folded into Day 3 |
| 2 | Sat 2026-10-24 | P0/P1 | Goal ledger correctness (S-052) | done: counters agree on every close path; cap is loud and proven |
| 3 | Tue 2026-10-27 | P1 | Watcher, N2 re-derivation, boot scorecard | done: 10/10 cold boots PASS with `--since`; watcher line per launch; N5 N/A on 2.1.4 |
| 4 | Wed 2026-10-28 | P1 | S-055 triage batch + quality gates | done: `TRIAGE.md` A–L verdicts; proof-catalog threshold + release smoke green |
| 5 | Thu 2026-10-29 | P0 | Live dual-generation gate + cutover | done: dual boot + guard matrix recorded; SHARED frozen; one runnable copy |
| 6 | Fri 2026-10-30 | — | Buffer, docs, handover | done: `README.md` shipped; final ci green; clean tree; one install method |

## Day 1 — State namespace and one setup owner (P0)

Status 2026-10-24: items 1–3 and 5–6 are implemented and proven; item 4 is
decided, not renamed. Exit is partially met: `typecheck`, `check:rules`,
`check:shared`, and `prove:state-namespace` are green; the file-mtime boot
snapshot needs a live boot and is folded into Day 3's cold-boot protocol.
Extra shared surfaces found during the audit were folded into the same change:
`predictive-router.json`, the file-lock shard dir, and the code-state cache.

Why: v2 still writes shared surfaces that v1 also owns. A cutover that leaves
the same paths in place can corrupt v1 state or make a rollback ambiguous.

1. Add one state-path helper (`src/utils/state-paths.ts`) with:
   - `TAWASSUL_V2_STATE_DIR` override;
   - default `~/.config/tawassul-v2/state`;
   - legacy read fallback only when the new file is absent and the old
     `~/.config/tawassyl/state/<file>` exists;
   - no automatic deletion of legacy files.
2. Point the six service defaults at the helper (trust-score, collective
   memory, spec-driven, cost transparency, failure autopsy, background
   coordinator). Keep the legacy fallback for one release.
3. Namespace the other shared surfaces in the same change:
   - HMAC key surface: new `TAWASSUL_V2_HMAC_V1:` prefix, verify both new and
     legacy `TAWASSUL_HMAC_V1:`; key file stays readable during migration.
   - applied-patch lock dir: `tawassul-v2-locks`.
   - N2 log: `tawassul-v2/n2-auto.jsonl`; leave the old file untouched.
4. Decide the plugin id:
   - Rename to `tawassul-v2` only if a configured test workspace boots with
     the renamed id and the host resolves it without collision; otherwise
     document the id-as-is decision with host evidence.
5. Add the per-directory setup guard (S-042): `Symbol.for("tawassul.v2.setup")`
   registry keyed by workspace, refcounted release, second copy yields at
   debug. This is the v1 bridge shape, proven there under dual discovery.
6. Proof: a new `prove:state-namespace` asserts the default path, the legacy
   read fallback, HMAC dual verification, and that two setups in one directory
   register once.

Exit: `npm run verify` plus the new proof green; a file-mtime snapshot shows
no writes under `~/.config/tawassyl` or `~/.config/tawassul` during a boot.
The one allowed exception is the shared HMAC key file, which is created only
when absent and never rewritten (item 3 keeps it readable for legacy
signatures). Rollback: revert the helper commit; legacy files were never
modified.

## Day 2 — Goal ledger correctness (P0/P1)

Status 2026-10-24: implemented and proven. `close()` and a terminal
`update()` share `finishLocked` (transition check, close invariant, one
closed event, one tombstone, one count); `deleteGoal` and a drop count the
prior status; the digest adds live terminal goals to the replayed counters so
a meta heal or ledger replay agrees with live state; the cap counts only
active goals, prints a cap-exhaustion line, and `runTodoReconcile` logs the
cap warning. `prove:goal-capture` is in `npm run ci`. The manual digest check
is folded into Day 3's boot scorecard so the counts are read from a live boot.

Why: v2 already avoids five of the seven v1 capture defects, but two
correctness gaps remain and are user-visible.

1. Lifecycle counts diverge by path: `update(status:"completed")` leaves the
   goal live and never increments, while `close()` increments and writes a
   dropped tombstone. Either derive the digest from events or route every
   close through one gate that increments and tombstones exactly once.
2. The 5000 cap compares `this.goals.size`, so completed goals that stayed
   live block new capture; `{ok:false, reason:"max"}` is swallowed at debug
   level. Count only active goals against the cap (or archive completed
   goals) and surface exhaustion in the tool result and digest.
3. Do not port v1 gaps 2, 4, 5, 6, 7: v2 has no auto-close, no reconcile
   timeout race, uses session detail instead of a title prefix, only selects
   active goals as candidates, and has no `includeLegacy` option.
4. Add `prove:goal-capture`: close by both paths yields identical counts;
   replay after a meta heal preserves them; a completed goal does not consume
   a capture slot; the 5001st active goal fails loudly.

Exit: proof green and a manual `goal(board)` digest shows counts consistent
with the goal set.

## Day 3 — Boot measurement and watcher policy (P1)

Why: v2 cannot claim a cold-boot result without a gate, and the launcher has
no watcher policy on a rotational host.

1. Port the watcher policy into `scripts/opencode-v2-iso.sh`:
   env > pinned > auto, rotational-disk probe, legacy flag honored only in
   auto, and one `[launcher] watcher mode=… d7=… decision=… reason=…` line
   per launch. The flag is resolved against the build, never exported blind:
   2.1.4 advertises `OPENCODE_DISABLE_FILEWATCHER`; the experimental name is
   only an alias, and a build that advertises neither gets a loud refusal.
2. Re-derive N2 from the post-S-039 hook: every cold boot measured with an
   explicit `--since`; records that predate the role gate are discarded.
3. Port the boot scorecard with both S-054 fixes: `--n2 auto` without
   `--since` returns INCOMPLETE, and N1/N4 require the log envelope and
   exclude `[bash]` / `pattern=` lines.
4. Run the 10-cold-boot protocol; record N1–N5 per boot in the scorecard.

Status 2026-10-24: done. Cases 2–11 (10 cold boots, one explicit `--since`
each) are all PASS: N1 0 subscribe errors, N2 4.9–6.1s (auto, role-gated),
N3 init p95 21–23ms, N4 0 state failures, N5 N/A. N5 is N/A because the
2.1.4 host log contains no `project copy refresh` string at all — the v1
watcher metric was retired, so the watcher gate is the launcher line plus N1;
a host that logs the signal but has no in-window pair stays INCOMPLETE.
The auto watcher decision on this host is `d7=rotational-disk → off`, logged
once per launch. One extra snapshot boot (case 12) reported N2=22.1s from a
21s gap with no plugin or host activity (`step_start`→`text` 13ms, init
21ms); a clean re-run of the same case passed at 7.3s, so the row is recorded
as transient provider latency, not a plugin stall. The same boot changed
nothing under `~/.config/tawassyl` or `~/.config/tawassul` (file mtime/size
snapshot before and after).

Exit: met — 10 rows, each identified by an explicit boot timestamp, watcher
decision logged for each launch, no INCOMPLETE row counted as PASS.

## Day 4 — S-055 triage and quality gates (P1)

Why: S-055 is a v1 backlog dump; executing it verbatim would re-import dead
items. Triage first, then implement only what is proven on v2.

1. Produce a triage table for sections A–L: apply / v1-only / already dead.
   First candidates to apply: silent-catch discipline (the subset that can
   lose data), hook-surface subscriptions with real behavior, coverage
   thresholds, and a release/smoke gate against the pinned host version.
2. Coverage thresholds: v2 carries no `vitest`, no `tests/`, and no
   `test:coverage`, so the v1 item is rejected rather than imported as an
   empty suite. The v2 equivalent is a proof-catalog threshold:
   `prove:proof-catalog` requires 25 proof files (24 at Day 4, plus the Day 6
   independence proof), exactly one `prove:` script
   per file, every proof wired into `ci`, and the release smoke present.
3. Add `scripts/release-smoke.sh`: pin the host version, build, boot a
   scratch workspace with an isolated `OPENCODE_DB` and temp plugin state,
   assert the plugin init line + 42-tool registration, then call `health`
   and `help` directly; refuse on version drift or boot failure.
4. Record every rejected item with one line of evidence in `TRIAGE.md`.

Status 2026-10-24: done. `TRIAGE.md` carries all A–L rows with a verdict
(`apply` / `v1-only` / `dead`) and one line of evidence each. Applied:
release smoke, catch discipline over the shared persistence path
(`persist-utils.ts`, `atomic.ts`, including the M-2 quarantine warning), and
the proof catalog. Rejected with evidence: the v1 vitest coverage thresholds
(no v2 suite to measure), the hook-surface expansion (v2 already subscribes
to the whole host stream; mappings without consumers would be noise), and
every `v1-only`/`dead` row. The smoke is green against host v2.1.4
(`SMOKE PASS: host v2.1.4, scratch boot, 42 tools, health + help`).

Exit: met — triage table committed, the v2 threshold gate enforced
(`prove:proof-catalog`), release smoke green, `npm run ci` green end to end.

## Day 5 — Cutover gate (P0)

1. Run `npm run ci` on a clean tree and keep the log.
2. Live dual-generation boot: one v1 workspace and one v2 workspace in the
   same host. Confirm one setup owner per workspace, 42 tools, a direct tool
   call, and that the v1 guard refuses the v2 DB (and vice versa).
3. Freeze `SHARED.md`. Remove `check:shared` from `verify`, delete
   `scripts/port-from-v1.mjs` and `test-utils.ts`, and remove remaining v1
   path references from scripts and docs.
4. Retire v1: disable its plugin in every workspace, keep the tree read-only,
   do not push it to GitHub, and leave exactly one install method for users.
5. Ask the owner before deleting the stale `"plugin": ["tawassul"]` entry in
   `/home/htoz/Documents/opencode.json` (it produces a registry 404 at boot).

Status 2026-10-24: done; the full evidence is `CUTOVER.md`.

- Clean-tree `npm run ci` on `3379550` returned 0
  (`/tmp/opencode/ci-day5-clean.log`, release smoke green).
- Dual boot: the v2 workspace registered 42 tools at 21.54ms init and replied;
  the v1 workspace registered 42 tools and replied on 2.1.4. Its DB carries
  `session_v2`, which the v1 guard refuses. The v1 pinned host 1.18.30 is not
  installed, so the v1 lane has no supported host here. Direct `health` (both)
  and `help` (v2) calls returned the expected output.
- Guard matrix: synthetic 1.18 schema → v1 ok / v2 refused; synthetic
  `tawassul-v2` DB → v2 ok / v1 refused; live v2 DB → v1 refused; live 2.1.4
  DB → v1 refused (`marker-session_v2`). No fail-open path.
- Freeze: `SHARED.md` header frozen; `check:shared` and the anchor checker
  removed; `scripts/port-from-v1.mjs` and `test-utils.ts` deleted;
  `AGENTS.md` + local `RULES.md` updated; the maintenance comment no longer
  names v1.
- Retirement: six active workspaces and the v1 reference tree renamed their
  plugin bundle to `.retired-20261024`; the `paassss` config entry is now
  `[]`; only the v2 `.opencode/plugin/tawassul.js` remains auto-loadable; the
  v1 tree is read-only; it has no git remote; `Documents/opencode.json`
  already had `"plugin": []`, so no owner prompt was needed.

Exit: met — cutover log committed, SHARED frozen, one runnable plugin copy.

## Day 6 — Buffer and handover

- Fix regressions found by Day 5, re-run every proof, update `README.md` and
  the install/bootstrap order.
- Record the final state-path and HMAC migration note for operators.
- Final commit; no uncommitted files.

Status 2026-10-24: done. No Day 5 regression required a code fix.

- `README.md` is the operator guide: prerequisites (host 2.1.4, Node 24+,
  Bun, `@opencode/plugin` 2.1.4), install order (`npm install` →
  `npm run build` → host loads `.opencode/plugin/tawassul.js`), the pinned
  launcher, the `verify`/`ci` split, the state + HMAC table, the guard codes,
  the 42-tool surface, troubleshooting, and the docs map.
- State and HMAC migration is documented: v2 writes under
  `~/.config/tawassul-v2/state` (override `TAWASSUL_V2_STATE_DIR`), the
  legacy `~/.config/tawassyl/state` is a read-only fallback, writes carry
  `TAWASSUL_V2_HMAC_V1:`, and verification also accepts the legacy
  `TAWASSUL_HMAC_V1:` / `TAWASSULL_HMAC_V1:` prefixes. The key file stays at
  `~/.config/tawassul/.tawassul-hmac-key`.
- `DECOUPLING.md` now records the README as delivered instead of pending.
- v1 retirement was completed beyond the plugin bundle: every workspace
  config now sets `mcp.tawassul.enabled = false` (9 configs), the v1 MCP file
  is renamed `tawassul.mjs.retired-20261024` in the 7 workspaces that had it
  (including the reference tree), and the v1 tree is read-only again.
- v2 independence is machine-checked: `scripts/prove-v2-independence.ts`
  proves there is no v1 tree reference in `src/` or the build/launcher, the
  legacy state name is confined to `state-paths.ts` and is read-only, the
  manifest has no v1 dependency, and exactly one host entry exists.
- Final `npm run ci` on this tree: see `/tmp/opencode/ci-day6-final.log`; 25 proofs
  pass and release smoke ends with
  `SMOKE PASS: host v2.1.4, scratch boot, 42 tools, health + help`.

Exit: met — clean tree, one install method, docs delivered.

## Day 7 — 2026-10-25 desktop DB split and multi-project hardening

Why: two desktop tabs returned "cannot find this session", and a local install
per project could still contend on one global router file.

- Root cause was a DB split, not data loss: the desktop reads
  `~/.local/share/opencode/tawassul-v2/opencode.db`, while the sessions lived in
  `~/.local/share/opencode/opencode.db`. Backups were taken first, then both
  sessions (942 messages) were merged into the sidecar with `BEGIN IMMEDIATE`
  and explicit column lists. `quick_check` returned `ok`; the live API returned
  200 for both sessions and their messages.
- Multi-project hardening: `scopedStatePath` moves the predictive router to
  `<project>/.opencode/predictive-router.json` with a global read fallback; the
  `ServiceIndex` fallback trust/cost stores use `resolveRuntimeStateDir`;
  `health` reports scope, state, router, and DB paths; `npm run doctor` checks
  symlink, scope, DB isolation, per-DB project session counts, and orphan
  servers; `README.md` documents the model.
- Verification: `npm run verify`, `npm run smoke:release` (42 tools),
  `npm run prove:state-namespace` (two new router assertions),
  `npm run prove:independence`, `npm run prove:proof-catalog`, and
  `npm run doctor` (0 failures, one orphan-process warning).
- The desktop service stayed live: `opencode reload` rebuilt the plugin
  (`42 schemas`, `42 tools`, `INIT_AUDIT health=healthy`) without stopping
  pid `704051`.

Exit: met — sessions restored, per-project router live, doctor and health cover
the failure mode. Full write-up: `RECOVERY-20261025.md`.

## P2 backlog (after cutover)

- S-044 select/multiselect elicitation with the same fail-closed contract.
- S-047 streaming deltas and a documented compaction template contract.
- Upstream documentation for the content-only result contract, in-place
  after-hook mutation, and `tool.reload()`.
- Remaining S-055 items marked "apply" after Day 4, driven by measured need.

## Guardrails

- Keep `MemAvailable` at or above 1500 MB; run heavy commands sequentially.
- English only, no code comments; `npm run check:rules` is the gate.
- Never share a DB between generations; the guard is the boundary.
- Never copy v1 state, backups, or duplicate records into v2.
- Every claim above needs a command and a log line, not a recollection.
