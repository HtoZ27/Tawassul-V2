# npm channel parity — plan draft

Status: draft v4, 2026-11-12. Owner: the owner. Executor: build.
Working document. It is not committed and it does not authorise work by
itself: goal G-010 is the ledger entry. Records: R-3057 (parity gate),
R-3058 (agent layer correction), R-3060 (why the first goal was dropped),
R-3059 (v1 baseline measurement), R-3061 (v1 test count and why it was not
ported).

This draft carries the plan itself (section 3), the seven-row acceptance gate
(section 4), the record of what the first draft got wrong (section 2), and
the seven defects that the v1 baseline exposed and that stay outside G-010
(section 8).

v3 changes: the evidence base compares the v1 tree at
`/home/htoz/Desktop/tawassyl/` with v2 (section 5), and section 8 records the
defects that comparison surfaced. None of them is added to G-010 scope, for
the reason given in each entry.

v4 changes: the v1 test count is corrected from 474 files to 328 files with
4,910 cases and 10,193 assertions, and S1 records the owner's reason for not
porting them (v2's structure differs from v1) as a decision rather than an
omission.

## 1. Purpose

The installer channel ships the product complete. The npm channel ships the
same product or does not ship. This plan defines the work that makes the
second sentence true, in the smallest change that leaves the installer
untouched.

## 2. Errors in the first draft

The first draft was withdrawn by the owner. Each row is a defect; none of them
is repeated in section 3.

| # | Claim in the first draft | Why it was wrong | Rule |
| --- | --- | --- | --- |
| 1 | npm could ship without DB maintenance to reach a publish date sooner | The bundle would carry the product minus a feature. A channel that cannot carry the product is the wrong channel; the answer is not to publish. | Owner requirement |
| 2 | `.opencode/agents/*.md` and the roster are V1 leftovers; `ctx.agent.transform` replaces them | The files are the host-visible, user-editable, portable layer. `transform` is runtime-only: agents vanish on plugin removal, users cannot edit or move definitions, and the roster registry has nowhere to live. | No feature-for-feature trade |
| 3 | Forbid runtime writes to `.opencode/agents` and `opencode.json` | That is how `addagent` and `kick` persist, how permission repairs land, and how `experimental.subagent_depth: 3` reaches the host (host default is 1). | No feature-for-feature trade |
| 4 | Bundle a runtime optionality audit (AST strictness, fail-closed tool surface, `TAWASSUL_NO_AUTOCONFIG`, `knowledge/critical-rules.md`, swallowed skill errors) into the npm goal | Unrelated redesign riding on a distribution task; it would change the working installer channel in the same change. | Minimum fix |
| 5 | Acceptance: "no shipped feature in `src` has a silent degradation path" | A blanket claim over the whole tree, not measurable by the npm proof, and out of scope for packaging. | Minimum fix |
| 6 | Acceptance: "the Windows runner passes DB maintenance" | Demands a capability the installer does not have. `docs/compatibility.md` documents Windows as bundle and wasm only, no database maintenance, no triggers. | No feature-for-feature trade |
| 7 | Effort estimate of 12-16 days built by summing new modules | Ignored that the shell lane already implements the ladder, guards, lock and stamps, and that its proofs can be re-pointed at a new executor. | Minimum fix |
| 8 | Listed the `agent-kick-runtime.ts` ↔ `agent-management.ts` cycle as an npm task | The cycle is already cut by passing `InstallScope` explicitly. What remains is the module-level `SCOPE` constant in `agent-management.ts:130`, a narrower item. | Minimum fix |
| 9 | Goal title "remove every optional runtime path" | The headline asserted the out-of-scope audit as the objective, and the ledger does not accept title edits after creation, so the goal was replaced, not corrected. | Minimum fix |

## 3. The plan

Nine work packages. WP0 is a gate: if it fails, WP1 is cancelled and npm is
not published. WP1 and WP2 are independent and run in parallel. WP3 through
WP7 are ordered.

### WP0 — Isolated spike (2 days, gate)

Answered in the host process, never in a standalone Bun script. Each answer
is a yes/no with an artifact.

| Question | Method | Fail meaning |
| --- | --- | --- |
| Does a bundled worker start inside the OpenCode host and reach `bun:sqlite`? | Isolated `XDG_*` and `OPENCODE_DB`, probe plugin boots the host CLI, worker opens a DB copy and returns `PRAGMA quick_check` | npm cannot carry DB maintenance; stop, installer stays the only channel |
| Does the worker reproduce the shell lane ladder decision on the same fixture? | `--check` in both lanes, compare the chosen rung and the byte inputs | ladder diverges; fix before WP1 |
| Is `task(agent: ...)` dispatchable in the same session after `ctx.agent.transform`? | add an agent, dispatch immediately, no restart | bridge is not same-session; `addagent` keeps "after reload" and no stronger claim |
| Does `agent.reload()` refresh the host surface, or is a restart required? | reload, dispatch, observe TUI and tool list | record the requirement in docs, no code claim |
| Does `checkGeneratedConfig` treat the durable `.md` and roster as drift on the next boot? | boot, edit a user agent, boot again, diff the files | fix the comparison in WP3 before any publish |

Deliverable: `scripts/prove-db-worker-spike.ts` (kept only if it becomes the
parity proof) plus a short result note in this file.

### WP1 — In-process DB maintenance worker (5-7 days)

The shell lane stays exactly as it is. The worker exists because the npm
tarball carries no shell scripts and the host on Windows has no `bash`.

Today, on an npm install, `laneScript()` in
`src/services/db-maintenance-trigger.ts` finds nothing: it probes
`TAWASSUL_DB_SCRIPT`, then `<dist>/../tawassul-runtime/db/opencode-db-scheduled.sh`,
then a repo checkout whose `package.json` name is `tawassul-v2`. None of the
three holds for a package installed from the registry, so the trigger logs at
debug level and returns. That is the missing feature, stated precisely.

New files:

| File | Responsibility |
| --- | --- |
| `src/services/db-maintenance/driver.ts` | Pick `bun:sqlite` when `typeof Bun !== "undefined"`, else `node:sqlite`; expose `open`, `exec`, `prepare`, `close` |
| `src/services/db-maintenance/worker.ts` | Worker entry; owns the ladder and the stages; posts one result message |
| `src/services/db-maintenance/lock.ts` | Directory lock with pid file, stale-owner check, release on exit |
| `src/services/db-maintenance/quiet.ts` | Quiescence probe that replaces `fuser`: exclusive transaction on the DB and WAL size stability across two reads |
| `scripts/prove-db-worker-parity.ts` | Same fixture through both lanes; diff artifacts |

Changed files:

- `src/services/db-maintenance-trigger.ts` — lane selection: worker when no
  shell lane resolves; shell lane otherwise. Stamp, 6-hour interval,
  24-hour minimum gap, notice-once-per-fingerprint and the lock contract stay
  as they are. `dbMaintenanceState()` keeps returning `unavailable` on
  `win32`, matching the documented Windows lane; only its log level becomes
  `info` so the absence is explicit rather than silent.
- `build-v2.mjs` — second entry:
  `bun build src/services/db-maintenance/worker.ts --target=node --format=esm --outfile=dist/db-worker.js`.
  Both drivers stay dynamic imports with a runtime-chosen specifier, which
  `bun build` leaves untouched (verified: the emitted file keeps
  `import(p)` verbatim).
- `package.json` — `db-worker.js` in the shipped file list (WP5).

Stages to reproduce, in the order the shell lane applies them:

1. **Wal rung** — WAL above 64 MiB: `PRAGMA wal_checkpoint(TRUNCATE)`;
   busy result falls back to `PASSIVE` and retries next cycle.
2. **In-use rung** — db plus WAL at or above the soft limit: bounded backup
   and prune while the DB is held; a non-zero exit resumes next cycle and
   never triggers a VACUUM.
3. **Quiescent rung** — db plus WAL at or above the cap (default 4 GiB) and
   the DB is provably quiet: backup, prune, checkpoint, VACUUM. An unprovable
   quiet keeps the rung off, fail-closed.
4. **Backup** — online backup API, then `PRAGMA quick_check` and a
   session-count probe; keep the last 5 (`--keep-backups`).
5. **Prune** — 90 days default, batch 3000, at most 2000 iterations, event
   retention `all|off`.
6. **Guards** — low-RAM refusal, disk-space check, lock contention (exit 8
   in the shell lane), cooldown, `--event-only`, `TAWASSUL_DB_CAP_BYTES`,
   target and max bytes.
7. **Stamps** — `last-run.stamp` on success, `last-failure.stamp` on failure,
   last-run untouched on failure.
8. **Fail-closed** — an unproven step is skipped and recorded; never reported
   as a success.

Proof reuse: `prove:db-retention`, `prove:db-scheduler`, `prove:gen-guard-wal`,
`prove:d05` run against the worker by pointing them at the worker entry.
`prove-db-worker-parity.ts` is the new row: identical fixture, identical
backup names and counts, identical prune counts, identical `quick_check`,
identical stamps; plus a spawn guard proving no `sqlite3`, `bash`, `fuser`
or `cron` process is created.

Exit criteria: parity proof green on Linux, all re-pointed proofs green, shell
lane untouched and still green. Switching the installer to the worker is a
later decision with its own goal; it is not part of this plan.

### WP2 — Agent availability bridge (3 days)

Durable layer stays authoritative (R-3058). `transform` is added on top.

| File | Change |
| --- | --- |
| `src/v2/types.ts` | `V2Context` gains an `agent` domain (transform and reload) and `options: PluginOptions` |
| `src/bootstrap/plugin-init.ts` | Pass both domains into the context; no behaviour change on their absence beyond WP6's assertions |
| `src/context/managers/AgentManager.ts` | Expose a builder that turns a template plus model and permissions into `Agent.Info` (`system`, `model`, `permissions[]`, `mode`) |
| `src/services/lifecycle-controller.ts` | After `await ensureDefaultAgentMds()`, register base, team and dynamic agents through one `transform` call |
| `src/tools/agent-management.ts` | `addagent`: parse → build info → `editor.add` → persist `.md` and roster → update `dynamicAgents` and `agentModelMap` → `reload` if WP0 says it is required. `kick`: `editor.remove`, unlink `.md`, roster entry, tombstone in `deleted`. Replace the stale "no plugin API" log at line 482 |

Preserved without change: `skipVariantMd` (project-scope generated variants
stay config-only), the global roster in `tawassul.jsonc`, the project agent
block in `opencode.json`, the backup and restore maps used by rollback,
`experimental.subagent_depth: 3` and the permission repairs.

Proof: `scripts/prove-agent-bridge.ts` — isolated state, boot, add an agent,
dispatch `task(agent: ...)` without restart, restart and confirm the agent,
kick, restart and confirm the tombstone holds.

### WP3 — Deterministic, non-destructive materialization (1-2 days)

| File | Change |
| --- | --- |
| `src/utils/opencode-config.ts` | One awaited boot pass: `ensureMinimalProjectContract`, `applyBootRepairs`, `repairProjectConfigBoot`, `ensureGlobalRosterSeed` |
| `src/bootstrap/plugin-init.ts:724-745` | Remove the passive regeneration race; keep the write behind the same lock |
| `src/utils/opencode-config.ts` | Merge only Tawassul-owned keys; never rewrite an unrelated key; keep `subagent_depth: 3` and agent permissions authoritative |

Rules: no `void` write, no boot jitter window that lets two processes write
the same file, second boot is byte-identical, a user-edited agent definition
survives, and a missing key is added once, not on every boot.

Proof: `scripts/prove-agent-materialization.ts` — fixture with a user agent, an
unknown key and a custom `subagent_depth`; boot twice; assert preservation,
idempotence and lock coverage.

### WP4 — Explicit install scope (1 day)

`ctx.options.scope` becomes the single source. `detectInstallScope` stays for
the installer CLI only.

| File | Change |
| --- | --- |
| `src/tools/agent-management.ts:130` | Delete the module-level `SCOPE`; take `scope` from the context |
| `src/bootstrap/plugin-init.ts` | Resolve scope once at init and thread it |
| `src/core/install-scope.ts` | `claimCoexistence` takes scope explicitly |
| `src/utils/path-resolver.ts` | Unchanged paths; callers pass the resolved scope |

Default: when the plugin resolves from a `node_modules` cache path, the scope
is `global`. Proof: `scripts/prove-scope-threading.ts` — project and global
fixtures, writes land in the right registry, npm-cache layout resolves global.

Note: `agent-kick-runtime.ts` already takes `InstallScope` explicitly and is
not touched again by this plan.

### WP5 — Package manifest and contents (1 day)

Two artifacts, two manifests, one pack script.

| Artifact | Contents |
| --- | --- |
| GitHub release bundle (unchanged) | `dist/index.js`, `dist/global.js`, wasm, sums, SBOM |
| npm tarball (new) | `dist/index.js`, `dist/db-worker.js`, wasm, `README`, `LICENSE`, `CHANGELOG`, `NOTICE`, schema; no `dist/global.js` |

`package.json`: name `tawassul`, `private` removed, `dependencies`
`@opencode/plugin ^2.3.0` and `zod ^4.6.7` (today both sit in
`devDependencies` and the pack manifest declares no dependencies at all),
`files`, `exports` without `./global.js`, `engines` matching what was tested.

`scripts/release/pack.sh`: build the npm manifest from the same stage
directory; `scripts/release/verify-artifact.ts`: add `package/dist/db-worker.js`
and drop `package/dist/global.js` for the npm tarball only.

### WP6 — Tarball proof (1 day)

`scripts/release/prove-npm-tarball.ts`:

1. Pack, extract into a temp prefix, install only the declared dependencies.
2. Boot the host CLI with isolated `XDG_*` and `OPENCODE_DB` against the
   installed package.
3. Assert 44 tools, 8 agents, 16 skills, one real AST parse.
4. Run DB maintenance on a fixture copy; assert backup, prune counts,
   `quick_check` and stamps.
5. Wrap `spawn`, `execFile` and `exec`; assert no `sqlite3`, `bash`, `fuser`
   or `cron`.
6. Assert no write outside the state directory.
7. Register in `scripts/gate-manifest.json` so `gate:proofs` counts it.

### WP7 — Parity matrix and publish (2 days)

`scripts/release/check-npm-parity.ts` prints the matrix and exits non-zero on
any difference:

| Row | npm tarball | Installer |
| --- | --- | --- |
| Tools | 44 | 44 |
| Agents | 8 | 8 |
| Skills | 16 | 16 |
| AST | real parse | real parse |
| DB maintenance | worker artifacts | shell lane artifacts |
| External binaries | none | `sqlite3`, `bash`, `fuser` |
| Writes outside state | none | none |
| Windows | documented lane: no DB maintenance | same |

Publish: `.github/workflows/publish.yml`, OIDC (`id-token: write`), triggered
on `v*` tags, running `npm publish ./tawassul-<version>.tgz --tag next
--provenance --access public`, then `npm view tawassul version dist.integrity`.
Rollback is `npm deprecate`, never unpublish.

### Sequence and effort

| Phase | Days | Depends on |
| --- | --- | --- |
| WP0 spike | 2 | none |
| WP1 worker | 5-7 | WP0 |
| WP2 agent bridge | 3 | WP0 (questions 3-5) |
| WP3 materialization | 1-2 | WP2 |
| WP4 scope | 1 | WP2 |
| WP5 package | 1 | WP1, WP2 |
| WP6 tarball proof | 1 | WP5 |
| WP7 parity and publish | 2 | WP6 |

Sequential total 16-19 days; with WP1 and WP2 in parallel, 14-17 days. The
range is an estimate, not a commitment, and it is the reason WP0 exists.

## 4. Acceptance gate

1. The tarball exposes exactly the same 44 tools, 8 agents and 16 skills as
   the installer channel.
2. DB maintenance on an identical fixture yields the same backup, prune
   counts and `quick_check` result as the installer shell lane, and the npm
   channel spawns no external binary.
3. A newly added agent is dispatchable in the same session through
   `ctx.agent.transform` and survives a restart through the durable layer.
4. Materialization is awaited, non-destructive and scope-correct; no user
   agent definition and no unrelated config key is overwritten.
5. `npm publish --dry-run` succeeds from the tarball with only declared
   dependencies and provenance.
6. The installer proofs pass unchanged: none deleted, skipped or weakened.
7. Windows npm behaviour matches the documented Windows installer lane.

One failed row means no publish and the installer stays the only channel.

## 5. Evidence base

Measured on the owner's host, 2026-11-12:

- `opencode-cli --version` reports `opencode v2.2.7`; the binary is Bun 1.4.4.
- `bun:sqlite` passes WAL, `VACUUM`, `VACUUM INTO`, `PRAGMA quick_check` and
  a `Worker` round trip.
- `node:sqlite` is absent on Bun ("No such built-in module") and present on
  Node 26.13, where the same probes pass.
- `dist/index.js` has exactly two external imports: `@opencode/plugin` and
  `zod`. `web-tree-sitter` is bundled; wasm resolves from
  `dist/../tawassul-runtime/wasm`.
- The npm tarball as packed today carries no `dependencies`, no worker, no
  DB lane script and no `dist/db-worker.js`, and `V2Context` has no `agent`
  and no `options` domain.

### Comparative baseline: v1 at `/home/htoz/Desktop/tawassyl/` versus v2

v1 is the retired tree: plugin code lives in
`.opencode/plugins/tawassul`, the workspace is private, and the tree is
read-only. Counts exclude `node_modules`, `dist`, `coverage`, `docs`,
`releases` and `tests` unless stated otherwise.

| Measure | v1 | v2 |
| --- | --- | --- |
| Plugin source files | 482 | 385 |
| Plugin source lines | 108,223 | 76,334 |
| Comment lines | 11,949 | 0 |
| Arabic comment lines (files) | 764 (276 files) | 0 |
| Commented-out code lines | 44 | 0 |
| Trailing-whitespace lines | not measured | 2,671 |
| Blank runs of four or more | not measured | 242 |
| Unit test files | 328 | 0 |
| Test cases (`it` / `test`) | 4,910 | 0 |
| Assertions (`expect`) | 10,193 | 0 |
| Coverage | v8 text plus HTML, 12 MB of report, untracked | none |
| Lint | eslint, wired into CI | no config, no script |
| CI jobs (main workflow) | lint, typecheck, test, build, windows, audit, bench | fast gate, proofs |
| Tools | 42 | 44 |
| Documentation | 5 documents | 87 in `docs/` plus 24 at the root |
| Tree size | 670 MB | 591 MB |
| Dead modules | the same four files present | the same four files, zero references |

The Arabic comments are the origin of the comment ban, and the measurements
show why: one line carried Arabic, English, a ticket reference and an emoji at
once. The ban removed the chaos and also removed 11,949 lines of explanation,
and v2 has no linter to replace what the comments were doing. Section 8 keeps
that finding as a separate goal instead of folding it into packaging.

The 474 test files reported earlier were wrong: that count added 146 zod test
files living inside the plugin's `node_modules` to the 328 project files. The
project has 328 files, 4,910 cases and 10,193 assertions. The suite was not
ported to v2 because v2's structure differs from v1: the tests target v1
classes and paths, so a bulk port would import the retired architecture. S1
treats this as a recorded decision, not an omission, and asks for v2-shaped
tests instead of a restored suite.

The four dead modules are inherited, not introduced by v2: the same four files
exist in v1, so deleting them is cleanup with no compatibility risk.

The facade graph is identical in both trees: seven facades, and in v2 every
one of them imports `TawassulContext` with `import type` while
`context-class.ts` imports the facades as values. There is no runtime cycle,
only a type-level one.

## 6. Open questions

Tracked by WP0; none is assumed answered.

1. Worker startup inside the host process.
2. Shell lane and worker reach the same rung on the same fixture.
3. `task(agent: ...)` after `transform`, same session, no restart.
4. `agent.reload()` sufficiency versus a restart.
5. Drift: does the next boot rewrite the durable agent layer?

## 7. Non-goals

- AST strictness, fail-closed tool surface, environment opt-outs, the
  `knowledge/critical-rules.md` path, swallowed skill or command registration
  errors. Separate goal if the owner asks.
- Changing the installer channel, its shell lane or its proofs before the
  worker proves itself.
- Any Windows DB capability the installer does not document.
- Replacing the durable agent layer with runtime registration.
- Switching the installer to the worker.
- Every item in section 8. They are recorded defects with their own entry
  conditions, not packaging work.

## 8. Defects surfaced by the v1 baseline

These seven entries come from reading `/home/htoz/Desktop/tawassyl/` and
comparing it with v2. None is a G-010 item: each one changes a different
surface (tests, source hygiene, docs, evaluation, types, disk), and folding
any of them into the npm change is the exact scope expansion that made the
first draft unusable (AGENTS.md rules 4 and 5). Each needs its own goal.

Only S1 is close enough to packaging to be worth stating in one line: it does
not block the publish gate, because the installer has the same gap, so parity
still holds. It is still the largest engineering debt in the tree.

### S1 — Build a v2 test and lint layer

**Symptom.** v2 has no project unit tests, no coverage report and no linter.
v1 had 328 test files, 4,910 `it`/`test` cases, 10,193 assertions, a v8
coverage report, eslint, and seven CI jobs, two of which ran the suite on
Linux and Windows.

**Why the suite was not ported.** This is the owner's decision, and the reason
is structural: v2 replaced the context and registration model that the v1
tests were written against. The v1 suite imports v1 classes, v1 paths and the
old bridge, so a bulk port would drag the retired architecture into v2 and
fail for structural reasons rather than behaviour. The absence of tests is
therefore a recorded decision, not an oversight, and the closed condition
must be v2-shaped tests, not a restored v1 count.

**Evidence.** Measured on the v1 tree: 328 project files, 4,910 cases, 10,193
assertions, 69,715 lines. The 474 figure that circulated earlier counted 146
zod test files inside the plugin's `node_modules` on top of the 328 project
files. In v2 the only `*.test.ts` files under the repository are those same
146 vendored ones. The 180 proof steps assert end-to-end behaviour, but they
do not exercise branches such as `applyReconcileTodo` in
`src/services/goal-store.ts`.

**Why separate.** A runner, a coverage gate and a lint gate change
`package.json`, the gate manifest and CI, and the test design has to be redone
for 385 files with a different architecture. That is a project, not a
packaging step.

**What closes it.** A runner wired into `gate:fast`, a coverage report
published by CI, a lint gate, and v2-shaped tests for the modules where a
regression is most expensive: `goal-store.ts`, `agent-management.ts`, the
handoff and state managers, and the install scope.

**Estimate.** 2-3 weeks for the targeted set; 4-6 weeks to approach v1's
4,910 cases with tests that actually match v2.

### S2 — Remove the comment-strip residue and restore explanation

**Symptom.** Removing comments left visible damage: 2,671 lines with trailing
whitespace, 242 places with four or more consecutive blank lines, and
functions whose decisions are no longer explained anywhere.

**Evidence.** `src/services/goal-store.ts` lines 1226 and 1231 carry leftover
whitespace where a comment stood; `applyReconcileTodo` (1218-1245) encodes a
non-obvious rule (skip when already completed, skip when dropped, attach the
`auto: marked complete in todowrite` evidence once) with no explanation.
v1 carried 11,949 comment lines, so the information existed and was discarded.

**Why separate.** It touches almost every source file and buys nothing for
distribution. It also must not become "put the comments back": the rule stands,
so the fix is names, small functions and a short note in the document that
owns the behaviour.

**What closes it.** Zero trailing whitespace in `src`, no blank runs of three
or more, `applyReconcileTodo` split into named predicates, `check:rules` still
green.

**Estimate.** 1-2 days.

### S3 — Delete the four dead modules

**Symptom.** `src/services/config-overlay.ts`, `versioned-migrator.ts`,
`plugin-sandbox.ts` and `foreground-fallback.ts` have zero references in
`src`, `scripts` and `tests`.

**Evidence.** 354 lines. The same four files exist in the v1 tree, so they are
inherited rot rather than a v2 regression, and nothing can depend on them
across the cutover.

**Why separate.** It is a deletion, not a fix; it needs its own proof run to
show the surface is unchanged.

**What closes it.** Files deleted, `npm run verify` green, proof count
unchanged, no new export in `src/services/index.ts`.

**Estimate.** One hour.

### S4 — Reduce the contributor documentation load

**Symptom.** `docs/` holds 87 documents (50 at the top level), 19,495 lines in
total, plus 24 documents at the root. Three internal plans account for about
450 KB: `plan-intelligence-continuity.md` (167 KB),
`plan-token-burn-control.md` (146 KB) and `tawassul-v2-code-first-plan.md`
(137 KB).

**Evidence.** v1 shipped five documents. The npm tarball ships none of these;
`pack.sh` copies only `README`, `LICENSE`, `CHANGELOG`, `NOTICE` and the
schema. So this is a contributor burden, not a package defect.

**Why separate.** Moving or archiving documents changes no code path, and it
should not race with the packaging change.

**What closes it.** Internal plans moved under `docs/archive/`, a top-level
index that separates user documentation from internal registers, and
`check:docs` green.

**Estimate.** 1 day.

### S5 — Measure tool-selection cost

**Symptom.** The model sees 44 tool names: 40 unconditional and 4 conditional
(`timeline`, `goal`, `checkpoint`, `evidence`, dropped silently when their
stores are missing). No measurement exists for wrong-tool selection.

**Evidence.** `src/bootstrap/tool-registry.ts` builds the surface and
`toolSurfaceAvailability` decides the four conditional entries. v1 exposed 42,
so v2 added two. The "13 tools elsewhere" comparison cannot be checked: the
reference tree is not on disk.

**Why separate.** Any merge, split or removal is a product decision that needs
data, not a packaging step.

**What closes it.** A fixed task set with a scored choice per task, run against
the current 44 and against any candidate reduction, with the result recorded
as a decision.

**Estimate.** 2-3 days.

### S6 — Break the facade type cycle

**Symptom.** Seven facades each import `TawassulContext` with `import type`,
while `src/context-class.ts:59-65` imports the facades as values. There is no
runtime cycle, but the type graph is cyclic and every facade can reach the
whole context.

**Evidence.** Verified line by line; the same seven facades exist in v1.

**Why separate.** It is a refactor across seven files with no user-visible
effect, and it must not ride on a distribution change.

**What closes it.** Facades accept a narrow interface instead of the whole
context, `context-class.ts` stays the only value-level aggregator, and a
circularity check covers the type graph.

**Estimate.** 1-2 days.

### S7 — Working-tree hygiene

**Symptom.** The working tree is 591 MB. `.opencode/` alone is 272 MB, of which
246 MB is a vendored `node_modules`; state backups add 9.3 MB
(`tawassul-state.json.bak.0`, `.bak.1`, and a quarantine copy). Four untracked
documents sit at the root of `docs/`, three of them large plans.

**Evidence.** Measured with `du` and `git status`. `.opencode/` is gitignored,
so this is disk hygiene, not repository contamination. The v1 tree had the same
pattern at 670 MB, with 218 MB of `node_modules` inside the plugin directory
and ten state files tracked by git.

**Why separate.** It is an environment fix, not a code change, and it must not
be confused with the repository state, which is clean apart from the four
untracked plans.

**What closes it.** A documented development bootstrap that does not vendor
246 MB inside the workspace, state backups pruned on a schedule, the three
stale plans archived or deleted, and a tree under 350 MB.

**Estimate.** Half a day.

## 9. Change log

- v1: first draft. Withdrawn by the owner for scope expansion.
- v2: scope reduced to npm parity; agent layer corrected to the hybrid model;
  nine errors recorded in section 2.
- v3: v1 baseline added to section 5; seven separate defects recorded in
  section 8 with evidence and exit conditions. No change to G-010 scope.
- v4: v1 test count corrected to 328 files, 4,910 cases and 10,193
  assertions; S1 records the owner's structural reason for not porting the
  suite and asks for v2-shaped tests.
