> **STATUS: REFERENCE ONLY — NOT EXECUTABLE.**
> Superseded on 2026-11-08 by `docs/tawassul-v2-minimal-fix-plan.md`.
> This file is an audit record of 121 findings; do not implement from it.
> About one third of the ledger belongs to the three approved changes; the rest is frozen.

# Tawassul V2 — Comprehensive Fix Plan (Version 6)

Date: 2026-11-08
Reference: HEAD `acc3c4e`
Reviews: `eval-9f95ae12`, `eval-2a607f9b`, `eval-cb5dd89e`, `eval-644b7401`, `eval-dc484775`, `eval-5a187219`, `eval-dff976f5`
Version 6 folds six area-based reviews: A (generation + config writer, 24 findings), B (deletion + guards, 10), C (boot repair + locks, 8), D (shared storage + identity + watchdog, 21), E (build + proofs + projects, 7 after re-run) and F (permissions + adversarial, 6). All were uncapped and unanchored. Every claim was re-checked against disk before it entered the ledger; the ones that failed re-check are listed as refuted. The ledger now holds D1–D121.

---

## Governing Decisions

1. **Single source:** the active config file (`opencode.json` or `opencode.jsonc`) in project scope. Presence = enabled, absence = deleted. No tombstone file, no deletion list in project scope.
2. **Additive generation:** the emission set is `bases ∪ config keys that are generated variants`. A variant absent from config is never emitted. The deletion list is not read in project scope. The only exception is `firstRun` (decision 4).
3. **Variant source:** `agent` keys in config, never `.md` files and never a deletion list.
4. **First run = 16 by name:** `tawa, analyst, architect, dev, reviewer, tester, designer, doc, addagent` + `pickle` variants for the seven roles. It is a **state predicate evaluated under the config lock on every boot**, not a token: `config missing` OR `agent` is an empty object. An empty object can only come from a fresh or legacy bootstrap, because bases cannot be kicked (`agent-kick-helpers.ts:61-66`), so it is a safe fresh marker.
5. **Model authority:** the model already present in config wins, unless it is in `RETIRED_MODEL_IDS`. Pins govern refresh, not failure.
6. **No developer deletion list** is shipped into user projects.
7. **State is isolated** per project under `v2DataRoot()/projects/<key>`. The XDG data root wins; when none is available the state falls back to the workspace directory (D88).
8. **The global lane changes only by N12:** it keeps `roster` and `full-roster`, and its deletion set is `roster.deleted` (`gen:124`) with `deletedPath === rosterPath` (`gen:89`). Un-retiring `ling` raises the global expected roster from 51 to 58; that is a stated change, not an accident.
9. **One lock, two layers:** `writeConfigLocked()` assumes the caller holds the config lock; `regenerateProjectConfig()` acquires it. No function acquires the same lock twice (`file-lock.ts:169-190` is not reentrant). The lock name is derived from the `realpath` of the project root (D120), and every config write uses `failClosed: true` — it never proceeds unlocked after failed retries (D121). The two current call sites that omit it (`agent-management.ts:861,877`) must pass it.
10. **Config path rule:** config writes resolve from the project root or `workspaceDir`, never from `stateDir`. When both `opencode.jsonc` and `opencode.json` exist, jsonc wins and a warning is emitted (the warning is new, D89); the stale json is never written.

---

## Non-Regression Contract

Every row is a feature that exists today and must still work after the fix. A change that breaks one row is rejected even if it fixes the generation bug.

| # | Feature at risk | Today | Required after the change | Evidence |
|---|---|---|---|---|
| N1 | Retired-name shield | `DELETED_AGENTS` is a static 39-name list | **stays static** except N12 (39 → 32); only `dynamicDeletedAgents` changes its source | `security-policy.ts:116-154` |
| N2 | Retired-name rejection in addagent | `addagent` refuses any name in the static list | **stays** | `agent-add-helpers.ts:197` |
| N3 | Config presence wins | `userPreservedAgents` is seeded from config keys | **unchanged**; and `pruneUserPreservedAgents` must not contradict it (D78) | `AgentManager.ts:114,125,191`; `security-policy.ts:168-175` |
| N4 | `variantUndo` restores an agent | it removes the name from the deletion list | project scope: **insert-if-absent** config key; global scope: `unpersistDeletedAgents` keeps its real restore job | `agent-management.ts:205-215,858-868` |
| N5 | Dispatch guard | blocks routing to any deleted name | static blocks always; dynamic = generated variants not present in config, with a pinned universe and a synchronous boot refresh | `dispatch-guards.ts:154,198`; `security-policy.ts:435-454` |
| N6 | Global lane | `roster.deleted`; `deletedPath === rosterPath` | **unchanged**, except the N12 roster-count change | `gen:89,124` |
| N7 | Boot repair | backup plus permission/model repair | keeps its policy and backup; uses the hardened primitive | `opencode-config.ts:376-397`; `plugin-init.ts:663` |
| N8 | Kick | removes the config key and the md file, cancels pending handoffs | **unchanged**; a re-kick of an absent variant reports "already deleted" instead of a no-op write (D74) | `agent-kick-runtime.ts:54-127` |
| N9 | User formatting | splice replaces from the newline before `"agent":`; JSONC without a section throws; pure JSON is re-serialized | byte-identical outside the `agent` **key start … value end**, except at most one separator comma on insertion; comments inside the block are replaced (as today); indentation-agnostic; non-object `agent` never eats the next member | `opencode-config.ts:176-212` |
| N10 | Strict checking | `--check` fails on mode/permission drift and absent variants | lenient in project mode, `--strict` available; **the gate runs `--strict`**; strict = missing base, structural corruption, retired model, or drift on a present agent | `gen:700-745`; `gate-manifest.json:55-60` |
| N11 | OOM guard | watchdog terminates a runaway process | terminate tier suppressed only when a second live instance is proven; unreadable registry keeps today's behavior | `memory-watchdog.ts:156-194` |
| N12 | Catalog and retirement agree | `ling` active with suffix `ling`, all `*-ling` retired; `muse-spark-1.2-contributor-free` active and retired | un-retire `ling` (39 → 32, global expected 51 → 58); reconcile muse on both sides. Both are stated changes with inverted proofs | `model-registry.ts:13-60,70`; `security-policy.ts:141-147` |
| N13 | Generated facts stay true | `facts.ts check` pins `agentsTotal` | the repo config is **not** regenerated; facts stay at 34 unless a step explicitly regenerates both | `facts.ts:30`; `gate-manifest.json:70-75` |
| N14 | Dynamic set has a universe | today it comes from the file | universe = the nine bases + generated variants of the seven roles; builtins (`explore`, `general`, `opencode`) are excluded; refresh is synchronous at construction | `AgentManager.ts:62`; `dispatch-guards.ts:198` |
| N15 | Proofs register with their code | five registration points | Phase-1 proofs register in 1.5; concurrency proofs in 4.2 | `generate-proof-count.ts:16-18`; `AGENTS.md:81` |

**Non-goals — explicitly rejected:**

1. A single writer that owns generation, kick, addagent, repair and F6.
2. Merging the boot writers into one function. Boot gets a coordinator, not a merged writer.
3. A new JSONC dependency.
4. Any `TAWASSUL_*` environment variable.
5. A global install or a global deletion file. **Global install is out of scope by user requirement**; firstRun applies to project scope only.
6. Deleting legacy files on disk.
7. Regenerating the repository's own config to 58 agents.

---

## Defect Ledger

### Rounds 1–6 (D1–D48)

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D1 | Generation write logic is unreachable: inside the unexported `main()` | `gen:805-888` | 1.0/A |
| D2 | `refuseProjectTarget` requires `.opencode/agents/tawa.md` | `gen:66-82` | 1.0/A |
| D3 | The seed script sits outside the bundle | `scripts/seed-agents.ts:20`; but `src/agent-templates.ts:2-5` already re-exports the capability (D55) | 1.0/A |
| D4 | The parity ledger pins `deletedPath` and the deletion-list requirement | `shared-parity.json:1363-1377` | 1.0/B |
| D5 | `firstRun` had no discriminator against decision 2 | plan decisions 2 and 4 | 1.2 |
| D6 | `firstRun` never fires because bootstrap writes `agent: {}` | `opencode-config.ts:487` | 1.2 |
| D7 | "16 md files" is impossible: 8 templates, variants config-only, addagent synthesized | `agent-data.ts:32`; `gen:540` | 1.2 |
| D8 | The checker fails every absent variant and every mode/permission drift | `gen:700-745` | 1.4 |
| D9 | Removing `deletedPath` breaks four unlisted readers | `gen:256,508,584,708` | 1.1 |
| D10 | Four proofs depend on the old semantics | `prove-gen-merge-guards.ts:51,59-61`; `prove-e02.ts:155`; `prove-s029.ts:92-104`; `prove-s036.ts:55-56` | 1.5 |
| D11 | The proof array starts at `:124`, not `:94` | `gate-manifest.json:94-100,124` | 4.2 |
| D12 | `project-state-migration.ts:44` stays excluded | `project-state-migration.ts:44` | 1.1 |
| D13 | The repair failure path is `debug`, not `warn` | `plugin-init.ts:770-772` | 1.4 |
| D14 | Phase 1 is not atomic; F6 rebuilds 58 on every boot | `plugin-init.ts:720-756` | atomicity |
| D15 | F6 can write another project's config | `gen:45-60` | 1.4 |
| D16 | Phase 2 targets host-global files | `usage-ledger.ts:272-274`; `n2-auto.ts:15-16`; `keyring.ts:11-12`; `file-lock.ts:35` | Phase 2 |
| D17 | Locks carry no version and removal is non-recursive | `file-lock.ts:179-182,212-239` | 2.0 |
| D18 | Three boot writers are fire-and-forget and read before the lock | `plugin-init.ts:663,676,701,724,744` | 1.4 |
| D19 | Parity re-disposition was split from 1.1 | `shared-parity.json:1363-1377` | 1.0/B |
| D20 | 1.0's DoD said "no behavior change" while rerouting F6 | plan 1.0 | 1.0 |
| D21 | `gen:576,850,865` are project-lane, not global | `gen:576,850,865` | 1.2 |
| D22 | `spliceAgentSection` and `package.json` were double-owned | plan 1.1/1.4, 3/4.2 | 1.1, 1.4, 4.2 |
| D23 | The global deletion lane is `roster.deleted`, not a file | `gen:89,124` | decision 8 |
| D24 | The static retired list was conflated with the dynamic user set | `security-policy.ts:114-163,435-454` | 1.1 |
| D25 | Removing the addagent static check would unblock 39 retired names | `agent-add-helpers.ts:197` | 1.1 |
| D26 | `variantUndo` has no restore path once the file is gone | `agent-management.ts:205,214,865` | 1.1 |
| D27 | The seven projects may hold a name in both the deletion list and config | no reconciliation exists | Phase 0, Phase 5 |
| D28 | The splice marker is indentation-sensitive; the fallback re-serializes or throws | `opencode-config.ts:177-190` | 1.4 |
| D29 | Scoping F6 to `ctx.directory` can disable repair in a nested workspace | `gen:45-60` | 1.4 |
| D30 | Leniency removes the developer safety net | `gen:722-742` | 1.4 |
| D31 | The watchdog fix has no fail-safe | `memory-watchdog.ts:156-194` | 2.5 |
| D32 | The plan cited a non-existent path `src/hooks/agent-kick-runtime.ts` | real: `src/tools/agent-kick-runtime.ts` | 1.1 |
| D33 | The plan imposed a single writer over five policies | splice call sites | 1.4 |
| D34 | `ling` is active in the catalog and retired | `model-registry.ts:58-60`; `security-policy.ts:141-147` | 1.1, N12 |
| D35 | "Absent from config" is ambiguous between deleted and not-yet-generated | `dispatch-guards.ts:154,198` | 1.1 |
| D36 | Kick still reads the sidecar and short-circuits on it | `agent-management.ts:1028,1041-1043` | 1.1 |
| D37 | Undo still writes the sidecar | `agent-management.ts:208-215` | 1.1 |
| D38 | Undo was described as writing a model; its real hazard is tombstone suppression | `agent-management.ts:858-868` | 1.1 |
| D39 | The `tawa.md` marker gate deadlocks a project with config but no marker | `gen:74-80`; `opencode-config.ts:469-472` | 1.4 |
| D40 | The plan did not state that bases are protected from kick | `agent-kick-helpers.ts:61-66` | 1.1, N5 |
| D41 | New proofs break the generated count before registration | `generate-proof-count.ts:16-18`; `AGENTS.md:81` | 1.5, 4.2 |
| D42 | Phase 5's "empty intersection" is unreachable | plan Phase 5 | Phase 5 |
| D43 | `muse-spark-1.2-contributor-free` is catalog-active and retired | `model-registry.ts:47,70` | 1.1, N12 |
| D44 | The static list has 39 names, not 40 | `security-policy.ts:116-154` | N1 |
| D45 | The firstRun empty-agent check can run outside the config lock | `opencode-config.ts:469-472` | 1.2 |
| D46 | D46 targeted the wrong function: the upward heuristic is `inferProjectRoot` | `gen:45-51` | 1.4 |
| D47 | The `findMatchingBrace` claim is stale | `opencode-config.ts:111-166` | 1.4 |
| D48 | Recursive legacy-lock removal can race a fresh acquirer | `file-lock.ts:212-239,517-541` | 2.0 |

### Round 7 — area review A (generation + writer)

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D49 | `buildAgents` emits variants from `deletedSet` only, and `unionDeletedVariants([])` returns the static set. After 1.1 the project lane would emit 58 (51 today) instead of the config-key set. The plan's "never adds an absent variant" was unimplementable as written | `gen:504-538,287-289` | 1.4, decision 2 |
| D50 | Two modes cannot express firstRun; there is no third mode and no `firstRunAgentSet()` | plan 1.2 | 1.2 |
| D51 | The writer cannot acquire the config lock inside `ensureMinimalProjectContract`, which already holds it. `tryAcquire` is `mkdir`-based and not reentrant, so the nested acquire fails after 8 retries | `opencode-config.ts:474`; `file-lock.ts:169-190`; `gen:784-803` | 1.0/A, 1.2 |
| D52 | Making `mode` required breaks script callers that pass only `([], opts)`. Keep a `full-roster` default and pass the project mode explicitly | `prove-e02.ts:155`; `prove-s029.ts:92-97`; `prove-s036.ts:56` | 1.2, 1.5 |
| D53 | The real foreign-root heuristic is `inferProjectRoot` (env → `__dirname` → cwd), not `resolveActiveConfigPath` | `gen:45-51` | 1.4, D46 |
| D54 | N12 has a global effect: un-retiring `ling` raises the global expected roster 51 → 58, inverts two proofs, and leaves any persisted `roster.deleted` ling entry suppressing the change | `gen:287-292,124`; `prove-s029.ts:92`; `prove-s036.ts:56` | 1.1, 1.5, N6 |
| D55 | The seed capability is already bundle-reachable through `src/agent-templates.ts`, so moving the script is unnecessary | `src/agent-templates.ts:2-5`; `build-v2.mjs:38` | 1.0/A |
| D56 | `indexOf("{", colonIdx)` after a non-object `agent` (`null`, `[]`, `"x"`) finds the **next** member's brace and deletes everything up to its close | `opencode-config.ts:191` (splice) and `:209` (`rewriteDynamicAgentModels`) | 1.4 |
| D57 | A firstRun token can be lost: a lock-busy create leaves `agent: {}` forever, and a user who empties `agent` is resurrected. A state predicate is deterministic and testable | `opencode-config.ts:471-479` | 1.2, decision 4 |
| D58 | "Byte-identical outside the block" is false on insertion: at least one separator comma is added. The contract must allow that comma and name the range | `opencode-config.ts:176-197` | 1.4, N9 |
| D59 | `rewriteDynamicAgentModels` duplicates the same fragile marker/brace parser, so boot repair stays indentation-blind and the two parsers drift | `opencode-config.ts:206-212` | 1.4 |
| D60 | The gate runs `--check` with no `--strict`, so making lenient the default silently degrades CI | `gate-manifest.json:55-60` | 1.4, N10 |
| D61 | `facts.ts check` pins `agentsTotal`; regenerating the repo config to 58 breaks `gate:fast` unless facts and config change together | `facts.ts:30`; `gate-manifest.json:70-75` | 1.4, N13 |
| D62 | Pins are `{pinned: string[]}` names only; "pin/config model disagreement" is not expressible. The failure set is retired membership only | `gen:104-119,586-600` | 1.4, N10 |
| D63 | "`buildAgents` derives from config" is ambiguous: the global roster has no config. Only `buildMergedAgents` may read config; `buildAgents` takes the emission set as a parameter | `gen:504,576` | 1.4 |
| D64 | Rerouting `ensureMinimalProjectContract` in 1.0/A breaks a clean project: `buildAgents` calls `assertBaseRegistrySync` and `readFrontmatter`, which throw when the 8 md files are absent | `gen:415-421,510` | 1.0/A, 1.2 |
| D65 | `ensureMinimalProjectContract` returns `non-project-scope` under a global install, so firstRun cannot fire there. Project scope is the supported mode and must be stated | `opencode-config.ts:464`; `install-scope.ts:7-13` | 1.2, non-goal 5 |
| D66 | The "no orphan names" check is tautological once expected = present keys. It must mean: every emitted key is a base, a variant of a base present in config, or `addagent`, and no retired variant is emitted | plan 1.2 | 1.2 |
| D67 | `addagent` and kick resolve the config through `resolveActiveConfigPath(ctx.stateDir)`; with a state override they write a stray config under state | `agent-management.ts:721,1153`; `agent-kick-runtime.ts:89` | 1.4, decision 10 |
| D68 | `resolveGenPaths` hardcodes `opencode.json`; a jsonc project creates a shadow config while `--check` stays green | `gen:53-60,688` | 1.3 |
| D69 | Two count-gate sites abort generation: pre-lock and in-lock | `gen:851-861,866-872` | 1.2 |
| D70 | `--check` returns `ok: true, missing: true` when no config exists, so a missing config is never reported as drift | `gen:687-693` | 1.3 |
| D71 | Comments inside the `agent` block are destroyed on every write; this is existing behavior and must be acknowledged, not claimed as preserved | `opencode-config.ts:176-197` | 1.4, N9 |
| D72 | The splice range starts at the newline before `"agent":`, so the key's own formatting is rewritten | `opencode-config.ts:196` | 1.4, N9 |

### Round 7 — area review B (deletion + guards)

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D73 | `unpersistDeletedAgents` has a real global restore job; N4 as written removes it everywhere | `agent-management.ts:208-215,169-184` | 1.1, N4 |
| D74 | After the sidecar read is removed, a re-kick of an absent variant reports "removed" and performs a no-op fail-closed write | `agent-management.ts:1028,1041-1043` | 1.1, N8 |
| D75 | The config-derived dynamic set is populated asynchronously, while the constructor reads tombstones synchronously; the pre-read window leaves the set empty or full | `AgentManager.ts:59-62` | 1.1, N5 |
| D76 | "Missing key in config" names no candidate universe; builtins and md-only agents are not config keys and would be blocked | `dispatch-guards.ts:154,198` | 1.1, N14 |
| D77 | The `variantUndo` repair message is unreachable: a quiet re-add never enters `touchedTags`, so the undo block cannot run again | `agent-management.ts:603-612,858-868` | 1.1 |
| D78 | `pruneUserPreservedAgents` subtracts the deleted set from `userPreservedAgents`, so an intersection name is transiently deleted, contradicting N3 | `security-policy.ts:173` | 1.1, N3 |
| D79 | N12 leaves the muse choice open, so the contradiction survives | `security-policy.ts:141-147`; `model-registry.ts:47,70` | 1.1, N12 |
| D80 | D38's wording was wrong: undo never writes a model; the hazard is tombstone suppression of regeneration | `agent-management.ts:858-868` | ledger |
| D81 | `dropAgentState` runs after the config write, leaving a window where dispatch sees a live-but-removed agent | `agent-management.ts:1232` | 1.1 |
| D82 | `parseKickInput` derives a variant spec for a bare base; N5's base-protection argument depends on preserving that derivation | `agent-kick-helpers.ts:51-52` | 1.1, N5 |

### Round 8 — area review C (boot repair + locks)

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D83 | `releaseFSLock` returns early on owner mismatch and in the catch path **without stopping the heartbeat**, so a process that lost ownership keeps a timer alive | `file-lock.ts:304-343` | 2.0 |
| D84 | Project-scope lock anchors diverge: kick/addagent lock `ctx.stateDir` while repair/contract/F6 lock the project root. With a state override the two writers never serialize | `agent-management.ts:71-83`; `opencode-config.ts:424,474` | 1.4, decision 9 |
| D85 | The atomic wrapper's backup is not fsynced and its rollback is a `copyFile`, so a crash between verify and rollback leaves a partial file | `atomic.ts:63-112` | 2.6 |
| D86 | `removeFSLockDir` and the exit cleanup remove lock directories without an owner-token check, the same class as the reaper | `file-lock.ts:60-95,415-459` | 2.0 |

### Round 9 — area review D (shared storage + identity + watchdog)

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D87 | With `TAWASSUL_KEYRING=1` the keychain wins on read, but `setSecret` writes only `secrets.json`, so a rotated secret is shadowed by the stale keychain value | `keyring.ts:24-52,71-99` | 2.4 |
| D88 | Decision 7's path is not guaranteed: XDG wins, and an empty data root falls back to the workspace directory | `state-paths.ts:23-35`; `client-shim.ts:89-100`; `context-class.ts:441-443` | decision 7 |
| D89 | "jsonc wins and a warning is emitted" is a target, not today's behavior: no warning exists in `src/` | `path-resolver.ts:127-132` | decision 10 |
| D90 | Refusing on any canonical mismatch also refuses a legitimately relocated `project-id` project, whose key does not depend on the path | `project-identity.ts:76-79` | 2.1 |
| D91 | Rotation is not one critical section in-process: `installUsageLedger` disposes the previous ledger without awaiting, `rename` clobbers an existing `.1`, and one catch swallows both stat and rename failures | `usage-ledger.ts:830-841,856-862` | 2.2 |
| D92 | `persist()` is not awaited at its two call sites, so an async conversion would lose the record at exit unless the hook awaits it | `n2-auto.ts:117,155` | 2.3 |
| D93 | `TAWASSUL_N2_LOG` is returned unresolved (cwd-dependent) and the directory is created without mode 0700 | `n2-auto.ts:12-13,73` | 2.3 |
| D94 | `getSecret` reads the file without the lock, so a concurrent non-atomic write can yield truncated JSON and a silent `null` (fail-open) | `keyring.ts:55-65,95-98` | 2.4 |
| D95 | `name in data` traverses the prototype, so `hasSecret("toString")` is true and non-string values leak out | `keyring.ts:59-61` | 2.4 |
| D96 | `sanitizeProjectKey` lowercases, so case-distinct project IDs share one state root | `project-identity.ts:56-64` | 2.1 |
| D97 | `realOrResolve` falls back to `resolve` when the path is missing, so one directory can produce two canonicals across boots | `project-identity.ts:44-50,72-75` | 2.1 |
| D98 | Two directories can legitimately share a canonical, because `project.canonical` is independent of `directory`; scanning by canonical alone would merge unrelated workspaces | `project-identity.ts:74-82` | 2.1 |
| D99 | The identity scan is greenfield: `IDENTITY_FILE` is only written, never scanned | `project-state-migration.ts:243-268` | 2.1 |
| D100 | `writeIdentity` compares key, source, projectID and canonical but not `directory`, so the field stays stale | `project-state-migration.ts:256-262` | 2.1 |
| D101 | `prepareProjectState` returns before `writeIdentity` when `workspaceDir === root`, so that case never gets an identity file for the scan to find | `project-state-migration.ts:273-275` | 2.1 |
| D102 | Concurrent boots can collide because the backup stamp has millisecond resolution and no pid, and `writeBackup` throws when the target exists; the window is one millisecond, so this is a hardening note, not a P0 | `project-state-migration.ts:128-130,219` | 2.6 |
| D103 | `evaluate()` swallows every exception, so all tiers including emergency die without a log | `memory-watchdog.ts:222-224` | 2.5 |
| D104 | The plan defines no liveness rule for a peer: a stale entry or a reused pid would "prove" a second instance and suppress termination forever | plan 2.5 | 2.5 |
| D105 | "registry in the state root" is undefined under decision 7's project-scoped roots; it must be host-global | plan 2.5 | 2.5 |
| D106 | `/proc/meminfo` is Linux-only, so the low-system tier is inert elsewhere | `memory-watchdog.ts:36-41,157` | 2.5 |
| D107 | `statePath` returns a literal unresolved `"~/..."` on error, creating a relative directory named `~` in the cwd | `state-paths.ts` (error branch) | 2.6 |

### Round 10 — area review E (build + proofs + projects)

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D108 | `npm run ship` does not exist in `package.json`; Phase 3 describes it as if it does. It must be created, and it must not double-build (`npm run verify` already builds) | `package.json` scripts; `verify` = `gate:fast && build` | Phase 3 |

**Refuted in round 10:**

| Claim | Verdict |
|---|---|
| "`shared-parity.json` is missing S-030 and S-053" | Refuted: both exist (`S-030` at `:661`, `S-053` at `:1234`) |
| "Phase 3 claims the proof count updates automatically" | Refuted: the plan says the opposite (D41, N15) |
| "Phase 4 says ship runs `verify:global` without a build" | Refuted: the plan keeps `verify:global` outside `ship` and uses `verify:release-artifact` |

### Round 11 — area review E re-run (proofs + projects)

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D109 | The Phase-0 audit assumes `identity.json` exists, but it is written only when `workspaceDir !== root`; an entry without it is unidentifiable | `project-state-migration.ts:273-277` | Phase 0 |
| D110 | Shard registration is not an append: estimates must sum exactly and stay within 10% of the mean, so a new proof can unbalance a shard | `prove-proof-catalog.ts:305-320` | 4.2 |
| D111 | `docs/validation.md:13` is a hand-maintained proof count that the generator never rewrites | `check-release.ts:70-73`; `generate-proof-count.ts:50-56` | 4.2 |
| D112 | The release-notes stage table is a second hand-maintained set of counts | `check-release.ts:84-91`; `docs/release-notes-0.1.0.md:135-138` | 4.2 |
| D113 | `package.json` is listed as a registration point, but nothing validates `prove:*` aliases | `prove-proof-catalog.ts` (no package check) | 4.2 |
| D114 | `PINNED_PROOF_FILES` is order-sensitive (sorted readdir compared by JSON), so an appended name fails with a misleading message | `prove-proof-catalog.ts:259-265` | 4.2 |
| D115 | `--strict` never reaches installed copies; no gate step runs `verify:global`, so Phase 5 is manual, not CI-verified | `install-global.ts:1223-1327`; `gate-manifest.json:54-61` | Phase 5 |

**Strict-mode correction (D62):** the repo has 34 keys, of which 30 are expected (58 − 28 generated-variant deletions; the deletion file holds 35 names, but the seven `*-muse` names are not generated variants) and 4 are preserved freeform keys. `--strict` must pass it: model-vs-template is **never** drift; only `RETIRED_MODEL_IDS` is. Dropping pin-based acceptance without that rule would fail `dev` (pinned gemini against a deepseek template).

### Round 12 — area review F (permissions + adversarial)

| # | Defect | Evidence | Owner |
|---|---|---|---|
| D116 | `prove-s028.ts` asserts that the seven `*-ling` names are retired and that `validateAddInput(["analyst-ling"], …)` is refused. N12 inverts both, so that proof turns red inside the atomic commit | `prove-s028.ts:93-98` | 1.5, N12 |
| D117 | `permission-guard` still treats `deleted-agents.json` as a roster file, still reads it, and still blocks a shrink with a message about a mechanism that no longer governs | `permission-guard.ts:106,120-128,215-236` | 1.1 |
| D118 | The kick fallback hint hardcodes `analyst-ling`, which N12 makes a legitimate variant, and `kickNotAnalystHint` offers `@tawa remove`, a tool `tawa` is blocked from | `agent-management.ts:961`; `i18n/en.json:277`; `security-policy.ts:54-60` | 1.1 |
| D119 | The language gate scans only `.ts/.mts/.mjs/.json`, so the JSONC fixtures the plan adds under `scripts/` or `tests/` escape both the English-only and the no-comments rules | `check-v2-rules.mjs:30-33` | 1.5, 2.6 |
| D120 | The config lock name hashes `resolve(anchor)` without `realpath`, so a symlinked or differently-spelled project root produces two lock names for one file | `opencode-config.ts:258-260` | 1.4, decision 9 |
| D121 | `withConfigWriteLock` proceeds **unlocked** after 8 failed retries unless `failClosed` is set, so a quarantined or busy lock does not serialize a config write | `agent-management.ts:84-91` | 1.4, 2.0 |

**Refuted in round 12:** "identity files written before `directory` was included will not match the new scan." Refuted: `writeIdentity` already writes `directory` (`project-state-migration.ts:249-251`); only the comparison omits it (D100).

### Refuted in full-scope evaluation 1

| Claim | Verdict |
|---|---|
| "`.opencode/deleted-agents.json` holds 28 entries, not 35" | Refuted: the file holds 35 names; 28 of them are generated variants, because `muse` is not a suffix in `MODEL_SUFFIX_MAP` (`model-registry.ts:13-59`) |
| "`BLOCKED_TOOLS` is at `security-policy.ts:34`" | Refuted: it is at `:49`; the ledger row is corrected |
| "Phase 3 names `verify-artifact`" | Confirmed typo: the real script is `verify:release-artifact`; both sites are corrected |

### Corrected in full-scope evaluation 2

| Claim | Verdict |
|---|---|
| "D25 blocks 40 retired names" | Corrected: the static list holds 39 names (`security-policy.ts:116-154`), so the row now says 39 |
| "Concurrent boots collide because the backup stamp is second-resolution" | Refuted as stated: the stamp is millisecond-resolution (`project-state-migration.ts:128-130`); D102 is reworded as a one-millisecond hardening note |
| "Decision 9's `failClosed: true` is already universal" | Not yet: `agent-management.ts:861,877` omit it; decision 9 now names both call sites |
| "`tawa` is in `BLOCKED_TOOLS`" | Corrected: `BLOCKED_TOOLS` lists tool names; the accurate statement is that `isBlockedToolForTawa` blocks the `kick` tool (`security-policy.ts:54-60`) |

### Refuted in round 7

| Claim | Verdict |
|---|---|
| "The seed script must move into the bundle before any seeding can work" | Refuted as a blocker: `src/agent-templates.ts` already re-exports `ALL_AGENTS` and `generateAgentMd` |
| "`variantUndo` overwrites the model addagent wrote" | Refuted as stated: it edits a list entry, not a model. The real hazard is tombstone suppression (D80) |
| "The upward walk exists in `resolveActiveConfigPath`" | Refuted: that function is an exact-dir check. The heuristic is `inferProjectRoot` (D53) |
| "`findMatchingBrace` must be fixed" | Refuted: it already skips strings and comments (D47) |
| "`disk-utils.ts` is the atomic writer" | Refuted: no such file; the real path is `src/utils/atomic.ts` (`atomicWriteFs`) |

---

## Phase 0 — Read-only Preflight

**0.1 Audit script (to be created).** `scripts/audit-installed-projects.ts` prints per project: path, state key, `canonical` and `source` from `identity.json`, agent count, missing bases, present variants, presence of `deleted-agents.json`, the deletion/config intersection, the effective set, and the `tawassul.js` hash.
**0.2 Baseline.** Run it on the seven projects **and on this repository**, whose own `.opencode/deleted-agents.json` holds 35 entries and whose config holds 34 agents. Record before any edit; rerun after every phase and compare content.
**0.3 Runtime condition:** if `~/.local/share/tawassul-v2` is absent, return zero projects without throwing. A `projects/*` entry without `identity.json` is still reported: use the directory name as the key and mark `source: unknown` (D109).

**Definition of done:** a stored baseline report with both intersections, and zero disk change.

---

## Phase 1 — Generation and First Run (P0)

**Atomicity (blocking):** 1.0–1.5 ship as **one commit**. Every intermediate state is bootable and self-defeating: F6 (`plugin-init.ts:720-756`) runs on each boot and rewrites the full roster. The window opens at **1.1**.
Inside that commit the order is: **1.0/A** extraction (behavior-preserving) → **1.4** decision + emission modes + hardened primitive + F6 scoping + coordinator → **1.1** → **1.2** → **1.3** → **1.0/B** parity → **1.5**.
1.4 ships with F6 in `project-additive` and a temporary kill switch (`TAWASSUL_F6_WRITE=0` is not allowed; use an in-code constant `F6_WRITE_ENABLED`, set false in 1.4, true in 1.2 of the same commit). The commit is atomic, so the switch never ships in the false state.

### 1.0 Prerequisites

**A. Exported writer (extraction only).**
- Extract `writeConfigLocked(projectRoot, mode)` (lock-free) and `regenerateProjectConfig(projectRoot, mode)` (acquires the lock) from `main()` (`gen:805-888`). Export both.
- Keep `refuseProjectTarget` inside `regenerateProjectConfig` for the CLI. Do **not** call the writer from F6 or `ensureMinimalProjectContract` in this step; that happens in 1.4 and 1.2.
- Seeding uses the existing bundled re-exports in `src/agent-templates.ts:2-5`; no script import and no move.
- **Do not** reroute any caller here. The DoD is "extraction is behavior-preserving and `gate:fast` passes", exactly as the current plan states; bullet 2 of the old 1.0/A contradicted that DoD (D64).

**B. Parity ledger.** Re-dispose S-030/S-053.10 in the same Phase-1 commit and update `scripts/prove-seed-agents.ts:76` and `docs/SHARED-PARITY.md`.

### 1.1 Retire `deleted-agents.json` in Project Scope

**Touchpoints — changed together:**

| File | Role | Action |
|---|---|---|
| `src/tools/agent-management.ts:136-197` | reads and writes the deletion list | remove the project sidecar write **and every project read** (`:1028,1041-1043`, `:208-215`); **keep the global roster path** (`unpersistDeletedAgents` for global scope, D73) |
| `src/tools/agent-management.ts:1028-1073` | kick short-circuit | derive "already deleted" from the absent config key; report it instead of writing (D74) |
| `src/tools/agent-management.ts:603-612,858-868` | undo repair message | with insert-if-absent the message is dead; delete it (D77) |
| `src/tools/agent-kick-runtime.ts:54-127` | the real config-key deleter | keep |
| `src/utils/path-resolver.ts:135-137` | `resolveDeletedAgentsPath` | drop after the last project reader is gone |
| `src/hooks/guards/permission-guard.ts:106,120-128,215-236` | roster-file guard includes `deleted-agents.json`, reads it, and blocks shrinking it | remove the sidecar from `isRosterFile`, from the read, and the `deleted-list-shrink` branch; keep `tawassul-pins.json` (D117) |
| `src/utils/project-state-migration.ts:44` | `EXCLUDED_ENTRIES` | **stays** |
| `src/scripts/gen-opencode-config.ts:58,255-275,508,584,708,747,849,864` | project-lane reads | remove for project scope; keep the global lane |
| `src/scripts/gen-opencode-config.ts:104-118` | `loadPinnedAgents` derives from `dirname(deletedPath)` | pass `tawassul-pins.json` explicitly |
| `src/context/managers/AgentManager.ts:59-62,163,309-355` | deleted roster and filtering | synchronous config-derived refresh at construction; builtin carve-out (D75, D76) |
| `src/security-policy.ts:114-163` | static 39-name list | keep except the seven `*-ling` (39 → 32) |
| `src/security-policy.ts:166-175` | `pruneUserPreservedAgents` | remove the prune; config presence wins (D78) |
| `src/security-policy.ts:435-454` | dynamic set and dispatch | config-derived with the pinned universe |
| `src/tools/agent-add-helpers.ts:197` | static retired rejection | **keep unchanged** |
| `src/hooks/guards/dispatch-guards.ts:154,198` | `checkDeletedAgent` | static unchanged; dynamic from config |
| `src/tools/agent-management.ts:961,1232` | kick fallback hint and `dropAgentState` ordering | drop the hardcoded `analyst-ling` hint; remove agent state only after the config write is durable (D81, D118) |
| `src/i18n/en.json:277` | `kickNotAnalystHint` | drop the `@tawa remove` example; `tawa` is blocked from the `kick` tool (`isBlockedToolForTawa`, `security-policy.ts:54-60`), and replace the `analyst-ling` sample (D118) |

**Additional obligations:**
- **`variantUndo` (N4):** project scope = insert-if-absent using the template model; if the key exists, no-op. Global scope keeps `unpersistDeletedAgents`.
- **Base protection (N5):** `isProtected` covers `AGENTS_DEFAULT`; preserve `parseKickInput`'s bare-base derivation (D82). Absence = deletion applies to variants and added agents only.
- **Retirement reconciliation (N12):** remove the seven `*-ling` names (39 → 32); reconcile `muse-spark-1.2-contributor-free` by dropping it from `RETIRED_MODEL_IDS` (it has no suffix, so it adds no variants). The global lane keeps its own deletion set, so the same step removes any `*-ling` entry from `roster.deleted` in `~/.config/opencode/tawassul.jsonc` (global only, once); without it the 51 → 58 change does not materialize. State both effects in the commit message (D54).
- **Dynamic universe (N14):** universe = nine bases + seven roles × seven suffixes. Builtins excluded. The set is `universe − config keys`. If the config is unreadable, keep the previous set and warn; never switch to "block everything".
- **Seven-project reconciliation:** compare each project's `deleted` array with its config keys; the key wins and the entry is reported.

**Definition of done:** deleting an agent from config does not bring it back; undo inserts only if absent; static retired names still rejected and still blocked; **grep proves zero project-scope readers and writers**; the global restore path still works; no legacy file is deleted.

### 1.2 First Run

- **Trigger is a predicate, evaluated under the lock on every boot:** `config missing` OR `agent` is an empty object (D57). No token. Empty cannot arise from kicking, because bases are protected.
- **Three modes, not two:** `full-roster`, `project-additive`, `first-run`. `buildAgents` keeps `deleted` optional and `mode` defaulted to `full-roster` for existing script callers (D52). Only `buildMergedAgents` reads config (D63).
- **Emission set:** `first-run` emits exactly the 16 names. The seven pickle variants come from `MODEL_SUFFIX_MAP`; `addagent` is synthesized (`gen:540`) and exempt from the orphan check (`gen:410`).
- **Files:** 8 md files from `src/core/agent-data.ts:32` via `src/agent-templates.ts`, written **before** the config write. Variants are config-only.
- **Count gate:** replace the literal check at **both** sites (`gen:851-861`, `gen:866-872`) with a mode-aware set predicate. `EXPECTED_AGENT_COUNT` stays for `full-roster` only.
- **Reroute:** `ensureMinimalProjectContract` calls `writeConfigLocked` **inside the lock it already holds** (D51); never `regenerateProjectConfig`. A separate boot step handles the `exists + empty agent` case by acquiring the lock itself.
- **Orphan rule:** every emitted key must be a base, a variant of a base present in config, or `addagent`; no retired variant may be emitted (D66).
- **Scope:** project install only; a global install returns `non-project-scope` and never reaches firstRun (D65, non-goal 5).

**Definition of done:** a clean temporary directory plus a first boot → 16 keys and 8 md files; a second boot changes nothing; a lock-busy first boot retries on the next boot and still reaches 16.

### 1.3 Generate a Missing Config

- Resolve through `resolveActiveConfigPath` (jsonc first, then json).
- `resolveGenPaths` must not hardcode `opencode.json` (D68); it returns the resolved path and a flag for the stale sibling.
- Create the skeleton (`$schema`, `experimental.subagent_depth: 3`) then write.
- `--check` on a missing config: fail unless `--allow-missing`, because generation would create it (D70).

### 1.4 One Decision, Separate Writers, One Hardened Primitive

- **One decision:** `expectedAgentSet(mode, config)` used by `--check`, F6 and generation. It fails only on: missing base, structural corruption, or a model in `RETIRED_MODEL_IDS`. Pins govern refresh, not failure (D62).
- **Lenient project mode / strict gate:** absent variants are not failures in `project-additive`; mode and permission drift on a present agent are warnings in lenient mode and failures in `--strict`. **Add `--strict` to `gate-manifest.json:55-60`** (D60). Model-vs-template is never drift in either mode; only `RETIRED_MODEL_IDS` fails, so the repo's 34-key config passes strict (D62, D115).
- **Primitive hardening:** `locateAgentSection(raw)` becomes the single structural locator used by both `spliceAgentSection` and `rewriteDynamicAgentModels` (D59). It:
  - finds the top-level `"agent"` key, not a string marker (D28);
  - if the value is non-object, replaces only that value token (D56);
  - if the key is absent, inserts before the final `}` with at most one separator comma, preserving indentation and line endings (D58);
  - returns `keyStart…valueEnd`, the exact byte range the contract covers (D72);
  - never re-serializes a JSONC file, never throws on a missing section.
  - **Accepted loss:** comments and formatting inside the block are replaced, as today (D71). Comments outside are preserved byte-for-byte.
- **F6 scoping:** `ctx.directory` feeds both the check and the write. Gate on an active config inside the project root and not global; `refuseProjectTarget` stays a CLI requirement (D39). Resolution walks up from `ctx.directory` and stops at `.git`, `.opencode`, or `$HOME`; the **foreign-root heuristic to neutralize is `inferProjectRoot` (`gen:45-51`)**, not `resolveActiveConfigPath` (D53).
- **F6 target:** the resolved project root feeds check, write, and lock anchor. The same anchor is used by repair, contract, F6, kick and addagent; `stateDir` never feeds a config write or a config lock (D67, D84).
- **Boot coordinator:** await repair → contract → F6 behind one promise; read inside the lock; each keeps its policy; F6 is additive-only and re-reads inside the lock (D18). `repairProjectConfigBoot` keeps its backup policy and uses the hardened primitive.
- **F6 write switch:** `F6_WRITE_ENABLED` is `false` in 1.4 and `true` after 1.2 lands in the same commit (atomicity).
- **Failure visibility:** the F6 passive-regen path logs `debug` today (`plugin-init.ts:770-772`); it must log `warn` and surface a health signal, so a skipped repair is observable (D13).

**Definition of done:** manual deletion → `--check` passes and boot does not resurrect it; JSONC with comments keeps every byte outside the range identical; `agent: null` is replaced without touching the next member; nothing is written outside the project root.

### 1.5 Related Proofs

- `prove-first-boot-seed.ts:30`: 16 by name + 8 md + no deletion file + idempotent. Keep the global seed check (`:69-73`).
- `prove-backup-cap.ts:5,72`: migrate to `repairProjectConfigBoot` before deleting `ensureAgentModels`.
- `prove-gen-merge-guards.ts:51,59-61`: drop the deletion-file copy; drift = retired model only, not "any difference from the template".
- `prove-e02.ts:155`, `prove-s029.ts:92-104`, `prove-s036.ts:55-56`: re-base on the explicit mode and the emission set. **Invert the two global assertions that encode 51 agents** (D54).
- `prove-s028.ts:93-98`: invert both ling assertions — the seven names leave `DELETED_AGENTS`, and `validateAddInput(["analyst-ling"], …)` becomes accepted (D116).
- New proofs: static retired names still blocked; undo insert-if-absent; JSONC byte-identical outside the range; `agent: null` safety; `--strict` fails on drift; intersection reported with every key preserved; re-kick reports already-deleted.
- **Language gate:** add `.jsonc` (and any new fixture extension) to the scanned set in `scripts/check-v2-rules.mjs:30-33` in the same commit that adds the first JSONC fixture, so fixtures cannot escape the English-only and no-comments rules (D119).
- **Register these proofs in the same commit (D41).**
- Update `prove-seed-agents.ts` and `docs/SHARED-PARITY.md` (1.0/B).

---

## Phase 2 — Concurrency Risks (P0/P1)

**Scope:** host-global files shared by all seven projects; 2.2–2.4 key their locks from the file path.

### 2.0 Fix the Lock Reaper First (P0)
- Versioned format: version + owner token + expiry; compare the full token, not the pid; drop `birthtime` for versioned locks.
- Removal is atomic: re-check the token, `rename` to quarantine, then delete. Every removal is logged.
- **Legacy migration:** an unversioned lock is never reaped by `birthtime`/3s. Adopt only when `expires` is older than the TTL; rename to quarantine first; recursive removal only on the quarantined name (D48).
- **Heartbeat lifecycle:** stop the timer on every release path — success, owner mismatch, thrown error, and process exit. A lost-ownership release must never leave a timer that renews another owner's expiry (D83).
- **One removal gate:** `removeFSLockDir` and the exit cleanup use the same token re-check and quarantine rename as the reaper (D86).
- **A quarantined lock is still held:** quarantine renames must not make `checkFSLock` report "not locked" to a writer that then proceeds unlocked (D121).
- **Reentrancy guard:** document that `acquireFSLock` is not reentrant and assert it in development (`file-lock.ts:169-190`).

### 2.1 Stable Project Identity Key (P0)
- Build the scan that does not exist today (D99): read `projects/*/identity.json` and match on **`canonical` and `directory` together**, because two directories can share a canonical (D98).
- Reuse the matched directory. Refuse a canonical mismatch only for path-derived keys; a `project-id` key is allowed to move (D90).
- Preserve case in `sanitizeProjectKey` (D96) and normalize with `realpath` only after the path exists (D97).
- Write the identity before the `workspaceDir === root` early return (D101), and include `directory` in the comparison (D100).
- Warn when `source` changes for the same project.

### 2.2 `usage-ledger.jsonl` (P0)
- One critical section: lock named from the path around `stat → rotate → appendFile` (`usage-ledger.ts:830-841`).
- Rotate to a non-clobbering name, log rename failures instead of swallowing them, and `await` the previous ledger's `dispose()` in `installUsageLedger` (D91).
- Guard `enqueue` after dispose so a late row is reported, not silently dropped.

### 2.3 `n2-auto.jsonl` (P0)
- Convert the synchronous read-truncate-write to async, and **await `persist()` at both call sites** plus a flush on exit (D92).
- Resolve `TAWASSUL_N2_LOG` and create the directory with mode 0700 (D93).
- Lock + temp/fsync/rename (`n2-auto.ts:74-82`).

### 2.4 `secrets.json` (P0)
- **One source of truth:** with `TAWASSUL_KEYRING=1` either write both backends or pin the file; today a rotation is shadowed by the keychain (D87).
- Lock the **read** path too, so a truncated concurrent write cannot return `null` (D94); temp + chmod 0600 + rename on write.
- Own-property check plus `typeof value === "string"` (D95).
- Replace the blocking `execFileSync` keychain calls with async spawn or a cache (event-loop stall).

### 2.5 Multi-Instance Watchdog (P1)
- **Host-global** registry (not under a project root, D105), with heartbeat + expiry + `kill(pid, 0)` liveness; a stale entry or a reused pid never proves a peer (D104).
- Only the terminate tier is disabled; unreadable registry keeps today's behavior (N11).
- Log every `evaluate()` failure instead of swallowing it (D103); document the `/proc/meminfo` platform limit (D106).

### 2.6 Hardening (P2)
- HMAC self-heal: no `unlink` of another party's file; temp + link/rename; re-verify length (`crypto.ts:126-175`).
- Atomic wrapper: fsync the backup before replacing, and roll back with a rename instead of a `copyFile` (D85).
- Singletons: warn on two projects in one module instance; refuse a mismatched `clear*`.
- Migration under concurrent boots: unique backup suffix and a caught existing target, so the second boot does not fail (D102).
- `statePath` throws on error instead of returning a literal `"~/..."` that creates a directory named `~` (D107).
- State/config separation: a config write never resolves from `stateDir` (D67).
- Two-project event-scope proof.

---

## Phase 3 — Build and Install (P1)

- `npm run build` wipes `dist/release`; installation needs `dist/release`.
- `verify:global` checks the installed copy and the source digest, not the release pack (`install-global.ts:1223-1279`).
- `npm run ship` must be **created** (it does not exist, D108): `gate:fast` → `build` → `pack:release` → `verify:release-artifact`. No double build. (`verify:release-artifact` exists; `verify-artifact` does not.)
- `install:global` and `verify:global` are a separate install step, outside `ship`.

---

## Phase 4 — Proofs (P1)

| Proof | Requirement |
|---|---|
| `prove:regen-manual` | manual deletion → generation does not restore it |
| `prove:regen-34` | 34-key config + 8 md → no variant loss |
| `prove:retired-shield` | static retired names rejected and blocked |
| `prove:variant-undo` | insert-if-absent; existing key untouched |
| `prove:jsonc-roundtrip` | bytes outside the range identical; `agent: null` safe |
| `prove:strict-check` | `--strict` fails on drift; passes the 34-agent repo config |
| `prove:identity-stable` | `project.id` change → same state directory |
| `prove:multi-project` | two projects → separate dirs, non-intersecting sessions |
| `prove:shared-append` | 100 concurrent ledger appends |
| `prove:n2-auto` | 100 appends + concurrent truncation |
| `prove:keyring` | two concurrent writers for different names |
| `prove:reaper` | a live lock is not stolen; v1 lock adoption is safe |
| `prove:watchdog-suppress` | terminate tier disabled only with a proven peer |

**4.2 Registration — one ordered set (D109–D114).** A new proof is not "one file": `release` runs before `proof-catalog` and `proof-count` in `gate:fast`, so a partial update fails there first. Per proof batch, in this order:
1. create `scripts/prove-*.ts`;
2. add the step to `gate-manifest.json:124+` (the `proofs` array; `:54-61` is `config` inside `fast`);
3. insert the filename **in sorted position** in `PINNED_PROOF_FILES` and bump `PINNED_PROOF_STEPS` (`prove-proof-catalog.ts:70-265`) — appending fails with a misleading count (D114);
4. add the step to one shard in `proof-shards.json`, raise that shard's `estimateMs` **and** `totalEstimateMs`, and rebalance so the sum is exact and no shard exceeds 1.1× the mean (D110);
5. run `bun scripts/generate-proof-count.ts`;
6. update the hand-maintained counts in `docs/validation.md:13` and `docs/release-notes-0.1.0.md:135-138` (D111, D112);
7. add the `prove:*` alias; either add a catalog assertion for it or drop `package.json` from the claimed registration set (D113).

Phase-1 proofs register in 1.5; concurrency proofs here.

---

## Phase 5 — Existing Projects (the Seven and This Repository)

- Preflight before and after; compare content, not counts.
- The seven stay at 34 agents; `--check` passes in project mode without touching them.
- **No key is removed.** Any name in both the deletion list and config keeps its key and is reported.
- `deleted-agents.json` is ignored silently and not deleted.
- This repository keeps its 34-agent config and its 35-entry deletion file; facts stay at 34 (N13). After 1.1 that file is inert: no gate step or proof reads it, and it is not deleted.
- `--strict` never reaches installed copies, so Phase 5 is a **manual, recorded run** with the audit script, not a CI claim (D115).
- `tawassyl` is out of scope.

**Definition of done:** a before/after report proving keys and variants are identical; the intersection is reported and every overlapping key is preserved (effective set = deletion − config keys).

---

## Final Order

```
0    preflight + intersection (seven projects + this repo)
2.0  reaper + legacy-lock migration + reentrancy guard
2.2 / 2.3 / 2.4  path-keyed locks and atomic writes
2.1  identity stability
=== Phase 1 — one commit ===
1.0/A  extracted writer (lock-free + locking layers), no reroute
1.4    decision + three modes + hardened locator + F6 scoping + coordinator
1.1    retire the sidecar (project) + ling/muse + dynamic universe
1.2    firstRun predicate + seeding + reroute + count gates
1.3    missing config + --check semantics
1.0/B  parity re-disposition
1.5    proofs + registration
===========================
2.5  watchdog
2.6  hardening
3    ship
4    proofs + registration
5    verify the seven projects and this repo
```

## Evaluation Log

| Round | Evaluator | Scope | Outcome | Folded into the plan |
|---|---|---|---|---|
| 1 | analyst-deepseek | D1-D121, N1-N15, DEC1-10, all phases | 117 confirmed, 1 real-gap (D119), 1 refuted (D54), 2 misowned (D81, D118); N12 at-risk; DEC8 conflict; P1.1 and P1.4 gaps | D54 roster cleanup, D81/D118 touchpoints, D119 gate scope, `verify:release-artifact`, `BLOCKED_TOOLS` line |
| 1v | maintainer re-check | the four eval-1 claims | one claim refuted: the deletion file holds 35 names, not 28; the other three confirmed | correction log, D62 arithmetic clarified |
| 2 | analyst-mimo | D1-D121, N1-N15, DEC1-10, all phases | 118 confirmed, 1 real-gap (D13), 2 refuted (D25, D102), 1 new; P1.4 gap | D13 failure visibility, D25 count 39, D102 millisecond wording, DEC9 call sites |
| 2b | analyst-mimo | its five declared gaps + the five corrections | all five gaps closed; all five corrections judged adequate; 1 new minor | `BLOCKED_TOOLS` wording, D71 citation |

## Remaining Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Same project in two processes | excluded | lost updates | documented as unsupported |
| Two projects with the same `project.id` | low | shared state | refuse on canonical mismatch |
| Global install beside project install | low | shared singletons | documented as forbidden |
| `TAWASSUL_*` in the host environment | low | isolation defeated | boot check + warning |
| Manual reformatting of config | medium | generation disabled | structural locator + warn/health |
| Old processes during upgrade | low | unversioned lock | quarantine adoption (2.0) |
| Static list replaced by config-derived set | medium | retired names dispatchable | N1/N2 |
| `variantUndo` loses its global restore path | medium | global deletions cannot return | N4 carve-out (D73) |
| JSONC rewrite changes formatting | medium | user config rewritten | byte-range contract + proof |
| Insertion adds a comma | certain | "byte-identical" false claim | contract allows one comma (D58) |
| F6 scoping disables repair | medium | drift accumulates | resolve upward + health signal |
| Leniency hides real drift | medium | broken config passes | `--strict` in the gate (D60) |
| Watchdog registry unreadable | low | kill layer disabled | N11 fail-safe |
| Deletion entry still in config | medium | an agent returns | Phase 0/5: key wins, report |
| Existing project without `tawa.md` | medium | F6 refused | gate on config presence (D39) |
| New proofs land unregistered | high | `gate:fast` fails | register in the same commit (D41) |
| Repo config regenerated to 58 | medium | facts drift, gate fails | N13: never regenerate the repo config |
| Dynamic set empty before config read | medium | kicked variants dispatchable | synchronous refresh + pinned universe (D75) |
| `agent` non-object | medium | next member destroyed | structural value-token replacement (D56) |
| Undo overwrites the requested model | low | silent model change | insert-if-absent (N4) |
| Heartbeat survives a lost-ownership release | medium | another owner's lock is renewed forever | stop on every path (D83) |
| Config lock anchor diverges from the write target | medium | two writers interleave | one project-root anchor (D84) |
| Lock name aliasing (symlink or `..`) | medium | two locks for one file | `realpath` in the name (D120) |
| Config write proceeds unlocked | high | silent interleaving | `failClosed: true` everywhere (D121) |
| JSONC fixtures escape the language gate | medium | non-English or commented fixtures ship | add `jsonc` to the scan (D119) |
| `userPreservedAgents` is a module singleton | medium | one project's keys unblock another's retired names | identity-scoped set (2.6) |
