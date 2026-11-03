# SHARED parity ledger

Generated from `scripts/shared-parity.json` by `bun scripts/check-shared-parity.ts --write`.
Hand edits are rejected by `bun scripts/check-shared-parity.ts --check`, which runs in `gate:fast`.
`SHARED.md` stays frozen at the 2026-10-24 cutover; this ledger is the v2 disposition of every entry.

## Totals

| Status | Requirements |
| --- | --- |
| verified | 55 |
| anchored | 0 |
| partial | 0 |
| missing | 0 |
| host-bound | 4 |
| n-a | 11 |
| doc-only | 2 |
| total | 72 |

57 entries, 72 requirements.

## Ledger

| Entry | Requirement | v2 anchor | Proof | Status |
| --- | --- | --- | --- | --- |
| S-001 | The v2 entry is a module exporting a plugin object with id and setup. | `src/index.ts:9` `setup: createV2Setup` | `scripts/prove-host-entry.ts` | verified |
| S-002 | The build resolves the host plugin package through the ESM exports condition instead of a static external list. | `build-v2.mjs:18` `import.meta.resolve` | `scripts/prove-host-entry.ts` | verified |
| S-003 | Every tool execute result is converted from the v1 shape to the v2 shape. | `src/v2/adapters.ts:99` `toV2Result` | `scripts/prove-v2-compat.ts` | verified |
| S-004 | Setup aborts before registration when the host lacks the session or tool domain. | `src/v2/setup.ts:466` `host missing required domains` | `scripts/prove-host-entry.ts` | verified |
| S-005 | The role to tool matrix is ported without an i18n or NLP dependency. | `src/role-matrix.ts:40` `TAWASSUL_TOOL_ROLES` | `scripts/prove-s005.ts`, `scripts/prove-s013.ts` | verified |
| S-006 | Model display names are English-only with no bilingual shape or lang parameter. | `src/core/model-registry.ts:91` `MODEL_DISPLAY_NAMES` | `scripts/prove-feature-index-english.ts` | verified |
| S-007 | A full-tree port must never overwrite hand-fixed files. | - | - | n-a |
| S-008 | The translations loader is English-canonical, ships the Arabic table for runtime languages, and has no logger dependency. | `src/translations.ts:4` `LANGUAGES` | `scripts/prove-feature-index-english.ts` | verified |
| S-009 | The entry carries no v1 server member; the v2 host initializes through setup. | `src/index.ts:7` `export const tawassul: Plugin.Plugin = {` | `scripts/prove-host-entry.ts` | verified |
| S-010 | Conflict-marker debris must never reach v2 sources. | - | - | n-a |
| S-011 | Status changes refresh the board index and carry session provenance. | `src/services/mission-board.ts:153` `scheduleIndexWrite` | `scripts/prove-board-invariants.ts` | verified |
| S-012 | A completed board cannot be reopened; transitions are close-only. | `src/services/mission-board.ts:269` `isCompleted` | `scripts/prove-board-invariants.ts` | verified |
| S-013.1 | Role-scoped plugin permissions and record/eval read-back are enforced. | `src/security-policy.ts:458` `checkTawassulToolPermission` | `scripts/prove-s013.ts`, `scripts/prove-e21.ts` | verified |
| S-013.2 | The MCP boundary is not applicable because v2 ships no MCP server or client. | - | - | n-a |
| S-014 | A standalone health tool exists in the tawa namespace. | `src/tools/tawa/health.ts:57` `buildHealthTool` | `scripts/prove-e46.ts` | verified |
| S-015 | The retired kanban-board name must not return. | - | - | n-a |
| S-016 | Conflict-marker pollutants must not be propagated. | - | - | n-a |
| S-017 | The three-day hardening batch is ported on merit: model retirements, generator hardening, governance, and runtime rows. | `src/services/proxy-fallback-chains.ts:73` `sweepRetiredModelPins` | `scripts/prove-s017.ts`, `scripts/prove-gen-lock-contention.ts`, `scripts/prove-gen-merge-guards.ts`, `scripts/prove-gen-guard-wal.ts`, `scripts/prove-roster-boundary.ts`, `scripts/prove-event-trust-p1.ts`, `scripts/prove-web-ssrf.ts`, `scripts/prove-s028.ts` | verified |
| S-018 | R-008, R-009, and R-011 are ported in a v2 shape with first-boot roster seeding. | `src/utils/opencode-config.ts:506` `ensureGlobalRosterSeed` | `scripts/prove-first-boot-seed.ts` | verified |
| S-019 | The atomic-audit P0 closures are ported: containment, WAL probe, backup environment, and fail-closed gates. | `scripts/opencode-db-maintenance.sh:596` `require_v2_generation` | `scripts/prove-db-retention.ts` | verified |
| S-020 | The nine-day batch is ported: tool surface, cache generation, guards, and wiring. | `src/context/model-utils.ts:24` `getPortCacheGen` | `scripts/prove-s020.ts` | verified |
| S-022 | The 37-commit backlog rows are triaged and the actionable ones ported. | `src/services/goal-store.ts:449` `mutate` | `scripts/prove-goal-resurrection.ts` | verified |
| S-021 | The 37-commit sweep remainders are ported: invocation fallback, scoped budgets, honest cost, and the MAX doctrine. | `src/tools/agent-management.ts:63` `tawaFallbackPermission` | `scripts/prove-s021.ts` | verified |
| S-023 | The reconciliation remainders are ported: iteration budgets, timers, torn reads, and abort. | `src/services/iteration-budget.ts:63` `applyIterationBudgets` | `scripts/prove-s021.ts` | verified |
| S-024 | The atomic-audit findings are ported and the gate hole is closed. | `src/services/timeline-store.ts:161` `getFlushStats` | `scripts/prove-s024.ts` | verified |
| S-025 | The round-2 findings are ported and no blocker remains. | `src/services/ask-channel-parse.ts:16` `YES_RE` | `scripts/prove-s024.ts` | verified |
| S-026 | The rule gate rejects comments, Arabic literals, and glued directives. | `scripts/check-v2-rules.mjs:9` `ARABIC_RE` | `scripts/prove-rule-gate.ts` | verified |
| S-027 | The S-022 closure was re-verified bilaterally. | - | - | doc-only |
| S-028 | The provider model cache is the source of truth for suffix governance. | `src/core/model-registry.ts:148` `getProviderModelTokens` | `scripts/prove-s028.ts` | verified |
| S-029 | R7 variant pins, dispatch precedence, dotted suffixes, and the log default are ported. | `src/tools/agent-management.ts:239` `computePinEntries` | `scripts/prove-s029.ts` | verified |
| S-030 | The live roster is aligned with the generation-layer retire. | `src/scripts/gen-opencode-config.ts:287` `unionDeletedVariants` | `scripts/prove-s029.ts` | verified |
| S-031 | The documented install path materializes the plugin entry on every build. | `build-v2.mjs:132` `tawassul.js` | `scripts/release-smoke.sh` | verified |
| S-032 | A stale project-scope copy must not win registration in a shared process. | `src/core/install-scope.ts:56` `claimCoexistence` | `scripts/prove-s038.ts` | verified |
| S-033.1 | The plugin-side cold-boot wave is ported: quiet resolution, write-behind, save debounce, jitter, logger stamp, quarantine, and save guard. | `src/utils/quiet.ts:6` `forceQuietMode` | `scripts/prove-s033.ts` | verified |
| S-033.2 | Launcher and installer duties stay in the host install script, not in the plugin. | `scripts/install-global.ts:212` `hostCandidates` | `scripts/prove-s033.ts` | verified |
| S-033.3 | The cold-boot launch wave passes only after a recorded cold-boot run meets N1 to N5. | - | - | n-a |
| S-034.1 | N2 records only announced assistant text parts. | `src/hooks/n2-auto.ts:40` `assistantMessages` | `scripts/prove-v2-compat.ts` | verified |
| S-034.2 | A v2 boot scorecard implements N1 to N5 with an explicit since gate. | `scripts/boot-scorecard-v2.sh:30` `SINCE_EXPLICIT` | `scripts/prove-boot-gate.ts` | verified |
| S-035.1 | The generation guard and the maintenance gate carry the v1 semantics. | `scripts/guard-db-generation.sh:254` `marker-v1-content` | `scripts/prove-db-retention.ts` | verified |
| S-035.2 | D3, recovery, and salvage remain v1-host support tools. | - | - | n-a |
| S-036 | Bare-base derivation, no-env hardening, kick bulk, and the roster updates are ported. | `src/tools/agent-add-helpers.ts:105` `deriveVariantSpec` | `scripts/prove-s028.ts`, `scripts/prove-s036.ts` | verified |
| S-037 | The v1 test-suite triage and the notify gate have no v2 runtime surface. | - | - | n-a |
| S-038 | The coexistence seat is per workspace, not process-global. | `src/core/install-scope.ts:56` `claimCoexistence` | `scripts/prove-s038.ts` | verified |
| S-039 | N2 records a text part only after its message is announced as assistant. | `src/hooks/n2-auto.ts:40` `assistantMessages` | `scripts/prove-v2-compat.ts` | verified |
| S-040 | Event rows are pruned and the backup probe counts both session tables. | `scripts/opencode-db-maintenance.sh:91` `EVENT_KEEP` | `scripts/prove-db-retention.ts` | verified |
| S-041.1 | Coexistence items 1 to 6 are implemented in v2 code and gates. | `scripts/opencode-db-maintenance.sh:596` `require_v2_generation` | `scripts/prove-db-retention.ts` | verified |
| S-041.2 | Item 7 ran as a live dual-generation boot and the v1 guard refused a v2 DB. | `CUTOVER.md:3` `live dual-generation gate` | `CUTOVER.md` | verified |
| S-042 | Local plugin entries must be deduplicated by the loader, not only by the plugin. | `src/core/install-scope.ts:56` `claimCoexistence` | - | host-bound |
| S-043 | Legacy config keys no longer produce per-boot normalization warnings. | `src/utils/opencode-config.ts:376` `applyBootRepairs` | `scripts/prove-e02.ts` | verified |
| S-044 | Select and multiselect elicitation fail closed through the ask bridge. | `src/services/ask-channel-parse.ts:12` `multiselect` | `scripts/prove-v2-ask-bridge.ts` | verified |
| S-045 | Deferred tool schemas are refreshed after init with a bounded retry. | `src/v2/setup.ts:49` `SCHEMA_RETRY_ATTEMPTS` | `scripts/prove-b02.ts` | verified |
| S-046 | Unknown permission actions need a host default policy or rule registration. | `src/v2/ask.ts:18` `evaluate` | - | host-bound |
| S-047 | Tool output deltas and a compaction prompt contract are implemented. | `src/hooks/tool-output-stream.ts:90` `message.part.delta` | `scripts/prove-e15.ts` | verified |
| S-048 | The input and output schema pairing needs host documentation. | `src/v2/result-bridge.ts:99` `writeBackV1Output` | - | host-bound |
| S-049 | After-hook output mutations are written back into the tool result. | `src/v2/result-bridge.ts:99` `writeBackV1Output` | `scripts/prove-v2-compat.ts` | verified |
| S-050 | Budget exhaustion must not be mislabeled as a verification failure. | - | - | n-a |
| S-051 | Permission evaluate mutation and tool reload need public contract documentation. | `src/v2/ask.ts:18` `evaluate` | - | host-bound |
| S-052 | Goal auto-capture follows the corrected shape, not the v1 code. | `src/services/goal-store.ts:710` `finishLocked` | `scripts/prove-goal-capture.ts` | verified |
| S-053.1 | The watcher policy is owned by the v2 launcher with env over pinned over auto and one decision line. | `scripts/opencode-v2-iso.sh:302` `[launcher] watcher mode=` | `scripts/prove-boot-gate.ts` | verified |
| S-053.2 | DB retention prunes event rows and the backup probe counts both session tables. | `scripts/opencode-db-maintenance.sh:91` `EVENT_KEEP` | `scripts/prove-db-retention.ts` | verified |
| S-053.3 | The seven-item unchecked-task census is either ported as tests or recorded as out of scope. | `ISSUES.md:2978` `### E-53` | `scripts/prove-handoff-rescue.ts`, `scripts/prove-seed-agents.ts` | verified |
| S-053.4 | Pause during a live session halts dispatch and persists the paused handoff set. | `src/tools/system-controls.ts:79` `const pauseState: PauseState = {` | `scripts/prove-s053.ts` | verified |
| S-053.5 | A task that runs longer than 420 seconds is tracked by the task timeout. | `src/hooks/tool-execute.ts:72` `export const TASK_TIMEOUT_MS = 420_000;` | `scripts/prove-s053.ts` | verified |
| S-053.6 | An image-generation 401 refreshes the token once and fails closed on a second 401. | `src/tools/image-gen.ts:190` `const refreshed = await refreshAndUpdateToken();` | `scripts/prove-s053.ts` | verified |
| S-053.7 | Confidentiality at rest for plugin state is a host and OS responsibility, not a plugin feature. | - | - | n-a |
| S-053.8 | User-level rate limiting is not a single-user local plugin surface. | - | - | n-a |
| S-053.9 | Shared state is signed with HMAC-SHA256 before it is written and verified on read. | `src/utils/crypto.ts:21` `export const HMAC_PREFIX = "TAWASSUL_V2_HMAC_V1:";` | `scripts/prove-s017.ts` | verified |
| S-053.10 | Deleted-agent names persist in the user-owned deletion list and survive a seed. | `src/scripts/gen-opencode-config.ts:58` `deletedPath: resolve(root, ".opencode", "deleted-agents.json"),` | `scripts/prove-seed-agents.ts`, `scripts/prove-first-boot-seed.ts` | verified |
| S-054 | The frozen boot-scorecard fixes are ported. | `scripts/boot-scorecard-v2.sh:30` `SINCE_EXPLICIT` | `scripts/prove-boot-gate.ts` | verified |
| S-055 | The v1 docs and atomic backlog is triaged before retirement. | - | - | doc-only |
| S-056 | The legacy state directory and fallback reads are removed; HMAC key and signature compatibility remain. | `src/utils/state-paths.ts:41` `export function statePath(` | `scripts/prove-v2-independence.ts`, `scripts/prove-s017.ts` | verified |
| S-057 | The addagent advisory consults the provider before warning about an unknown model. | `src/core/model-registry.ts:171` `shouldWarnUnverifiedModel` | `scripts/prove-s028.ts` | verified |

## Open items

None.

## Host-bound items

| Entry | Requirement | Host note |
| --- | --- | --- |
| S-042 | Local plugin entries must be deduplicated by the loader, not only by the plugin. | The plugin-side claim prevents duplicate registration; loader-level dedupe across workspace entries is a host contract. |
| S-046 | Unknown permission actions need a host default policy or rule registration. | The bridge forces ask for tawassul.ask; the default for unrelated actions is host-owned. |
| S-048 | The input and output schema pairing needs host documentation. | The bridge follows the v2 contract; the remaining ask is documentation for third-party plugins. |
| S-051 | Permission evaluate mutation and tool reload need public contract documentation. | Both mechanisms are verified in the host bundle; the remaining ask is documentation. |
