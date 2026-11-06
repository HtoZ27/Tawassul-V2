# S-055 triage — v2 cutover scope

Day 4 of `PLAN.md`, 2026-10-24. S-055 is a v1 backlog dump; this table decides
each item for the v2 tree. Verdicts: **apply** (implemented in v2 now),
**v1-only** (reference defect, closed at v1 retirement, not ported), **dead**
(no longer true on either tree). Every rejected item carries one line of
evidence.

## A. Reliability and data safety

| Item | Verdict | Evidence |
| --- | --- | --- |
| Silent catches: register and fix the data-loss subset | apply (subset) | v2 has 309 `catch {` sites (census 2026-10-25); the shared persistence path is now loud (`src/services/persist-utils.ts`, `src/utils/atomic.ts`) and gated by `prove:catch-discipline`. A full census of the remaining sites is a follow-up, not a cutover gate. |
| DLQ, tick-lock, FS-lock, atomicWrite, single-flight, flushSaves, `opencode.json` backup, merge registry, learning queue | v1-only | v2 already has a DLQ (`src/services/event-hub.ts:8`), FS lock (`src/infra/file-lock.ts`), atomic write (`src/utils/atomic.ts`), flush (`src/services/persist-utils.ts`), merge guards (`prove:gen-merge-guards`), and config seeding (`ensureMinimalProjectContract`). Tick-lock/single-flight/learning queue have no v2 behavior and no measured loss. |
| 500 duplicate v1 records (`R-2434`–`R-2933`) | v1-only | S-053: one v1 persistence bug, not history. Must not migrate; owner decides the backup at v1 retirement. |

## B. Security

| Item | Verdict | Evidence |
| --- | --- | --- |
| M1–M3/M5/M7: `-e`, pager/ext-diff, consent, HMAC, fail-closed scan, mandatory pipeline | v1-only | v2 has HMAC (`src/utils/crypto.ts`), consent (`src/hooks/guards/consent-gate-guard.ts`), fail-closed policy (`src/security-policy.ts`), and the pipeline gate (`prove:pipeline-early-exit`). The `-e`/pager/ext-diff items are v1 tool-surface rules that do not exist in the v2 tool set. |
| L1–L7: quarantine, HMAC false, redact, `.env2`, restrict `npm run`, binding audit, remove IP | v1-only | v2 has quarantine (`preserveRejectedState`), HMAC false (`unwrapWithHmac`), and redaction (`src/utils/logger.ts`). `.env2`, npm-run restriction, binding audit, and the IP removal are v1 tooling/docs; v2 has no equivalent surface. |
| `execSync` injection | dead | `grep execSync src` returns 0; no v2 runtime path shells out through it. |

## C. Performance

| Item | Verdict | Evidence |
| --- | --- | --- |
| H1–H5: join, Levenshtein, stringify, trim, timer cleanup | v1-only | These are v1 code paths; the v2 boot measured 21–24ms init p95 across 10 cold boots (Day 3) and reproduced no stall. |
| M1–M6: one JSON write, dirty-only, memoize, incremental scan, config cache, map eviction, fewer timers | v1-only | v2 has 29 `setInterval` sites (census 2026-10-25) but no measured stall or memory failure; the item is a v1 implementation detail, not a v2 cutover gate. Revisit only with a measured v2 stall. |

## D. Tests and release gates

| Item | Verdict | Evidence |
| --- | --- | --- |
| Vitest coverage thresholds + `test:coverage` | v1-only | v2 has no `tests/` directory, no `vitest` dependency, no `vitest.config.ts`, and no `test:coverage` script. Importing vitest just to set thresholds over an empty suite would be theater. The v2 equivalent is `prove:proof-catalog`: <!-- generated:proof-files -->181<!-- /generated --> proof files (25 at Day 4 plus the Day 6 independence proof), each wired into exactly one gate step, with a hard minimum count. |
| 44 files without direct coverage; Replica pattern; tautological/flaky tests | v1-only | v1 test-suite inventory; v2 has no unit-test suite to repair. |
| Release gate: host version pin + smoke | apply | `scripts/release-smoke.sh` pins 2.1.4, refuses drift, builds, boots a scratch workspace with an isolated DB, asserts the plugin init line and 42 tools, and calls `health` + `help` directly. Wired as `smoke:release` in `ci`. |
| CI H1–H5, 16 Medium, 9 Low hardening | v1-only | v2 has no remote; the item is owner-blocked until the first CI exists. The local `ci` chain is the current gate. |

## E. Dead code and architecture

| Item | Verdict | Evidence |
| --- | --- | --- |
| Delete 4 schemas, freeze `ROLE_BLOCKED`, remove caps, P5 exports | v1-only | `ROLE_BLOCKED` is absent from v2 (`grep` returns 0 files); the schema/export cleanup is a v1 refactor with no v2 cutover impact. |
| Infra layer split, shared `types/`, decompose `agent-management`/`tool-execute`, dependency cleanup | v1-only | Large v1 refactor; v2 already has its own module layout and no cutover dependency on it. |
| `docs/` backlog: StateManager merge, DI, export, codemap | v1-only | v1 documentation/refactor plan; v2 documents its own tree in `PLAN.md`, `SHARED.md`, and `DECOUPLING.md`. |

## F. i18n, docs, platform, and config

| Item | Verdict | Evidence |
| --- | --- | --- |
| 1761 literal lines vs 214 `t()`, dead keys, contradictory numbers | v1-only | v2 is English-only by project rule; `src/i18n/en.json` plus `src/translations.ts` hold the single English dictionary, so there is no Arabic dictionary to translate or unify. |
| RULES Linux-only, `TAWASSUL_DEBUG` unify, env docs, derive permission block | v1-only | v2 uses `TAWASSUL_DEBUG` consistently in two files (`src/services/event-hub.ts:7`, `src/utils/logger.ts:2`), has no `.env.example`, and derives tool permissions in `src/security-policy.ts`. |
| `TAWASSUL_DEBUG` duplicated in `.env.example` | dead | v1-only file; v2 has no `.env.example`. |

## G. Agent permissions

| Item | Verdict | Evidence |
| --- | --- | --- |
| Whitelist gaps, safe pipes, rejection messages, AGENTS.md sync, explicit list, risk score | v1-only | v2 already ports the dispatch guards (`src/hooks/guards/dispatch-guards.ts`), agent management, and resource guards. Replacing `calculateRiskScore` is a product decision, not a cutover blocker. |
| `calculateRiskScore` still exported | v1-only | Still present in v2 (`src/discussion/voting.ts:61`, consumed at `src/hooks/guards/resource-guards.ts:72`); replacing it is a behavioral change with no proven v2 defect. |

## H. Dynamic behavior and feature gaps

| Item | Verdict | Evidence |
| --- | --- | --- |
| 6 denies, `ls|sort`, memory rescue, session sweep, P-M6, fuzzer, prune/backup cap, pre-HMAC message, routing eval, E2E, Top 1–15, capability statement, rejection counter, golden set, pipes, Task Unification, loop-guard, STATE_DIR spacing | v1-only | These target v1 services and tool behavior; v2 has different services and no measured equivalent failure. |
| M-2 silent state loss | apply | `preserveRejectedState` now logs a loud warning when quarantine fails, and `prove:catch-discipline` guards the shared persistence path. |
| 806 backup files | dead | `find` over both state roots returns 0 `.bak` files (2026-10-24). |

## I. Hook surface and orchestration gaps

| Item | Verdict | Evidence |
| --- | --- | --- |
| v1 hooks missing `file.edited`, `permission.asked/replied`, `todo.updated`, `shell.env`, `tui.*`, `lsp.*`, `session.*` | dead (v2) | v2 subscribes to the whole host stream with `ctx.event.subscribe()` (`src/v2/setup.ts`); `mapV2EventToV1` maps the `session.*` family that has consumers. Adding mappings without consumer behavior would be noise. |
| F5 addagent hint, R25 subagent injection | v1-only | v1 prompt text and v1 subagent path; v2 has its own ask/handoff bridges. |

## J. Upgrade, review, skills, and conditional fixes

| Item | Verdict | Evidence |
| --- | --- | --- |
| UPGRADE: locks, e2e, version guards, SDK sync, v2 port | v1-only | v2 is the port; the host pin is enforced by `scripts/release-smoke.sh`. |
| REVIEW code-state/checkpoint coverage, F-03…F-56 | v1-only | v1 review backlog; v2 has `codestate`/`checkpoint` proofs and no equivalent F-item. |
| SKILLS `--local` proof, forge path | v1-only | v1 skill tooling; v2 does not ship that skill surface. |
| Conditional PERF/REVISIONV/MULTI-PROJECT items | v1-only | Owner/measurement decisions on v1; no v2 code path or proven impact. |

## K. Blocked on the owner

| Item | Verdict | Evidence |
| --- | --- | --- |
| 8024-session migration tool, `events.jsonl`/`goals` caps, full v1→v2 conversion, remote/CI | v1-only (owner) | These need an owner decision, credentials, or a separate migration program; none is a v2 code fix. The v2 cutover uses the namespace and guard work already committed. |

## L. Boot-stall plan remainders

| Item | Verdict | Evidence |
| --- | --- | --- |
| M2.2 heavy-work deferral, persist-write batching | dead (v2) | Not shipped in v1 either; v2's 10 cold boots pass with 21–24ms init and no stall. Revisit only with a measured v2 stall. |
| M2.5/M1 autoupdate monitor + D7 recalibration note | apply (done) | The v2 launcher exports `OPENCODE_DISABLE_AUTOUPDATE=1` (`scripts/opencode-v2-iso.sh:87`); the D7 rotational recalibration is recorded in Day 3 (`d7=rotational-disk`). |
| M3 final N1/N5 protocol | apply (done) | Day 3: 10/10 cold boots, explicit `--since`, N5 N/A because 2.1.4 emits no project-copy refresh lines. |
| A8 automated import | v1-only | Deferred/experimental in v1; v2 does not import v1 sessions. |
| D2 Stage 2 self-bootstrap | v1-only | v2 has its own first-boot seed and `prove:first-boot`; the v1 installer gate does not apply. |
| 87 test dirs + `git worktree prune` | v1-only (owner) | Deferred by owner order; outside the v2 plan. |

## Explicitly not transferred

| Item | Verdict | Evidence |
| --- | --- | --- |
| Live measurements (RSS, last-write-wins, clean install, memory sample, vortex) | v1-only | User-owned measurements, not code fixes. |
| Time windows (D3 close, log freeze, D7 20 boots, first V2 launch) | v1-only | Verification/owner actions; the D7 runner was S-053 and is done for v2. |
| Intentionally accepted/rejected items | v1-only | Accepted v1 trade-offs; not defects. |
| Dead sub-items (`tawassul-agent-cli.sh`, 3/5/5 thresholds, `rg|jq`/`cat|grep`) | dead | Already archived/done in v1 (`55012f7d`/`6ac92f1f`). |
| v2 program itself | v1-only | Covered by S-042…S-048, S-053, S-056. |
| Dead-since-written sections, dead links, orphan test comment | dead | No functional break; do not re-open. |

## Known constraints (v2)

| Constraint | Evidence | Consequence |
| --- | --- | --- |
| `callDepth` counts dispatches per session, never per nesting level | `src/hooks/guards/dispatch-guards.ts:235–251` increments the parent session only | A child session starts at 0, so the `callDepth !== 0` test cannot tell a child from a root session |
| Exempt reconnaissance does not increment the depth counter | `src/hooks/guards/dispatch-guards.ts:243–247` | A session that only calls `@explore`/`@general` keeps `callDepth = 0` and stays subject to the routed-turn shell block |
| The exemption has a cliff | `src/hooks/PipelineState.ts:31` (`MAX_EXEMPT_CALLS = 20`) | The twenty-first exempt call counts toward the three-dispatch budget |
| Host nesting is a config value, not plugin code | `experimental.subagent_depth` in the project config; the host default is 1 | The plugin cannot raise or lower it; the seed writes 3 for new projects, and existing projects must set it once |
| The depth ceiling has a config knob | `src/context/config-schema.ts:14` (`maxCallDepth` 1..20) | 3 is the default, not an immutable constant; the owner chose to leave the upper bound open |
| `callDepthGuard` skips unnamed callers | `src/hooks/guards/dispatch-guards.ts:32` | A host that omits the agent name bypasses the plugin ceiling entirely |

## Day 4 outcome

- Applied: release smoke (`scripts/release-smoke.sh`), catch discipline
  (`scripts/prove-catch-discipline.ts`), proof catalog
  (`scripts/prove-proof-catalog.ts`), and the M-2 quarantine warning.
- Rejected with evidence: the v1 vitest coverage item (v2 has no vitest or
  test suite; the proof catalog is the v2 threshold), and every row marked
  `v1-only` or `dead` above.
- The Day 4 exit is met by the v2 gates, not by importing the v1 suite:
  `npm run verify`, `prove:proof-catalog` (<!-- generated:proof-steps -->178<!-- /generated --> proof steps plus the catalog
  check, every proof wired into the gates), `prove:catch-discipline`, `smoke:release` (host 2.2.0 range, scratch
  boot, 42 tools, health + help), and a green `npm run ci`.
