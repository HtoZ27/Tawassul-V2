# Shared Issues Log — Tawassul v1 <-> v2

Every entry records a problem shared by both versions, how it was fixed, and anchors to the actual code in each version.

Format rules (enforced by `scripts/check-shared-anchors.mjs`):
- `v1/` prefix anchors into `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/`
- bare anchors resolve inside this V2 project
- every anchor must exist in the referenced file
- content is English only

---

## S-001 Plugin entry shape

The v1 plugin is a function returned inside an object; the v2 plugin must be constructed with `Plugin.define`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/plugin.ts:12` — default export `{ id, server }` where server is the real entry |
| v1 fix | `v1/plugin.ts:12` — single-file artifact re-exports it; runtime discovers without `plugin:` config |
| v2 problem | `src/index.ts:4` — `Plugin.Plugin.define` only accepts `{ id, setup }`, cannot carry a v1 `server` |
| v2 fix | `src/index.ts:6` — plain object `{ id, server, setup }`; the host ducks-types whichever field it recognizes |

## S-002 ESM package exports break require.resolve

`@opencode/plugin@2.0.3` ships `exports` conditions with no CJS `main`; `require.resolve` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/build.mjs:27` — external list is static via `bun build` (no runtime resolve) |
| v1 fix | `v1/build.mjs:56` — external packages resolve via upward node_modules walk at load time |
| v2 problem | `build-v2.mjs:12` — first cut used `createRequire` resolve → crashed |
| v2 fix | `build-v2.mjs:14` — `import.meta.resolve` honors ESM `exports` conditions |

## S-003 Tool execute return type

v2 tool `execute` must return `Promise<Result>` in the promise API domain; an Effect is not awaited by the caller.

| | Anchor |
| --- | --- |
| v1 problem | `v1/plugin-types.ts:15` — v1 hook contract wraps tool results via `Omit<OfficialHooks, ...>` |
| v1 fix | `v1/bootstrap/plugin-init.ts:794` — return object builds `tool.execute` callbacks directly |
| v2 problem | `src/v2/adapters.ts:42` — v1 `ToolResult` is `string | { output, metadata }`, not a v2 `Tool.Result` |
| v2 fix | `src/v2/adapters.ts:72` — `return toV2Result(result)` bridges the return inside `makeV2Tool.execute` |

## S-004 Version double-guard (fail-open)

The merged bundle must refuse to run on the wrong host instead of half-initializing.

| | Anchor |
| --- | --- |
| v1 guard | `v1/plugin.ts:12` — v1 runtime loads this file only; no `>=2` host exists |
| v2 guard | `src/v2/setup.ts:122` — capability probe aborts setup when session/tool domains are missing |

## S-005 Minimal-surface port for type closures

The v2 build is incremental: `context/constants.ts` needed `getAllowedToolsForRole` (via `agent-templates → render-agent`), but the full `security-policy.ts` drags Arabic i18n/NLP closures (translations, stem, arabic-roots.json) that are not yet ported. The port only copies what the render path needs.

| | Anchor |
| --- | --- |
| v1 problem | `v1/security-policy.ts:641` — role→tool map + `getAllowedToolsForRole` (dedicated 20-line section) |
| v1 fix | `v1/security-policy.ts:666` — single source of truth for the role matrix |
| v2 problem | `src/security-policy.ts:1` — naive full port pulled translations + stem + JSON NLP data |
| v2 fix | `src/security-policy.ts:5` — minimal map + function, no dependency on i18n/NLP |

## S-006 Arabic code references survive auto-port

The port strips comments and skips Arabic-literal files, but bilingual language machinery (locale maps, `"ar"` display fields, `lang: "ar" | "en"` parameters, agent instructions naming Arabic) can survive as valid ASCII and pass `check:rules`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/core/model-registry.ts:22` — every entry carries `display: { ar, en }` bilingually |
| v1 fix | `v1/security-policy.ts:666` — v1 is intentionally bilingual via the translations service |
| v2 problem | `src/core/model-registry.ts:11` — bilingual display shape and `lang` params survived auto-port |
| v2 fix | `src/core/model-registry.ts:11` — single `string` display, `lang` params dropped (English-only) |

## S-007 Full-tree port re-writes hand-fixed files

Re-running the tool with no args (`node scripts/port-from-v1.mjs`) copies every clean v1 file and overwrites manual English rewrites of files that contain no Arabic literals. After the full-tree pass, `model-registry.ts`, `constants.ts`, `priority-types.ts`, and `context/types.ts` silently regressed to bilingual shapes.

| | Anchor |
| --- | --- |
| v1 problem | `v1/core/model-registry.ts:22` — clean file (bilingual strings, no Arabic script) re-portable |
| v1 fix | `v1/core/model-registry.ts:177` — caller contract: `getUserFacingModelName(id)` takes no `lang` |
| v2 problem | `src/core/model-registry.ts:11` — bilingual display shape reintroduced after manual fix |
| v2 fix | `src/core/model-registry.ts:11` — single `string` display restored; manual files must be re-checked after any full-tree port |

## S-008 English-locked translations stub

The v2 build needs `translations.ts` (SKIP_FILES) for 36 importers, but the v1 file statically imports both `i18n/en.json` and Arabic-heavy `i18n/ar.json` and a logger. The v2 stub is English-only: `Lang = "en"`, locale cache holds only the English dictionary, `ar` resolution removed.

| | Anchor |
| --- | --- |
| v1 problem | `v1/translations.ts:1` — imports `ar` + `en` JSON and `utils/logger` |
| v1 fix | `v1/i18n/en.json:1` — full English dictionary (single source for v2 stub) |
| v2 problem | `src/translations.ts:1` — stub must exist for 36 importers but must not pull Arabic |
| v2 fix | `src/translations.ts:5` — English only, no logger dependency, `t` resolves from `en` |

## S-009 Dual-entry v1/v2 adapter (reference: oh-my-opencode-slim)

Cross-version plugin pattern proven by the third-party `oh-my-opencode-slim` package (studied at ~/Desktop/oh-my-opencode-slim-3.0.0-beta.10): one default export `{ id, server, setup }` — the v1 host loads `.server` (the unchanged v1 factory), the v2 host loads `.setup(ctx)` (an adapter). The adapter wraps the SAME v1 factory so all build logic is reused, then translates the returned v1 hooks into v2 registrations: agent/tool/command drafts, the session context hook (system/messages transforms), the `session.prompt` hook (with context-hook fallback on older hosts), tool `execute.before/after` hooks, and the event subscription. Each bridged hook is individually try/catch-guarded. Reference modules in the study package: `src/v2/index.ts`, `src/v2/setup.ts`, `src/v2/adapters.ts`, `src/v2/types.ts`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/plugin.ts:12` — v1 host calls `.server`; v2 host has no `.server` path |
| v1 fix | `v1/plugin.ts:12` — v1 shape kept untouched as `.server` |
| v2 problem | `src/index.ts:4` — entry was `Plugin.Plugin.define`, single-host only, no `server` field |
| v2 fix | `src/index.ts:7` — `{ id, server, setup }` dual export; `setup` is `createV2Setup()` which wraps `initPlugin` via the v2 shim |

## S-010 Conflict-marker debris from stale lint-staged stash applies

A stale lint-staged automatic-backup stash applied onto a much newer HEAD leaves `<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes` markers inside tracked files. In v1 this hit 38 files at once — `opencode.json` (breaks OpenCode boot with a JSONC parse error), plugin sources, tests, docs, and the built `dist/`. The port tool copies v1 files verbatim, so without a guard the marker debris ports straight into v2 sources and fails `check:rules`.

Resolution in v1 is a git operation, not a code edit: take the HEAD ("Updated upstream") side of every hunk, drop the stale stash side, restage, and rebuild `dist/`.

| | Anchor |
| --- | --- |
| v1 problem | `v1/scripts/gen-opencode-config.ts:53` — `<<<<<<< Updated upstream` marker inside the import block |
| v1 fix | `v1/tool-names.ts:45` — keep the HEAD side of each hunk; the stale stash side is dead weight |
| v2 problem | `scripts/port-from-v1.mjs:82` — `readFileSync` reads whatever v1 has, markers included |
| v2 fix | `scripts/port-from-v1.mjs:9` — conflict-marker regex; `scripts/port-from-v1.mjs:83` — SKIP guard runs before the write |

## P0.7 Shared 2.0.0 runtime fixes — DONE on v2 (baseline for S-011/S-012)

Two runtime fixes from the 2.0.0 shared work are already implemented and verified in v2:

| # | Fix | Where |
|---|-----|-------|
| P1 | Un-stick stuck tasks: `updateStatus` rebuilds a stale reverse index once and retries before giving up, so a real task is always reachable | `src/services/mission-board.ts` — `updateStatus` rebuild + retry path |
| P2 | 3-second save-window handle is unref'd (`setTimeout(...) + unref()`) so the window never keeps the process alive | `src/services/state-persistence.ts` — save-window timer |

The remaining contested batch (session provenance for board tasks) is fully covered by S-011.

## S-011 Status-change index sync + session provenance (loop guard) — IMPLEMENTED on v2

`updateStatus` persists the board but never refreshes `index.json`, so a finished board can keep showing as `active` there and the model re-queues done work in a loop. Separately, `TaskItem` carries no session identity, so the model cannot tell work done by another session apart from its own. Ownership: v1 side states the problem and the proven fix shape; v2 agents implement in this tree.

| | Anchor |
| --- | --- |
| v1 problem | `v1/services/mission-board.ts:224` — `persistAndLog` without `scheduleIndexWrite` inside the status-change path; no `sessionId` anywhere in the file |
| v1 fix shape | `v1/services/mission-board.ts:232` — stale-index rebuild + retry (un-stick) covers the write path only, not the index or provenance |
| v2 problem | `src/services/mission-board.ts:240` — persist without index sync in `updateStatus`; `src/services/mission-board.ts:24` — `TaskItem` without session identity |
| v2 fix | in `src/services/mission-board.ts:240` call `scheduleIndexWrite()` after `persistAndLog`; add `sessionId?: string` to `TaskItem` at `src/services/mission-board.ts:24`, accept it via `updateStatus` at `src/services/mission-board.ts:208`, store and emit it, carry it on the event at `src/services/event-hub.ts:77`, and render it in `src/tools/tawa/show-board.ts:45` |

## S-012 Completion invariant — close-only + droppable closed goals + true CAS (loop guard, proven CAS shape) — IMPLEMENTED on v2

`updateStatus` in v2 can flip a `completed` board back to `active` with no close-only guard and no real compare-and-set, so done work gets re-queued in a loop the same way the stale index caused (S-011). v1 solves this in the goal store itself: `completed` is final + physically droppable, and the invariant is enforced by a true CAS gate — never by prompts.

| | Anchor |
| --- | --- |
| v1 problem | `v1/services/goal-store.ts:115` — `completed` invariant enforced HERE (not in prompts); `v1/services/goal-store.ts:117` — completed goals physically dropped from `list("completed")` |
| v1 fix | `v1/services/goal-store.ts:8` — CAS-grade mutual exclusion (HMAC never suffices); `v1/services/goal-store.ts:131-135` — `completed` is close-only and droppable (`in_progress`→`blocked`→`completed` are allowed, `completed` re-open never) |
| v2 problem | `src/services/mission-board.ts:240` — `updateStatus` without a CAS gate; `src/services/mission-board.ts:24` — `TaskItem` with no completion invariant |
| v2 fix | in `src/services/mission-board.ts:240` enforce close-only: a `completed` task cannot be reopened; use a true CAS (compare-and-set on the persisted status) before applying the transition; represent droppable-closed goals so closed work is physically removable from the board |

## S-013 Role-scoped permissions + record/eval read-back + MCP boundary (security hardening) — IMPLEMENTED on v2

v1 ships a role-scoped security policy (role→tool matrix, role-scoped plugin permissions, record/eval read-back guard, and an MCP boundary guard); v2 implements all three surfaces: the role→tool matrix (`getAllowedToolsForRole`) in `security-policy.ts`, read-back on the record/eval tools plus a persistence-read-back guard that discloses stale on-disk saves, and the MCP boundary guard as the once-per-session `SYSTEM_CONCORDANCE_TEXT` injection ("Never search plugin files or the MCP server").

| | Anchor |
| --- | --- |
| v1 problem | `v1/security-policy.ts:146` — role-scoped permission matrix (role→tool) |
| v1 fix | `v1/security-policy.ts:641` — `getAllowedToolsForRole` single source of truth |
| v2 problem | `src/security-policy.ts:532` — `TAWASSUL_TOOL_ROLES` role→tool matrix already present; `src/tools/record.ts:50` and `src/tools/evaluation-report.ts:106` — read-back via `record(get/list)` and `evaluationreport(get: true)` already present; `src/hooks/message-updated.ts:487` — `SYSTEM_CONCORDANCE_TEXT` already deflects plugin-file/MCP hunting |
| v2 fix | `src/security-policy.ts:542` — `getAllowedToolsForRole` present as the single source of truth; persistence read-back guard added: `getSaveHealth()` wired through `src/services/state-persistence.ts:593`, `src/services/lifecycle-manager.ts:35`, `src/context/facades/state-facade.ts` → `src/context-class.ts:490`; write paths now `await ctx.saveState()` and append a `⚠️ Persistence warning: on-disk save failed (N)` disclosure when stale (`src/tools/record.ts` write path, `src/tools/evaluation-report.ts:173`) |

## S-014 Standalone health tool — IMPLEMENTED on v2

v1 ships a standalone health tool (`agent-health.ts` + test) as its own tool; v2 ports it as `src/tools/tawa/health.ts` registered under the `health` tool name.

| | Anchor |
| --- | --- |
| v1 problem | `v1/services/agent-health.ts:20` — standalone health tool |
| v1 fix | `v1/services/agent-health.ts` — health tool as a distinct tool file + `v1/tests/health-tool.test.ts` |
| v2 problem | `src/tools/` — no health tool file |
| v2 fix | add `src/tools/tawa/health.ts` exposing a standalone health tool mirroring `v1/services/agent-health.ts` |

## S-015 Old `kanban-board` naming removed from v1 — DONE on v1 (baseline, do NOT re-implement in v2)

The legacy twin `kanban-board` (old name for `mission-board`) has been deleted from v1. v2 must keep its own `mission-board` (already the live name) as-is; nothing called `kanban-board` remains to port.

| | Anchor |
| --- | --- |
| v1 problem | `v1/services/kanban-board.ts` — GitHub-stash twin sitting next to the live `v1/services/mission-board.ts`; dead duplicate, and git status listed both files as `UU` |
| v1 fix (applied) | commit `b935531c` — `git rm v1/services/kanban-board.ts` + `v1/services/kanban-board.test.ts`; live twin `v1/services/mission-board.ts` + `v1/services/mission-board.test.ts` carries all behavior; grep for `kanban-board` is empty across the whole v1 tree |
| proof on v1 | `npx vitest run services/mission-board.test.ts` — 19/19 green |
| note for v2 | treat `mission-board` as the single source of truth; do not recreate a `kanban-board` name anywhere in `src/` |

## S-016 Conflict-marker pollutants resolved on v1 — DONE on v1 (baseline, do NOT propagate in v2)

v1's `git stash` cycle left `<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes` markers in tracked files; those markers break typecheck with `TS1185` and would otherwise be ported verbatim by the port tool.

| | Anchor |
| --- | --- |
| v1 problem | whole v1 tree carried conflict markers (reported as `UU`/`UD` in git status); `npx tsc -p . --noEmit` failed with `TS1185` at every marker |
| v1 fix (applied) | commit `b935531c` — every hunk resolved toward the live side (`normalizeName`/mission-board semantics), markers removed in 23 files / 50 blocks; `dist` rebuilt from the clean source; `npx tsc -p . --noEmit` green (exit 0) |
| proof on v1 | conflict-marker scan is empty across the whole tree; `scripts/port-from-v1.mjs:82` stays guarded against any future marker |
| note for v2 | anchor the port guard: `scripts/port-from-v1.mjs:83` SKIP-on-marker must remain; never ship a file to v2 that still contains a `<<<<<<<` line |

## S-017 Three-day v1 hardening batch (2026-09-20 → 23) — IMPLEMENTED on v2

18 v1 commits (`62d31cba` → `ad40a084`): suite 292 files / 4926 tests green (started 287/4861), contract 51 → 44 agents, `dist` LOAD 40. Already applied to V2 by the v1 side: model rename + retired registration + contract regen (`7f9a2b4`, 4 source files). Everything below is for the V2 team to port themselves — v1 will not touch V2 sources again. Standing rules both sides follow: English-only code; no usage-guide docs (unread) / no prompt injection (latency); provider traffic never guarded; end-user installs receive tools only.

### A. Model retirements (user rulings: mimo renamed, minimax/kimi dead, muse-1.3 canonical)

| | Anchor |
| --- | --- |
| v1 rename | `v1/core/model-registry.ts:37` id → `mimo-v2.6-flash-free`, display `v1/context/model-utils.ts:158` |
| v1 retired set | `v1/core/model-registry.ts:114` (mimo-v2.5, kimi, muse-1.2 exact id, deepseek, nemotron, ox, hy3) |
| v1 guards keep old id | `v1/scripts/gen-opencode-config.ts:263` + `v1/scripts/gen-opencode-config.ts:912` (retired-id migration detection, intentional — do NOT "clean" these) |
| v1 pins sidecar | 5 base overrides recorded; architect/designer are template-clean and need none (template emits 1.3 for those two, diversified heads for the rest) |
| v1 quarantine | `v1/tests/root-generator-quarantine.test.ts:12` mirrors registry set (single source — add future retired ids ONLY to the registry, the test follows) |
| v1 root emitter hygiene | retired-pin defs stripped (deep/hy3/kimi/minimax), per-role concrete heads replace `dynamic`, localhost-curl + `plugin` key deleted (root `scripts/generate-opencode-config.mjs` — outside anchor scope, referenced by name only) |
| v2 done | `src/core/model-registry.ts:16`, `src/core/model-registry.ts:75` + `src/context/model-utils.ts:141` (renamed + retired, commit `7f9a2b4`) |
| v2 todo | chain heads to 1.3 where still 1.2: mirror `v1/services/proxy-fallback-chains.ts:42`; your chains already carry mimo-v2.6 (`src/services/proxy-fallback-chains.ts:6` — verify rest incl. architect head: v1 found architect pinned to dead minimax and repinned to 1.3) |
| v2 todo | state residue: `.opencode/tawassul-state.json:1` envelope still pins `analyst-mimo → mimo-v2.5-free` (HMAC-signed: re-sign via your key code, NEVER hand-edit); your registry already retires it (`src/core/model-registry.ts:77`), so boot sweep should clear it — verify, do not rebuild state by hand |

### B. Generator hardening

| | Anchor |
| --- | --- |
| v1 in-lock build + honored verify | `v1/scripts/gen-opencode-config.ts:1193` (project+global twins; build INSIDE lock, verify failures throw — the old code built outside and discarded results) |
| v1 silent-exit kill | `v1/utils/opencode-config.ts:313` (ref'd backoff; unref'd timer exited 0 SILENTLY under contention — exposed by the proof test below, not by inspection) |
| v1 lock proof test | `v1/tests/gen-lock-contention.test.ts:1` (real child: refuse-while-held, run-after; lesson: async test fns must await inside try — a `finally` deleting tmpdir fires before a returned promise settles) |
| v1 A5 permission compare + hybrid pins | `v1/scripts/gen-opencode-config.ts:1040` (canonicalized deep compare) + pin-aware model check (template OR pins sidecar; unpinned drift fails with message) |
| v1 facts assert-first + retired param + ci scripts | `v1/tests/facts-guard.test.ts:23` (heal only behind flag), A3 parametrized test, `check:config`/`ci` in package.json |
| v2 todo | mirror in `src/scripts/gen-opencode-config.ts:145` (your guard sites) + `src/utils/opencode-config.ts:362` + write the lock-contention proof test FIRST (it is what exposed our silent-exit bug) |

### C. Governance (the chaos-vector closure)

| | Anchor |
| --- | --- |
| v1 unmanaged boundary | `v1/hooks/validation-pipeline.ts:277` (redirect + roster + consent; main session exempt by root boundary — owner hand-edits untouched by construction, locked by test) |
| v1 roster split (tier-free) | `v1/hooks/guards/permission-guard.ts:133` + stage wiring; variant `.md` via scoped regex (never bare `.md` — README/docs must not match); pins shrink mirrored; state.json EXCLUDED by design (flow audit first) |
| v1 add-detect + empty/miss + protected+disk keys | key-diff block (adds AND deletes, base AND variant — tool-internal fs + main session never reach the hook); empty payload = wipe = block; oldString-miss = unverifiable = block |
| v1 F4 allowlist | `v1/tools/agent-add-helpers.ts:239` gate on registry-derived `v1/core/model-registry.ts:168` — NOTE the placement trap: the FIRST attempt gated in `validateAddInput` post-compound block, which is UNREACHABLE (compound `continue`s earlier); the live gate sits on the compound path itself. Port the live placement, not the obvious one. |
| v1 init fail-closed | `v1/bootstrap/plugin-init.ts:915` (consent-requiring tools only — full closure would deadlock boot) |
| v1 tests | `v1/hooks/guards/roster-boundary.test.ts:1` (11 tests incl. main-session-ease lock + blockingGuard attribution) |
| v1 tier verdict (DO NOT re-litigate blindly) | full permissionGuard stays VALIDATION-scoped: blunt wiring broke 7 dev-bash tests, narrowing broke 20 tier-denial tests — BOTH pinned sets legitimate; roster stage covers ESSENTIAL. Any tier redesign must satisfy all four suites together. |
| v2 todo | port to `src/hooks/validation-pipeline.ts:199` + `src/hooks/guards/permission-guard.ts:31`; keep your tier gate VALIDATION-scoped |

### D. Runtime hardening (one line each — port mechanically; all English-only)

| Fix | v1 anchor | v2 pointer |
| --- | --- | --- |
| ledger swap-pre-await + requeue | `v1/services/handoff-ledger.ts:70` | `src/services/handoff-ledger.ts:65` (different shape — adapt: swap before await, requeue at front on failure) |
| goal re-read in lock (3 sites) | `v1/services/goal-store.ts:553` | mirror in your goal-store |
| session registry under file lock | `v1/context/session-manager.ts:60` (best-effort fallback preserved) | mirror |
| deferred wakeup timer | `v1/services/state-persistence.ts:535` + lenient-complete budget comment (max(), never min() — min would persist secrets unsanitized) | mirror both halves |
| Thompson priors persist + pure getReport | `v1/services/trust-score/calculator.ts:98` | mirror (repeated reads diluted trend + evicted genuine history at limit) |
| elicitation fallback audited | `v1/hooks/message-updated.ts:777` (behavior unchanged, warn added) | mirror |
| deletion sentinel throws | `v1/utils/opencode-config.ts:719` (+outer twin; eslint `preserve-caught-error` demands `{cause}`) | mirror |
| dirname-realpath fallback | `v1/utils/path.ts:99` (sibling function already did it right — mirror, don't invent) | `src/utils/path.ts:97` |
| stored-chain audit (mutex kept) | `v1/tools/agent-management.ts:118` (fail-fast would poison the key forever — audit, don't gate; kick flows already await each step) | mirror + read this note twice |
| logger redact + cycle + stringify | `v1/utils/logger.ts:51` (over-depth→REDACTED; path-based WeakSet with delete-on-exit so DAG-shared refs still render; stringify fallback marker) | `src/utils/logger.ts:45` |
| HMAC fail-clean | `v1/utils/crypto.ts:410` (hex-regex + try/catch; non-hex 64-char threw inside timingSafeEqual) | `src/utils/crypto.ts:335` (same unguarded shape — port directly) |
| token out of env | `v1/tools/image-gen.ts:83` (module memory; env still read as fallback) | `src/tools/image-gen.ts:51` |
| image fallback grounded | `v1/services/image-router/index.ts:150` (next-preferred, not first-available) | `src/services/image-router/index.ts:32` |
| short-task validation order | `v1/services/third-party-validator.ts:31` (identity+breaker before length shortcut; test rewritten, no-skip proof) | `src/services/third-party-validator.ts:32` |
| handoff rule-error blocks | `v1/tools/handoff.ts:647` (strict blocks hard, non-strict warns+continues — check your strict semantics match) | `src/tools/handoff.ts:599` |
| npm/pnpm/yarn + git allowlists | `v1/utils/secure-exec.ts:17` (lifecycle scripts; pnpm/yarn bare-script forms; git diff display-only — CAUTION: your git_diff tool equivalent needs `--stat/--unified/--no-color/-p`, our suite caught the break pre-commit) | `src/utils/secure-exec.ts:14` |
| unique web temp files | `v1/tools/web.ts:478` (Date.now+randomBytes — fixed-name race) | `src/tools/web.ts:215` area |
| slot-wait deadline | `v1/services/event-hub.ts:429` (timer deliberately ref'd — B1b lesson; first attempt deadlocked: awaiting capacity-only never re-runs the date check, needs the race) | mirror + read this note twice |
| trust/event P1 proof tests | `v1/services/event-hub.test.ts:830` (saturate 1000 slots), trust read-stability test | mirror patterns |

### E. Tests/CI patterns (port the patterns, not verbatim)

`v1/tests/lifecycle-import-lint.test.ts:55` (comment-strip census, 172 sites/55 files across 12 dirs — build YOUR OWN inventory; our first over-broad attempt exploded to 55 files of noise and was reverted on the spot: detector stays at comment-only emptiness); `v1/tools/web-ssrf.test.ts:1` (28 evil/benign; CIDR `v1/tools/web.ts:299` octal-aware short-form parser; legacy messages preserved first — new checks are backstop-only); logger poll (`v1/utils/logger.test.ts:8`, 5s/25ms — replaces fixed 60ms flake); jitter left deliberately (boot timing, no observed exit); F3 documented as availability-vs-grant (missing tool fails loudly by host — no code change); A6 `check:config`/`ci` scripts.

### F. S7-redirect closure (agreed residual — own your Firecrawl deployment)

Zero direct fetch exists in `v1/tools/web.ts` (all via Firecrawl `baseUrl()`); per-redirect DNS revalidation is structurally impossible in-plugin. v1 closed it with initial-URL CIDR only. If your Firecrawl is self-hosted on your network, the residual risk is YOURS at the network layer, not the plugin.

### G. Product decisions v2 must make itself (not code)

1. **`general` grants without a `general` agent**: 98 grants in your `opencode.json:72` (v1 identical — root file, see `v1/security-policy.ts:99` helper list + `v1/AGENTS.md:121` documenting @general for reports). Options: (a) implement a real @general report agent (matches existing docs on both sides), (b) strip the grants (change your TASK_PERMISSIONS equivalent + regen contracts), (c) document-and-leave (safe today: grants to nonexistent = no-op; latent only if the name is ever created — and creation would then silently inherit broad task rights).
2. **F1-tier end-state**: leave VALIDATION-scoped (v1 verdict after refuted narrowing). Do not re-litigate without redesigning getTier + all suites together.
3. **Root emitter**: v1 keeps `.mjs` quarantined-by-test (4-1 vote over deletion: deleting loses the guard target for zero security gain). Your call for any v2-side emitter.

### H. Process notes (saves you days — learned the hard way)

1. **d.ts emit is stricter than `tsc --noEmit`**: broke our build on `as LogData` casts (fix: `as unknown as`). Run the real build in CI, not just typecheck.
2. **The suite rebuilds `dist/` as a side effect** (chunk-hash rotation): always `git checkout -- dist/index.d.ts` formatting churn before committing, and expect `D`+new-chunk pairs in every build commit.
3. **Pre-commit hook (husky lint-staged: prettier + eslint)** rejected us twice (`preserve-caught-error` on throws, `no-useless-assignment` on lock patterns) — fix, don't bypass; a failed hook leaves half-staged trees (verify with `git status` before retrying).
4. **Proving tests catch real breaks**: our git-diff allowlist broke the legit `git_diff` tool flags pre-commit (suite saved us); our tier narrowing broke 20 pinned tests (reverted); an over-broad census detector exploded 15→55 files (reverted on the spot). Trust red suites over analyst prose — including ours.
5. **Flake family (parallel load)**: logger 60ms (fixed via poll), E2E count overflow (cross-test interference), benchmark timing margins — all green in isolation; rerun full suite once before blaming code. Memory rule that saved the machine: keep 1.5GB free before heavy runs (`free -g` first).
6. **vitest transform runs TS directly** (`node scripts/*.ts` works on node 24 — no tsx needed); child-process tests must `await` inside try (a `finally` deleting tmpdir fires before a returned promise settles).
7. **Test bugs we wrote ourselves** (included so you laugh once, not twice): write-vs-edit reconstruction misuse, wrong-sibling assertions, stale line numbers after file growth, async-cleanup races. Every one was caught by running the test, never by review.
8. **`/tmp/opencode` residue**: test sandboxes (`tawassul-test-*`, 244 dirs / 15MB once) accumulate from killed runs — clean periodically; ours now clean themselves via `finally` + `rmSync`.

### V2 implementation report (2026-09-24, all verified via `npm run ci`)

A: `src/services/proxy-fallback-chains.ts:5` heads repinned (reviewer/designer/doc 1.2→1.3, architect minimax→1.3); `src/core/model-registry.ts:75` retired set completed with `opencode/muse-spark-1.2-contributor-free` + kimi id (8 ids); new `sweepRetiredModelPins` (`src/services/proxy-fallback-chains.ts:76`) called at boot (`src/bootstrap/plugin-init.ts:484`, proven: analyst-mimo stale pin → gemini head); local contract 44 agents, roster names identical to v1, `architect` repinned to 1.3, `--check` green.
B: in-lock build + honored verify in both twins (`src/scripts/gen-opencode-config.ts:778`, `:817`); silent-exit verified already-correct (ref'd waits; heartbeat unref mirrors v1); proof-first `scripts/prove-gen-lock-contention.ts`; A5 canonical permission compare + pure-template/pins hybrid (`src/scripts/gen-opencode-config.ts:682`); facts `check` mode + tracked `src/FACTS.md` (agentsTotal=44) + A3/A5 proofs (`scripts/prove-gen-merge-guards.ts`); `check:config`/`check:facts`/`ci` scripts in package.json.
C: tier-free `checkRosterBoundaryDelete` + `rosterBoundaryDeleteGuard` (`src/hooks/guards/permission-guard.ts:88`, `:215`) wired into ESSENTIAL enforcement-checks (`src/hooks/validation-pipeline.ts:208`) with scoped variant-.md regex, pins-shrink, key-diff add/delete, empty/miss blocks; unmanaged edit/write/delete branch with `blockingGuard` attribution (`src/hooks/validation-pipeline.ts:246`); F4 allowlist on the compound path (`src/tools/agent-add-helpers.ts:153` + `addagentCompoundInvalidSuffix` key, proven: unknown rejected, analyst-ling valid); init fail-closed for consent tools (`src/bootstrap/plugin-init.ts:873`); `scripts/prove-roster-boundary.ts`; tier gate stays VALIDATION-scoped (G2 decided: leave).
D: all 19 rows mirrored (ledger swap+requeue; goal re-read ×4 sites; session-registry file lock; deferred wakeup + max-budget sanitize; Thompson priors persist + pure getReport; elicitation warn; deletion-sentinel throws with cause; dirname-realpath; chain audit; logger redact/cycle/stringify; HMAC hex-guard; token in module memory; next-preferred image fallback; validator order; handoff fail-closed; pkg/git allowlists with `--cached`/`--staged` adapted for v2 gitdiff; unique web temps; slot deadline with ref'd timer; P1 proofs in `scripts/prove-event-trust-p1.ts`).
E: SSRF CIDR backstop ported (`src/tools/web.ts:236`, proven `scripts/prove-web-ssrf.ts` incl. hex/octal/decimal evasions); comment census = `check:rules` (326 files enforced); logger-poll/jitter/F3 need no action per brief.
F: agreed residual, no plugin action.
G decisions: G1 document-and-leave — `task`/`handoff` `general` grants target opencode-native subagents by design (`targetsAreExploreOrGeneral` read/report paths); latent creation risk closed by `OPCODE_BUILTIN_AGENTS` reservation in addagent plus the key-diff guard blocking hand-adds. G2 leave VALIDATION-scoped. G3 keep `build-v2.mjs` (build entry, not a runtime emitter).

### V2 follow-ups (2026-09-24)
A2 residue cleared headless via project key code (`scripts/sweep-state-retired-pins.ts`: unwrap→sweep→re-sign→re-verify; analyst-mimo + general pins migrated, envelope clean). Live boot verified on host 1.18.30 (`opencode run` in sandbox: self-check + AskChannel + boot repair + healthy INIT_AUDIT + F6 regen + model reply, exit 0; the `v2 setup aborted` line is the expected V1-host branch — `server: initPlugin` drives). Dead `vitest*.ts` stubs removed (no runner, no references; bun proofs in `ci` are the pattern). Orphan `.bak` scheme files + 670 killed-run `/tmp/tawassul-*` sandboxes (7.1M) removed; managed 5-deep backup sets untouched.

— End S-017. v1 side will not modify V2 sources; V2 side owns all rows marked v2 todo. Disputes: reply in this file with anchor-backed evidence (checker enforces every `path:line`; v1 `path:` lines may drift ± as files grow — re-verify with grep, never trust numbers blindly).

## S-018 v1 commit 3af1b224 (R-008/R-009/R-011) — ported on merit, v2-shaped — IMPLEMENTED on v2

v2 differs from v1 (single-file bundle, English-only, bun proofs, no test runner, untracked runtime state) and is heading for independence: each row below was judged on usefulness to v2, not ported blindly. Skipped deliberately: AGENTS.md section (no v2 counterpart; standing rule against unread usage-guide docs), mandatory-dependency packaging (tree-sitter already bundled in `dist/index.js`), `*-muse` `.md` deletions + analyst-ling exception (v2 carries no variant `.md` files at all), F3/logger-poll non-changes.

| | Anchor |
| --- | --- |
| R-008 v1 fix | `v1/tools/agent-management.ts:429` — `skipVariantMd` (config-only variants in project scope) |
| R-008 v2 port | `src/tools/agent-management.ts:342` — same skip shape with `SPECIALIZATIONS`; matches v2 on-disk reality (zero variant `.md` files); rollback bookkeeping untouched |
| R-009 v1 fix | `v1/utils/opencode-config.ts:568` + `:633` — minimal contract + global roster seed, wired by coexistence scope |
| R-009 v2 port | `src/utils/opencode-config.ts:467` + `:519` (no comments per v2 rules) wired in `src/bootstrap/plugin-init.ts:467` + `:471`; mcp branch kept guarded (never fires — v2 has no MCP bundle); proven by `scripts/prove-first-boot-seed.ts` (create/idempotent/opt-out/scope/mcp-bundle/global-seed) |
| R-011 v1 fix | `v1/tests/lifecycle-import-lint.test.ts:44` census + `:154` prompt duty; clause in 9 base `.md` files |
| R-011 v2 port | single source `src/core/render-agent.ts:33` (`DISCLOSURE_SECTION`, appended at `:113`) covering all future writes; 8 on-disk base `.md` files carry the clause; proven by `scripts/prove-disclosure.ts` (on-disk markers + renderer markers + 21-file reviewed census — background-durability silences accepted, handoff enrichment converted to warn at `src/tools/handoff.ts:117` + `:154`) |

## S-019 v1 commit 29a4f809 atomic-audit P0 closures (WAL verify, containment, backup env, fail-closed gates) — IMPLEMENTED on v2

v1 commit 29a4f809 closes the external atomic-audit P0s (73 green): WAL-blind source probe, literal-string archive ban, missing backup env, fail-open table probes, unreliable fuser reads, missing cooldown-mark liveness. V2 ports the fail-closed shapes and vendors its own maintenance copy so the V2 launcher no longer depends on the v1 tree at runtime. Rejected with evidence on v1 (not ported): extra V2 markers already live in both working DBs, mkdir owner lock.

| | Anchor |
| --- | --- |
| P0-1 v1 fix | `v1/tests/review-fixes.test.ts:1` — WAL regression test, source probe reads WAL-inclusive |
| P0-1 v2 port | `scripts/opencode-db-maintenance.sh:338` — source session count via plain readonly, backup stays immutable |
| P0-2/6 v1 fix | `v1/tests/review-fixes.test.ts:1` — containment tests both directions, exit 2 rows untouched |
| P0-2/6 v2 port | `scripts/opencode-db-maintenance.sh:122` — canonicalize DB path, refuse symlinks, ban backup spellings, refuse DB backup overlap |
| P0-3 v1 fix | `v1/tests/installer.test.ts:1` — systemd unit carries backup env |
| P0-3 v2 port | `scripts/opencode-v2-iso.sh:35` — V2 backups stay inside the V2 profile, never in a V1 data dir |
| P0-4/5 v1 fix | `v1/tests/db-generation-guard.test.ts:1` — corrupt guard, holder and broken-fuser no-escalation |
| P0-4/5 v2 port | `scripts/guard-db-generation.sh:56` — probe prints PROBE-FAILED, caller refuses fail-closed; `scripts/opencode-db-maintenance.sh:216` — fuser holders distinguishes no-holders from unreliable |
| mark v1 fix | `v1/tests/launch-cap.test.ts:1` — mark liveness cleared on failure except exit 8 |
| mark v2 port | `scripts/opencode-db-maintenance.sh:65` — cooldown-mark option with trap clear; `scripts/opencode-v2-iso.sh:58` — launcher stamps and passes the mark |
| vendoring | `scripts/opencode-db-maintenance.sh:1` — V2 local copy with V2 defaults, V2 launcher prefers it before the v1 fallback |

## S-020 v1 nine-day batch 2026-09-26 → 2026-10-05 (tool-surface, cache, guards, wiring, burn discipline) — IMPLEMENTED on v2

Seventeen v1 commits in the window; four are bundle rebuilds and three are v1-only harnesses with no V2 counterpart (vitest type-error unmasking, dist gate budgets, pipeline early-exit proof, scheduler rotation and single-owner installer with no V2 timer or installer). Everything below was ported on merit, v2-shaped (English-only, no comments), proven by `scripts/prove-s020.ts` (21 assertions) plus `scripts/prove-roster-boundary.ts` and generator `--check`.

| | Anchor |
| --- | --- |
| bash v1 fix | `v1/tests/permissions.test.ts:1` — drift tests pin the record, the MCP deny, and fallback parity |
| bash v2 port | `src/core/agent-data.ts:41` — tawa flat deny becomes the record; `src/scripts/gen-opencode-config.ts:537` — addagent entry ditto, with flat-string re-assertion at merge; dead `ROLE_BLOCKED_TOOLS` removed from `src/security-policy.ts`; MCP disconnect not applicable (v2 has no MCP bundle) |
| cache v1 fix | `v1/hooks/guards/shared/model-cache.ts:36` — single-flight state, short negatives, generation-keyed slot |
| cache v2 port | `src/hooks/guards/shared/model-cache.ts:1` — unified slot on `getPortCacheGen`, single-flight shared fetch with per-caller abort race, fail-closed short negatives, `getModelListProvenance` disclosure |
| throttle v1 fix | `v1/hooks/guards/shared/warn-throttle.ts:20` — first logs full, repeats counted, summary on rollover |
| throttle v2 port | `src/hooks/guards/shared/warn-throttle.ts:1` + `src/hooks/guards/shared/fetch-wait-metrics.ts:1` — new modules; proxy timeout message carries provenance age via `warnThrottled`, waits recorded |
| roster v1 fix | `v1/hooks/validation-pipeline.ts:1` — async boundary check with late-rejection absorption |
| roster v2 port | `src/hooks/guards/permission-guard.ts:104` — async disk reads; `src/hooks/guards/shared/types.ts:8` — `GuardFn` widens to `MaybePromise`; factories await; pipeline absorbs late rejections |
| consent v1 fix | `v1/hooks/guards/consent-gate-guard.ts:75` — denial TTL 60s vs approval 10min; `v1/hooks/guards/consent-gate-guard.ts:94` — expired-unseen relay |
| consent v2 port | `src/hooks/guards/consent-gate-guard.ts:42` — asymmetric TTL; heredoc-aware key stripping with kick target in key; no-root-binding fail-loud; dead always-persist removed; two new `en` keys |
| wiring v1 fix | `v1/services/goal-store.ts:748` — clone the in-lock fresh goal; `v1/services/collective-memory/store.ts:91` — strip actually strips |
| wiring v2 port | `src/services/goal-store.ts:643` — fresh-evidence check already present, kept; `src/services/collective-memory/store.ts:78` — strip fix, scoped return, strip-before-validate on load; `src/services/mission-board.ts:333` — generic enqueue with boolean persist; central timer registration in coordinator, self-heal, factory |
| burn v1 fix | `v1/services/effort-analyzer.ts:595` — predicate on already-computed analysis; `v1/services/persist-utils.ts:93` — no-write gate |
| burn v2 port | `src/services/effort-analyzer.ts:464` — `isComplexEffort` reused by `src/hooks/message-updated.ts:183`; `src/services/persist-utils.ts:66` — `writeIfChanged`; `src/services/mission-board.ts:306` — index diff-gate; ONCE-PER-TASK wording in `src/core/agent-data.ts:184`; big-pickle worker/dispatcher rule in tawa instructions |
| deferred | SDK-first providers: no SDK client exists on the V2 hook context, nothing to prefer — self-fetch stays until a client surface appears |

## S-022 v1 37-commit backlog ad40a084..HEAD — triage for V2 (v1 side provides, V2 implements)

Scope: 37 v1 commits after S-017's end (`ad40a084..HEAD` on v1 master, verified count 37). This entry exists so port work does not re-triage or duplicate. Already covered — no action: S-018 (3af1b224), S-019 (29a4f809), S-020's seventeen (bash/cache/throttle/roster/consent/wiring/burn/deferred), S-021's implemented rows, and the committed `scripts/prove-s021.ts:1` (tawa fallback record, scoped budgets, unattributed-zero cost, MAX tiers, mention/dispatch regexes, goal/timeline ensureLoaded). Deliberate skips — no action: ten rebuild-only bundle commits (dist artifacts, source batches covered separately), two docs-only commits (fecce8cb, 58896e4b), vitest/dist harness commits (4fa50311, 60fa2b95 — v2 runs bun proofs, shapes differ), scheduler rotation + single-owner installer (c15473e1, 29662006-owner — v2 has no timer and no installer; S-020 agrees), SDK-first (deferred, S-020). Rejected with evidence — do NOT port: extra V2 markers (proven live in both working DBs, would brick them) and mkdir owner lock (wedge risk exceeds race risk); see S-019.

What is genuinely behind, all V2-compatible (v1 states fix shape, v2 owns implementation):

| | Anchor |
| --- | --- |
| resurrection v1 fix | `v1/tests/integration/goal-resurrection.test.ts:1` — both loser outcomes (not-found/locked) accepted, no-ghost-write stays strict |
| resurrection implemented | `scripts/prove-goal-resurrection.ts:1` — both losers observed live on a tmp store, ghost write refused; invariant code already in `src/services/goal-store.ts:397` (`mutate` fail-fast) plus in-lock re-reads |
| early-exit v1 fix | `v1/tests/integration/pipeline-early-exit.test.ts:1` — pipeline early-exit proof + plan ledger (Phase 6 proven-by-design) |
| early-exit implemented | `scripts/prove-pipeline-early-exit.ts:1` — group stops at first failure with attribution; overlong task blocked at content-checks with model unset; control reaches proxyRouting |
| priming v1 fix | `v1/tests/integration/store-ensure-loaded.test.ts:1` — reader-correctness: stores primed before first read (hooks-registration, service-factory, session hook) |
| priming implemented | `scripts/prove-store-priming.ts:1` — shared single load, fail-open on missing dir, board `ready` joins; collective-memory has no V2 readers outside boot/event wiring, so no join needed there |
| G8-remainder v1 fix | commit 64bf081f minus the S-020-consent part: warn-loud inject, announced port-skip, per-session turn sequencing, settled-anyway timeouts, blank-session guard, announced slices, disk pre-flight, audit-sink debug |
| G8-remainder implemented | `src/bootstrap/plugin-init.ts:287` — exported inject with loud warn; `src/context/model-utils.ts:56` — announced URL skip; `src/services/tool-run-log.ts:105` — per-session turn sequencing, caller turn dropped at `src/hooks/tool-execute.ts:566`; `src/services/ask-channel.ts:71` — blank guard plus settle-anyway timeout; `src/services/collective-memory/store.ts:436` — disk pre-flight plus announced slices; `src/services/event-hub.ts:79` — `CONSENT_EXPIRED` member; audit-sink debug in proxy-effects, validation-pipeline, memory telemetry |
| pipeline-tweak v1 fix | 64bf081f memory-telemetry catch |
| pipeline-tweak implemented | `src/hooks/validation-pipeline.ts:185` — telemetry failure announced on debug |
| sqlite-lessons v1 fix | commit ed96a537 D1/D13 findings (app-path busy_timeout effectively zero, retry-with-backoff discipline, WAL-blind reads abort live runs — the exact bug class S-019 just closed in the vendored script) |
| sqlite-lessons verified absent | no sqlite touchpoints anywhere under `src/` (state persists via signed JSON envelopes with save-window retry/backoff); WAL lesson already applied in the S-019 vendored script — nothing to add |
| cost-remainder v1 fix | commit cc04987f honest-cost-records part (prove-s021.ts already covers unattributed-zero; attribution paths remain) |
| cost-remainder verified | single producer `src/bootstrap/event-integrations.ts:231` records unattributed+estimated; no other `recordOperation` callers exist |
| static-gates v1 fix | `v1/tests/installer.test.ts:1` — bash -n gate over every shipped script (e329c612 practice) |
| static-gates implemented | `package.json:14` — `check:sh` over `scripts/*.sh`, wired into `verify` (hence `ci`) |

Ownership: v1 side will not modify V2 sources; V2 side owns every row marked v2 todo. Prove each row bun-style (extend `scripts/prove-s021.ts:1` or add a focused proof script); a row is done when its proof runs in `ci`, not when the code merely exists.

## S-021 v1 perf doctrine, local-server honesty, tawa/addagent invocation (37-commit sweep remainders) — IMPLEMENTED on v2

Remainders of the 37-commit sweep after S-018/S-019/S-020: the invocation failure after recent opencode updates (gateway 403s shapes without declared allows), per-session budget scope, invented cost attribution, unobserved persist failures, reader races under parallel load, and the MAX effort+model doctrine. MCP mirror denies omitted deliberately (v2 has no MCP bundle — S-018 stance). Proven by `scripts/prove-s021.ts` (41 assertions) plus generator `--check`.

| | Anchor |
| --- | --- |
| invoke v1 fix | `v1/tests/permissions.test.ts:1` — fallback parity pinned: runtime-written tawa carries the record |
| invoke v2 port | `src/tools/agent-management.ts:62` — `tawaFallbackPermission` with the bash record, all four write sites converted; `src/core/render-agent.ts:66` — record-size cap removed so generated `tawa.md` declares allows; flat-string re-assertion already in S-020 |
| budget v1 fix | `v1/services/iteration-budget.ts:37` — `consume(agent, scope)` with `budgetKey`, limits stay per agent |
| budget v2 port | `src/services/iteration-budget.ts:15` — scoped key, per-agent limits, scoped refund/remaining; all four call sites pass `sessionID` |
| cost v1 fix | `v1/services/cost-transparency/types.ts:364` — `UNATTRIBUTED_MODEL_ID` priced zero, `estimated` flag |
| cost v2 port | `src/services/cost-transparency/types.ts:320` — placeholder plus real-id schema acceptance; tracker threads `estimated`; producer records unattributed with rate-limited warn instead of silent skip |
| persist v1 fix | `v1/services/mission-board.ts:193` — create refuses ghosts, unload warns, eviction keeps on failure |
| persist v2 port | `src/services/mission-board.ts:153` — create throws on false; unload warns; eviction keeps; diff-gate compares schemaVersion plus boards; both absorption handlers audit `STAGE_REJECTED_AFTER_TIMEOUT` in `src/hooks/validation-pipeline.ts:1` |
| prime v1 fix | `v1/services/goal-store.ts:228` — shared never-rejecting `ensureLoaded` joined by readers and writers |
| prime v2 port | `src/services/goal-store.ts:188` + `src/services/timeline-store.ts:347` — same shape; joined by digest closure, reconcile, and both tool entry points |
| max v1 fix | `v1/services/proxy-models.ts:15` — every tier resolves to the complex-tier model; effort pinned deep |
| max v2 port | `src/services/proxy-models.ts:19` — all tiers pickle; `src/services/effort-analyzer.ts:400` — deep pin with English hints, empty-null preserved; single-case doctrine in `src/hooks/message-updated.ts:55` — bare guards, verb boundaries, `DISPATCH_QA_IN_ROOT`, agent-only guidance, null-safe plan |

## S-023 exhaustive 37-commit reconciliation remainders — IMPLEMENTED on v2

File-by-file diff of the full sweep (`ad40a084..HEAD`, ~120 files) after S-018/S-019/S-020/S-021/S-022. Rebuilds, docs, tests, CI shims, and v1-host artifacts need no port. Everything below was missing in V2 and is now ported, proven by `scripts/prove-s021.ts` (41 assertions) plus generator `--check` and the lock proof.

| | Anchor |
| --- | --- |
| template v1 fix | `v1/tests/permissions.test.ts:1` — template itself carries the record, not just the merge |
| template v2 port | `src/scripts/gen-opencode-config.ts:516` — dispatcher flat strings become the record at template build; merge also injects when bash is absent; post-write verify caught the write/verify split via `scripts/prove-gen-lock-contention.ts:1` |
| budgets v1 fix | `v1/services/iteration-budget.ts:71` — `applyIterationBudgets` escape hatch with invalid-entry reporting |
| budgets v2 port | `src/services/iteration-budget.ts:15` — same shape; `iterationBudgets` schema at `src/context/config-schema.ts:14`, type at `src/context/types.ts:87`, applied at boot in `src/bootstrap/plugin-init.ts:595` |
| timers v1 fix | B-micro central registration at all three sites plus ordered field init |
| timers v2 port | `src/bootstrap/service-factory.ts:193` — HealthTracker; `:781` cleanup schedule; `:276` router diff-gate via `src/services/persist-utils.ts:66`; `src/hooks/PipelineState.ts:195` — centrally registered auto-sweep; `src/context-class.ts:156` — timerManager declared first and passed in; boot priming via `ensureLoaded` at `src/bootstrap/service-factory.ts:575` + `:592` |
| torn v1 fix | `v1/services/goal-store.ts:272` — pure read path, separator flag consumed on append |
| torn v2 port | `src/services/goal-store.ts:240` — fragment skipped without rewrite; `src/services/goal-store.ts:330` — flag; separator consumed at `:341`; per-load reset at `:202` |
| abort v1 fix | abort-loser signal threaded into the fetch with quiet caller-abort path |
| abort v2 port | `src/context/model-utils.ts:192` — `externalSignal` aborts the loser early; caller aborts serve defaults quietly with the port cache kept |
| wording v1 fix | one completion summary only across all agent prompts |
| wording v2 port | `src/core/agent-data.ts:186` — ONCE-PER-TASK record calls; transparency line at `:221` rewritten to one completion summary; `t("rateLimitRetryExhausted")` toast at `src/bootstrap/plugin-init.ts:219` with key in `src/i18n/en.json:519`; dead `spRoleBlocked` key removed |
| clients v1 fix | `v1/hooks/message-updated-types.ts:121` — `isComplexEffort` on the injectable clients |
| clients v2 port | `src/hooks/message-updated-types.ts:114` — same field, resolved with fallback, consumed via `svc` in `src/hooks/message-updated.ts:62` + `:190`, registered in `src/bootstrap/hooks-registration.ts:22` + `:75` |
| verified N/A | dispatch-guards comment delta (no-comments rule covers it); validation NOTE (same rule); budget sweep rename (behavior identical); ar.json (Arabic catalog, never ported); SDK adapt paths (deferred, S-020); MCP mirror keys (no bundle, S-018 stance) |

## S-024 atomic-audit findings — IMPLEMENTED on v2

Independent four-analyst audit of S-018..S-023 plus the full 37-commit matrix found seven port gaps hiding inside rows marked verified, plus a rule-gate hole. All ported below and proven by new `scripts/prove-s024.ts` (33 assertions, wired into `ci` via `prove:s024`).

| | Anchor |
| --- | --- |
| disclosure v1 fix | `v1/services/persist-utils.ts:101` — compare-read failure announces via debug instead of swallowing |
| disclosure v2 port | `src/services/persist-utils.ts:74` — same announcement; census count net unchanged (disclosed `:73`-region catch leaves the inventory while strip-exposed `:114` enters it); sibling toast/lock catches at `src/bootstrap/plugin-init.ts:240` + `:576` also disclose now (remaining `:976` matches V1 silence verbatim, stays counted; `:908` likewise counted) |
| flush v1 fix | `v1/services/timeline-store.ts:190` — buffer cap with announced drop; `:206` stats; `:217` backoff; `:486` disk pre-flight; `:499` append/meta split with `metaDirty` |
| flush v2 port | `src/services/timeline-store.ts:145` — cap + drop; `:160` `getFlushStats` (`src/types/timeline-types.ts:76`); `:169` backoff wired into schedule; `:430` split flush with `:443` pre-flight; meta-only failure sets `metaDirty` without re-queue |
| runlog v1 fix | `v1/services/tool-run-log.ts:47` — 8-member never-dedup set; `:130` caller-turn honor; `:172` turn sequencing + save-path age-out |
| runlog v2 port | `src/services/tool-run-log.ts:46` — same set; `:121` `input.turn \|\| nextTurn`; `:65` + `:166` + `:172` sequencing; `:97` save-path age-out |
| cost v1 fix | `v1/services/cost-transparency/tracker.ts:26` + `:253` — summary-level estimate count; `v1/bootstrap/event-integrations.ts:239` — zero tokens + warn-once when output length missing |
| cost v2 port | `src/services/cost-transparency/tracker.ts:14` + `:224` — same count; `src/bootstrap/event-integrations.ts:227` — measured/zero split with `:240` + `:243` warnings |
| gauge v1 fix | `v1/bootstrap/db-isolation.ts:34` — canonicalize; `:43` shared-DB detect; `:169` shared-DB warn; keyed hint path |
| gauge v2 port | `src/bootstrap/db-isolation.ts:14` + `:22` — same; shared-DB warn branch with fixed `~/.local/share/opencode-projects` hint at `:71` + `:90`; `installationHealth` deliberately skipped (coupled to the rejected installer surface) |
| reset v1 fix | `v1/services/goal-store.ts:284` — per-load separator reset |
| reset v2 port | `src/services/goal-store.ts:202` — same one-liner |
| consent wording gap | `src/i18n/en.json:79` promises yes/نعم/ok but the matcher honored only yes — fixed at the matcher instead of the string; chat-path Arabic closed in S-025 via `src/services/ask-channel-parse.ts:8` |
| consent v2 port | `src/hooks/guards/consent-gate-guard.ts:16` — shared `isApprovalWord` (true/yes/ok/نعم/once), both approval sites; `always` preserved at the second site; beyond-parity fix (V1 matchers never honored ok/نعم) |
| timers v2 remainder | `src/services/session-observer.ts:36` — `TimerManagerLike` injection with raw fallback for cleanup + persist timers, centrally cleared on dispose (out-of-sweep pre-existing raw timers; no production caller passes timers yet) |
| tawa scalar | `.opencode/agents/tawa.md` (generated tree, untracked) — `bash: deny` scalar removed; live `.md` omits `bash` (V1 parity — V1 tawa.md also carries no bash key); effective record lives in generated `opencode.json`; generator scalar→record repair is the durable mechanism |
| gate v2 fix | `scripts/check-v2-rules.mjs` — AST string-blanking + remainder scan finds every comment class (in-function, end-of-block, EOF); scans `.json`, regex literals, and template fragments; functional Arabic matchers pass via documented snippet allow-list (`:10`); `scripts/prove-disclosure.ts:102` + `:130` — brace-aware catch scanner, comment-only bodies count as silent, honest 49-file inventory |
| gate v2 result | 174 comment ranges stripped across 55 files; `npm run check:rules` green on 340 files; census green (51-file honest inventory) |
| verified N/A | model fetch abort timer cleared in `finally`; parse-race timer unrefed and cleared on settle (`src/context/model-utils.ts:219`); budget schema 10000 cap vs permissive applier (schema is the gate, documented); AGENTS.md entry line fixed (was `Plugin.Plugin.define`; entry is `Plugin.define`, `Plugin.Plugin` is the config type) |

## S-025 audit-round-2 findings — IMPLEMENTED on v2

Four-analyst re-audit of S-024 converged: ports equivalent, no blocker. It surfaced one real V1 regression, two census blind spots, and claim-precision fixes. Proven by `scripts/prove-s024.ts` (39 assertions).

| | Anchor |
| --- | --- |
| chat-parse v1 fix | `v1/services/ask-channel-parse.ts:21` — confirm YES/NO regexes carry Arabic alternatives (نعم/أجل/اكيد/موافق/تمام/حسنا/تفضل/ايوا; لا/كلا/مرفوض/لأ/لاء/ممنوع/رفض) |
| chat-parse v2 port | `src/services/ask-channel-parse.ts:8` — same Arabic sets added to YES_RE/NO_RE; consumption guards unchanged (`src/services/ask-channel.ts:148` single-flight + single-line + 60-char + anchored match); allow-list extended in `scripts/check-v2-rules.mjs:10` |
| race-timer v2 fix | `src/context/model-utils.ts:219` — parse-race deadline unrefed and cleared on settle (was never cleared); abort timer cleared in `finally` as before |
| census v2 fix | `scripts/prove-disclosure.ts:102` + `:130` — string-blanking plus balanced-brace walk; new promise-`.catch(()=>{})` empty-arrow branch; `src/` top-level files now scanned (`src/context-class.ts:1` covered); honest 51-file inventory |
| config-path v2 fix | `src/i18n/en.json:84` — hint names `.opencode/tawassul.jsonc` with legacy `.json` accepted (matches `src/utils/path-resolver.ts:127`) |
| docs v2 fix | `AGENTS.md:43` — entry sentence corrected to `Plugin.define` on the `Plugin` namespace |
| verified N/A | timeline lone-newline on meta-only retry (identical in both trees, blank lines skipped on load); `warnCostOnce` is per-message/5-min rate-limited warn (identical both sides); schema-10000 cap is the gate on the only validated path |
