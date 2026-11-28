# Tawassul V2 — Code-First Minimal Plan

Date: 2026-11-11 (first written 2026-11-09)
HEAD: `db589b1` (Commit 0; the plan was written against `acc3c4e`)
Status: executable after five independent full-plan reviews and five final
reviews; corrections 1-108 are applied. Commit 0 landed as `db589b1`; Commit A and Commit B await
approval. Supersedes `docs/tawassul-v2-minimal-fix-plan.md` (frozen).
Scope: the three changes only. No restructuring, no fourth change.

Every v2 anchor below was opened in this session. The v1 anchors in 1.1 and
1.1a are reference-only: the v1 tree is outside this workspace and was not
re-opened during this review. Review findings were re-verified against the code
before being applied; agent reports alone were not used as evidence. Rules that
bind this plan: English is canonical, no comments in scanned code, minimum fix,
no feature-for-feature trade.

Two corrections are non-negotiable and override any earlier wording:

1. `DELETED_AGENTS` (`src/security-policy.ts:114-156`, 39 names) is the user's
   own historical list, not a product default. It must not be shipped or
   imposed on any end user. Change 2 deletes it from the source, removes every
   consumer, and ships no replacement list.
2. 58 is the generator's full arithmetic capacity, not a shipped list and not a
   first-run count. The project first run is 16. The global boot seed is 8.
   `gen --scope global` computes 58 only when the native `agent/*.md` files
   exist and `roster.deleted` is empty; without those files
   `assertBaseRegistrySync` throws and the command fails.

## 0. The three changes

| # | Change | Primary files |
|---|---|---|
| 1 | A project first run creates 16 agents, not 51 or 58 | `src/scripts/gen-opencode-config.ts`, `src/utils/opencode-config.ts`, `src/bootstrap/plugin-init.ts` |
| 2 | A deleted agent stays deleted without a shipped deletion list; an explicit re-add works | `src/scripts/gen-opencode-config.ts`, `src/tools/agent-management.ts`, `src/tools/agent-kick-runtime.ts`, `src/context/managers/AgentManager.ts`, `src/security-policy.ts`, `src/core/variant-names.ts`, `src/tools/agent-add-helpers.ts`, `src/core/model-registry.ts`, `src/bootstrap/hooks-registration.ts`, `src/hooks/guards/permission-guard.ts` |
| 3 | Two processes do not corrupt the shared files | `src/utils/opencode-config.ts`, `src/infra/file-lock.ts`, `src/context/session-manager.ts`, `src/services/usage-ledger.ts`, `src/hooks/n2-auto.ts`, `src/services/keyring.ts` |

Changes 1 and 2 are one atomic commit: writing 16 while the generator still
emits 51 resurrects the set on the next boot, and removing the deletion
authority without the additive rule resurrects deleted variants.

### 0.1 Requirements carried from the frozen plans

The frozen plans are read as requirements, not as authority. Each requirement is
restated here and mapped to the edit that honors it.

| Requirement | Frozen anchor | Honored by |
|---|---|---|
| First run and deletion are **project scope**; no global install is designed or delivered here | `docs/tawassul-v2-minimal-fix-plan.md:76`, `:93` | changes 1 and 2 edit the project lane only; they leave the global roster content, boot seed (8), and lock-path model unchanged. Change 3's lock canonicalization and global seed lock are safety-only and do not make the global install a delivery target. Removing `DELETED_AGENTS` also removes the 39 static names from the global `validateTaskRouting`/`checkDeletedAgent` predicate (`security-policy.ts:436`, `:454`); this is behaviorally inert because those names cannot exist as agents anywhere, and `roster.deleted` plus the dynamic set remain the global record. The one global-install filesystem side effect from changes 1 and 2 is F6's missing-only base-file seed in the project directory F6 already targets (1.5, 5) |
| The agreed first run is **16** by name: 8 bases + `addagent` + 7 `-pickle` | minimal plan `:16`, `:77`, `:154` | `firstRunAgentSet` in 2.2, asserted by `prove-first-boot-seed` |
| No developer deletion list is shipped into a project | minimal plan `:78`, R1/R2 `:90-91` | the sidecar is no longer read or written in project scope; absence from `config.agent` is the record |
| The deletion record stops **generation**, not an explicit re-add | minimal plan `:79` | the additive filter removes absent variants; `validateAddInput` allows a re-add when the provider serves it or is unknown |
| A deleted agent must not return on the next update | minimal plan `:80` | additive filter in `buildMergedAgents`; `AgentManager.deletedRoster` derives absence |
| The provider list is the source of truth for model availability | minimal plan `:81`, R3 `:92` | `modelAvailability` with an exact-slug map; the static list stops overriding models in `buildMergedAgents` (including the gated `addagentStale`), the boot `sweepRetiredModelPins`, the boot-repair rewrite (`opencode-config.ts:227`), the dead-model sweep, and `hooks-registration` |
| No new `TAWASSUL_*` environment variable | minimal plan `:82`, R6 `:95` | no new variable; the plan uses the existing host-provided models file |
| English is canonical; no comments in scanned code except `@truth provider` | minimal plan `:83-84`; `AGENTS.md` rule 2 | `npm run check:rules`; the four pre-existing gate files either land in Commit 0 or their `model-registry.ts` hunk is excluded from Commit A by hunk-level staging (section 7) |

The frozen plans' errors are **not** carried: the 51 and 58 counts are not first
installs, base roles are protected and cannot be kicked (section 3.2), and the
global roster path is `tawassul.jsonc`, never `opencode.json[c]` (section 1).

## 1. Scope boundary and the first version reviewed

This plan's first-run and deletion changes execute in **project scope only**, in
the developer's workspace. The global install is not a delivery target: changes
1 and 2 leave its roster content, boot seed content (8), and lock-path model
untouched. Change 3 later canonicalizes lock names and locks the global seed;
that is a cross-process safety fix, not a global delivery. Removing
`DELETED_AGENTS` does remove the 39 static names from the global routing
predicate (`validateTaskRouting` and `checkDeletedAgent`,
`security-policy.ts:436`, `:454`); that predicate is behaviorally inert because
the names cannot exist as agents anywhere, and `roster.deleted` plus the dynamic
set remain the global record. The only global-install filesystem behaviour
change from changes 1 and 2 is F6's missing-only base-file seed in the project
directory F6 already rewrites (1.5, 5). The global roster is `tawassul.jsonc`
(legacy `tawassul.json`), never `opencode.json[c]`. The global boot seed is 8;
`gen --scope global` computes 58 only with the native `agent/*.md` files and an
empty `roster.deleted`. Neither is a first install, and changes 1 and 2 do not
change either.

### 1.1 The v1 reference model

The v1 tree is `/home/htoz/Desktop/tawassyl/` (read-only). Its plugin installer
does not exist as a plugin installer: `scripts/install-tawassul.sh:1-20` installs
database safety only. The agent/roster layout is defined by the generator. The
v1 anchors below are relative to `.opencode/plugins/tawassul/`; the installer
anchor is relative to the repository root:

| Fact | v1 anchor |
|---|---|
| Global roster is `tawassul.jsonc` (legacy `tawassul.json`) | `utils/path-resolver.ts:26-27`, `:212-217` |
| Global agents live in `~/.config/opencode/agent` | `utils/path-resolver.ts:111-119`, `:274-281` |
| Global lane writes roster + native agents, never `opencode.json` | `scripts/gen-opencode-config.ts:158-162`, `:164-173` |
| Refuses a non-tawassul global space | `scripts/gen-opencode-config.ts:182-190` |

### 1.1a What the first version did with first run and deletion

The first version of this addition is the v1 generator under
`.opencode/plugins/tawassul/`. It did **not** have a 16-key first run:

| Fact | v1 anchor |
|---|---|
| `buildAgents` defaults to `readDeletedAgents(...)`, so the sidecar drives the emission set | `scripts/gen-opencode-config.ts:796-800` |
| The sidecar holds 35 names; 28 are generated variants (4 suffixes × 7 roles: `deep`, `minimax`, `ox`, `ling`), and the seven `*-muse` names are not in `MODEL_SUFFIX_MAP` | `.opencode/deleted-agents.json` (35 entries); `core/variant-names.ts:23-29`; `core/model-registry.ts:34-86` |
| Therefore v1 had no 16-key first run: with the sidecar present it emits 30 (58 − 28); with no sidecar it emits 58 | `scripts/gen-opencode-config.ts:796-800`; `:870` |
| `buildExpectedConfig` reads the project config unconditionally; it does not synthesize a config | `scripts/gen-opencode-config.ts:1030-1041` |
| `refuseProjectTarget` requires the `tawa.md` marker | `scripts/gen-opencode-config.ts:140-155` |
| The global roster is `tawassul.jsonc`, never `opencode.json` | `utils/path-resolver.ts:26-27`, `:212-217` |

The v2 **fresh project** count is different again: the sidecar is absent, and
`buildAgents`'s default `unionDeletedVariants(readDeletedAgents(...))` unions the
seven static `*-ling` names, so it emits 51 (58 − 7). This **checkout** has the
35-name sidecar and emits 30 (58 − 28); `.opencode/` is gitignored, so the
sidecar is local state, not a shipped file. Neither is the agreed first run.

Change 1 keeps v1's "the project config must already exist" rule but replaces
every one of those counts with 16. Change 2 removes the shipped sidecar's
authority and replaces it with presence/absence in the project config. The v2
CLI cannot keep v1's `tawa.md` guard because v2 seeds `tawa.md` itself as one of
the eight base files, so requiring it first is circular.

### 1.2 The v2 lane map

The v2 global lane is the same model, and the host config is outside it.

| Entity | Path | Source |
|---|---|---|
| Global roster | `globalConfigDir()/tawassul.jsonc`, legacy `tawassul.json` | `src/utils/path-resolver.ts:10-14`, `:111-124` |
| Global native agents | `globalConfigDir()/agent/*.md` | `src/utils/path-resolver.ts:14`, `:74-76`, `:149-152` |
| Global pins | beside the roster | `src/scripts/gen-opencode-config.ts:84-92` |
| Host config | `~/.config/opencode/opencode.json[c]` | never written by the installer (`scripts/install-global.ts:1034`) |

The installer writes the plugin bundle, the runtime directory (the `wasm/` and
`db/` assets), and the marker file (`scripts/install-global.ts:129-136`). It
states that no `opencode.json` edit is
needed (`:1034`); its purge archives the roster beside its old path
(`:1107-1109`, `:1340`) and keeps the native agent directory (`:1146-1150`,
`:1341`). `docs/installation.md:116-117,129` repeats the no-edit rule, and
`docs/configuration.md:8-9` names the global roster path.

### 1.3 Global writers and their locks

`tawassul.jsonc` is the one file shared by every workspace of the user.

| Writer | Anchor | Lock |
|---|---|---|
| `addagent` roster write | `src/tools/agent-management.ts:613-703` | `withConfigWriteLock`, `failClosed: true` at `:702` |
| `kick` roster write | `src/tools/agent-management.ts:1064-1224` → `src/tools/agent-kick-runtime.ts:54-88` | `withConfigWriteLock`, `failClosed: true` at `:1223` |
| global deletion write | `src/tools/agent-management.ts:175-200` | `persistDeletedAgents` inside the kick lock (`:1076`) and `unpersistDeletedAgents` inside the add lock (`:861-863`); the pin write at `:877-879` is `writeBaseRolePins`, not a deletion write |
| CLI `--scope global` | `src/scripts/gen-opencode-config.ts:815-838` | `withCliConfigLock` at `:784-803` |
| boot seed | `src/utils/opencode-config.ts:507-527` | **none today**; change 3 adds one |
| purge/keep | `scripts/install-global.ts:1146-1150` | installer owns the machine |

The global reader is `src/context/managers/AgentManager.ts:104-116` (roster
agents) and `:330-338` (roster deleted). `buildGlobalRoster`
(`src/scripts/gen-opencode-config.ts:121-169`) starts from `buildAgents(deleted)`
and merges existing roster keys; therefore a generated variant that is absent
from `roster.agents` **and** absent from `roster.deleted` is re-emitted by
`gen --scope global`. The persisted deletion set for the global lane is
`roster.deleted`, not the project sidecar.

Global writers of `agent/*.md` are not under `withConfigWriteLock`:
`addSingleAgent` writes each file through `AgentManager.writeAgentMd`
(`src/tools/agent-management.ts:376-390`, `src/context/managers/AgentManager.ts:452-515`).
Each file is replaced atomically and the content is deterministic for one
model. This is per-file last-writer-wins, not torn data; section 4.7 records it
as an explicit boundary rather than adding a second lock layer.

### 1.4 What the global lane does not do

- It does not write the host `opencode.json[c]` (`scripts/install-global.ts:1034`;
  `docs/installation.md:129`).
- It does not create a workspace config. `ensureMinimalProjectContract` returns
  `non-project-scope` (`src/utils/opencode-config.ts:464`).
- It does not seed native `.md` files. The installer only counts and keeps them
  (`scripts/install-global.ts:1146-1150`), while `gen --scope global` reads
  frontmatter from that directory (`src/scripts/gen-opencode-config.ts:297-309`).
  This is a stated precondition, not part of the three changes. Without those
  files, `gen --scope global` fails before generation: a missing `agent/`
  directory throws in `collectBaseRegistry`'s `readdirSync`
  (`src/scripts/gen-opencode-config.ts:403`), and a missing base file throws in
  `assertBaseRegistrySync` (`:415-429`, called at `:510`). It does not produce 58.
- The boot seed creates only the 8 base entries (`src/utils/opencode-config.ts:517-520`,
  written at `:524`). With the native `.md` present and `roster.deleted` empty,
  `gen --scope global` later computes 58 (`src/scripts/gen-opencode-config.ts:127`,
  `:565`); with deletions it subtracts them. The 58 is a computed full set, not a
  shipped roster and not a first install.

### 1.5 F6 and the second ungated writer

Two project-config writers are not gated by install scope:

| Writer | Anchor | Creates a config? |
|---|---|---|
| boot repair | `src/bootstrap/plugin-init.ts:663-669`; `src/utils/opencode-config.ts:400-452` | no (`:410-412`) |
| F6 passive regen | `src/bootstrap/plugin-init.ts:720-773` | no (`src/scripts/gen-opencode-config.ts:688-692`) |

`ensureMinimalProjectContract` is gated (`src/utils/opencode-config.ts:464`);
`ensureGlobalRosterSeed` is global-only (`src/bootstrap/plugin-init.ts:671-674`).
Decision A is the default: keep both writers as they are, document that a
global install normalizes an existing project config but never creates one.
Under change 1, F6 also calls `ensureBaseAgentFiles` before its check, so a
global install can create `.opencode/agents/*.md` in the project directory F6
resolves when that directory already has an `opencode.json`. That is a side
effect of Decision A, not an accident, and it is stated in section 5. F6 keeps
`resolveGenPaths()` with no argument and therefore follows `inferProjectRoot()`
(`src/scripts/gen-opencode-config.ts:45-51`): `TAWASSUL_PROJECT_DIR`, then the
plugin-directory `opencode.json` heuristic, then `process.cwd()`. It is not
`ctx.directory`; boot repair is (`src/bootstrap/plugin-init.ts:663`). The seed
target is exactly the directory F6 already regenerates, and no proof may assume
it equals the host workspace. Decision B gates both writers with
`coexistenceScope === "project"` (computed at `src/bootstrap/plugin-init.ts:541`;
`SCOPE` is a different value, defined at `src/tools/agent-management.ts:126`)
and removes that side effect; it changes existing behaviour and needs an
explicit user order under rule 5.

## 2. Change 1 — the agreed first install writes 16

### 2.1 The current chain (the 51 defect)

1. `ensureMinimalProjectContract` writes `agent: {}`
   (`src/utils/opencode-config.ts:460-500`, the literal at `:487`).
2. F6 sees the drift and writes `buildExpectedConfig`
   (`src/bootstrap/plugin-init.ts:720-773`).
3. `buildMergedAgents` starts from `buildAgents`; with no explicit list the
   current default is `unionDeletedVariants(readDeletedAgents(...))`, which is
   the seven `*-ling` names, so the current project first run writes
   **51** = 58 − 7 (`src/scripts/gen-opencode-config.ts:505-563`, `:567-668`).
4. The CLI gates `buildAgents` against `derivedExpectedCount(deleted)`
   (`count !== expected` at `:852-853`), then writes `buildExpectedConfig`
   (`src/scripts/gen-opencode-config.ts:849-883`). Today the expected count is 51.

The agreed first install is **16**. The 51 above is the current defect that
change 1 replaces; it is not the plan's first install. The global lane's 58 is
not a shipped roster, not a first install, and not changed by this plan. The
only first-install number in this plan is 16.

`buildAgents` calls `assertBaseRegistrySync` before reading any frontmatter
(`src/scripts/gen-opencode-config.ts:510`); a missing base `.md` throws there
(`:417-421`), and a missing `agents/` directory throws in
`collectBaseRegistry`'s `readdirSync` (`:403`). `readFrontmatter` (`:297-309`)
throws only for malformed or incomplete frontmatter. A fresh project therefore
cannot build until the 8 files exist.

The base `.md` files are also the runtime metadata source, and `tawa` depends on
them the most. `readOpencodeJsonAgents` deliberately excludes `tawa` and
`addagent` from the config-derived set (`AgentManager.ts:122`, `:188`), and
`getAgents()` keeps a tag only when it is a config key, dynamic, in
`config.team`, or its `.md` exists (`:164-170`). Without `tawa.md`, `tawa`
disappears from handoff candidates, `moa`, `image_route`, diagnostics, and the
routing description fallback (`hooks-registration.ts:410-413`). The plan seeds
all eight base files before generation, so a project first run cannot hit this.
Generated variants have no `.md` today and stay available through their
`opencode.json` key; their capability falls back to `config.agentModels`
(`tools/handoff.ts:572`). `addagent` is a tool, not a routed agent tag: both
config-derived readers filter it out (`AgentManager.ts:122`, `:188`), and it has
no `.md`. Global `agent/*.md` are written by
`ensureDefaultAgentMds` on the first enabled boot (`AgentManager.ts:417-450`);
the installer only keeps them (`scripts/install-global.ts:1146-1152`).

The global lane is different: `buildGlobalRoster` passes `roster.deleted`
directly and never applies the static list. With the native
`~/.config/opencode/agent/*.md` files present and `roster.deleted` empty,
`gen --scope global` computes 58 (`src/scripts/gen-opencode-config.ts:121-127`);
without those files, `assertBaseRegistrySync` throws and the command fails. The
global boot seed itself creates 8 agents and no `.md`; the eight base files are
written by `ensureDefaultAgentMds` later in the same boot
(`AgentManager.ts:417-450`).

### 2.2 Exact edits

**`src/scripts/gen-opencode-config.ts`**

1. Add `firstRunAgentSet(opts?)`: call `buildAgents([], opts)`, then keep only
   `BASE_ORDER`, `addagent`, and generated variants whose name ends with
   `-pickle`. Result: 8 + 1 + 7 = 16. Pass `opts` so tests can point at a
   temporary agents directory.
2. `buildMergedAgents` control flow, in this order:
   - `maybeRaw === undefined` and `existsSync(configPath) === false` → base is
     `firstRunAgentSet(opts)`;
   - parse failure → throw
     `new Error("opencode.json is present but cannot be parsed; regeneration refused")`
     instead of the silent `existing = null` at `:577-583`;
   - `agent` missing, `null`, or an object with no keys → base is
     `firstRunAgentSet(opts)`;
   - `agent` present but not a non-array object (for example an array or a
     string) → throw `new Error("opencode.json agent must be an object")`;
   - otherwise base is `buildAgents(opts?.deleted, opts)`, the existing-agent
     merge runs, then the additive filter.
   The first-run branches return `firstRunAgentSet(opts)` directly. That is safe
   because `buildAgents` already applies `grantRolePluginTools` (`:528`), the
   full `addagent` permission block (`:545-555`), `grantTawaPluginTools`
   (`:558`), and `applyPermissionRepairs` (`:559`); the `buildMergedAgents` tail
   (`:659-667`) only repeats those idempotent grants. Checked in this session:
   for the 16 first-run names, `buildAgents([])` and `buildMergedAgents` on an
   empty `agent` container emit identical entries.
3. Additive filter as a new block after the existing-agent merge loop, which
   ends at `:658`: for every generated variant in the emitted object, delete it
   when its name is not a key of `existing`. Bases, `addagent`, and
   non-generated keys are never removed. This is what keeps an existing 30- or
   51-agent project unchanged on upgrade.
4. `buildAgents` (`:508`): default `deleted ?? []`.
5. CLI project path (`:840-888`), project lane only:
   - change `refuseProjectTarget` (`:66-82`) from the generated `tawa.md`
     marker to a real project config: refuse when `paths.configPath` is inside
     the global config dir, and refuse when neither `opencode.json` nor
     `opencode.jsonc` exists. `tawa.md` is the first-run output, so requiring
     it makes the guard circular;
   - if `paths.configPath` is absent but `opencode.jsonc` exists beside it,
     refuse with `refusing to create opencode.json beside an existing
     opencode.jsonc`; the CLI writes `opencode.json`, which would shadow the
     active JSONC. This guard is project-only: the global branch (`:807-838`)
     writes `tawassul.jsonc` (legacy `tawassul.json`) and never touches
     `opencode.json[c]`;
   - if neither config exists, refuse: the plugin boot
     (`ensureMinimalProjectContract`) creates the first config. The CLI does
     not synthesize a config; v1's CLI also required an existing config;
   - call `ensureBaseAgentFiles(paths.agentsDir)` after the config check, so a
     real project with an `opencode.json` but no `.opencode/agents` can
     bootstrap. This is the developer's test path. Add `ensureBaseAgentFiles`
     to the existing `../utils/opencode-config.ts` import at `:17-23`;
   - remove the pre-lock deleted-list reads and the derived-count gate at
     `:849-861` (`count !== derivedExpectedCount(deleted)` at `:852-853`),
     and replace the in-lock `deletedIn` / `agentsIn` / `countIn` block at
     `:864-882`; the post-write log drops the `deletedIn.length` clause;
   - inside the lock, read `paths.configPath` (it exists); compute
     `buildMergedAgents(rawDoc, opts)` and gate that same object: when the
     document is first-run (`agent` missing/empty), it must have exactly 16
     keys; otherwise every emitted generated variant must be a key of the
     existing `agent`. Also assert the reverse direction: every generated
     variant key already present in `agent` is either emitted or named in
     `opts.deleted`; without this, the `gen:642` skip path can drop an existing
     variant silently;
   - write `spliceAgentSection(rawDoc, gated)` with `atomicWriteFile` (`:874`).

   Only one count stays closed: a first-run document must hold exactly the 16
   keys of `firstRunAgentSet`. Any project that already has an `agent` container
   is gated by set relations instead of a number, so its count is open by
   design and follows the project: a 30-key project stays 30, a 51-key project
   stays 51, and an upgrade neither adds an absent variant nor removes a
   present one. The global lane keeps `derivedExpectedCount(roster.deleted)`
   (`gen:817`), where 58 is the capacity constant
   (`EXPECTED_AGENT_COUNT`, `:565`) minus deleted variants (`:291-293`),
   never a project first-run count.
6. `checkGeneratedConfig` (`:683-765`): before either `buildMergedAgents` call,
   check the eight base `.md` files (`BASE_ORDER` under
   `opts?.agentsDir ?? paths.agentsDir`); if any is missing, return
   `{ ok: false, diff: "missing base agent files: ..." }`. Place this check
   after the `existsSync(paths.configPath)` early return at `:688-692`, so a
   config-less checkout keeps `{ ok: true, missing: true }` and `gate:fast`'s
   `config` step does not fail where `.opencode/` is absent (`.gitignore:1`).
   `--check` (`runCheck:890-917`) does not seed, so a config present without
   `.opencode/agents` would otherwise throw in `assertBaseRegistrySync`
   (`:415-429`, called at `:510`). Then delete the
   deleted-list read
   (`:744-751`), the `deletedSet` (`:752`), the `resurrected` computation
   (`:753-755`), its condition in the success check (`:756`), and its message
   block (`:760-763`). Split the container branch (`:700-704`): a missing or null
   `agent` returns the first-run expectation (`missing agents: ...`); an `agent`
   that is present but not a non-array object returns
   `{ ok: false, diff: "agent must be an object" }` without calling
   `buildMergedAgents`, so the new throw cannot escape the check. `runCheck`
   calls this function at `:903` without a try/catch.
7. Delete `readDeletedAgents` (`:255-275`) and `unionDeletedVariants`
   (`:287-289`) once every caller is removed. Keep `deletedPath` in `GenPaths`
   (`:41`, `:58`): it is still the anchor from which `loadPinnedAgents` derives
   `tawassul-pins.json` (`:104-105`, `:584`, `:708`) and it is the S-053.10
   parity anchor (`scripts/shared-parity.json:1362-1377`).
8. Update the `validateDeletedList` warning text (`:280-283`) from
   `deleted-agents.json` to `deletion list`, because the project sidecar is no
   longer an input.

**`src/utils/opencode-config.ts`**

1. Export `ensureBaseAgentFiles(agentsDir)`: `mkdir(agentsDir, { recursive: true })`,
   then for each `ALL_AGENTS` entry write `<agentsDir>/<name>.md` with
   `generateAgentMd(entry)` only when the file is missing. Only `ALL_AGENTS` is
   imported today (`src/utils/opencode-config.ts:16`); add `generateAgentMd` to
   that import (both are exported by `src/agent-templates.ts`:
   `ALL_AGENTS` at `:3`, `generateAgentMd` at `:4`). Use the
   existing `atomicWriteFile` import (`:7`) with `{ backup: false }`: the write
   is missing-only, so there is no prior file to back up, and `seed:agents`
   writes missing files directly. The eight local
   `.opencode/agents/<name>.md` files are themselves `npm run seed:agents`
   output (`package.json:31`, `scripts/seed-agents.ts:20-49`) and `.opencode/`
   is gitignored (`.gitignore:1`); the repository ships none of them.
   `generateAgentMd` reproduces those local files byte-for-byte, so a seeded
   project gets the same files this checkout has, not a shipped set.
2. `ensureMinimalProjectContract` (`:460-500`): after the in-lock recheck
   (`:480-483`), call
   `ensureBaseAgentFiles(resolve(projectDir, ".opencode", "agents"))`, build the
   document with `agent: {}`, call `buildExpectedConfig(docText, { projectRoot:
   projectDir, configPath })` through a dynamic import, and write the result
   atomically. Use the `configPath` declared at `:489`. On a build failure,
   write the minimal `agent: {}` document and log a warning; `--check` then
   reports the missing 16, so the failure is visible instead of silent.
   Recovery is manual: `ensureMinimalProjectContract` returns `exists` on later
   boots and F6's `buildExpectedConfig` keeps failing on the same input, so the
   operator must fix or remove the offending `.md`/config and re-run the seed
   and boot; `--check` is the signal.

**`src/bootstrap/plugin-init.ts`**

1. Import `ensureBaseAgentFiles` beside `ensureMinimalProjectContract`
   (`:46-50`).
2. F6 (`:720-773`): resolve `resolveGenPaths()` first; it follows
   `inferProjectRoot()` (`src/scripts/gen-opencode-config.ts:45-51`), not
   `ctx.directory`. If `paths.configPath` does not exist, return:
   `checkGeneratedConfig` already reports `missing: true` (`:688-692`), and F6
   must not create `.md` files in a project it cannot repair. This early return
   is only for seeding; the check itself keeps its existing missing-config
   behavior. Otherwise call `await ensureBaseAgentFiles(paths.agentsDir)`, then
   `checkGeneratedConfig()` at `:724`. Without this, a project that already has
   `opencode.json` but no `.opencode/agents` depends on the install scope: in
   project scope `ensureDefaultAgentMds` normally writes the eight at
   `tawaCtx.init()` (`lifecycle-controller.ts:53`), so the F6 seed is the
   fallback for a failed or partial init write; in global scope
   `ensureDefaultAgentMds` writes the global `agent/` directory, not the
   project, so F6 is the only project seeder. In both cases
   `buildMergedAgents` throws in `assertBaseRegistrySync` (`:415-429`, called
   at `:510`) if the files are still missing.

### 2.3 Why 16 is 8 + 1 + 7

`BASE_ORDER` is the 8 templates in `src/core/agent-data.ts:32-386`
(`tawa`, `dev`, `analyst`, `tester`, `reviewer`, `architect`, `designer`,
`doc`). `addagent` is the dispatcher (`src/scripts/gen-opencode-config.ts:540`).
`MODEL_SUFFIX_MAP` has seven suffixes (`src/core/model-registry.ts:79-81`);
`pickle` maps to `opencode/big-pickle`, the same default used by `addagent`
(`src/scripts/gen-opencode-config.ts:295`). This composition is the only product
choice in the plan; the count 16 is fixed.

### 2.4 The `.md` inventory and the gap

**Producers.**

| Producer | Scope | Behaviour |
|---|---|---|
| `npm run seed:agents` (`scripts/seed-agents.ts:20-49`) | project | writes the 8 `ALL_AGENTS` files into `.opencode/agents`; missing-only, `--force` rewrites drifted |
| `ensureBaseAgentFiles` (new, 2.2) | project | same 8 files, missing-only, called by the boot seed, F6, and the CLI before generation |
| `addagent` (`agent-management.ts:376-389`) | project | base roles get a `.md`; generated variants are skipped deliberately (`skipVariantMd`, log at `:389`) |
| `addagent` (same code) | global | `skipVariantMd` is false, so a global variant gets a native `.md` too |
| `addagent` rollback (`rollbackAdd`, `agent-management.ts:403-447`) | both | on a failed add: restores a backed-up `.md`, removes an orphan it wrote, or keeps an unreadable pre-existing file and logs; behavior unchanged |
| `kick` (`agent-kick-runtime.ts:43-52`) | both | removes the agent's `.md` if present |
| `ensureDefaultAgentMds` (`AgentManager.ts:417-450`, called at `src/services/lifecycle-controller.ts:53`) | both | every enabled boot: writes the 8 base files when missing, and rewrites an existing file that lacks the responsibilities markers (`:435-441`) |
| global installer (`install-global.ts:1146-1152`) | global | keeps `agent/*.md`; never creates one |
| global boot seed (`utils/opencode-config.ts:507-527`) | global | writes the 8-agent roster only; no `.md` itself |

**Consumers.**

1. Generation: frontmatter supplies description/mode/permission (`gen:515-522`); a missing base file throws (`gen:415-429`, called at `:510`).
2. Metadata: `readAgentMd` (`AgentManager.ts:370-392`) feeds capability/role into handoffs, `moa`, `image_route`, diagnostics, and the routing description (`hooks-registration.ts:410-413`; `tools/handoff.ts:572`; `services/handoff-service.ts:206`).
3. Availability: `getAgents()` keeps a tag only if it is a config/roster key, dynamic, in `config.team`, or its `.md` exists (`AgentManager.ts:164-170`); `tawa` and `addagent` are excluded from the key set (`:122`, `:188`), so `tawa` depends on `tawa.md`.
4. Global write identity: `globalSpaceGuard` (`agent-management.ts:456-465`) and its CLI twin `refuseGlobalTarget` (`gen:94-102`) accept a global space with `agent/tawa.md` or an existing roster. `refuseProjectTarget`'s `tawa.md` marker check (`gen:66-82`) is replaced by the config-existence check in 2.2.

**Scope rule.** The eight base `.md` files are not project-specific agent
definitions: they are the same `AGENTS_MD_DEFAULT` templates materialized into
the active scope's agent directory (`<project>/.opencode/agents` in project
scope, `~/.config/opencode/agent` in global scope). A project therefore gets
its own copies of the same eight bases, not a different set. The
project-specific surface is `opencode.json`: the seven `-pickle` variants and
`addagent` are config-only in project scope (`agent-management.ts:376-389`), so
a first-run project is eight `.md` files plus eight config-only entries, not
sixteen `.md` files. The first-run 16 therefore carry the same names and
default models in every project; a project diverges only through later add,
kick, or pin edits. The global lane keeps its own eight base `.md` files (plus
any variant `.md` that a global `addagent` writes) and its roster. Decision A
adds only the F6 seed for a project that already has `opencode.json`; the
project boot seed (`ensureMinimalProjectContract`) writes its own eight
independently. Decision B skips the F6 write. Neither decision moves the global
definitions into each project. A project whose only config is
`opencode.jsonc` is outside both seeds: `ensureMinimalProjectContract` returns
at its existing-config check, and F6/CLI target `opencode.json` only. In a
project-scope install its base `.md` files arrive through
`ensureDefaultAgentMds` at the first enabled boot (4.7); before that boot it is
the same pre-boot gap as the global lane. In a global install
`ensureDefaultAgentMds` writes the global `agent/` directory, not the project,
so no writer creates project base `.md`; the gap is inert because F6 and the
CLI do not target a `.jsonc`-only project.

**The gap.** A project first run is covered: the plan seeds all eight base files before generation, so `tawa.md` exists and generation cannot throw. Generated variants stay config-only in project scope by design (`agent-management.ts:376`, `:389`); they are available through their `opencode.json` key and their capability falls back to `config.agentModels`. The only uncovered state is the window **before the first successful plugin boot**: `ensureGlobalRosterSeed` writes the roster but no `.md`, and `ensureDefaultAgentMds` (`AgentManager.ts:417-450`, called from `src/services/lifecycle-controller.ts:53`) writes the eight base files during `tawaCtx.init()`. A `gen --scope global` run before any boot therefore fails closed at `assertBaseRegistrySync`; after one boot the native files exist and `gen --scope global` can compute 58; the guard passes with `agent/tawa.md` or the seeded roster, but the generator still needs all eight native `.md` files for `assertBaseRegistrySync`. The same holds for a boot where the write fails (read-only config dir or disabled plugin): pre-existing, non-corrupting, and recorded as a boundary. The `ensureBaseAgentFiles` addition to `ensureMinimalProjectContract` is therefore for the project contract write that runs before and parallel to `tawaCtx.init()` (`plugin-init.ts:676` vs `:704`), not to fill a permanent global hole. Adding it to the global seed would duplicate `ensureDefaultAgentMds`; it is not in the plan.

## 3. Change 2 — deletion persists without a shipped list

### 3.1 What exists today

Three deletion authorities exist, not one:

| Authority | Anchor | Effect |
|---|---|---|
| static `DELETED_AGENTS` — the user's own historical list (39 names, not a product default) | `src/security-policy.ts:114-156` | blocks routing and re-add; `unionDeletedVariants` keeps only the 7 generated names (`*-ling`) |
| project sidecar `.opencode/deleted-agents.json` | `src/scripts/gen-opencode-config.ts:255-275`, `src/tools/agent-management.ts:140-173` | the project's persisted list |
| global `roster.deleted` | `src/context/managers/AgentManager.ts:330-338` | the global persisted list |

`DELETED_AGENTS` is not a shipped default, a migration list, or a first-run
list. It is the user's own historical deletion set and is the exact list this
change removes. No replacement list is shipped; the project record is the
absence of a key from `config.agent`, and the global record is the user-written
`roster.deleted`.

The old claim that 28 static names are generated variants is false: only the
seven `*-ling` names pass `isGeneratedVariant` against the current
`MODEL_SUFFIX_MAP`. The other 32 names are name-level rejections only.
`buildGlobalRoster` never applied the static list. With the native
`~/.config/opencode/agent/*.md` files present and an empty `roster.deleted`,
`gen --scope global` computes 58; without those `.md` files,
`assertBaseRegistrySync` throws (`src/scripts/gen-opencode-config.ts:415-429`,
called at `:510`) and the command does not reach 58; a missing `agent/`
directory throws earlier in `readdirSync` (`:403`). The project lane was 51;
the global boot seed is 8.

### 3.2 The new rule

- **Project:** a generated variant exists iff its key is present in
  `config.agent`. Absence is deletion. No sidecar, no shipped list.
- **Global:** `roster.deleted` is the explicit, user-generated list. It is
  written by `kick` and never shipped. `buildGlobalRoster` keeps reading it.
- **Re-add:** no static list rejects a name after change 2; `DELETED_AGENTS` is
  gone. The provider list decides whether the model is real: `served` allows,
  `absent` rejects, `unknown` warns and allows.
- **Base roles are protected; they cannot be deleted.** `isProtected`
  (`src/tools/agent-kick-helpers.ts:61-66`) returns true for every base because
  `AGENTS_DEFAULT` is built from all eight `ALL_AGENTS`
  (`src/context/constants.ts:20`). `classifyRemove` (`:68-74`) therefore returns
  `"protected"`, and the kick loop (`src/tools/agent-management.ts:1045-1061`)
  pushes the name to `result.protected_` and `continue`s. Only
  `result.removed` reaches `removeAgentsFromConfig` (`:1069-1074`), and a base
  name is never in that list. `buildMergedAgents` re-emitting bases
  (`src/scripts/gen-opencode-config.ts:515-526`) is a second line of defence,
  not the protection. The deletion universe is generated variants only
  (`generatedVariantNames`), so absence in `config.agent` can never mark a base
  deleted.
- **Boot window:** an `agent: {}` or missing `agent` object means "no deletions
  yet", not "all 49 variants deleted". The real deletion set begins when the
  first-run set or a user config supplies the present keys. A JSON parse failure
  is different: `kick` fails closed (`src/tools/agent-management.ts:1029-1033`),
  while `AgentManager` returns an empty set from its inner parse catch
  (`src/context/managers/AgentManager.ts:348-352`) without resetting the process
  set; other read errors fall to the outer catch at `:365-367`. Both catch bodies contain a `return`, so
  neither is a silent catch in the `prove-disclosure` census; the file's three
  pinned silent catches are `:127`, `:140`, `:196`.

### 3.3 Exact edits

**`src/core/variant-names.ts`**

Add `generatedVariantNames(bases)`:
`bases.flatMap((base) => Object.keys(MODEL_SUFFIX_MAP).map((suffix) =>
`${base}-${suffix}`))`. This is the single deletion universe used by
`AgentManager` and `agent-management`; it avoids duplicating the 7 × 7 product.

**`src/core/model-registry.ts`**

Add `modelAvailability(fullModel): "served" | "absent" | "unknown"` beside
`isModelServedByProvider` (`:160-169`). It cannot reuse that function's token
set: `readProviderTokenCache` (`:110-146`) stores each full lowercased slug
**and** its `[-_.]` fragments (`:132-137`), so `tokens.has("free")` is true for
unrelated models. Add an exact map beside the token map:

- extend `ProviderTokenCache` (`:102-106`) with
  `exactByProvider: Map<string, ReadonlySet<string>>`;
- `readProviderTokenCache` (`:110-146`) returns the cache object instead of
  the bare `byProvider` map, and its four early returns (`:113`, `:117`,
  `:120`, `:142`) return an empty cache with both maps empty;
- while building each provider (`:131-139`), collect `exact.add(lower)` when the
  slug is added; do not add fragments. Call
  `exactByProvider.set(provider.toLowerCase(), exact)` unconditionally beside
  `byProvider.set(...)` at `:139`, including when `exact` is empty: a provider
  with an empty `models` object must map to an empty set, not a missing key, or
  every slug is `unknown` instead of `absent`;
- store both maps in the cache object at `:144`;
- `getProviderModelTokens` (`:148-150`), `getAllProviderModelTokens`
  (`:152-158`), and `isModelServedByProvider` (`:160-169`) read `.byProvider`;
  only `modelAvailability` reads `.exactByProvider`;
- `modelAvailability` splits at the **first** `/` (no slash, empty provider, or
  empty slug → `unknown`); a provider key absent from `exactByProvider` →
  `unknown`; the exact lowercased slug in that provider's set → `served`;
  provider present but the slug missing → `absent`.

A provider entry without a `models` object is skipped at `:130`, so it answers
`unknown`, not `absent`; that is fail-open and recorded as a boundary.

The cache stores the full slug with any inner slashes, so a model such as
`nvidia/deepseek-ai/deepseek-v4.1-flash` uses provider `nvidia` and slug
`deepseek-ai/deepseek-v4.1-flash`. `getProviderModelTokens` keeps the expanded
token set and its existing callers; only `modelAvailability` uses the exact map.

**`src/scripts/gen-opencode-config.ts`**

1. Remove the `DELETED_AGENTS` import (`:7`), `readDeletedAgents` (`:255-275`),
   and `unionDeletedVariants` (`:287-289`) once their last callers are gone,
   including the in-lock use at `:864`. No replacement list is introduced.
2. `buildAgents` default becomes `deleted ?? []` (`:508`).
3. The additive filter from 2.2.3 is the project deletion rule.
4. `checkGeneratedConfig` drops the deleted-agents sidecar read and the
   resurrect path (`:744-756`, `:760-763`); the pin read
   (`loadPinnedAgents`, `:708`) stays.
5. `checkGeneratedConfig`'s model check (`:729-734`) accepts a served model
   without a pin: after `actual.model !== pureModel` and `!pinned.has(name)`,
   allow `typeof actual.model === "string" && modelAvailability(actual.model)
   === "served"`. It also accepts a retired model whose availability is not
   `absent`: `RETIRED_MODEL_IDS.has(actual.model) &&
   modelAvailability(actual.model) !== "absent"`. Without the first clause the
   served model step 8 keeps in `buildMergedAgents` makes `gen --check` fail on
   every run; without the second, an unpinned retired `unknown` model that the
   same merge keeps (notably the gated `addagentStale` entry, which
   `computePinEntries` never pins) makes `gen` write the config and then fail
   its own post-write verify. This is project-lane only: the global lane uses
   `checkGlobalRoster` (`:171-200`) and keeps `RETIRED_MODEL_IDS`. A pin remains
   the way to keep a non-retired model the cache classifies as `unknown`; an
   `absent` model is regenerated by the merge regardless of a pin.
6. The global lane is unchanged: `buildGlobalRoster` passes `roster.deleted`
   (`:121-169`), and the global gate keeps `derivedExpectedCount` (`:817`).
7. Keep `deletedPath` (see 2.2.7); only the sidecar reading is removed.
8. `buildMergedAgents:590-591`: replace the `RETIRED_MODEL_IDS.has(existingModel)`
   predicate with `modelAvailability(existingModel) === "absent"`. A model the
   provider still serves is kept even if it is listed as retired; a model the
   provider omits is regenerated. `unknown` is not a retirement. Add a new
   `import { modelAvailability } from "../core/model-registry.ts";` (this file
   has no model-registry import today; `:10` imports the suffix map and
   `RETIRED_MODEL_IDS` from `variant-names.ts`). Also gate the project-lane
   `addagentStale` predicate (`:600-605`) on `modelAvailability(existingCfg.model)
   === "absent"`: `opencode/mimo-v2.5-free` is in `RETIRED_MODEL_IDS`
   (`model-registry.ts:73`), so without the gate it would override a served or
   `unknown` `addagent` model immediately after the merge kept it. With the
   gate, the `retiredOverride` path already regenerates an absent model; the
   predicate becomes redundant but stays for auditability. Leave
   `legacyHeadOnBase` (`:592-599`) static: its model is the free fallback, not
   a retirement. The global merge at `:135-154` keeps both static predicates,
   because that path reconciles the shipped roster, not a project config.

**`src/bootstrap/hooks-registration.ts`**

`:100` computes `isRetired = raw !== undefined && RETIRED_MODEL_IDS.has(raw)`.
Replace the second half only, keeping the undefined guard:
`isRetired = raw !== undefined && modelAvailability(raw) === "absent"`;
`unknown` stays a normal model. Add a new
`import { modelAvailability } from "../core/model-registry.ts";`; the existing
`import { RETIRED_MODEL_IDS } from "../core/variant-names.ts";` (`:20`) stays.
The `RETIRED_MODEL_IDS` checks at `:125`, `:147-148` remain: they order fallback
candidates and must not pick a retired model as the healthy replacement.

**`src/services/proxy-fallback-chains.ts`**

`sweepRetiredModelPins` (`:73-86`) is another static retirement predicate: it
reassigns an `agentModelMap` entry whose model is in `RETIRED_MODEL_IDS`
(`:76`) and chooses the first non-retired chain member (`:79`). It runs at every
boot (`src/bootstrap/plugin-init.ts:708`) and mutates the effective model map,
so a served-retired model kept by `buildMergedAgents` would be silently replaced
in memory while `opencode.json` still shows it. Replace `:76` with
`modelAvailability(model) === "absent"` and `:79` with
`!RETIRED_MODEL_IDS.has(m) && modelAvailability(m) !== "absent"`; keep
`RETIRED_MODEL_IDS` for chain ordering, and add `modelAvailability` to the
existing `../core/model-registry.ts` import (`:1`). `unknown` is kept, not
reassigned.

**`src/utils/opencode-config.ts`**

`rewriteDynamicAgentModels` (`:205-247`) is the fifth static retirement
predicate. `applyBootRepairs` calls it unconditionally (`:379`), and
`repairProjectConfigBoot` runs at every boot (`src/bootstrap/plugin-init.ts:663`).
`:227` rewrites any model in `RETIRED_MODEL_IDS`, so a served-but-retired model
that `buildMergedAgents` keeps is silently replaced in `opencode.json` on the
next boot; provider truth would not survive a restart. Replace `:227` with
`const isRetired = modelId !== null && modelAvailability(modelId) === "absent";`
and the chain pick at `:233` with
`chain.find((m) => !RETIRED_MODEL_IDS.has(m) && modelAvailability(m) !== "absent") ?? defaultAgentModelForRole(role)`.
Add a new `import { modelAvailability } from "../core/model-registry.ts";`; the
existing `RETIRED_MODEL_IDS` import from `../core/variant-names.ts` (`:22`)
stays for ordering. `ensureAgentModels` (`:304`) calls the same function, so it
becomes provider-aware with no separate edit. With no provider cache every
model is `unknown` and boot repair keeps it, consistent with the fail-open
policy elsewhere; a model is rewritten only once the cache reports `absent`.

**`src/tools/agent-management.ts`**

1. Delete `deletedAgentsPath` (`:136-138`); drop `resolveDeletedAgentsPath`
   from the path-resolver import and `resolveSafePathSync` from the
   `../utils/path.ts` import (keep `resolveSafePath`, still used at `:730`).
2. `readDeletedAgentNames` (`:140-173`): keep the global branch; for the project,
   read `resolveActiveConfigPath(ctx.stateDir, "project")` and parse it with
   `readJsoncObject` (add it to the `../utils/opencode-config.ts` import at
   `:7-14`), take `Object.keys(agent)`, and return
   `generatedVariantNames(SPECIALIZATIONS)` minus those keys. Add
   `generatedVariantNames` to the `../core/variant-names.ts` import (`:36`). A
   missing config, a missing `agent`, `agent: {}`, or an `agent` that is not a
   non-array object returns an empty set (boot window). A parse failure
   propagates: `kick` fails closed at `:1029-1033`.
3. `writeDeletedAgentNames` (`:175-200`): the global branch still writes
   `roster.deleted`; the project branch writes no file. It calls
   `setDynamicDeletedAgents([...names])` and `pruneUserPreservedAgents([...names])`
   so the routing guard updates immediately. Absence in the config is the
   persistence; the in-memory set is only a cache for this process.
4. `persistDeletedAgents` / `unpersistDeletedAgents` (`:202-215`): keep them.
   The project config is the source. `persist` runs after
   `removeAgentsFromConfig` (`:1070-1076`), so `readDeletedAgentNames` already
   contains the removed name. `unpersist` runs after the add has written the key
   (`:823-825`), so the name is already absent; the current `if (changed)` guard
   would skip the in-memory update and leave a stale `dynamicDeletedAgents`
   entry. For project scope call
   `writeDeletedAgentNames(ctx, await readDeletedAgentNames(ctx))`
   unconditionally (it writes no file there), or guard with
   `changed || SCOPE === "project"`. Keep the `changed` fast path for global so
   an unchanged roster is not rewritten. Also update the user-facing warning at
   `:865`, which still says the variant "stays in deleted-agents.json"; the
   project sidecar is no longer an input, so the message must name the missing
   config key instead (a re-add writes that key).
5. Add `{ failClosed: true }` to the unpersist call at `:861-863` and to the
   pin write at `:877-879`. The first protects the deletion cache; the second
   keeps pins from racing an unlocked generator write. Both are inside
   `withConfigWriteLock`, whose unlocked fallback is otherwise allowed.
6. The `RETIRED_MODEL_IDS` sweeps (`:1085-1199`) become provider-truth sweeps.
   The three trigger predicates at `:1091`, `:1128`, and `:1179` currently read
   `deadModels.has(...) || RETIRED_MODEL_IDS.has(...)`; both operands resolve to
   the same static set because `deadModels` is initialized from
   `RETIRED_MODEL_IDS` at `:1085`. Replace each whole predicate with
   `modelAvailability(...) === "absent"`. Then delete the `deadModels`
   declaration. In each healthy-chain filter (`:1095`, `:1132`, `:1183`), replace
   the two-find expression with one find,
   `chain.find((m) => !RETIRED_MODEL_IDS.has(m) && modelAvailability(m) !== "absent") ?? "opencode/big-pickle"`:
   after `deadModels` is gone, the original second find would repeat the first
   predicate, and a replacement must not itself be provider-absent. Add `modelAvailability` to
   the existing `../core/model-registry.ts` import (`:39`). The global roster
   branch (`:1110-1151`) keeps its shape; only the three predicates, the three
   filters, and the `deadModels` declaration change.
7. The project `add` path must fail closed when no project config exists:
   `agent-management.ts:737-743` currently turns `ENOENT` into `raw = null` and
   then skips the config write at `:743`, so `addagent` reports success while
   the config never receives the key. Replace the `ENOENT` branch with a thrown
   `Error("addagent: project opencode.json is missing — refusing to write")`;
   the existing catch at `:830-835` logs it and sets `configWriteFailed`.
8. The project `kick` path has the same hole: `agent-kick-runtime.ts:96-102`
   returns on `ENOENT`. Throw instead
   (`Error("kick: project config is missing — refusing to write")`); the kick
   catch at `agent-management.ts:1225-1229` then aborts before any destructive
   step. Without this, a kick in a config-less workspace updates the deletion
   cache and removes state while the config still lists the agent.

**`src/hooks/guards/permission-guard.ts`**

1. Remove `filePath.endsWith("deleted-agents.json")` from `isRosterFile`
   (`:106`). The sidecar is inert; blocking edits to it is dead policy.
2. Keep the shrink branch (`:210-222`) and `extractDeletedNames` (`:15-26`),
   and scope the branch to the global roster: run it only when `filePath` ends
   with `tawassul.json` or `tawassul.jsonc`. This preserves the direct-edit
   guard for the global `roster.deleted` list and removes it only for the inert
   sidecar and for a `deleted` key in the project `opencode.json`, which is not
   an authority after change 2. Removing the branch would be a
   feature-for-feature trade against the global guard; retargeting is the
   smaller change.
3. `scripts/prove-roster-boundary.ts` gains two cases: a shrink-shaped edit of
   a populated `.opencode/deleted-agents.json` to `{"deleted":[]}` is no longer
   blocked (the payload is non-empty, so this proves the `:106` removal rather
   than the empty-wipe rule at `:150`); a shrink of `tawassul.jsonc`'s
   `deleted` array to `{"deleted":[]}` remains blocked. The variant-MD, key-add,
   key-delete, empty-wipe, and oldString-miss cases keep their expectations.

**`src/context/managers/AgentManager.ts`**

1. `deletedRoster` (`:309-368`): the project source becomes
   `resolveActiveConfigPath(this.stateDir, "project")`; parse it with
   `readJsoncObject` (JSONC comments are valid in `opencode.json`); add
   `readJsoncObject` to the `../../utils/opencode-config.ts` import (`:29`).
   When `agent` is missing, null, empty, or not a non-array object, return an
   empty set. Every empty exit that represents a valid config must also write
   the cache entry and call `setDynamicDeletedAgents([])` and
   `pruneUserPreservedAgents([])` before returning: today the early returns at
   `:331-335`, `:340-344`, and `:354` occur before the calls at `:359-360`, so
   a transition from a populated roster to an empty one would keep the old
   process set. The parse-failure catch at `:350-352` (which wraps
   `readJsoncObject`) writes the empty cache entry but deliberately does not
   reset the process set: the file is unreadable, so resetting would make
   previously deleted names routable in this process; across restarts the empty
   set still forgets them, which is the disclosed fail-open and why kick fails
   closed separately. Otherwise return `generatedVariantNames(<7 bases>)` minus
   the present keys. The global branch keeps `roster.deleted`. The existing
   outer `catch` (`:365-367`) stays for read errors and returns an empty set
   without resetting; it is non-empty, so it is not one of the three silent
   catches pinned for this file by `prove-disclosure` (`:127`, `:140`, `:196`).
2. The cache key becomes the source path plus `(mtimeMs, size)` (project) or
   the roster path plus `(mtimeMs, size)` (global); the existing
   `DELETED_ROSTER_TTL_MS` stays. Add `_deletedRosterCachePath` and
   `_deletedRosterCacheSize` beside the fields at `:46-48`, capture both values
   from one `statSync(srcPath)` at `:315-320` (both `-1` when the stat fails),
   compare the path and both values at `:321-326`, store all three at every
   cache-write site (`:332-335`, `:341-344`, `:350-352`, `:354`, `:361-363`),
   and reset all three in `clearReadCache` (`:407-409`). The path matters
   because `resolveActiveConfigPath` prefers a newly created `opencode.jsonc`
   over `opencode.json`; without it a same-mtime/size file can serve the
   previous file's deletion set. An mtime alone can collide on a coarse
   filesystem clock; the size is a second discriminator.
3. Import `ALL_AGENTS` (from `../../agent-templates.ts`) and
   `generatedVariantNames` (from `../../core/variant-names.ts`); derive the
   seven bases as `ALL_AGENTS.filter((a) => a.name !== "tawa").map((a) => a.name)`
   (the same set as `EXTEND_AGENTS`), not all eight. Remove the now-unused
   `resolveDeletedAgentsPath` import (`:26`). Keep the existing
   `setDynamicDeletedAgents` / `pruneUserPreservedAgents` calls (`:359-360`):
   removing the prune would let a stale preserved set un-delete an agent that
   was just removed, because `validateTaskRouting` (`src/security-policy.ts:436`)
   and `checkDeletedAgent` (`:454`) subtract `userPreservedAgents` after the
   deletion sets are consulted.

**`src/security-policy.ts`**

1. Delete `DELETED_AGENTS` (`:114-156`) entirely. It is the user's own
   historical list, not a product default; do not replace it with another
   shipped list.
2. `validateTaskRouting` (`:435-436`): `deleted = dynamicDeletedAgents.has(agentName)
   && !userPreservedAgents.has(agentName)`.
3. `checkDeletedAgent` (`:451-455`; the return expression is at `:454`): keep the
   early `userPreservedAgents` return at `:453`, then reduce `:454` to
   `return dynamicDeletedAgents.has(normalized);`. That is the same guarded
   expression after normalization.

**`src/tools/agent-add-helpers.ts`**

1. Remove the `DELETED_AGENTS` import (`:9`) and the rejection at `:197-199`.
   Remove the now-orphaned `addagentDeletedAgent` key from
   `src/i18n/en.json:29` and `src/i18n/ar.json:29`; the deleted rejection at
   `:198` is its only caller.
2. In `validateAddInput` (`:170-182`), capture the resolved model once:
   `const resolved = resolveModelAlias(model)`, use it for the existing guard,
   then after the alias check call `modelAvailability(resolved)` — not the raw
   alias. Add `modelAvailability` to the `../core/model-registry.ts` import
   (`:5`), and add `logger` from `../utils/logger.ts` for the `unknown` branch:
   - `absent` → return
     ``<provider> does not list <model> — the provider is the source of truth, not the registry``;
   - `unknown` → `logger.warn` the same sentence with `allowing <model> unverified`;
   - `served` → allow.
   The two strings stay raw English because they carry the policy sentence.

**Pins and custom models**

`checkGeneratedConfig` compares `actual.model` with `pureAgents[name].model`
unless the name is pinned (`src/scripts/gen-opencode-config.ts:728-734`). A kept
generated variant with a custom slug such as `analyst-exo-free` has no
`pureAgents` entry, so it needs a pin. `addagent` already writes that pin through
`computePinEntries` / `writeBaseRolePins`
(`src/tools/agent-management.ts:870-879`). The additive filter must keep such a
key; it does, because the name is not generated by the suffix map. The served
clause is model-level, not name-level: any served model on an unpinned entry is
accepted, which matches the merge. A non-retired `unknown` still requires a pin;
a retired model whose availability is not `absent` is accepted by the clause
added in correction 95.

The provider-truth merge adds a second acceptance path: a model whose
`modelAvailability` is `served` is accepted without a pin (2.3 step 5). A pin
remains necessary only when the provider cache cannot classify the model
(`unknown`); an `absent` model is regenerated by the merge even if pinned. This
is project-lane only; the global lane keeps `checkGlobalRoster`
(`gen:171-200`) and `RETIRED_MODEL_IDS`.

### 3.4 Proofs that must change

| Proof | Change |
|---|---|
| `scripts/prove-first-boot-seed.ts:30-31` | the project contract now holds 16 keys (8 bases + `addagent` + 7 `-pickle`) and the 8 base `.md` files; the seeded files match a second `generateAgentMd` seed byte-for-byte (do not compare to the gitignored `.opencode/agents`, which a fresh clone lacks until `npm run seed:agents`); a pre-existing modified `dev.md` is left byte-identical on the `ensureMinimalProjectContract`/`ensureBaseAgentFiles` path (a full boot's `ensureDefaultAgentMds` rewrites a file that lacks the responsibilities markers, `AgentManager.ts:435-441`); the global seed still holds 8 (`:60-71`) |
| `scripts/prove-s029.ts:9-15` | drop the `DELETED_AGENTS`, `unionDeletedVariants`, `derivedExpectedCount`, and `EXPECTED_AGENT_COUNT` imports; import `setDynamicDeletedAgents` instead |
| `scripts/prove-s029.ts:72-78` | call `setDynamicDeletedAgents(["dev-ling"])` before the guard block; without it the guard is false after the static list is removed |
| `scripts/prove-s029.ts:92-93` | collapse the two assertions into one `buildAgents()["analyst-ling"] !== undefined`; after the static list is gone `buildAgents()` and `buildAgents([])` are identical, so the explicit empty-list call proves nothing and is removed |
| `scripts/prove-s029.ts:95-110` | delete the whole retired block, including the live-config assertion at `:106-110`; all of it depends on `retired = unionDeletedVariants([])` |
| `scripts/prove-s017.ts:66-72` | set `TAWASSUL_MODELS_JSON` to a fixture listing `opencode` and `cloudflare-workers-ai` with empty `models` objects before the sweep test, so both retired pins are `absent` and still reassigned; add a second fixture that lists the two retired slugs, and assert `reassigned.length === 0` (a served-retired model is kept). Restore the variable after the block |
| `scripts/prove-s028.ts:4` | add `modelAvailability` to the existing `../src/core/model-registry.ts` import |
| `scripts/prove-s028.ts:8` | drop the static import |
| `scripts/prove-s028.ts:82` | stays `!== null`: `fledge` is not a known suffix, and a missing provider cache cannot govern a custom suffix, so compound-suffix governance rejects it. Change only the message to cite governance, not the static list |
| `scripts/prove-s028.ts:81-83` | add a case beside it: `validateAddInput(["analyst-ling"], "opencode/ling-3.0-flash-fin-free") === null` with no provider cache. `ling` is a known suffix and the model is `unknown`, which warns and allows; this is the re-add proof for a formerly static name. The messages at `:81` and `:87` no longer cite the static list: `:81` describes compound-suffix governance and `:87` describes the unknown-provider allow. The assertions are unchanged |
| `scripts/prove-s028.ts:87` | stays `=== null`: a malformed cache is also `unknown` |
| `scripts/prove-s028.ts:94-98` | replace the static census with a real provider file: call `useCache("provider.json")` (or write a dedicated `no-ling.json`) before the assertions, because `:89-92` leaves `TAWASSUL_MODELS_JSON` pointing at a directory, which yields `unknown`. `provider.json` lists provider `opencode` and omits `ling-3.0-flash-fin-free`, so the add is rejected as `absent` |
| `scripts/prove-s036.ts:4,55-56` | drop the static import; replace the census with a source check that `src/security-policy.ts` contains no `DELETED_AGENTS` declaration (a partial removal that keeps the constant would otherwise pass), and with `buildAgents()["analyst-ling"] !== undefined` so the `buildAgents` import stays used |
| `scripts/prove-gen-merge-guards.ts:51` | remove the `deleted-agents.json` copy; the hybrid 34-key config is kept by the additive filter, and the pinned-drift cases stay |
| `scripts/prove-gen-merge-guards.ts:18-42` | set `TAWASSUL_MODELS_JSON` to a fixture `{"opencode":{"models":{}},"cloudflare-workers-ai":{"models":{}}}` before `proveRetiredMigration`. With no models file every retired id is `unknown`, `retiredOverride` is false, and the stale model is kept, so the migration assertion fails. The fixture lists both providers (the retired set spans those two) and omits every retired slug, so each is `absent` |
| `scripts/prove-gen-merge-guards.ts` | add a served-retired case beside the migration fixture: a `dev` entry with `opencode/mimo-v2.5-free` (retired but listed by the provider) and no pin; `buildMergedAgents` keeps it and `checkGeneratedConfig().ok === true`. Repeat with an unpinned `addagent` entry cloned from the generated config with only its model changed to the same slug, and assert it is kept too (the gated `addagentStale` predicate); a pin would bypass the gate and prove nothing. Without the 2.3 step 5 acceptance this fails. Add the `unknown` variant with a fixture that omits the provider (or an unset `TAWASSUL_MODELS_JSON`): the same unpinned `addagent` entry is kept and `checkGeneratedConfig().ok === true` only through the retired-not-`absent` clause; an unpinned non-retired `someone/else-1` under the same unknown fixture still fails, preserving the drift guard |
| `scripts/prove-s028.ts` | add an exact-map case: write `useCache("exact.json", '{"opencode":{"models":{"big-pickle":{}}}}')`, then `modelAvailability("opencode/big-pickle") === "served"` and `modelAvailability("opencode/pickle") === "absent"`; a `[-_.]` fragment is not a model. Add a provider entry without a `models` object (for example `{"broken":{}}`) and assert its slug is `unknown`, not `absent` (`model-registry.ts:130`) |
| `scripts/prove-roster-boundary.ts` | add two cases: a shrink-shaped edit of a populated `.opencode/deleted-agents.json` to `{"deleted":[]}` is no longer blocked; a `tawassul.jsonc` shrink to `{"deleted":[]}` stays blocked. The existing roster-file cases keep their expectations |
| `scripts/shared-parity.json:661-681` | S-030 keeps an anchor but re-points it to `derivedExpectedCount` (`gen:291`); rewrite its requirement text and note from "generation-layer retire" to "config-derived deletion plus additive generation", and add `scripts/prove-gen-merge-guards.ts` to the requirement's `proofs` array beside `scripts/prove-s029.ts` (the 16-key and subset-keep assertions live there). Do not hand-write the moved line: run `bun scripts/check-shared-parity.ts --write` so the line, the marker, and `docs/SHARED-PARITY.md` are regenerated, then verify the marker text |
| `scripts/shared-parity.json:1362-1377` | S-053.10 keeps its `deletedPath` anchor at `gen:58` (the path still feeds `loadPinnedAgents`), but the requirement text becomes "In global scope, deleted-agent names persist in `roster.deleted` and survive a seed; in project scope, absence from `config.agent` is the record." The note becomes "The global generator reads `roster.deleted` and rejects malformed shapes; the project generator reads `config.agent` and writes no deletion list." Regenerate with `--write`; do not hand-edit the note text alone |

## 4. Change 3 — cross-process safety

### 4.1 One lock name for one file

`opencodeConfigLockName` hashes `resolve(anchor)` today
(`src/utils/opencode-config.ts:258-259`). Two textual paths to the same file
(for example a symlinked `~/.config/opencode`) produce two locks. The seven
direct `acquireOpencodeConfigLock` calls all funnel through it:
`src/utils/opencode-config.ts:284` (the `withOpencodeConfigLock` wrapper), `:318`,
`:424`, `:474`, `src/tools/agent-management.ts:84`,
`src/bootstrap/plugin-init.ts:744`, and
`src/scripts/gen-opencode-config.ts:785`.

Fix: canonicalize inside the function, not at the call sites. Walk up through
missing ancestors so the first global boot, when `~/.config/opencode` does not
exist yet, still produces a canonical name:

```ts
function canonicalAnchor(anchor: string): string {
  const resolved = resolve(anchor);
  let current = resolved;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return tail.length === 0 ? real : resolve(real, ...tail);
    } catch (err) {
      logger.debug(`[tawassul] canonicalAnchor: ${(err as Error).message}`);
    }
    const parent = dirname(current);
    if (parent === current) return resolved;
    tail.unshift(basename(current));
    current = parent;
  }
}
```

`opencodeConfigLockName` hashes `canonicalAnchor(anchor)`. This covers an
existing file, an existing directory, a missing leaf, and a missing parent. Add
`realpathSync` to the `node:fs` import (`:3`) and `dirname`/`basename` to the
`node:path` import (`:5`).

The catch must not be empty. `scripts/prove-disclosure.ts:69` pins
`utils/opencode-config.ts` at 5 silent catches, and the census counts only
empty, `void 0`, or `void 0;` bodies (`scripts/prove-disclosure.ts:256-262`).
An empty `catch {}` makes the count 6 and fails `prove-disclosure`. The debug
log keeps the pinned count at 5; `logger` is already imported at `:23`.

### 4.2 The boot seed takes the lock

`ensureGlobalRosterSeed` checks and writes without a lock
(`src/utils/opencode-config.ts:507-527`), while `addagent` writes the same file
under the lock. A seed that starts before an add and writes after it can erase
the added key. Fix:

1. `mkdir(dir, { recursive: true })` before locking, so the canonical anchor
   has an existing directory.
2. Acquire `acquireOpencodeConfigLock(canonical)` before the second existence
   check.
3. Re-check both `canonical` and `legacy` under the lock, write, release in
   `finally`. Use the existing `withOpencodeConfigLock(canonical, ...)` helper,
   which already owns the release path, and catch its busy throw with a
   non-empty debug log; or, with a direct acquire, log in the `finally` catch.
   Do not add an empty `catch {}` (4.5): this file is pinned at 5 silent catches.
4. If the lock is busy, skip the seed this boot; it is idempotent.

### 4.3 Fail closed on the unpersist call and the pin write

`withConfigWriteLock` only refuses an unlocked write when `failClosed` is set
(`src/tools/agent-management.ts:85-91`). The add path already sets it at `:702`
(the roster write) and `:837` (the project config write), and `kick` already
sets it (`:1223`). The two add-path writes inside the lock do
not: the `unpersistDeletedAgents` call at `:861-863` and the
`writeBaseRolePins` call at `:877-879`. Add `{ failClosed: true }` to both.

The first is the deletion-cache write: without it, a busy lock leaves the
in-memory deletion set stale after a re-add. The second is the pin write that
`checkGeneratedConfig` consults for a kept custom-model variant
(`src/scripts/gen-opencode-config.ts:728-734`); an unlocked write can race the
generator. Neither call is a second undo of the deletion list: `:877-879` is
the pin write, not `unpersistDeletedAgents`.

### 4.4 Reclaim only a lock that is really stale

`src/infra/file-lock.ts` has four removal paths, and they disagree. The minimum
fix is owner identity, not a rewrite:

| Path | Current defect | Fix |
|---|---|---|
| `acquireFSLock:259-296` | expiry missing → wait 3 s, then remove without any owner check; owner without a pid → return busy forever | in both branches read the owner before removal; a live pid blocks removal; a no-pid owner is re-read after the grace and reclaimed only when unchanged |
| `checkFSLock:357-403` | expiry missing → remove after 3 s without an owner check; owner without a pid → `locked: true` forever | same rule in both branches: live pid blocks, no-pid owner re-read after the grace |
| `cleanExpiredFSLocks:503-548` | pid dead → remove; no pid → remove immediately; expiry missing → remove after 3 s without an owner check | same rule in both branches; an expiry-missing entry whose owner has a live pid stays |
| `removeFSLockDir:415-459` | owner pid alive → false; otherwise remove immediately | same rule: grace plus owner re-read for a missing or no-pid owner |

Exact minimal changes:

1. `src/context/session-manager.ts:51`: `lockOwner` gets
   `::pid-${process.pid}`. Without a pid, both `acquireFSLock:286-289` and
   `checkFSLock:377-380` treat a live session-manager lock as busy forever.
2. Exit cleanup (`src/infra/file-lock.ts:65-95`): store the owner with each
   acquired lock (a `Map<string, string>` instead of a `Set<string>`) and delete
   the lock directory only when the on-disk `owner` still equals that id. A
   process that exits late must not delete a lock another process now owns. The
   exit handler is synchronous, so read the owner with `readFileSync` inside a
   non-empty catch (log at debug); it cannot call the async `readOwner`.
3. `releaseFSLock` (`:304-354`): stop the heartbeat and drop the bookkeeping on
   every exit, including the no-directory return (`:307-311`), the owner
   mismatch (`:317-319`), and the catch (`:350-353`).
4. No-pid legacy locks are reclaimed only after a grace — the existing 3 s
   directory-age check when `expires` is missing, or the expiry itself when it
   is present — and a second owner read that matches the first observation. A
   lock whose owner has a live pid is never reclaimed in any of the four paths.
   This includes the expiry-missing branch: a missing `expires` file is not
   evidence of staleness, so it must read the owner before removal.
5. `removeStaleLock` (`:212-239`) takes the owner the caller observed and
   quarantines before deleting. Immediately before the rename it re-reads
   `owner` from disk with `readFileSync` (add it to the `node:fs` import at
   `:3`) and aborts (leaving the lock in place) when the value differs from
   `observedOwner`. Generate a unique sibling name
   (`${basename(lockDir)}.stale-${process.pid}-${Date.now()}-${seq}`, with a
   module counter `seq`), `rename(lockDir, quarantineDir)` as one atomic step
   (add `rename` to the `node:fs/promises` import at `:2`),
   then delete the quarantine. The per-file delete sequence, including its five
   silent catch bodies (`:216`, `:221`, `:226`, `:231`, `:236`), is retained and
   applied to the quarantine directory, so the `prove-disclosure` count for this
   file stays 23. A lock created after the rename is never touched,
   because only the renamed directory is deleted; a lock created between the
   staleness decision and the rename is still exposed, so the re-read plus the
   unique suffix **narrows** the delete-after-decision window rather than
   closing it (the re-read and the rename are not one atomic compare-and-swap).
   All removal paths (`acquireFSLock:260-273` and `:277-293`; `checkFSLock:382`
   and `:397` (the expiry-missing branch at `:388-398`); `cleanExpiredFSLocks:529`,
   `:538`, `:541`; `removeFSLockDir:415-459`) call this one helper and pass the
   owner observed when deciding staleness. The second `checkFSLock` call at
   `:397` must not be left on the old unowned delete path. A failed `rename` is logged at debug and the lock is
   left in place (fail closed). The expiry / heartbeat structure and the on-disk
   lock format are unchanged.
6. Every new catch in this file must log. `scripts/prove-disclosure.ts:31` pins
   `infra/file-lock.ts` at 23 silent catches, and `:69` pins
   `utils/opencode-config.ts` at 5; the inventory spans `:14-75`. The census
   (`:256-262`) counts only empty, `void 0`, or `void 0;` bodies. A new empty
   `catch {}` around the quarantine rename or the synchronous owner read makes
   the count 24 and fails the proof; the existing empty catches are unchanged.

### 4.5 Shared append and read-modify-write files

These are the other files shared across workspaces. Each fix is a lock plus an
atomic replace; no format change.

| File | Current defect | Fix |
|---|---|---|
| `src/services/usage-ledger.ts:830-841` | `stat` → `rename` → `append` without a lock; two processes can rotate between each other's steps, and `rename` clobbers an existing `.1` | take a lock named from `this.path` for `stat`/`rename`/`append`; when the lock is busy, skip rotation and call `appendFile` only (one `O_APPEND` write keeps the row); when acquired and the current file exceeds `maxBytes`, first move an existing `.1` to `${path}.1.${process.pid}-${Date.now()}-${seq}` (a module counter `seq`; unique, non-clobbering), then rotate current to `.1`; `load` (`:352-353`) keeps reading exactly `.1` + current, so the oldest backup is retained on disk but not re-read |
| `src/hooks/n2-auto.ts:50-86` | synchronous read-tail + truncate-write + append; two processes can drop the other's line | make `persist` async; lock named from `n2AutoLogPath()`; when locked, write the tail to a temp file and rename, then append the new record; when busy, append only; await at `:117` and `:155` |
| `src/services/keyring.ts:16-99` | `getSecret` reads `secrets.json` unlocked while `setSecret` rewrites it with a truncating `writeFile`; a read during the rewrite can see a truncated file, `JSON.parse` throws, and the catch at `:63-65` returns null | split an unlocked `readSecretsFile()` helper; `getSecret` and `setSecret` both take the same lock; `setSecret` reads, updates, and writes through `atomicWriteFile` from `src/infra/disk-utils.ts` (temp `0600` + rename) in one locked section; use `Object.hasOwn(data, name)` and a `typeof === "string"` check; if the write lock cannot be acquired, fail closed with a warning instead of writing unlocked. A read that cannot take the lock reads unlocked: the atomic rename means it sees the old or the new file, never a truncated one. Keep the two existing silent catches (`:47`, `:90`) so `prove-disclosure` stays at 2 |

All three use the same name helper as the config lock:
`opencodeConfigLockName(canonical path)` from `src/utils/opencode-config.ts:258-260`.
Create the parent directory before locking so the canonical anchor resolves.
Every new `acquireFSLock` caller must pass an owner containing
`::pid-${process.pid}` (the pattern `acquireOpencodeConfigLock` already uses at
`src/utils/opencode-config.ts:273`). An owner without a pid is a no-pid legacy
lock: by the rule in 4.4 it can be reclaimed after the 3 s grace while the
process is still alive.
The `tawassul-opencode-lock-` prefix is a hash namespace, not a scope claim.
Do not add an empty `catch {}` in any of these paths: the reviewed inventory at
`scripts/prove-disclosure.ts:14-75` pins it exactly (`services/keyring.ts: 2`,
`utils/opencode-config.ts: 5`, `infra/file-lock.ts: 23`,
`tools/agent-management.ts: 6`, `context/managers/AgentManager.ts: 3`,
`scripts/gen-opencode-config.ts: 1`), and the census counts only empty,
`void 0`, or `void 0;` bodies (`scripts/prove-disclosure.ts:256-262`). The
expected counts after change 3 are unchanged. Any new catch must log; re-pin
only after verifying the body is genuinely silent. `acquireFSLock` returns a boolean, so
the three call sites need no catch; reuse the existing non-silent debug catches
at `src/hooks/n2-auto.ts:79-81` and `:83-85`.

Neither `usage-ledger.ts` nor `n2-auto.ts` appears in the inventory today: the
rotation catch at `usage-ledger.ts:836-839` is non-empty (a
`const ignored = undefined; void ignored;` body), and the two n2 catches log at
debug. Replacing the ledger catch with an empty `catch {}`, or adding one around
any new lock step, would add a new file to the census and fail
`prove-disclosure`; every new catch in these files must keep a non-empty body (a
debug log is enough).

`installUsageLedger` stays synchronous (`src/services/usage-ledger.ts:856-862`);
the lock lives in the async append path. `setSecret` has no callers in `src`
today; the change is still made because the file is shared state.

### 4.6 Coverage after the change

| Shared file | Writers | Lock after the change |
|---|---|---|
| `tawassul.jsonc` | add `agent-management.ts:688`, kick `agent-kick-runtime.ts:85`, global delete `agent-management.ts:180`, CLI `gen:824`, seed `opencode-config.ts:524` | config lock, `failClosed` where a refusal is safe; seed now locked |
| project config (`opencode.json`, or an existing `opencode.jsonc` for the active-file writers) | add `agent-management.ts:824`, F6 `plugin-init.ts:756` (`opencode.json` only), boot repair `opencode-config.ts:436`, kick `agent-kick-runtime.ts:125`, CLI `gen:874` (`opencode.json` only) | config lock anchored at the project directory; canonicalized where the pre-existing anchors coincide (4.7); add/kick fail closed when the config is absent |
| usage ledger | `usage-ledger.ts:840` | ledger lock, append fallback |
| n2 log | `n2-auto.ts:82` | n2 lock, append fallback |
| `secrets.json` | `keyring.ts:58` read, `:95` write | keyring lock for both, atomic replace, write fails closed |
| `agent/*.md` (both scopes) | `ensureBaseAgentFiles`, `ensureDefaultAgentMds`, `addagent`, `kick` | no lock; each file is atomic and last-writer-wins per tag (4.7) |

### 4.7 Explicit boundaries

- Global `agent/*.md` writes remain outside `withConfigWriteLock`. Each file is
  atomic and deterministic; two concurrent adds of the same tag are
  last-writer-wins per file. This is recorded as a boundary, not fixed with a
  second lock layer.
- Project `.md` writes follow the same boundary: `ensureBaseAgentFiles` is
  missing-only and writes identical template bytes, while project
  `addagent`/`kick` write or remove one agent file through the existing atomic
  path (`agent-management.ts:376-390`, `agent-kick-runtime.ts:43-52`). They are
  not added to the locked-file table in 4.6 because they are per-agent metadata,
  not the shared config or ledger state; concurrent same-tag writes are
  last-writer-wins, not torn data.
- A stale `.opencode/deleted-agents.json` becomes inert. The code stops reading
  it, and `src/hooks/guards/permission-guard.ts:106` stops blocking direct edits
  to it. The shrink branch (`:210-222`) and `extractDeletedNames` (`:15-26`) are
  kept and scoped to `tawassul.json`/`tawassul.jsonc`. The sidecar and a
  `deleted` key in the project `opencode.json` are no longer guarded; the
  global `roster.deleted` direct-edit shrink guard stays. The official path
  remains `kick`, and the global lane still treats `roster.deleted` as its
  authority. Retargeting is smaller than removing the branch and avoids a
  feature-for-feature trade.
- The generator's target and the runtime's authority are two files.
  `resolveGenPaths` always returns `opencode.json`
  (`src/scripts/gen-opencode-config.ts:53-60`), while runtime readers use
  `resolveActiveConfigPath`, which prefers `opencode.jsonc`
  (`src/utils/path-resolver.ts:127-132`). F6 and the CLI therefore target
  `opencode.json` only: `checkGeneratedConfig()` returns
  `{ ok: true, missing: true }` when that file is absent
  (`src/scripts/gen-opencode-config.ts:688-692`), and the CLI refuses to create
  `opencode.json` beside an existing `opencode.jsonc` (2.2.5). A `.jsonc`-only
  project is still read by `AgentManager` and the add/kick paths, but is not
  regenerated by F6. In this state `gen --check` returns
  `{ ok: true, missing: true }` because it targets `opencode.json`, and the
  write path refuses the `.jsonc` shadow before `buildAgents`, so
  `assertBaseRegistrySync` is not reached. This split predates the plan and is
  recorded, not changed.
- Project-config lock anchors are not unified by this change. Add/kick take
  `resolve(ctx.stateDir)` (`src/tools/agent-management.ts:83`), boot repair and
  the boot seed take `resolve(ctx.directory)` (`plugin-init.ts:663`, `:676`),
  F6 takes `dirname(paths.configPath)` (`:735`), and the CLI takes its project
  directory. `canonicalAnchor` collapses textual aliases of one path, not
  different anchors. They serialize when
  `stateDir === ctx.directory === dirname(configPath)`, the normal single-root
  project; a monorepo where `projectRoot !== workspaceDir`, or F6's cwd
  fallback (correction 53), keeps distinct locks. This is a disclosed
  pre-existing boundary; Change 3 does not re-anchor those writers.
- Replacing the `tawa.md` marker with `opencode.json` in `refuseProjectTarget`
  (`src/scripts/gen-opencode-config.ts:66-82`) is intentionally weaker as an
  identity check: the CLI proves the target is an OpenCode project, not that it
  is a Tawassul project. This is required for a first run because `tawa.md` is
  first-run output. It is bounded: the CLI refuses the global config dir,
  refuses a JSONC shadow, refuses a directory with no config, and is invoked
  explicitly with `--project` or from the project root.
- `ensureAgentModels` (`src/utils/opencode-config.ts:304`) and the
  `rewriteDynamicAgentModels` step inside `applyBootRepairs` (`:376-397`) share
  one model-map repair. Both become provider-aware through the same change:
  `:227` tests `modelAvailability(modelId) === "absent"` and `:233` filters
  absent models from the replacement chain; `ensureAgentModels` needs no
  separate edit because it calls `rewriteDynamicAgentModels`. This is required,
  not cosmetic: `applyBootRepairs` runs at every boot through
  `repairProjectConfigBoot` (`src/bootstrap/plugin-init.ts:663`), so without it
  boot repair rewrites a served-retired model that `buildMergedAgents` kept,
  and the provider-truth promise lasts only until the next restart. With no
  provider cache every model is `unknown`, so boot repair leaves it in place;
  that matches the fail-open policy used everywhere else.
- `resolveAgentModelRef` (`src/services/model-refs.ts:17`) keeps its
  `!RETIRED_MODEL_IDS.has(raw)` rejection. It feeds handoff metadata only
  (`plugin-init.ts:900-901`, `service-factory.ts:686-687,749-750`,
  `handoff.ts:465-466`), not the effective agent model, so a served-retired pin
  still dispatches the agent while the handoff record names the role head.
  Changing it would alter recorded handoff metadata, not model selection;
  `scripts/prove-dispatch-model.ts:66-67` pins the current behavior. Recorded,
  not changed.
- `resolveDeletedAgentsPath` in `src/utils/path-resolver.ts:135-138` has no
  remaining caller after this change. It is left in place to avoid unrelated
  churn; it is not used as an authority.

## 5. F6 boundary

The facts are in 1.5. Decision A is the default and this plan is executable
under it:

- F6 and boot repair keep running in a global install;
- both only rewrite an **existing** config in the directory they resolve;
- F6's new seed call is reached only when the config exists; it writes only the
  `.md` files that are missing, because `assertBaseRegistrySync`
  (`src/scripts/gen-opencode-config.ts:415-429`, called at `:510`) needs them.
  `checkGeneratedConfig` already returns `{ ok: true, missing: true }` when the
  config is absent (`src/scripts/gen-opencode-config.ts:688-692`), so a
  config-less project is never seeded by F6;
- with change 1, an empty `agent` container becomes 16, and an existing set is
  normalized without adding absent variants;
- therefore a global install can create `.opencode/agents/*.md` in the project
  directory F6 resolves (`inferProjectRoot`, `gen:45-51`) when that directory
  already has an `opencode.json`, and can rewrite that directory's `agent`
  block. A directory with no `opencode.json` is never touched by F6. F6 is not
  keyed to `ctx.directory`; boot repair is (`src/bootstrap/plugin-init.ts:663`).
- the two writers see different files. Boot repair scans `opencode.jsonc` first
  and then `opencode.json` (`src/utils/opencode-config.ts:403-409`), while F6's
  `resolveGenPaths` and `checkGeneratedConfig` look only at `opencode.json`
  (`src/scripts/gen-opencode-config.ts:53-60`, `:688-692`). A workspace whose
  only config is `opencode.jsonc` is therefore repaired by boot repair but never
  regenerated by F6; runtime readers follow the JSONC through
  `resolveActiveConfigPath` (`src/utils/path-resolver.ts:127-132`), and the CLI
  now refuses to create `opencode.json` beside it (2.2.5). This pre-existing
  split is recorded in 4.7.
- `docs/installation.md` gains one sentence stating this behaviour.
- `docs/STATE-ROOT-DESIGN.md:103` still lists `.opencode/deleted-agents.json` as
  workspace state; update it to state that the sidecar is inert and that project
  deletion is absence from `opencode.json`. `docs/SHARED-PARITY.md` is
  regenerated by `check-shared-parity --write`, not hand-edited. There is no
  `docs/DECOUPLING.md` in this tree; the root `DECOUPLING.md:10-24` is updated
  instead (sidecar inert, project deletion by absence).

Decision B is a separate change: gate both writers with
`coexistenceScope === "project"` (computed at `src/bootstrap/plugin-init.ts:541`;
`SCOPE` at `src/tools/agent-management.ts:126` is a different value).
It changes existing behaviour, avoids the workspace side effect, and needs an
explicit order.

## 6. Proof plan

No new proof files. The 180-step count in `AGENTS.md` stays. The proof stage
requires a seeded checkout: `prove-s029` and `prove-s036` call `buildAgents()`
with no argument, and `prove-gen-lock-contention` and `prove-gen-merge-guards`
copy the base `.md` files from `.opencode/agents`. A fresh clone must run
`npm run seed:agents` before `npm run check:agents` and `gate:proofs`; this is
pre-existing and unchanged by the plan.

| Proof | Assertion |
|---|---|
| `scripts/prove-first-boot-seed.ts` | a fresh project contract holds 16 keys and the 8 base `.md` files, and the seeded files match a second `generateAgentMd` seed byte-for-byte (not the gitignored `.opencode/agents` directory); a pre-existing modified `dev.md` is left byte-identical; a temp `TAWASSUL_PROJECT_DIR` with `opencode.json` resolves `paths.agentsDir` under that directory, and without `opencode.json` the F6 seed predicate is false; the global seed still holds 8 |
| `scripts/prove-gen-lock-contention.ts` | the held anchor still refuses the CLI; a symlink alias produces the same `opencodeConfigLockName` and the CLI refuses while the alias lock is held; a missing parent still canonicalizes; a fresh CLI run writes exactly **16** (pin `count === 16` at `:56`, not `count > 0`); a stale no-pid lock is quarantined only after the 3 s grace, and a lock whose owner pid is alive is never removed; an `opencode.jsonc` shadow is refused |
| `scripts/prove-gen-merge-guards.ts` | an empty agent container yields 16; a config with a subset keeps only that subset; a non-object `agent` throws in `buildMergedAgents` and `checkGeneratedConfig` reports `agent must be an object`; `kick dev-ling` then two `buildExpectedConfig` runs both omit it; no `deleted-agents.json` copy; the retired-migration loop runs with the two-provider fixture so every retired slug is `absent`; a served-retired model with no pin is kept and `checkGeneratedConfig().ok === true`, including an unpinned `addagent` entry, plus its `unknown`-retired variant under a fixture that omits the provider |
| `scripts/prove-s028.ts` | the static census is gone; `analyst-fledge` is still rejected by compound-suffix governance without a cache; `analyst-ling` is allowed under an unknown provider; a real provider file that omits the exact ling slug rejects the add as `absent`; a fragment such as `pickle` is `absent` when only `big-pickle` is listed |
| `scripts/prove-s029.ts` | default `buildAgents()` includes `analyst-ling`; the dynamic guard test still refuses a deleted generated variant after `setDynamicDeletedAgents(["dev-ling"])`; a project `add` and `kick` with no config fail closed instead of reporting success |
| `scripts/prove-s036.ts` | the static `analyst-ling` census is gone; `src/security-policy.ts` contains no `DELETED_AGENTS` declaration; default generation keeps the variant |
| `scripts/prove-roster-boundary.ts` | a shrink-shaped edit of a populated `.opencode/deleted-agents.json` to `{"deleted":[]}` is no longer blocked; a `tawassul.jsonc` shrink to `{"deleted":[]}` remains blocked; the other roster-file cases are unchanged |
| `scripts/prove-usage-ledger.ts` | `.1` rotation stays and reload reads `.1` + current; a pre-existing `.1` is moved aside to a unique name before the current file rotates to `.1`; two ledger instances on one path both keep their batches |
| `scripts/prove-n2-cap.ts` | the awaited async `persist` keeps the 500/512/513 assertions |
| `scripts/prove-e02.ts` | the temp global `opencode.json` stays byte-identical (`:106-131`); `buildAgents(undefined, { projectRoot: repo })` (`:155`) returns the full-capacity 58 keys because no deletion list is applied (not a shipped default), and the permission-repair assertions still hold. Add a boot-repair pair under `TAWASSUL_MODELS_JSON`: with a fixture that lists `opencode` and `cloudflare-workers-ai` with empty `models` objects (so `opencode/mimo-v2.5-free` is `absent`, not `unknown`), a `dev` entry pinned to it gets `fixes` including `dynamic-models` and `dev.model` changes; with a fixture listing that slug, `fixes` excludes `dynamic-models` and `dev.model` stays. Restore the variable after the block |
| `scripts/prove-disclosure.ts` | unchanged: the silent-catch census stays exact. `utils/opencode-config.ts` stays 5 because the `canonicalAnchor` catch logs (`:69`); `infra/file-lock.ts` stays 23 because the async owner checks reuse `readOwner` and every new synchronous catch logs (`:31`); `services/keyring.ts` stays 2 because both existing silent catches are untouched; `scripts/gen-opencode-config.ts` stays 1 |

## 7. Order and gate

1. Commit 0 — **landed** as `db589b1` on 2026-11-11: the pre-existing
   `@truth provider` rule-gate work (`AGENTS.md`, `scripts/check-v2-rules.mjs`,
   `scripts/prove-rule-gate.ts`, and the one-line hunk at
   `src/core/model-registry.ts:10`). It passed `npm run check:rules`
   (613 files) and `npm run prove:rules` (36 assertions) before the commit.
   Commit A can now stage `model-registry.ts` whole.
2. Commit A: change 1 + change 2 (atomic), including the proof edits, the
   S-030 re-point, the S-053.10 text, the i18n key removal, and the docs
   updates. If Commit 0 landed, whole-file staging of `model-registry.ts` is
   safe; otherwise use hunk-level staging as in step 1.
3. Commit B: change 3, including the lock proof extension.
4. On a fresh clone, run `npm run seed:agents` first (section 6). Then run
   `npm run check:rules`, `npm run check:agents`, then `npm run verify`
   (this builds `dist/`), then `grep -R "DELETED_AGENTS" src scripts dist` and
   require no output, then `npm run gate:proofs` (or the four shards). The grep
   must include `dist/`: a stale `dist/global.js` can retain the 39 names until
   the rebuild.

## 8. Stated consequences

- A fresh project first run is 16, not 51. An existing project keeps exactly the
  generated variants it already has; nothing is added on upgrade and nothing is
  removed. The global boot seed creates 8 agents and no `.md`; the eight base
  files are written at the first enabled boot by `ensureDefaultAgentMds`
  (`AgentManager.ts:417-450`), so a `gen --scope global` run before any boot
  fails closed. `gen --scope global` computes 58 only when the native
  `agent/*.md` files exist and `roster.deleted` is empty. 58 is the generator's
  full capacity, not a shipped list.
- A generated variant named in `config.team` but absent from `config.agent` is
  treated as deleted: `getAgents()` applies the deletion filter
  (`AgentManager.ts:165`) before the `config.team` check (`:168`). This is a
  consequence of absence-based deletion; the plan does not change that order,
  and a base role or dynamic agent remains routable through its own branch.
- A stale `.opencode/deleted-agents.json` becomes inert. It is not deleted by
  the code, it is not read again, and the roster guard no longer blocks direct
  edits to it (`permission-guard.ts:106` is removed). It may be deleted manually.
  Its seven non-variant `*-muse` names were never generated and are no longer
  honoured; the provider decides a re-add.
- `DELETED_AGENTS` (39 names) is the user's own historical list, not a product
  default. Change 2 deletes it from `src/security-policy.ts`, removes every
  consumer, and ships no replacement list. After `npm run verify` rebuilds
  `dist/`, `grep -R "DELETED_AGENTS" src scripts dist` must return no code
  reference.
- Today the local `.md` files come from `npm run seed:agents`
  (`package.json:31`, `scripts/seed-agents.ts:20-49`) and `.opencode/` is
  gitignored (`.gitignore:1`). The plan moves missing-base seeding into the
  project boot (`ensureBaseAgentFiles`); it does not add a new native global
  `.md` writer on top of the existing `ensureDefaultAgentMds` boot write. The
  global installer keeps `~/.config/opencode/agent/*.md` and never creates them
  (`scripts/install-global.ts:1146-1152`). Under Decision A, a global install
  can create project `.opencode/agents/*.md` in the project directory F6
  resolves when that directory already has `opencode.json` through F6, but F6
  itself never writes `~/.config/opencode/agent/*.md`.
- Kicking a base role is impossible: `isProtected` covers all eight bases via
  `AGENTS_DEFAULT`, and `classifyRemove` returns `"protected"` before any config
  write. Only generated variants and `addagent`-created dynamic agents can be
  deleted durably. For a generated variant, absence from `config.agent` is the
  durable record; for a custom dynamic agent, absence is durable for generation,
  while the routing-guard refusal lasts only for the current process, exactly as
  today (kick never persisted customs: `agent-management.ts:1045-1052`).
  `kick @addagent` is not a removal at all: `readOpencodeJsonAgents` excludes
  `tawa` and `addagent` (`AgentManager.ts:188`), so `hasConfigAgent` is false and
  `classifyRemove` returns `"not-found"`.
- `kick` treats a generated variant that is absent from the config as already
  deleted, because absence is the record. It reports it as already deleted
  instead of writing a deletion entry.
- Under Decision A, a global install normalizes an existing config in the
  directory it resolves and creates the 8 base `.md` files there; it never
  creates a config.
- The generator and F6 target `opencode.json`, while the runtime authority is
  the active config (`.jsonc` first). A `.jsonc`-only project is read by
  `AgentManager` and the add/kick paths but is not regenerated by F6, and the
  CLI refuses to create `opencode.json` beside the JSONC. This split predates
  the plan and is recorded in 4.7 rather than changed.
- `gen --scope global` still requires the native `agent/*.md` files; the
  installer does not create them, and they appear at the first enabled boot
  through `ensureDefaultAgentMds` (`AgentManager.ts:417-450`). This plan does
  not change that.
- A generated variant can be re-added only when the provider list serves its
  exact model slug, or when no provider list is available (`unknown` warns and
  allows). A provider list that omits a catalog model rejects it; the provider
  is the source of truth.
- An `agent: {}` or missing `agent` block is treated as "no deletions yet" by
  `AgentManager`, so the boot window before the 16-key write cannot mark all 49
  variants deleted.
- Provider truth is a runtime predicate, not a second catalog: a model in the
  provider file is `served` even when `RETIRED_MODEL_IDS` lists it; a model the
  provider omits is `absent`; with no provider file the answer is `unknown`,
  which warns and keeps the model. `RETIRED_MODEL_IDS` remains only for fallback
  ordering and the global roster merge.
- With no readable models cache every slug is `unknown`: `addagent` warns and
  allows, and the retired-model sweep keeps the model. A fresh install therefore
  retires nothing; only the `RETIRED_MODEL_IDS` fallback ordering remains. A
  stale but parseable cache can answer `served` for a retired slug or `absent`
  for a genuinely served one: the cache is the provider's snapshot, not live
  truth. Both are boundaries of provider truth, not defects introduced here.
- A project `add` or `kick` with no `opencode.json`/`opencode.jsonc` now fails
  closed instead of reporting success without a config write. The plugin boot
  (`ensureMinimalProjectContract`) is the only creator of a first config.
- The permission-guard cleanup stops guarding the inert project sidecar and a
  `deleted` key in `opencode.json`, and keeps the direct-edit shrink guard for
  the global `roster.deleted` list by scoping the branch to
  `tawassul.json`/`tawassul.jsonc`. `kick` remains the only supported deletion
  path, and the global deletion authority is still `roster.deleted`.
- The usage ledger keeps exactly one readable backup: `.1` plus the current
  file. A pre-existing `.1` is moved to a unique name before rotation, so it is
  retained on disk but not re-read by `load`.
- `setSecret` fails closed when the keyring lock is busy; `getSecret` also takes
  the lock, so a read never observes the rename window as an empty file.

### 8.1 Change interactions

| Pair | Shared mechanism | Resolution in this plan |
|---|---|---|
| 1 ↔ 2 | first-run 16 and deletion-by-absence | the first-run branches return `firstRunAgentSet` before the additive filter, so a missing/empty `agent` becomes 16; an existing container is filtered by set relations, so a 16-, 30-, 51-, or 58-key project keeps its own set |
| 2 ↔ `.md` | add/kick and base seeding | project generated variants are config-only; `kick` removes a `.md` only when one exists; the eight bases are protected and are the only `.md` files a first-run project needs; a custom dynamic agent may add its own; a `.jsonc`-only project relies on `ensureDefaultAgentMds` in project scope, while under a global install no project writer exists and the gap is inert because both seeds target `opencode.json` (2.4) |
| 2 ↔ 3 | re-add after deletion | deletion is a missing config key; `validateAddInput` checks the provider: `served` allows, `absent` rejects, `unknown` warns and allows |
| 3 ↔ project gate | served-retired models | `buildMergedAgents` (including the gated `addagentStale`) keeps `served`/`unknown`; `checkGeneratedConfig` accepts `served`; `sweepRetiredModelPins` and boot repair trigger only on `absent`; the dead-model sweep uses the same predicate |
| 3 ↔ global lane | `RETIRED_MODEL_IDS` | the global roster merge and `checkGlobalRoster` keep the static list; `roster.deleted` is still the global deletion record; the provider-aware runtime predicates do not change the roster format. A served-retired model in a global roster is kept by the runtime sweep but still fails the static `checkGlobalRoster`, which is a stored-contract check; regenerating the roster is the repair. This asymmetry is intentional and disclosed. |
| A/B ↔ F6 | project `.md` seed | A seeds missing project base files when `opencode.json` exists; B skips that write; in project scope the boot seed writes its own eight; in global scope the global install keeps `agent/*.md` |

## 9. Corrections applied after the second review

| # | Correction |
|---|---|
| 1 | The agreed first install is **16**: the 8 base roles, `addagent`, and the 7 `-pickle` variants. The old code's 51 is the defect this plan replaces, not a first-install count. The global lane's 58 is not a first install and is not shipped; it is the arithmetic full set computed by `gen --scope global` only when native `agent/*.md` exist and `roster.deleted` is empty. This plan does not change that command. |
| 2 | The CLI project guard is a real project config, not the generated `tawa.md` marker: `refuseProjectTarget` refuses when neither `opencode.json` nor `opencode.jsonc` exists. `tawa.md` is first-run output, so requiring it makes the guard circular. Seeding runs after the config check. |
| 3 | The first-run set is the developer's chosen set for testing the addition: 16 = 8 bases + `addagent` + 7 `-pickle`. `ensureMinimalProjectContract` writes it for any project-scope boot without a config (`src/utils/opencode-config.ts:460-500`; called at `src/bootstrap/plugin-init.ts:676`), so it is not structurally an end-user default. It is the developer's default only because this tree is the single deployment (AGENTS.md ownership boundary). It is not a migration promise for arbitrary existing projects. The additive rule exists only so a deleted variant is not resurrected. |
| 4 | The first version of the addition was reviewed: v1's `buildExpectedConfig(undefined, opts)` reads the config unconditionally (`scripts/gen-opencode-config.ts:1030-1041`), and `buildAgents` applies its default deletion list (`:796-800`, default at `:799`), so v1 had no 16-key first run. The v2 plan keeps v1's requirement that a project config already exists, but replaces the 51-key emission with 16. |
| 5 | `canonicalAnchor` must walk up through missing ancestors; `realpath(dirname)` alone fails on the first global boot. The seed must `mkdir` before locking. |
| 6 | `AgentManager.deletedRoster` must treat `agent: {}` or a missing `agent` as an empty deletion set, or the boot window marks all 49 variants deleted for the TTL. |
| 7 | The project roster parse must use `readJsoncObject` / `stripJsoncComments`; plain `JSON.parse` fails on valid JSONC comments. |
| 8 | Global `agent/*.md` writes are outside the config lock; per-file last-writer-wins is documented as a boundary. |
| 9 | `validateAddInput` must call `modelAvailability` with the resolved model, not the raw alias. |
| 10 | A kept custom-model variant needs a pin; `addagent` already writes it through `computePinEntries` / `writeBaseRolePins`. |
| 11 | `prove-s029:95-110` depends entirely on `retired = unionDeletedVariants([])`; the whole block is removed, including the live-config assertion. |
| 12 | `prove-s028:94-98` passed only because the static census masked provider truth; the replacement first re-points `TAWASSUL_MODELS_JSON` to `provider.json` (the `:89-92` directory fixture would answer `unknown`), whose `opencode` provider omits the exact ling slug, so the add is `absent`; a fragment case (`pickle` when only `big-pickle` is listed) proves the exact-slug map. |
| 13 | `prove-s028:82` does **not** flip: `analyst-fledge` is rejected by compound-suffix governance when the missing cache cannot govern the custom suffix, not by the static list. The assertion stays and only its message changes; a separate `analyst-ling` case proves the unknown-provider allow. `prove-gen-merge-guards:51` drops the sidecar copy, and the hybrid 34-key config is preserved by the additive filter. |
| 14 | The S-030 parity anchor must move to `derivedExpectedCount`; `check-shared-parity` validates the exact line and marker, and `--check` also rejects a stale `docs/SHARED-PARITY.md`, so `--write` is required. |
| 15 | S-053.10 anchors `deletedPath` at `gen:58`; keep `deletedPath` (it also feeds `loadPinnedAgents`) so the parity anchor stays valid. |
| 16 | The earlier claim that "kicking a base removes it for the session" was false. `isProtected` (`agent-kick-helpers.ts:61-66`) returns true for every base because `AGENTS_DEFAULT` contains all eight (`context/constants.ts:20`); `classifyRemove` returns `"protected"`; the kick loop skips protected names (`agent-management.ts:1045-1061`); `removeAgentsFromConfig` only receives `result.removed` (`:1069-1074`). Base roles cannot be deleted, and `generatedVariantNames` excludes base names from the deletion universe. |
| 17 | The `file-lock.ts` fix is the minimum plus one mechanism: pid in the `session-manager` owner, owner-aware exit cleanup, release cleans bookkeeping/heartbeat on every exit, no-pid legacy locks reclaimed only after grace plus a re-read, and **quarantine-rename before delete** on all four removal paths. The helper receives the owner the caller observed and re-reads it immediately before the rename, aborting on a mismatch; together with the unique quarantine suffix this **narrows** the delete-after-decision window rather than closing it (the re-read and the rename are not one atomic compare-and-swap). A live pid is never reclaimed, and every new catch logs. |
| 18 | `writeDeletedAgentNames` and `unpersistDeletedAgents` must not become pure no-ops for the project: they still update `setDynamicDeletedAgents`/`pruneUserPreservedAgents` from the derived set, so the routing guard sees a re-add immediately. Only the file write is removed. |
| 19 | `validateDeletedList` no longer names `deleted-agents.json`, because the global roster is the only remaining input. |
| 20 | `prove-s036:56` flips to `!== undefined` so default generation is asserted positively and the `buildAgents` import stays used. |
| 21 | `checkGeneratedConfig` must return a diff for a present-but-invalid `agent` value; it cannot call `buildMergedAgents`, which now throws for that shape, and `runCheck` calls the checker without a catch. |
| 22 | `unpersistDeletedAgents` must update the in-memory set even when the derived set is unchanged: the add writes the config key before the call, so the `if (changed)` guard sees no change and would leave a stale `dynamicDeletedAgents` entry. |
| 23 | The CLI must refuse to synthesize `opencode.json` when `opencode.jsonc` exists beside it; a new `.json` would shadow the project's real config. The guard is project-only: the global lane writes `tawassul.jsonc` (legacy `tawassul.json`) and never `opencode.json[c]`. |
| 24 | `canonicalAnchor` and the three new lock sites must not add empty `catch {}` bodies; `prove-disclosure` pins `utils/opencode-config.ts` at 5 and the full inventory is exact. |
| 25 | No `file-lock` removal path may delete a lock whose owner has a live pid, including the expiry-missing branch; a missing `expires` file is not evidence of staleness. Every stale removal re-reads the owner, aborts on a change, then quarantines the directory with an atomic rename before deleting it. A lock created after the rename is never deleted; the re-read narrows, but does not close, the window before the rename (4.4.5). |
| 26 | The project `add` path (`agent-management.ts:737-743`) and `kick` path (`agent-kick-runtime.ts:96-102`) currently turn a missing config into a silent skip. Both now fail closed: add reports an error and sets `configWriteFailed`; kick throws before any state or `.md` removal. |
| 27 | Provider truth changes five runtime predicates: `buildMergedAgents:590-591`, `hooks-registration.ts:100`, the boot sweep `proxy-fallback-chains.ts:76/:79`, the boot-repair rewrite `opencode-config.ts:227/:233`, and the dead-model sweep `agent-management.ts:1085-1199`, all via `modelAvailability === "absent"`. `RETIRED_MODEL_IDS` stays for fallback ordering (`hooks-registration:125,147-148`; sweep chain filters) and for the global roster merge at `gen:135`. The earlier "do not touch the sweeps" instruction was wrong and is removed. |
| 28 | `modelAvailability` cannot reuse `getProviderModelTokens`: the cache stores full slugs plus `[-_.]` fragments, so a fragment can falsely answer `served`. The plan adds `exactByProvider` to the same cache object and proves a fragment is `absent`. |
| 29 | The permission guard drops the inert sidecar at `permission-guard.ts:106` and keeps the shrink branch (`:210-222`) and `extractDeletedNames` (`:15-26`), scoped to `tawassul.json`/`tawassul.jsonc`. This preserves the direct-edit shrink guard for global `roster.deleted`; removing the branch was a feature-for-feature trade under rule 5 and is not done. The `prove-roster-boundary` case uses a shrink-shaped sidecar payload so it proves the `:106` removal, and keeps a global-roster shrink case. |
| 30 | `pruneUserPreservedAgents` at `AgentManager.ts:359-360` is kept. Removing it would let a stale preserved set un-delete a just-removed agent, because `validateTaskRouting` (`security-policy.ts:436`) and `checkDeletedAgent` (`:454`) subtract `userPreservedAgents` after consulting the deletion sets. |
| 31 | `AgentManager.deletedRoster` keys its cache on `(mtimeMs, size)`, not mtime alone: add `_deletedRosterCacheSize` at `:46-48`, capture both from one `statSync` at `:315-320`, compare both at `:321-326`, store both at every cache-write site (`:332-335`, `:341-344`, `:350-352`, `:354`, `:361-363`), and reset it at `:407-409`. A coarse filesystem clock can repeat an mtime across two writes. |
| 32 | The usage-ledger rotation keeps exactly one readable backup (`.1` + current). If `.1` already exists it is moved to a unique name before the current file rotates to `.1`; `load` (`:352-353`) is not widened. The lock covers `stat`, both renames, and the append; a busy lock appends without rotating. |
| 33 | The keyring locks reads as well as writes. `getSecret` and `setSecret` share an unlocked read helper; the write goes through `atomicWriteFile` (temp `0600` + rename); `Object.hasOwn` and a string check replace `in`. The two existing silent catches (`keyring.ts:47`, `:90`) stay so `prove-disclosure` remains 2. |
| 34 | `ensureAgentModels` (`opencode-config.ts:304`) and the `rewriteDynamicAgentModels` step in `applyBootRepairs` (`:376-397`) are provider-aware, not static: `:227` tests `modelAvailability(modelId) === "absent"` and `:233` filters absent models from the replacement chain. `ensureAgentModels` needs no separate edit because it calls `rewriteDynamicAgentModels`; its only caller is `prove-backup-cap.ts:72`, which uses the `dynamic` sentinel and is unaffected. `applyBootRepairs` runs through `repairProjectConfigBoot` (`plugin-init.ts:663`) on every boot, so leaving it static would rewrite a served-retired model the merge kept. |
| 35 | F6 seeds base `.md` files only when the config exists: `checkGeneratedConfig` returns `{ ok: true, missing: true }` for an absent config (`gen:688-692`), so a config-less project is never seeded by F6. Seeding is needed only when `buildMergedAgents` would otherwise throw in `assertBaseRegistrySync` (`:415-429`, called at `:510`). |
| 36 | `prove-gen-merge-guards:18-42` needs `TAWASSUL_MODELS_JSON` set to `{"opencode":{"models":{}},"cloudflare-workers-ai":{"models":{}}}`. Without a models file every retired id is `unknown`, so the stale model is kept and the migration assertion fails; the fixture lists both providers and omits every retired slug so each is `absent`. |
| 37 | The global lane writes `tawassul.jsonc` (legacy `tawassul.json`), never `opencode.json[c]`; the JSONC shadow guard is project-only. The global boot seed is 8; the 58-key figure is a computed full set requiring native `agent/*.md`, not a shipped roster and not a first install. |
| 38 | Commit 0 is the pre-existing `@truth provider` rule-gate work: `AGENTS.md`, `scripts/check-v2-rules.mjs`, `scripts/prove-rule-gate.ts`, and the one-line hunk at `src/core/model-registry.ts:10`. It must land before Commit A if whole-file staging is used, because Commit A edits the same file. If the user does not authorise Commit 0, Commit A uses hunk-level staging: only its change-2 hunks in `model-registry.ts`, leaving the `@truth` line and the three gate files unstaged. The working tree still passes `check:rules`, and the commit does not contain the directive, so it is self-contained. |
| 39 | `firstRunAgentSet` may return directly: `buildAgents` already applies `grantRolePluginTools` (`gen:528`), the full `addagent` permission block (`:545-555`), `grantTawaPluginTools` (`:558`), and `applyPermissionRepairs` (`:559`), so the `buildMergedAgents` tail (`:659-667`) only repeats idempotent grants. Checked in this session: the 16 first-run entries from `buildAgents([])` are byte-identical to the same keys from `buildMergedAgents` on an empty container. An earlier draft wrongly claimed the early return would drop the `addagent` grants. |
| 40 | `readDeletedAgentNames` returns an empty set for a missing config, a missing `agent`, `agent: {}`, or a non-object `agent`, but a JSON parse failure propagates: `kick` fails closed at `agent-management.ts:1029-1033`. `AgentManager.deletedRoster` catches its own parse failure at `AgentManager.ts:348-352` and returns an empty set; other read errors fall to the outer catch at `:365-367`. Both catch bodies contain a `return`, so neither is a silent catch in the census; the file's three pinned silent catches are `:127`, `:140`, `:196`. |
| 41 | `DELETED_AGENTS` (39 names) is the user's own historical list, not a product default. Change 2 deletes it entirely and ships no replacement. Every consumer is removed: `security-policy.ts:114-156`, `:436`, `:454`; `gen:7/:288/:508/:744-763/:864`; `agent-add-helpers.ts:9/:197-199`; and the tests/parity entries in 3.4. A post-change `grep -R "DELETED_AGENTS" src scripts dist` must be empty after the build. |
| 42 | 58 is the generator's full arithmetic capacity, not a shipped list. The project first run is 16, the global boot seed is 8, and `gen --scope global` computes 58 only with native `agent/*.md` and an empty `roster.deleted`; without `.md`, `assertBaseRegistrySync` throws (`gen:415-429`, called at `:510`), and a missing `agent/` directory throws earlier in `readdirSync` (`:403`). 58 is never a first-install count. |
| 43 | `.md` asymmetry is intentional and now explicit: today local `.md` come from `npm run seed:agents`; the plan adds project-boot seeding for missing base files; `ensureDefaultAgentMds` writes the 8 base files on every enabled boot in both scopes (`AgentManager.ts:417-450`); the global installer only counts/keeps `~/.config/opencode/agent/*.md` and never creates them. Under Decision A, a global install may create project `.opencode/agents/*.md` in the project directory F6 resolves when that directory has `opencode.json`, but F6 never creates native global `.md`. |
| 44 | A missing base `.md` is thrown by `assertBaseRegistrySync` (`gen:415-429`, called from `buildAgents` at `:510`), not by `readFrontmatter`; a missing `agents/` directory throws in `collectBaseRegistry`'s `readdirSync` (`:403`). `readFrontmatter` (`:297-309`) throws only for malformed frontmatter. Every affected section is corrected. |
| 45 | `checkFSLock` has two stale-removal calls, `:382` (expired) and `:397` (expiry-missing); both must use the owner-aware quarantine helper. The full removal census is `acquireFSLock:271`, `:293`, `checkFSLock:382`, `:397`, `cleanExpiredFSLocks:529`, `:538`, `:541`, and `removeFSLockDir:415-459`. |
| 46 | `prove-disclosure.ts:31` pins `infra/file-lock.ts` at 23 silent catches and `:69` pins `utils/opencode-config.ts` at 5; the inventory spans `:14-75`. The earlier citation of `:69` for the file-lock pin was wrong. |
| 47 | The add path sets `failClosed` at `:702` (roster write) and `:837` (project config write); section 4.3 cites both. |
| 48 | The repository ships no `.opencode/agents/*.md`: `.opencode/` is gitignored (`.gitignore:1`), and the eight local files are `npm run seed:agents` output (`package.json:31`, `scripts/seed-agents.ts:20-49`). The byte-for-byte claim is against those local files, not shipped files. |
| 49 | `prove-first-boot-seed` compares the seeded files to a second `generateAgentMd` seed, not to the gitignored `.opencode/agents`, which a fresh clone lacks until `npm run seed:agents`; the proof stage therefore requires a seeded checkout (pre-existing). The byte-identity assertion holds on the `ensureMinimalProjectContract`/`ensureBaseAgentFiles` path; `ensureDefaultAgentMds` rewrites marker-less files at boot. |
| 50 | `prove-s028` messages at `:81` and `:87` no longer cite the static list: `:81` describes compound-suffix governance and `:87` the unknown-provider allow. Assertions unchanged. |
| 51 | The CLI check is the derived-count gate `count !== derivedExpectedCount(deleted)` (`gen:852-853`), not a literal 51 gate. |
| 52 | `checkDeletedAgent` spans `security-policy.ts:451-455`; keep the early preserved return at `:453` and reduce the `:454` expression to `return dynamicDeletedAgents.has(normalized);`. |
| 53 | F6 follows `inferProjectRoot()` (`gen:45-51`): `TAWASSUL_PROJECT_DIR`, the plugin-directory `opencode.json` heuristic, then `process.cwd()`. It is not `ctx.directory`; boot repair is (`plugin-init.ts:663`). F6 runs in **both scopes** (`:720-773`); only the two boot seeds are scope-gated (`:671-679`). In global scope F6 is the only `.md` seeder reachable before the project config is normalized, so Decision A can seed the project directory it resolves. Section 1's scope sentence names this as the only global-install filesystem side effect. When neither the env var nor the plugin-directory `opencode.json` exists, F6 targets `process.cwd()`, which can differ from `ctx.directory`; that fallback is pre-existing, and `prove-first-boot-seed` pins the env override, not the cwd branch. |
| 54 | Docs: update `docs/STATE-ROOT-DESIGN.md:103` (the sidecar is inert; project deletion is absence from `opencode.json`) and `docs/installation.md` (the F6 sentence); regenerate `docs/SHARED-PARITY.md` with `--write`. `docs/DECOUPLING.md` does not exist in this tree; the root `DECOUPLING.md:10-24` is updated instead, because it still says `deleted-agents.json` stays user state that the generator reads. |
| 55 | Remove the orphaned `addagentDeletedAgent` key from `src/i18n/en.json:29` and `src/i18n/ar.json:29`; `agent-add-helpers.ts:198` was its only caller. |
| 56 | Every empty exit of `AgentManager.deletedRoster` that represents a valid config writes the cache entry and resets the process set (`setDynamicDeletedAgents([])` / `pruneUserPreservedAgents([])`); the current early returns at `:331-335`, `:340-344`, and `:354` occur before the calls at `:359-360`. A parse failure is different: the inner catch (`:350-352`) writes the empty cache entry but deliberately does not reset the process set, and the outer catch (`:365-367`) returns empty for read errors without resetting either. The file is unreadable, so the in-memory deletions are kept for this process; across restarts the empty set forgets them, which is fail-open and why kick fails closed separately. |
| 57 | `prove-gen-lock-contention.ts:56` pins `count === 16`, not `count > 0`; it adds a missing-parent canonicalization case and a `.jsonc` shadow refusal. |
| 58 | `prove-s036` asserts `src/security-policy.ts` contains no `DELETED_AGENTS` declaration, so a partial removal that keeps the constant cannot pass. |
| 59 | S-053.10 text becomes "In global scope, deleted-agent names persist in `roster.deleted` and survive a seed; in project scope, absence from `config.agent` is the record." The note says the global generator reads `roster.deleted` and rejects malformed shapes; the project generator reads `config.agent` and writes no deletion list. Regenerate with `--write`. |
| 60 | The post-change grep runs after `npm run verify` (which rebuilds `dist/`) and includes `dist/`; a stale `dist/global.js` can retain the 39 names. |
| 61 | Consequence: with no readable models cache every slug is `unknown`, so a fresh install retires nothing and only `RETIRED_MODEL_IDS` fallback ordering remains; a stale parseable cache can answer `served` or `absent` incorrectly. Both are boundaries of provider truth. |
| 62 | The in-lock CLI gate also asserts the reverse direction: every generated variant key already present in `agent` is emitted or named in `opts.deleted`; otherwise `gen:642` drops it silently. |
| 63 | Only generated-variant deletion is durable through config absence; a custom dynamic agent's routing refusal is process-local, as today, because kick persists only generated variants (`agent-management.ts:1045-1052`). Section 8 no longer claims otherwise. |
| 64 | `prove-roster-boundary` uses a shrink-shaped sidecar write (`{"deleted":[]}` against a populated file) and keeps a `tawassul.jsonc` shrink case, proving both the `:106` removal and the retained global guard. |
| 65 | `prove-gen-merge-guards` adds a kicked-variant-stays-absent assertion across two `buildExpectedConfig` runs and the non-object `agent` throw/check pair. |
| 66 | `prove-s029` adds the fail-closed add/kick missing-config case. |
| 67 | Replacing the `tawa.md` marker with `opencode.json` in `refuseProjectTarget` (`gen:66-82`) is a weaker identity check: it proves an OpenCode project, not a Tawassul project. This is required for a first run and is bounded by the global-dir refusal, the JSONC-shadow refusal, the no-config refusal, and explicit `--project` invocation. Recorded in 4.7 as a boundary. |
| 68 | `prove-first-boot-seed` also asserts the F6 target: a temp `TAWASSUL_PROJECT_DIR` with `opencode.json` resolves `paths.agentsDir` under that directory, and without `opencode.json` the seed predicate is false. This pins `inferProjectRoot()` behavior without adding a proof file. |
| 69 | `ensureDefaultAgentMds` (`AgentManager.ts:417-450`, called from `src/services/lifecycle-controller.ts:53`) writes the 8 base `.md` on every enabled boot in both scopes, and rewrites a file lacking the responsibilities markers (`:435-441`). Section 2.4 lists it as a producer, and the uncovered `.md` state is narrowed to the pre-first-boot window. The global seed stays md-free: adding `ensureBaseAgentFiles` there would duplicate this boot write. |
| 70 | Anchor corrections: `prove-disclosure` inventory `:14-75`; `readFrontmatter` `:297-309`; `buildAgents` `:505-563`; `ensureMinimalProjectContract` `:460-500`; `gen:688-692` used consistently for the config-less early return. |
| 71 | The proof stage requires a seeded checkout: `prove-s029`/`prove-s036` call `buildAgents()` with no argument and `assertBaseRegistrySync` throws without the directory (`gen:403`, `:415-429`), while the two gen proofs copy from `.opencode/agents`. A fresh clone must run `npm run seed:agents` before `gate:proofs`; this is pre-existing and unchanged. The "absent in CI" wording is replaced in section 6 and correction 49. |
| 72 | `readProviderTokenCache` must map every provider key, including an empty `models` object: call `exactByProvider.set(...)` unconditionally beside `byProvider.set(...)` (`model-registry.ts:139`), or the empty two-provider fixture answers `unknown` instead of `absent`. Section 2.4 also names `refuseGlobalTarget` (`gen:94-102`) and states that `globalSpaceGuard` passes with `agent/tawa.md` or a roster while the generator still needs all eight native `.md`. Correction 53 now says F6 runs in both scopes. |
| 73 | Rejected after personal verification: the claim that the `served` branch is unreachable because `validateAddInput` returns early on a null `resolveModelAlias`. `resolveModelAlias` accepts any well-formed `provider/model` and returns it (`model-registry.ts:178-185`), so full provider slugs reach the provider check; only malformed or bare unknown names are rejected earlier, which is intended. No plan change. |
| 74 | Header HEAD updated to `db589b1` (the plan was written against `acc3c4e`). The `agent-templates.ts` anchor is split as `:3` for `ALL_AGENTS` and `:4` for `generateAgentMd`; the previous `:3-4` range was correct for "both" but less precise. |
| 75 | After `deadModels` is deleted, the two `chain.find(...)` predicates in each sweep filter become identical. The plan now requires one find, `!RETIRED_MODEL_IDS.has(m) && modelAvailability(m) !== "absent"`, falling back to `opencode/big-pickle`; this also stops a provider-absent model from being chosen as the replacement for an absent one. |
| 76 | Section 0.1 and section 1 now disclose that deleting `DELETED_AGENTS` also removes the 39 static names from the global routing predicate (`security-policy.ts:436`, `:454`). It is behaviorally inert (the names cannot exist as agents) and does not make the global install a delivery target. |
| 77 | Correction 56 notes that the `deletedRoster` parse-failure catch (`AgentManager.ts:365-367`) intentionally leaves the process set untouched. `lifecycle-controller.ts:53` is cited with its `src/services/` path. Section 2.4 lists `rollbackAdd` (`agent-management.ts:403-447`) as a behavior-unchanged `.md` producer. |
| 78 | The provider-truth merge can keep a served-retired model on a base role or a non-template variant, but `checkGeneratedConfig` accepted only `pureAgents[name].model` or a pin (`gen:729-734`), so `gen --check`/`gate:fast` would fail on the state the plan creates and F6 would re-check it every boot. `checkGeneratedConfig` now also accepts `modelAvailability(actual.model) === "served"`, project lane only (the global lane uses `checkGlobalRoster`). 2.2.7 and 2.3 step 5 carry it; `prove-gen-merge-guards` adds the served-retired case. |
| 79 | `sweepRetiredModelPins` (`proxy-fallback-chains.ts:73-86`, called at `plugin-init.ts:708`) was a fourth static predicate missed by correction 27; it would replace a served-retired model in `agentModelMap` while the config kept it. It now triggers on `modelAvailability === "absent"` and filters absent models from the replacement chain. `prove-s017` adds the absent and served fixtures. |
| 80 | `prove-s029:92-93` collapse to one assertion: after the static list is gone `buildAgents()` and `buildAgents([])` are identical. `checkGeneratedConfig` step 4 names the deleted-agents sidecar, because the pin read at `:708` stays. |
| 81 | A provider entry without a `models` object is skipped at `model-registry.ts:130` and answers `unknown`, not `absent`; recorded and pinned in `prove-s028`. `prove-e02:155` returns 30 keys today and 58 after Commit A; the proof asserts no count, so it is not a gate. F6's `process.cwd()` fallback can differ from `ctx.directory`; pre-existing, with the env override pinned and the cwd branch recorded. |
| 82 | Boot repair is the fifth provider-truth predicate, not a disclosed static boundary: `applyBootRepairs` runs at every boot (`plugin-init.ts:663`), so `rewriteDynamicAgentModels:227/:233` would rewrite a served-retired model that `buildMergedAgents` kept. `resolveAgentModelRef` (`model-refs.ts:17`) stays read-only because it feeds handoff metadata only; `prove-dispatch-model:66-67` pins that. `prove-e02` gains the served/absent pair. |
| 83 | The `.md` scope is explicit: the eight base files are the same `AGENTS_MD_DEFAULT` templates materialized per scope (`<project>/.opencode/agents` or `~/.config/opencode/agent`), not a project-specific agent set. A first-run project is eight `.md` files plus the seven `-pickle` variants and `addagent` as config-only entries; the global lane keeps its own eight base `.md` files (plus any variant `.md` that a global `addagent` writes) and roster. Decision A adds only the F6 seed for a project that already has `opencode.json`; the project boot seed writes its own eight independently. |
| 84 | `addagentStale` (`gen:600-605`) was a sixth static model predicate missed by correction 27. Making `retiredOverride` provider-aware would let it regenerate a served or `unknown` `addagent` model right after the merge kept it, because `mimo-v2.5-free` is in `RETIRED_MODEL_IDS` (`model-registry.ts:73`). It is now gated on `modelAvailability(existingCfg.model) === "absent"`; the project merge keeps a served model, and the absent path is already covered by `retiredOverride`. The global merge (`:135-154`) keeps both static predicates. `prove-gen-merge-guards` adds the served `addagent` case. |
| 85 | Section 1 and 0.1 no longer say the plan leaves "lock paths" unchanged: changes 1 and 2 leave the global lock model alone, but Change 3 canonicalizes lock names and locks the global seed. The 2.4 producer row now names F6 as an `ensureBaseAgentFiles` caller, and the scope rule says a global `addagent` variant may write its own `.md`; "eight base `.md`" is not "exactly eight `.md`". |
| 86 | 4.6 and 4.7 now record project and global `.md` writes (`ensureBaseAgentFiles`, `ensureDefaultAgentMds`, `addagent`, `kick`) as the same per-file atomic, last-writer-wins boundary; they stay outside `withConfigWriteLock` because they are per-agent metadata, not shared config or ledger state. |
| 87 | Section 8 now states that `kick @addagent` is not a removal at all: `readOpencodeJsonAgents` excludes `tawa` and `addagent` (`AgentManager.ts:188`), so `hasConfigAgent` is false and `classifyRemove` returns `"not-found"`. This supports the "only generated variants and dynamic agents are durable deletions" sentence. |
| 88 | The 3 ↔ global-lane row now states the global asymmetry: a served-retired model in a global roster is kept by the provider-aware runtime sweep but still fails the static `checkGlobalRoster`; the roster is a stored contract and must be regenerated. This is intentional, not a silent inconsistency. |
| 89 | The `.md` scope rule and the 2 ↔ `.md` row now state the `.jsonc`-only exception: `ensureMinimalProjectContract` returns at its existing-config check, and F6/CLI target `opencode.json` only, so in a project-scope install such a project gets base `.md` from `ensureDefaultAgentMds` at the first enabled boot, not from the seeds; in a global install no project writer exists, and the gap is inert because F6/CLI do not target it. Before that boot it is the same pre-boot gap as the global lane. |
| 90 | 3.2, 3.3 and correction 56 disagreed about the parse-failure path: 3.3 listed `:350-352` among the empty exits that reset the process set, while correction 56 said the parse failure does not reset and placed it on the outer catch. The inner catch at `:350-352` is the parse failure; it now writes the empty cache entry but does not reset, so a corrupt file cannot make previously deleted names routable in the current process (across restarts the empty set forgets them, the disclosed fail-open). The valid-empty early returns `:331-335`, `:340-344`, and `:354` reset; the outer catch `:365-367` covers read errors and does not reset. |
| 91 | 2.1 said generated variants and `addagent` stay available through their `opencode.json` key, contradicting the same section's statement that `readOpencodeJsonAgents` filters `addagent` out (`AgentManager.ts:122`, `:188`). `addagent` is a tool, not a routed tag; only generated variants are config-key-available without a `.md`. |
| 92 | 4.6 claimed the project-config lock is anchored at the project directory, but add/kick use `resolve(ctx.stateDir)` (`agent-management.ts:83`), boot repair and the boot seed use `resolve(ctx.directory)` (`plugin-init.ts:663`, `:676`), F6 uses `dirname(paths.configPath)` (`:735`), and the CLI uses its project directory. `canonicalAnchor` collapses textual aliases, not different anchors. 4.7 now discloses that they coincide only when `stateDir === ctx.directory === dirname(configPath)`; monorepo and F6 cwd-fallback cases keep distinct locks, and Change 3 does not re-anchor those pre-existing writers. |
| 93 | 4.4.5's quarantine rewrite could have removed the five silent catches in `removeStaleLock` (`file-lock.ts:216`, `:221`, `:226`, `:231`, `:236`), dropping the pinned `prove-disclosure` count from 23. The plan now says the per-file delete sequence is retained and applied to the quarantine directory. |
| 94 | Anchor drift: `rewriteDynamicAgentModels` ends at `opencode-config.ts:247`, not `:256`; S-053.10 spans `shared-parity.json:1362-1377`, not `:1362-1376`; the table now cites the full `checkFSLock:357-403` and `cleanExpiredFSLocks:503-548` bodies instead of sub-ranges that looked like declarations. |
| 95 | `checkGeneratedConfig` accepted only `served` or a pin, but the plan's merge keeps an unpinned retired model when the cache says `unknown` (`retiredOverride` is gated on `absent`, and `addagentStale` is the same). `addagent` is never pinned (`computePinEntries` keeps base roles and compound specs only), so `gen` wrote the kept model and then failed its own post-write verify; `--check` stayed red and F6 repeated the failure silently. The check now also accepts `RETIRED_MODEL_IDS.has(actual.model) && modelAvailability(actual.model) !== "absent"`. The `unknown`-retired `addagent` proof case is added; an unpinned non-retired `someone/else-1` still fails. |
| 96 | `checkGlobalRoster` spans `gen:171-200`, not `:171-190`; both citations (2.3 step 5 and 3.3) were corrected. |
| 97 | The second S-053.10 citation (3.4 table) still said `shared-parity.json:1362-1376` after correction 94; it now matches the object's `:1362-1377`. |
| 98 | The usage-ledger rotation template used `-${seq}` without defining `seq`; 4.5 now names it as a module counter, matching the file-lock quarantine template. |
| 99 | The 4.4.5 quarantine rewrite needs two imports that `file-lock.ts` does not have today: `rename` from `node:fs/promises` and `readFileSync` from `node:fs` (`file-lock.ts:2-3`). The plan now names both in the same hunk as the synchronous owner re-read and the rename. |
| 100 | `ensureBaseAgentFiles` writes only missing files, so `atomicWriteFile`'s default backup attempt hits ENOENT and unlinks its candidate; no `.bak` file is left. 2.2 now passes `{ backup: false }` to skip the attempt and match `seed:agents`, which writes missing files directly. |
| 101 | The `.jsonc`-only boundary in 4.7 now states that `gen --check` returns `{ ok: true, missing: true }` (it targets `opencode.json`) and the write path refuses the `.jsonc` shadow before `buildAgents`, so `assertBaseRegistrySync` is not reached; the only gap is the runtime pre-init window already recorded. |
| 102 | The F6 seed rationale at 2.2 assumed a project-scope init: F6 runs after `await tawaCtx.init()` (`plugin-init.ts:704`, `:720`), and in project scope `ensureDefaultAgentMds` (`lifecycle-controller.ts:53`) normally writes the eight base `.md` first, so the F6 seed is the fallback for a failed or partial init write. Under a global install `ensureDefaultAgentMds` writes `~/.config/opencode/agent`, not the project, so F6 is the only project seeder. The code is unchanged; the justification now states both scopes. |
| 103 | The `.jsonc`-only claim in 2.4, the 2 ↔ `.md` row, and correction 89 was only true in project scope. Under a global install `resolveAgentsDir` returns the global `agent/` directory, so `ensureDefaultAgentMds` never writes project base `.md`; the gap is inert because F6 and the CLI do not target a `.jsonc`-only project. The text is scoped accordingly. |
| 104 | The `deletedRoster` cache key omitted the source path. `resolveActiveConfigPath` can switch from `opencode.json` to a newly created `opencode.jsonc`, so a same-`(mtimeMs, size)` file could serve the previous file's deletion set. 3.3.2 now adds `_deletedRosterCachePath` and compares/stores it with the size at every cache-write site, resetting all three in `clearReadCache`. |
| 105 | The corrupted-contract state has no automatic repair: after a failed `buildExpectedConfig` the contract holds `agent: {}`, `ensureMinimalProjectContract` returns `exists` on later boots, and F6 keeps failing on the same input. 2.2 now states that recovery is manual (fix or remove the offending `.md`/config, re-run the seed and boot) and that `--check` is the signal. |
| 106 | The served acceptance is model-level, not name-level: it accepts any served model on an unpinned entry, matching the merge. 3.3.5 now says so explicitly, while keeping the non-retired `unknown` pin requirement and the retired-not-`absent` clause. |
| 107 | A generated variant named in `config.team` but absent from `config.agent` becomes unroutable: `getAgents()` applies the deletion filter (`AgentManager.ts:165`) before the `config.team` check (`:168`). Section 8 records this consequence; the order is unchanged, and base roles or dynamic agents still pass through their own branch. |
| 108 | Root `DECOUPLING.md:10-24` still says `deleted-agents.json` stays user state that the generator reads. The docs step and correction 54 now update it (sidecar inert, project deletion by absence) instead of only noting that `docs/DECOUPLING.md` does not exist. |
