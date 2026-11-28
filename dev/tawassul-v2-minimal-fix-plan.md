> **FROZEN 2026-11-09.** This revision is a historical record. It is not
> executable, must not be extended, and must not be cited as authority. The
> executable plan is `docs/tawassul-v2-code-first-plan.md`.

# Tawassul V2 — Minimal Fix Plan

Date: 2026-11-09
Reference: HEAD `acc3c4e`
Revision: 5 — third (scoped) evaluation round applied; every open point is closed in section 14.
Supersedes: `docs/tawassul-v2-fix-plan.md`, kept as a non-executable audit.

## 1. What this plan is

Three changes, not a restructuring:

1. A first run in a user project creates **16 agents**, not 34 and not 58.
2. A deleted agent **stays deleted** across updates, and an explicit re-add works.
3. Two processes on two projects do not corrupt the shared files.

The 121-item audit is evidence, not a work order. Roughly one third of it belongs to these three changes; the rest is frozen in section 12.

## 2. Evaluation of the old plan

| Area | Verdict | Action |
|---|---|---|
| Emission set built from the deletion list | correct diagnosis | kept and fixed |
| Config presence as the only source of truth | correct | kept |
| One lock, two layers, `failClosed` | correct | kept |
| Lock name from `realpath` | correct | kept, now centralised |
| No developer deletion list shipped | correct | kept |
| 121 items as the execution scope | overreach | frozen; only the three changes execute |
| Identity scan, watchdog registry, HMAC, migration, `ship`, proof pipeline | unrelated to the three | frozen |
| Rewriting the JSONC locator, the F6 coordinator, the keyring source of truth | unrelated | frozen |
| Static `DELETED_AGENTS` as an authority | wrong | removed from every user-facing decision |
| Catalog as model truth | wrong | the provider is truth |
| Global `roster.deleted` cleanup for `ling` | wrong for this scope | dropped; the global lane stays explicit |

Errors found while evaluating the old plan and corrected here:

- The deletion file holds **35 names**, of which **28** are generated variants; the seven `*-muse` names are not. The old arithmetic `58 - 28 = 30` was right, but the reason was unstated.
- `BLOCKED_TOOLS` is a list of tool names, not agent names.
- The real script is `verify:release-artifact`, not `verify-artifact`.
- `D25` says 40 retired names; the static list holds 39.

Revision 3 corrections, from the first evaluation round:

- A deleted `*-pickle` was re-emitted by the additive filter; the keep-set is the existing keys.
- `unionDeletedVariants` read `DELETED_AGENTS`; the constant cannot go while the function stays.
- The project sidecar was still written by one branch and read by three others.
- The deleted-set direction was inverted in two steps.
- The contract forgot `projectRoot`; the pins path needed no change.
- Four proof blocks were missing; `pruneUserPreservedAgents` was cited at its definition.
- The unversioned-lock rule created an immortal lock; the anchor was normalised at one site out of five.

Revision 4 corrections, from the second evaluation round:

- `firstRunAgentSet` was defined but never called, and the merge loop only adds keys; the removal pass is now written out in A2.1 and A2.3.
- A4.1 deleted helpers the global lane still uses: `persistDeletedAgents` at `:1076`, `unpersist` through `variantUndo`, and the kick read at `:1028`. They are now scope-guarded, not deleted.
- `failClosed` is missing at both `:861` and `:877`; `:861` is a two-argument call with no option.
- `prove-s029` also imports `unionDeletedVariants` at `:13` and uses `retired` at `:106-110`.
- `shared-parity.json` S-030 anchors `unionDeletedVariants`; `--write` aborts on a vanished marker, so the anchor must be re-pointed by hand.
- The CLI count gate tested `buildAgents()` (58 keys) instead of the set actually written.
- `RETIRED_MODEL_IDS` is still an override trigger in `hooks-registration.ts:100-110`.
- `configPath: p` was out of scope; the acquire sites are six, not five.

Revision 5 corrections, from the scoped third round (section 14 only):

- A2.6's membership predicate rejected its own first-run output; it is now two-branch.
- B1 named the acquire path and `checkFSLock` only; `cleanExpiredFSLocks` and `removeFSLockDir` are now explicit, and a pid-less owner is reclaimed after the grace.
- A2.1 now states the splice boundary for a comment-bearing document without an `agent` marker.
- A7.2 now cites the section 9 fixture that keeps the `prove-s028:98` refusal `absent`.
- The 51 -> 58 rows in sections 12 and 13 were false: Commit A leaves the global lane untouched.

## 3. Requirements

1. Project scope only; no global install.
2. First run = the nine names in `BASE_ORDER` (`tawa`, the seven roles, `addagent`) plus the seven `pickle` variants of the seven roles: 16 keys.
3. No developer deletion list is shipped into a user project.
4. The deletion list exists to stop **generation** from re-creating deleted agents, not to refuse an explicit re-add.
5. A user who deletes an unwanted agent must not see it return on update.
6. The provider is the source of truth for model availability; the catalog is only a suffix and alias map.
7. No `TAWASSUL_*` variable in the host environment.
8. All code and docs in English.
9. No comments in scanned code (AGENTS.md rule 2), with one single-purpose exception: `@truth provider`; see section 5.

## 4. Design rules

- **R0 — Minimum fix.** Apply the smallest change that fixes the defect. Do not expand into adjacent defects, refactors, or new mechanisms. A change that grows beyond the touchpoints listed in sections 6–8 is rejected and raised to the user.
- **R0b — No feature-for-feature trade.** A fix must not break another working feature. If it would, redesign it or stop for an explicit user order. The definitions of done in this plan are the binding contract.
- **R1 — Presence is the record.** A key in `config.agent` means enabled; absence means deleted. No separate project tombstone is needed.
- **R2 — Additive generation.** The project emission set is: the 8 base agents + `addagent` + every key already present in `config.agent`. A key that is absent is never emitted, including a deleted pickle.
- **R3 — Provider truth.** `modelAvailability(model)` returns `served`, `absent`, or `unknown`. Only `absent` rejects or replaces. `unknown` allows and warns.
- **R4 — Project scope only.** `ensureMinimalProjectContract` already returns `non-project-scope` under a global install; first run never fires there.
- **R5 — Writes fail closed, model checks fail open.** A config write that cannot take the lock throws; an unavailable provider list never blocks a write.
- **R6 — No new environment variables.** No `TAWASSUL_*` gate, including a first-run token.
- **R7 — A parse failure is not a first run.** A config file that exists but cannot be parsed aborts generation and is never overwritten.
- **R8 — First run seeds before it builds.** `buildAgents` reads the 8 base `.md` files, so the files are written before any first-run set is constructed.
- **R9 — Scope, not deletion.** The project and global lanes share functions. A lane is removed by an early return on `SCOPE`, never by deleting a shared helper.

## 5. Code note — "the provider is the source of truth, not the registry"

Recorded as one directive on the declaration agents actually read, in `src/core/model-registry.ts:10`:

```ts
export const MODEL_CATALOG: ModelCatalogEntry[] = [ // @truth provider: the provider is the source of truth, not the registry
```

`@truth provider` is a single-purpose shape in `ALLOWED_COMMENT_PATTERNS` (`check-v2-rules.mjs:16-22`) and in AGENTS.md rule 2. It exists because `MODEL_CATALOG` was repeatedly read as the authority while the provider list was ignored. The pattern accepts that prefix only, with a non-empty sentence; every other prose comment stays rejected. `scripts/prove-rule-gate.ts` proves the acceptance and three rejections: a different source, an empty sentence, and a plain comment.

These four files are already modified in the working tree and are uncommitted:

| File | Change |
|---|---|
| `scripts/check-v2-rules.mjs` | the `@truth provider` pattern |
| `scripts/prove-rule-gate.ts` | three assertions |
| `src/core/model-registry.ts` | the trailing directive on line 10 |
| `AGENTS.md` | rule 2 names the shape and its purpose |

They are step A0 and belong to Commit A. They change no behaviour.

The same sentence also appears in the two runtime messages of `validateAddInput`:

| Path | Exact string |
|---|---|
| `absent` rejection | `<provider> does not list <model> — the provider is the source of truth, not the registry` |
| `unknown` warning | `provider list for <provider> is unavailable — the provider is the source of truth, not the registry; allowing <model> unverified` |

## 6. Commit A — patch list by file

Changes 1 and 2 are one commit. The list is ordered so no function is edited twice.

### A0. Working-tree gate files — no further edit

Commit the four files in section 5 as they stand. `npm run check:rules` and `bun scripts/prove-rule-gate.ts` already pass on them.

### A1. `src/core/model-registry.ts`

1. Keep exact slugs. `ProviderTokenCache` stores an expanded token set (`:129-138`), so `tokens.has("ling")` is true for every `ling-*` model. `absent` must not be concluded from a fragment. Add a parallel `exact: Map<string, ReadonlySet<string>>` populated with the lowercased model keys. `getProviderModelTokens` and `getAllProviderModelTokens` keep their current semantics.
2. Add `modelAvailability(fullModel): "served" | "absent" | "unknown"`.
   - No `/`, empty provider or slug -> `unknown`.
   - Provider absent from the cache (file missing, unreadable, or provider not listed) -> `unknown`.
   - Slug in the exact set -> `served`.
   - Otherwise -> `absent`.
3. No TTL. The cache is keyed by `mtimeMs` (`:108-146`); an unchanged file is treated as current. A missing or unreadable `models.json` makes every provider `unknown`, which is intended under R5. Each call re-stats the file; accepted.

### A2. `src/scripts/gen-opencode-config.ts`

1. `buildMergedAgents` (`:567-668`) control flow, in this order:
   - `maybeRaw === undefined` and the config file is absent (`existsSync` false) -> `return firstRunAgentSet()`;
   - read the file; parse failure -> throw `Error("opencode.json is present but cannot be parsed; regeneration refused")` (R7);
   - `agent` missing, `null`, or `{}` -> `return firstRunAgentSet()`;
   - otherwise build and merge (A2.3).
   A comment-bearing document without an `agent` marker cannot be spliced (`opencode-config.ts:188`); the write is refused before any byte is written and no setting is lost. The contract path always writes `agent: {}` into pure JSON, so a true first boot never hits this.
2. Add `firstRunAgentSet()`: `buildAgents([])` filtered to `BASE_ORDER`, `addagent`, and `isGeneratedVariant(name, EXTEND_AGENTS) && name.endsWith("-pickle")` -> 16 keys. It requires the 8 `.md` files; A3.1 seeds them first (R8). It is called only from A2.1.
3. Additive merge, after the existing merge loop at `:642-657`:
   ```
   for (const name of Object.keys(agents))
     if (isGeneratedVariant(name, EXTEND_AGENTS) && !(name in existing)) delete agents[name];
   ```
   The loop at `:642-657` only adds and copies; it never removes. Without this pass every regen emits all 49 variants and the resurrect defect survives. Non-generated keys are copied verbatim and are never deleted.
4. `buildAgents` (`:505-510`): default `deleted ?? []` instead of `unionDeletedVariants(readDeletedAgents(...))`. The global lane passes its own list.
5. Pins: no edit. `loadPinnedAgents` derives the file from `dirname(deletedPath)` (`:104-105`), which is `.opencode` in both lanes and matches `resolvePinsPath` (`path-resolver.ts:141-146`).
6. Count gates (`:852-872`): the predicate runs on the object actually written at `:873`, in two branches. If `existing` is empty (first run), the output must equal `firstRunAgentSet()` exactly: 16 keys. Otherwise every key must be a base, `addagent`, or a key in `existing`. The current code gates `buildAgents()` (58 keys), which the predicate can never satisfy. Keep `EXPECTED_AGENT_COUNT` and `derivedExpectedCount` for the global gate only (`:817`).
7. Retired override (`:590-591`): replace `RETIRED_MODEL_IDS.has(model)` with `modelAvailability(model) === "absent"`. With no provider list the model is kept, not migrated. That is R3, accepted.
8. Delete `unionDeletedVariants` (`:287-289`). It is the only function that reads `DELETED_AGENTS`, and the global lane uses `roster.deleted` (`:121-169`). Keep `derivedExpectedCount`, which does not read the static list.
9. `checkGeneratedConfig` (`:683-766`): drop the deleted-list read and variable (`:744-751`) and the `resurrected` block (`:752-763`). The function is project-only; the global lane uses `checkGlobalRoster`.
10. CLI `main()` (`:849-850`, `:864-865`, `:873`): the project lane writes `buildMergedAgents(...)` and gates that same object. The global lane is unchanged.

### A3. `src/utils/opencode-config.ts`

1. Add `ensureFirstRunAssets(projectDir)`: create `.opencode/agents` and write the 8 base `.md` files from `ALL_AGENTS` and `generateAgentMd` (`agent-templates.ts` re-exports both), only when missing.
2. `ensureMinimalProjectContract` (`:460-499`): after the lock and the boot jitter, seed the assets, build the document with `agent: {}`, then call `buildExpectedConfig(docText, { projectRoot: projectDir, configPath })` through a dynamic `await import("../scripts/gen-opencode-config.ts")` and write the result atomically. Use the `configPath` local declared at `:489`, not the loop const `p` from `:480-483`. The dynamic import avoids the cycle: that module imports `spliceAgentSection` from this one.
3. Lock anchor: normalise inside `opencodeConfigLockName` (`:258`), not at the call sites. All six acquire sites funnel through it: `opencode-config.ts:318`, `:424`, `:474`, `agent-management.ts:84`, `plugin-init.ts:744`, `gen:785`. Fall back to `resolve` if `realpath` throws.
4. Repair rewrite (`:218-247`): replace only on `modelAvailability === "absent"`; keep on `served` or `unknown`. This touches both `:227` and `:233`.

### A4. `src/tools/agent-management.ts`

1. Remove the project **branches**, never the shared helpers (R9):
   - `readDeletedAgentNames` (`:140-178`): global branch only; the project branch goes.
   - `writeDeletedAgentNames` (`:180-205`): global branch only; the project branch goes. `deletedAgentsPath` (`:136`) becomes unused and is deleted.
   - `persistDeletedAgents` (`:202-206`) and `unpersistDeletedAgents` (`:208-215`): early return unless `SCOPE === "global"`. The call at `:1076` and the `variantUndo` block (`:858-869`) stay, and `variantUndo` runs only in the global lane.
   - `dropAgentState` (`:1233`) and every unguarded helper stay.
2. Kick (`:1028`): replace the project read with a local helper that returns the generated variants **absent** from the project config; keep `readDeletedAgentNames` for the global lane. `deleted` still feeds `alreadyDeleted` at `:1041`.
3. After the config write is durable (`:1233`), refresh `setDynamicDeletedAgents` with the generated variants **absent** from the new config. Present keys are never marked deleted.
4. `failClosed`: two locks lack it, `:861` and `:877`; both are two-argument calls with no option. Pass `{ failClosed: true }` to each.
5. `deadModels` sweep (`:1085-1199`, nine `RETIRED_MODEL_IDS` sites including `:1128` and `:1179`): `modelAvailability === "absent"`. `RETIRED_MODEL_IDS` remains only for fallback-chain ordering.
6. `src/bootstrap/hooks-registration.ts:100-110`: the `isRetired` trigger becomes `absent`; `:125` and `:147` keep their fallback-chain role. `gen:135` stays static because it is a global-lane merge, not a project decision.

### A5. `src/security-policy.ts`

1. Two sites, not one: `validateTaskRouting` (`:436`) and `checkDeletedAgent` (`:454`). Drop `DELETED_AGENTS` from both; keep `dynamicDeletedAgents` minus `userPreservedAgents`.
2. Dynamic set producer: generated variants of the seven roles that are **absent** from the project config. Builtins are excluded. `AgentManager.deletedRoster` is the sole producer; `security-policy` does not import config readers.
3. Delete `DELETED_AGENTS` (`:114`). Importers to clean: `gen-opencode-config.ts:7`, `agent-add-helpers.ts:9`, `prove-s028.ts:8`, `prove-s029.ts:15`, `prove-s036.ts:4`.
4. `pruneUserPreservedAgents` (`:173`) is a definition, not a call. The boot call is `AgentManager.ts:360`, removed by A6.3. Keep the export: `agent-management.ts:182` is the only surviving global call; `:199` is in the project branch removed by A4.1.
5. `scripts/shared-parity.json` S-030 anchors `unionDeletedVariants` at `gen:287`. Re-point it to `derivedExpectedCount` in the same commit. `bun scripts/check-shared-parity.ts --write` aborts when a marker disappears (`:371-373`), so this is a hand edit, not a mechanical one.

### A6. `src/context/managers/AgentManager.ts`

1. `deletedRoster()` (`:309-360`): the **project branch** returns the generated variants whose key is **absent** from `config.agent`. The global branch (`:330-338`) keeps reading `roster.deleted`.
2. Cache key becomes the config `mtimeMs` and size instead of the sidecar mtime (D1).
3. Remove the `pruneUserPreservedAgents` call at `:360`.

### A7. `src/tools/agent-add-helpers.ts`

1. `:197`: remove the `DELETED_AGENTS.has` rejection and the `:9` import.
2. Add the provider check, with the section 5 strings:
   - `absent` -> return the rejection;
   - `unknown` -> `logger.warn` and allow;
   - `served` -> allow.
   Add the `logger` import; the file does not have one today. The two strings stay raw English rather than `t(...)` because they carry the policy sentence verbatim.
   The `:98` refusal survives only with the section 9 fixture: a models file that lists provider `opencode` without `ling-3.0-flash-fin-free` yields `absent`. Today's directory fixture yields `unknown` and would allow.
3. `resolveModelAlias` (`:170-182`) still rejects an alias the catalog does not know, before any provider lookup. Kept: an alias is a catalog convenience; `provider/model` is the provider path. Documented gap, frozen.

### A8. `src/hooks/guards/permission-guard.ts`

1. Remove `deleted-agents.json` from `isRosterFile` (`:106`) and the `deleted-list-shrink` branch.
2. `opencode.json` is already protected at `:99-101`, so no replacement guard is needed (D6).

### A9. `src/bootstrap/plugin-init.ts`

No edit. The parse failure is thrown by A2.1 inside F6's existing `try` (`:721`, catch at `:770`).

## 7. Overlaps and dependencies — resolved

| # | Was | Resolution |
|---|---|---|
| O1 | `buildMergedAgents` edited three times | one pass in A2: first-run, merge, removal, gates, CLI |
| O2 | `opencode-config.ts` edited three times | A3 covers contract, repair, and anchor |
| O3 | `agent-management.ts` edited four times | A4 covers branches, refresh, locks, dead models |
| O4 | dynamic set updated from two places | A4.3 refreshes it; A5.2 names `deletedRoster` as the producer |
| O5 | `failClosed` two sites | A4.4 covers `:861` and `:877` |
| O6 | two lock anchors | A3.3 normalises inside `opencodeConfigLockName` |
| D1 | `deletedRoster` cached by sidecar mtime | A6.2 re-keys on the config |
| D2 | stale dynamic set after delete | A4.3 refreshes after the write |
| D3 | Commit B touched the Commit A lock | anchor moved to A3.3 |
| D4 | `resolveGenPaths` hardcodes `opencode.json` | frozen: a jsonc-only project is not a first run |
| D5 | three proof imports of `DELETED_AGENTS` | A5.3 and section 9 |
| D6 | permission guard gap | none; `opencode.json` is protected |

## 8. Commit B — cross-process safety

1. `src/infra/file-lock.ts`
   - `file-lock.ts` has no version field; the condition is "expiry absent or unparseable". Read the owner and remove when the pid is dead. If the owner is missing or unparseable, apply the 3000 ms grace once, re-read the owner, and only then quarantine-remove; never steal a lock that has a live owner.
   - Apply the same rule to every removal and repair path, not only the acquire path: `acquireFSLock` (`:259-273`), its owner check (`:277-293`), `checkFSLock` (`:365-398`), `cleanExpiredFSLocks` (`:517-542`), and `removeFSLockDir` (`:422-429`). A pid-less owner is reclaimed after the grace instead of returning busy forever (`:288`, `:377-380`).
   - Re-check the owner token before removal; quarantine-rename before delete.
   - Stop the heartbeat on every release path, including owner mismatch and thrown errors.
2. `src/services/usage-ledger.ts`
   - One critical section around `stat`, rotation, and append, with a lock named from `this.path`.
   - Rotate to a non-clobbering name; log rename failures.
   - `installUsageLedger` stays synchronous (`:856-862`) and keeps `void previous.dispose()`. Rotation happens in the async write path.
3. `src/hooks/n2-auto.ts`
   - Make `persist` async (`:50`); lock, then read-truncate-write, then temp + rename.
   - Await `persist()` at `:117` and `:155`. The hook is already async (`:88`).
4. `src/services/keyring.ts`
   - Lock both read and write; read-modify-write in one section; temp + `chmod 0600` + rename.
   - Split the unlocked read from the public read, so the write path does not re-acquire the lock it already holds.
   - Use an own-property check and require a string value.

## 9. Proofs — existing files only

No new proof files. The frozen proof pipeline (section 12) stays frozen; the assertions below are folded into the proofs that already run.

| Proof | Change |
|---|---|
| `prove-first-boot-seed.ts:30` | expects 16 keys and the 8 base `.md` files; assert the config was built with `projectRoot` |
| `prove-s028.ts:8,94-98` | drop the import; delete the five `DELETED_AGENTS` asserts at `:94-97`; keep the refusal at `:98` by seeding a models file where `ling` is `absent` (today the probe points at a directory, which yields `unknown`) |
| `prove-s029.ts:9-15` | drop the `DELETED_AGENTS` import at `:15` and the `unionDeletedVariants` import at `:13`; `:11-12` may become unused |
| `prove-s029.ts:72-78` | seed `setDynamicDeletedAgents` with a generated variant, otherwise both guards allow everything |
| `prove-s029.ts:92-110` | line 92 flips (the variant is no longer filtered), 93 is redundant, and the `retired` block at `:95-110` goes away with A2.8; re-base `:106-110` on the config-absent set |
| `prove-s036.ts:4,55-56` | drop the import; delete the census at `:55`; `:56` flips once `buildAgents()` no longer filters the static list |
| `prove-gen-merge-guards.ts:18-42` | `proveRetiredMigration` needs a provider fixture where the retired ids are `absent`; with no list they are `unknown` and no migration happens |
| `prove-gen-merge-guards.ts:51,59-61` | no deletion-file copy; the drift case is an `absent` model. `:65-66` hold unchanged because the pinned pass still succeeds |
| `prove-e02.ts:155` | no action; the call is count-independent and no `full-roster` flag exists |

## 10. Order of work

Commit A is atomic: a first run that writes 16 while the generator still emits 58 resurrects; removing the sidecar without additive generation resurrects.

1. A0 gate files (already applied)
2. A1 provider availability
3. A2 generator: first-run, merge, removal, gates, CLI
4. A3 contract and lock names
5. A4 agent management branches
6. A5 security policy and the S-030 anchor
7. A6 agent manager
8. A7 add helpers
9. A8 permission guard
10. proofs (section 9)
11. Commit A
12. Commit B (B1–B4), separate

## 11. Verification

1. `npm run verify` (fast gate plus build).
2. Targeted proofs: `bun scripts/prove-first-boot-seed.ts`, `prove-s028`, `prove-s029`, `prove-s036`, `prove-gen-merge-guards`, `prove-rule-gate`.
3. Temp project with isolated `XDG_*` and `OPENCODE_DB`: first boot -> 16 keys and 8 `.md`; second boot -> byte-identical; delete `dev-pickle` -> absent after regen; `addagent` it -> present after the next boot.
4. Compare the seeded `.md` content with `generateAgentMd` output, and confirm `readFrontmatter` accepts it.
5. A corrupt `opencode.json` -> no write, non-zero exit, file unchanged.
6. The installed projects: read each state directory's `identity.json`, take its `directory` field, then record the `opencode.json` agent-key count and `.opencode/deleted-agents.json` presence before and after one boot. A state directory never holds the config; `identity.json` is the only mapping.
7. `npm run check:rules` and `bun scripts/prove-rule-gate.ts`.
8. `npm run check:parity`. Re-point S-030 by hand in the same commit (A5.5); then run `bun scripts/check-shared-parity.ts --write` only for line drift. A vanished marker cannot be repaired by `--write`.

## 12. Frozen backlog

These are real findings from the old audit. None of them executes in this plan.

| Area | Examples |
|---|---|
| Project identity | canonical scan, `identity.json` rewrite, case sensitivity |
| Watchdog | multi-instance registry, liveness rules |
| HMAC | self-heal race |
| Migration | backup collision, journal |
| Build and release | `ship` script, release artifact verification |
| Proof pipeline | seven-step registration, shard balancing |
| JSONC locator | full rewrite and byte-range contract |
| Boot coordinator | merging or ordering the three writers |
| Keyring source of truth | keychain versus file precedence |
| Global lane | `roster.deleted` cleanup |
| `resolveGenPaths` | `.jsonc`-only projects never regenerate |
| Alias path | a catalog alias is rejected before the provider is consulted |

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| New variants do not appear automatically | users miss new models | explicit `addagent`; a future sync command |
| Provider list unavailable | a dead model is accepted, and a retired model is not migrated | `unknown` never rejects; the section 5 warning is logged |
| Legacy sidecar ignored | a name deleted only in the sidecar stays present | report the sidecar/config intersection during verification |
| Lock anchor changes | a nested acquire deadlocks | normalised once in `opencodeConfigLockName`; six acquire sites share it |
| First-run misdetected on `agent: {}` | a deliberate reset returns 16 | documented; bases are protected, so no normal flow empties the object |
| Gate extension abused for prose | comments creep back into scanned code | the pattern accepts only `@truth provider:` plus a sentence; `prove-rule-gate` rejects the rest |
| S-030 marker removed | `check:parity` fails and `--write` cannot repair it | A5.5 re-points the anchor by hand in the same commit |

## 14. Scoped review — decisions closed in revision 5

The third round evaluated only these ten points. All are closed; the table records the decision so the points are not re-opened.

| # | Decision |
|---|---|
| 1 | A missing `agent` key stays a first run, and so does `{}`. A comment-bearing document without the marker is refused before any write; the contract path writes `agent: {}` into pure JSON, so a true first boot always succeeds. |
| 2 | The gate is two-branch: a first run must equal `firstRunAgentSet()` (16 keys); otherwise every key is a base, `addagent`, or a key in `existing`. The live 34-key config and a fresh 16-key config both pass. |
| 3 | `checkGeneratedConfig:706` compares against additive `buildMergedAgents`; `prove-gen-merge-guards:65-66` need no change. |
| 4 | The S-030 marker is ledger data. A hand edit is allowed; `SHARED.md` prose is untouched and `--write` only re-resolves line drift. |
| 5 | `buildGlobalRoster` is called only by the global lane and `checkGlobalRoster`; `gen:135` stays static and never feeds a project decision. |
| 6 | B1 names all five removal and repair paths and reclaims a pid-less owner after the grace; a live owner is never stolen. |
| 7 | The keyring takes no lock today. B4 adds one acquisition per path; the write section uses the unlocked read, so nothing re-acquires a held lock. |
| 8 | The `:98` refusal survives only with the section 9 models fixture (`absent`); A7.2 cites it. The current directory fixture would classify as `unknown` and allow. |
| 9 | Commit A does not change the global count: the global lane passes `roster.deleted` explicitly. No proof asserts 51 or 58; the stale rows in sections 12 and 13 are removed. The proofs re-based in section 9 are re-based for the static-list removal and the 16-key first run, not for a global count. |
| 10 | Verification step 6 reads each state directory's `identity.json`, resolves its `directory` field, then counts keys in `<directory>/opencode.json` and checks `<directory>/.opencode/deleted-agents.json` before and after one boot. The state directories are never read as if they held the config. |
