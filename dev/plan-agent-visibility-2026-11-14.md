# Agent Visibility / List Rebuild Repair Plan (2026-11-14)

## Purpose

The agents were not deleted. What disappears is the constructed agent list during a
plugin re-initialization, a host location reload, or a failed roster read. This plan
lists every confirmed cause and the smallest change that removes it, without deleting
agents, without rewriting `opencode.json`, and without using `MODEL_CATALOG` as an
acceptance authority.

## Confirmed evidence

| Observation | Evidence |
|---|---|
| Cold list is incomplete | `AgentManager.getAgents()` returns 8 cold, 34 warm; 26 agents missing on cold |
| Generated variants have no `.md` | Project has 35 config keys and 11 agent `.md` files (8 base + 3 manual) |
| Silent read failure | A malformed `opencode.json` leaves the config list at 0 with no log |
| Host location changes the list | `GET /api/agent` returns 42 for the project location and 7 for `/home/htoz` |
| Host list source is unresolved | Whether the Desktop builds `agent.list` from `opencode.json` or from the plugin roster is not proven from this repository |
| Duplicate rows | `check()` shows 39 rows for 34 unique agents; 5 duplicates |
| Stale model map | 18 rows show `no model config`; `@analyst-mimo` shows an old model |
| Re-initialization churn | 10 plugin initializations in 9 hours, 3 within 4 seconds |
| No deletion occurred | `opencode.json` last modified 2026-11-11 21:34; `checkGeneratedConfig()` ok, 35/35; deleted set empty |

## Hard design constraints

1. `dynamicAgents` are dispatch-only and must stay bare. Never add `@` to a dynamic
   agent name. `@` is the composer mention namespace; converting a dynamic name to
   `@name` would offer it in the message-box suggestions, which is rejected.
2. No agent deletion, no roster rewrite, no state migration in this plan.
3. No `MODEL_CATALOG` lookup in acceptance or diagnostics truth. Provider truth remains
   the authority for generated agents; manual keys are accepted as authored. The
   existing `shouldWarnUnverifiedModel` warning may keep reading the catalog; this is
   not an acceptance path.
4. The Desktop UI is outside this repository. Host-location behavior is a host issue,
   not a plugin issue.
5. Minimum change only. Each item names its proof and acceptance test.
6. No new synchronous config read at init, in `getAgents()`, or on the routing hot
   path. The existing `statSync`/`readFileSync` calls in `deletedRoster()` and
   `readAgentMd()` stay; they are not the cold-8 cause.
7. Deletion trust is process-local. No sidecar, no persistence, no state migration. A
   restart on a wiped config is a recorded residual, not a new file.
8. A roster is complete when all seven base roles are present. Completeness never means
   "every generated variant is present", because a legitimately deleted variant is
   absent by design.
9. Roster and agent-file reads are confined to the current workspace
   (`<directory>/opencode.json[c]`, `<directory>/.opencode/agents`) and the global
   install (`<globalConfigDir>/tawassul.json[c]`, `<globalConfigDir>/agent`). No
   parent, sibling, or home scan exists. The only home read happens when home is
   itself the opened workspace, which the existing quiet-mode warning flags. The
   process-local trust report names only the active config path.

## Confirmed decisions (2026-11-14)

1. **Cold read: B.** Use an asynchronous roster prewarm awaited at the plugin setup
   boundary. Do not add a synchronous config read at init, in `getAgents()`, or on the
   routing hot path. Rationale: v1 proved that synchronous startup reads delay session
   opening; the async barrier avoids that while still closing the plugin-internal cold
   window.
2. **Manual keys: accepted as authored.** When `pureAgents[name] === undefined`, the
   generator check skips the model acceptance test (P2-6). Generated agents keep the
   template, pins, and provider checks.
3. **Dynamic agents in `check()`: shown once, bare, in a separate section.** Use a
   `dynamic (internal, not mentionable)` section. Never synthesize `@`. A dynamic name
   that is also a config key keeps its `@` row and does not get a bare duplicate.
4. **Stale state: report only.** No automatic prune; cleanup is an explicit command
   with a backup (P3-11).
5. **Host location: plugin warns; the list source is the Desktop host.** No plugin
   attempt to fix `agent.list(location)` (P1-3).
6. **P0-1 is plugin-internal correctness.** It fixes routing, `availableAgents`,
   `classify`, `check()`, and the mid-session window reopened by `clearReadCache()`.
   Whether the Desktop panel changes is a separate measurement (P1-6), not an
   acceptance gate inside P0-1.
7. **The deletion trust guard is process-local and per config path.** A module-level
   `Map<configPath, Set<string>>` records the last complete derivation. No persistence
   and no `deleted-agents.json`.
8. **Completeness is base-role presence.** All seven non-tawa base roles must be
   present. A missing variant is a deletion, not an incomplete roster.

## Review record (2026-11-14)

Six reviewers evaluated this plan in sequence, each receiving the findings of the
previous ones. All six returned **APPROVE WITH CHANGES**; no blocking item was refuted.

| Reviewer | Verdict |
|---|---|
| @analyst-mimo | APPROVE WITH CHANGES |
| @analyst-pickle | APPROVE WITH CHANGES |
| @analyst-gemini | APPROVE WITH CHANGES |
| @analyst-glm-5.3-flash-free | APPROVE WITH CHANGES |
| @analyst-deepseek | APPROVE WITH CHANGES |
| @analyst-minimax | APPROVE WITH CHANGES |

Consolidated blocking findings, all now folded into the items below:

1. **B:** P0-1 had no valid anchor (`createV2Setup` returns a dispose closure) and an
   acceptance that contradicted its own host caveat.
2. **C:** P1-5 named no allowed model source and risked `MODEL_CATALOG`.
3. **N1:** P1-4 and P1-5 ignored the second `check()` loop at
   `diagnostics.ts:295-308`.
4. **N2:** acceptance used environment-specific absolute counts (34 vs 42).
5. **N3:** a failed warm was indistinguishable from a successful one.
6. **N4:** the bounded wait was a race whose late landing was unobserved.
7. **NB:** `recordEmpty(true)` cleared the process deleted set outside the P2-8 guard,
   resurrecting kicked agents after an externally wiped config.
8. **NT:** the roster cache had no completeness guard, so a short list could pass a
   delta-0 assertion.
9. **NEW-1:** P1-5's `agentModels[agent]` lookup always missed because
   `getAgents()` yields `@name` while `agentModels` is bare-keyed; config-only
   variants had no configured-model source at all.
10. **NEW-2:** a post-mutation prewarm could await a warm that read the file before the
    write and keep a stale list for the cache TTL.

## v1 comparison (read-only reference at `/home/htoz/Desktop/tawassyl/`)

The v1 tree was read during planning to recover the intent behind each behavior, not to
port code. Its comments explain several design choices that v2 inherited or changed.
The six reviewers were denied access to the v1 tree by the `external_directory`
permission, so their v1 check is limited to the quoted comments in this section and the
v2 code shapes.

### What v1 solved deliberately

| Area | v1 intent (comment) | v1 mechanism |
|---|---|---|
| Init cost | The `AgentManager` constructor defers the full `_refreshCache` (N `.md` reads) to the first `getAgents()` call to avoid blocking the event loop during plugin init. The v1 boot-stall plan showed that blocking startup I/O delays session opening | lazy `.md` cache, async warm |
| Roster warm | Kick a lightweight `opencode.json` warm in the constructor "so the routing roster cache is populated by the time any routing/classify runs" | `_kickOpencodeWarm()` |
| Config-only variants | Generated variants in project scope are emitted into `opencode.json`; the config is their only surface. Writing a `.md` makes the host merge config + markdown into a duplicate/diverged agent | `skipVariantMd` |
| First boot | The minimal contract deliberately contains `agent: {}` (an empty container, not a roster) so `addagent`/`kick` can splice. Omitting the key makes every addagent refuse in a fresh project | `ensureMinimalProjectContract` |
| Check honesty | `--check` compares against the pure template, not the merged expected (which would be a tautology); a mismatch passes only with an explicit pins record; permission drift is compared exactly | `checkGeneratedConfig` |
| Deletion safety | Project deletions live in `.opencode/deleted-agents.json`; the roster read feeds the security-policy overlay so kicked agents are not routable | `deletedRoster()` |
| Malformed global roster | Missing file -> empty roster; malformed file -> hard error, "fail loudly, never silently resurrect" | `readTawassulRoster` |

### What v1 did not solve

1. **Cold list race.** v1's `readOpencodeJsonAgents` comment is explicit: "Cold start
   (project scope): no blocking sync read on the routing hot path (P1). Kick the
   async roster warm and return whatever is cached now (empty until the refresh
   lands - sub-ms)." The constructor comment says the warm should populate the cache
   before routing, but nothing awaits it before the host lists agents.
2. **Config-only variants plus the `.md` filter.** v1's `getAgents()` verifies a name
   through `opencode.json`, `dynamicAgents`, `team`, or a `.md` file. The same
   8-vs-34 shape would appear in v1 whenever the first list happens before the warm
   lands; the code path is identical.
3. **Silent read failures.** The project and global branches both catch and return
   `[]` with no log.
4. **Diagnostics duplication and `no model config` are also present in v1.** The
   config reader prefixes `@`, `dynamicAgents` stores bare names, and
   `agentModelMap` is populated only when an agent runs.
5. **The v1 "cold-boot" commits** (`591d7418`, `395d8cb4`) address DB/watcher/boot
   stalls, not the agent-list race. No v1 fix was missed.

### What v2 changed (interference)

| Area | v1 | v2 | Effect |
|---|---|---|---|
| Project deletion source | explicit `.opencode/deleted-agents.json` | absence from `config.agent` | v2-only risk: a partial config can mark live variants as deleted |
| Model acceptance | template or pins | template, pins, or provider availability | manual keys still fail, exactly as in v1; the provider layer does not change that |
| First boot | writes `agent: {}` and stops | writes `agent: {}`, then expands it; on expansion failure falls back to the container | new fallback path; the container itself remains required |
| API / lifecycle | v1 plugin init | v2 `Plugin.define`, supersede path, 10 inits in 9h | more re-init churn; measure before changing |
| Cold read | async warm, empty until it lands | same | inherited, not a v2 regression |

### Non-breakage constraints derived from v1

- Keep generated variants config-only in project scope; never add a `.md` for them.
- Keep `agent: {}` on first boot; it is the splice contract for addagent/kick.
- Keep the pure-template comparison for generated agents; a manual-key carve-out
  must not hide generated drift.
- Do not restore `deleted-agents.json`; v2's derivation is the current model, so
  guard it instead of replacing it. An in-memory per-path map is a guard, not a
  second source of truth.
- Do not convert `dynamicAgents` to `@name`; v1 also kept them bare for dispatch.

### v1 references used

- `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/context/managers/AgentManager.ts`
  (constructor, `readOpencodeJsonAgents`, `getAgents`, `deletedRoster`)
- `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/tools/agent-management.ts`
  (`skipVariantMd`)
- `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/utils/opencode-config.ts`
  (`ensureMinimalProjectContract`, `readTawassulRoster`)
- `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/scripts/gen-opencode-config.ts`
  (`checkGeneratedConfig`, `buildMergedAgents`)
- `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/tools/diagnostics.ts`
  (`agentModelMap`)
- `/home/htoz/Desktop/tawassyl/docs/BOOT-STALL-FIX-PLAN-2026-10-19.md`
  (home-as-project decision, startup-stall evidence)

## Plan items

### P0-1. Close the plugin-internal cold window with an async setup barrier (decision B)

**Location:** `src/context/managers/AgentManager.ts` (constructor line 64,
`_kickOpencodeWarm()` lines 73-82, `readOpencodeJsonAgents()` lines 118-128,
`getAgents()` lines 154-173, `clearReadCache()` lines 422-431);
`src/bootstrap/plugin-init.ts` (`getInitReady()` line 470, early returns at lines 523,
548, 588, 597); `src/v2/setup.ts` (`createV2Setup` lines 481-482, the `initPlugin` call
at line 513, the schema wait at line 585, the dispose return at line 846);
`src/plugin-types.ts` (symbol slot at lines 4 and 44).

**Problem:** On a cache miss the project branch starts an asynchronous warm and returns
`[]`. `getAgents()` then filters every agent without an `.md` file. Because generated
variants exist only as config keys, only the 8 base agents survive. The host can list
agents before the warm lands.

**v1 context:** v1 has the same race and chose it deliberately: it avoided a blocking
sync read on the routing hot path and returned an empty list until the async warm
landed. The constructor comment shows the opposite intent ("populated by the time any
routing/classify runs"), but nothing awaits the warm before the host lists agents.
This is an inherited gap, not a missing v1 fix. In addition, v1's boot-stall plan
proved that blocking startup I/O delays session opening (the 94.7 second stall
investigation). That proof is why this plan must not add a synchronous read at init or
on a cache miss.

**Decision:** B, confirmed on 2026-11-14. B means an asynchronous prewarm awaited at
the plugin setup boundary. No synchronous read is added to the constructor,
`getAgents()`, or the routing hot path.

**Minimum change (B):**

1. Add `AgentManager.prewarmRoster(): Promise<RosterPrewarmResult>` where the result is
   `{ populated: boolean; complete: boolean; elapsedMs: number }`. Store the in-flight
   warm promise (not only the `_opencodeWarmInFlight` boolean) and await it. If no warm
   is in flight, start one. Do not start a second read and do not clear the cache.
2. Add a monotonic roster generation counter. `clearReadCache()` increments it before
   kicking the warm. Every warm records the generation it started under. After a
   mutation, `prewarmRoster()` must await a warm that started at or after the current
   generation; if the in-flight warm predates the write, start a fresh read. This
   closes the stale pre-write list (NEW-2).
3. Expose the prewarm promise through a new symbol slot on the plugin object, for
   example `ROSTER_READY = Symbol.for("tawassul.v2.rosterReady")`. Do not reuse
   `INIT_READY`: `getInitReady()` returns `undefined` for stub and early-return paths,
   and `plugin-init.ts:588` returns before the context exists. The probe must skip
   cleanly when the slot is absent.
4. In `createV2Setup`, immediately after
   `const plugin = (deps.init ?? initPlugin)(input)` (line 513) and before the 750 ms
   schema wait (line 585), await the roster promise with a bounded wait. The hard bound
   is 2 seconds; the expected time is a few milliseconds. On timeout, incomplete data,
   or read failure, log one warning with the config path, elapsed time, `populated`, and
   `complete`, then continue. Never block the host indefinitely.
5. On timeout, attach a continuation to the warm promise that logs the late landing
   (actual elapsed, `populated`, `complete`). Do not cancel the read.
6. After addagent/kick, the tool awaits `prewarmRoster()` with the same bound before
   returning. This is an explicit user mutation, not startup and not routing.
7. Keep `_kickOpencodeWarm()` and the 25 second refresh timer. Keep the global branch
   unchanged.
8. Do not add a synchronous read to `getAgents()` or the routing hot path. The existing
   `statSync`/`readFileSync` calls in `deletedRoster()` and `readAgentMd()` stay; the
   plan adds no new synchronous read.

**Completeness (shared predicate, NT):**

- A roster is complete when `config.agent` is a plain object, non-empty, and contains
  all seven base roles (`ALL_AGENTS` minus `tawa`; `addagent` is not in `ALL_AGENTS`).
- Do not require every generated variant: a legitimately deleted variant is absent by
  design, because absence is the deletion encoding in project scope.
- Use the same predicate in three places: the roster cache
  (`readOpencodeJsonAgents`, so a truncated snapshot never replaces the last good one),
  the deletion derivation (P2-8/NB), and `prewarmRoster()`'s `complete` flag.
- Cache-side extra rule: if a snapshot keeps the seven bases but drops variant keys
  that are neither in the path-scoped deleted set nor absent from the last complete
  snapshot, treat it as truncated and keep the last good snapshot. This prevents a
  generate/rewrite window from producing a short list that still looks complete.
- An intentional first-boot `agent: {}` is an authoritative empty container, not a
  truncated snapshot. It does not trigger the malformed-config warning; its
  incompleteness is logged at debug until the expansion fills it.

**Why this is safe:** the barrier awaits the existing asynchronous file read; it does
not block the event loop. The bounded wait delays only the plugin setup by the roster
parse (normally a few milliseconds), not by the full init that caused the v1 boot
stall. No synchronous read is added anywhere.

**Trade-off:** the barrier adds the roster read time to the setup promise, not to the
event loop. The measurement must confirm that this stays in the low-millisecond range.
If it does not, the correct next step is a host-side readiness signal, not a
synchronous read.

**Host reframing:** P0-1 fixes the plugin-internal roster: routing, `availableAgents`,
`classify`, `check()`, and the mid-session window reopened by `clearReadCache()` after
addagent/kick. It does not prove the Desktop panel changes. If the host builds
`agent.list` from `opencode.json`, the panel count is unchanged. Whether the host waits
for setup and which source it lists is measured separately in P1-6. The host dependency
is not an acceptance gate inside P0-1, so P0-1 stays passable from this repository. Do
not switch to a synchronous read if the host ignores setup.

**Non-breakage:** config keys keep their existing `@name` shape, `dynamicAgents` stay
bare, no `.md` is created for a config-only variant, and the preservation overlay still
protects manual keys from kick.

**Proof:** Extend `scripts/prove-seed-agents.ts` with a cold-cache case:
- call `prewarmRoster()` before the first `getAgents()`;
- the first `getAgents()` includes a generated variant that exists only in the config;
- the first `getAgents()` includes a manual config key;
- the first `getAgents()` includes a base agent whose `.md` exists;
- `populated === true` and `complete === true`;
- the first list equals the post-warm list (fixture-relative, 0 missing);
- after the cold read, a manual config key is treated as user-preserved;
- after addagent/kick, the awaited prewarm leaves the next `getAgents()` complete;
- a kick during an in-flight warm yields a post-write list (NEW-2).

Add a fake host that awaits setup: a stub `V2Context` plus `deps.init` returning `{}`
without the roster symbol must resolve setup, skip the barrier, and not throw. Add a
slow-read case that asserts the bound logs once, the late landing is logged, and the
setup does not hang. Add a read counter that proves the barrier causes exactly one
config read and no second read. Add an event-loop yield assertion (a concurrent timer
fires during the wait). Add a partial-config case where `complete === false` and a
delta-0 assertion must not pass. The host-level cold probe is opt-in and manual, not
part of `gate:proofs`.

**Acceptance:** after the barrier, the first `getAgents()` equals the post-warm list
(fixture-relative, 0 missing), with `populated === true` and `complete === true`. A
config-only variant resolves through the route/available path, a manual key is present,
and an `.md` base is present. The barrier is bounded (hard bound 2 seconds, expected
low milliseconds), logs its elapsed time, and logs a late landing when it times out.
Exactly one config read occurs; no new synchronous read is added. The host measurement
is recorded separately in P1-6; if the host lists before setup resolves, record the
host dependency and stop.

---

### P0-2. Make read failures observable and non-destructive

**Location:** `AgentManager.ts`, project catch at line 198; global catch at line 129;
cache write at lines 122-128.

**Problem:** Read and parse errors are swallowed. A transient failure becomes a long
disappearance because the refresh timer also fails silently and the cache stays empty.
Because a config without an `agent` key leaves the cache null, every `getAgents()` call
re-kicks a read (the read storm).

**v1 context:** v1 has the same silent `catch` in both branches, so this is inherited.
The improvement here is observability and a last-known-good list, not the repair of a
v2 regression.

**Minimum change:** Log one explicit line with the path and reason (warn for a
malformed file, debug for a missing file). If a previous cache exists, return it
instead of `[]`. Do not replace a valid cache with an empty result on a read error.
Distinguish an authoritatively empty config (a missing or non-object `agent` key) from
an unreadable or malformed file, and cache the authoritative empty result so the read
storm stops.

**Proof:** Same proof file: after a successful read, corrupt the config and call
`clearReadCache()`; `getAgents()` must not throw and must still expose `.md`-backed
agents. A config with no `agent` key must cache an empty result and not re-read on
every call.

**Acceptance:** a malformed config produces one explicit log line and never silently
empties the config list; `.md`-backed agents remain visible; no read storm on an
authoritatively empty config.

---

### P1-3. Host location warning (out of repository)

**Location:** Desktop host `agent.list(location)`; no plugin source in this repository.

**Problem:** The project location returns 42 agents; `/home/htoz` returns 7 built-ins.
The UI keeps no local list and renders whatever the current location returns. The home
location also receives 115 `agent.updated` and 119 `config.updated` events.

**v1 context:** v1's boot-stall plan already treated home-as-project as a host
location problem and did not fix `agent.list(location)` inside the plugin. The plugin
can only warn; the list source belongs to the Desktop host.

**Minimum change:** No plugin behavior change. Add or extend a one-time warning in
`src/bootstrap/plugin-init.ts` for `home-as-project` that prints the resolved config
path and the available agent count. Any fix to `agent.list(location)` must be made in
the Desktop host.

**Acceptance:** opening the home directory logs a clear warning and does not mix the
global roster into project scope.

---

### P1-6. Measure host readiness and list source (out of repository)

**Location:** Desktop host; no plugin source in this repository.

**Problem:** P0-1 closes the plugin-internal window, but it cannot prove that the
Desktop waits for setup before `agent.list`, nor that the panel uses the plugin roster
rather than `opencode.json`. The cold 8-vs-34 evidence suggests the host may list
before setup resolves; the 42-vs-7 evidence suggests the panel may be config-derived.

**v1 context:** v1's boot-stall plan treated home-as-project as a host location issue.
No v1 fix awaits setup before listing agents.

**Minimum change:** No plugin behavior change. Record, from a real cold start:
- whether the setup promise resolves before the first `agent.list`;
- whether the list is built from `opencode.json` or from the plugin roster;
- the first `agent.list` count, the panel count, and the barrier elapsed time;
- the number of `agent.updated` and `config.updated` events at the home location.

**Acceptance:** the measurement is recorded with timestamps and counts. If the host
lists before setup resolves, the fix belongs to the host; do not add a synchronous read
fallback. If the panel is config-derived, record that P0-1 is plugin-internal only.

---

### P1-4. Remove duplicate diagnostic rows without promoting dynamic agents

**Location:** `src/tools/diagnostics.ts`, `check()` main loop at lines 247-254 and the
recommendation loop at lines 295-308; agent name utilities in
`src/utils/name-utils.ts`.

**Problem:** `dynamicAgents` stores bare names while the config roster is read as
`@name`. `getAgents()` removes exact duplicates only, so `analyst-mimo` and
`@analyst-mimo` are both rendered. The second loop at lines 295-308 re-iterates the
raw list and emits a `checkNoModel` row plus a duplicate for every agent without a
configured model, so a dedupe of the main loop alone cannot reach "0 duplicates". This
is a diagnostics duplication, not a second agent and not a deletion.

**v1 context:** v1 has the same shape: its config reader maps keys to `@name`, and
`dynamicAgents` stores bare tags. This is inherited, not a v2 regression.

**Minimum change:** Deduplicate and separate at the diagnostics boundary only. Do not
change `getAgents()`, `readOpencodeJsonAgents()`, `dynamicAgents`, or persisted state
in this item. Add a small pure helper, for example
`dedupeAgentRows(agents, dynamicAgents, configKeys)`, returning two lists:
- `mentionable`: unique names that are present in the config or in another roster
  source;
- `dynamicOnly`: unique dynamic names whose normalized name is absent from
  `config.agent` and from every other roster source.

Rules:
- key by `normalizeName(agent)`;
- keep the first occurrence;
- if a dynamic name is also a config key, keep the `@` row and do not add a bare
  duplicate; it is host-mentionable;
- use the bare form only for a truly config-absent dynamic name;
- never synthesize `@` for any name.

`check()` renders `mentionable` as today, then a separate
`dynamic (internal, not mentionable)` section for `dynamicOnly`, one bare row each.
Route both the main loop (247-254) and the recommendation loop (295-308) through the
same two lists. Normalize the lookups used by `check()` (config, ratings, errors, model
map) so the bare row still resolves to the same data.

**Why not normalize `dynamicAgents` to `@name`:** that would put runtime agents into the
composer mention namespace. Rejected by product requirement.

**Why not change `getAgents()` representation:** it feeds routing and
`availableAgents`; changing the representation risks both dispatch and suggestion
behavior. This item is display-only. `report()` at `diagnostics.ts:119` also iterates
the raw list; it is deliberately out of scope here and keeps its current behavior, so
the minimum change stays confined to `check()`.

**Proof:** Extend an existing proof with the pure helper:
- case A, `analyst-mimo` is a config key: input
  `["@analyst-mimo", "analyst-mimo", "@dev"]`, dynamic `["analyst-mimo"]` ->
  `mentionable` is `["@analyst-mimo", "@dev"]`, `dynamicOnly` is `[]`;
- case B, `analyst-mimo` is absent from the config: input
  `["@dev", "analyst-mimo"]`, dynamic `["analyst-mimo"]` ->
  `mentionable` is `["@dev"]`, `dynamicOnly` is `["analyst-mimo"]`;
- no `@analyst-mimo` is synthesized in case B.

**Acceptance:** `check()` rows equal unique agents (fixture-relative), 0 duplicates,
config-key dynamic names keep their `@` row, dynamic-only names are bare, and composer
suggestions are unchanged. Both diagnostic loops are covered.

---

### P1-5. Report model state truthfully

**Location:** `src/tools/diagnostics.ts`, lines 247-278 and 295-308;
`src/context/managers/AgentManager.ts`, `readOpencodeJsonAgents()` lines 118-128 (must
retain the per-key model); `src/config/ConfigManager.ts` lines 55-118;
`src/core/model-registry.ts` lines 181-190.

**Problem:** `agentModelMap` is populated only when an agent runs, so 18 agents show
`no model config` even though they have a model. In addition, `getAgents()` yields
`@name` while `agentModels` is authored with bare keys, so
`ctx.config.agentModels[agent]` at line 248 always misses. `agentModels` is populated
only from `tassul.json`, never from `opencode.json`, so a config-only variant whose
model lives in `opencode.json` `agent[name].model` has no configured-model source at
all. Stale entries such as `@analyst-mimo -> google/gemini-flash-lite-latest` are
displayed as if current.

**v1 context:** v1 also reports `no model config`, because its `agentModelMap` is
runtime-only in the same way, and its config reader also prefixes `@`. This is
inherited; the normalized lookup and the `opencode.json` source are the v2 repair.

**Minimum change:** Separate `configured` from `last used`, and name every source:
- **configured, first source:** `opencode.json` `agent[name].model`. The roster cache
  must retain the per-key model, not only the name.
- **configured, second source:** `ctx.config.agentModels[normalizeName(agent)]?.models`
  (populated from `tassul.json`, bare keys). Try the bare name and the `@` form.
- **availability:** `modelAvailability()` (provider truth, `model-registry.ts:181-190`).
  It returns `unknown` when no provider cache exists; do not label a value stale on
  `unknown`.
- **last used:** `agentModelMap`, labeled `last used`.
- Label `last used (stale)` only when availability proves the model absent. Never
  present a stale value as current.
- Label `not yet observed` only when no configured source and no map entry exist.
- The new labels need keys in both `src/i18n/en.json` and `src/i18n/ar.json`; only
  `checkNoModel` exists today.

Do not delete map entries in this item. Do not change runtime model selection. Do not
consult `MODEL_CATALOG` as an acceptance source; `shouldWarnUnverifiedModel` keeps its
existing warning behavior.

**Proof:** A small diagnostics fixture or a pure formatting helper test:
- agent with `opencode.json` `agent[name].model` and no map entry -> `configured`, not
  `no model config`;
- agent with a `tassul.json` `agentModels` entry and no map entry -> `configured` via
  the normalized lookup;
- agent with a stale map entry and proven-absent availability -> `last used (stale)`;
- agent with a map entry and `unknown` availability -> `last used`, not stale;
- agent with no config and no map entry -> `not yet observed`;
- config-only variant -> its `opencode.json` model is reported as `configured`, not
  `not yet observed`.

**Acceptance:** `check()` no longer reports `no model config` for a configured agent,
both loops use the same source resolution, no stale value is presented as current, and
i18n keys exist in both language files.

---

### P2-6. Accept manual config keys in the generator check

**Location:** `src/scripts/gen-opencode-config.ts`, `checkGeneratedConfig()` lines
696-775; `pureAgents` built at line 727; lookup at line 748.

**Problem:** `buildMergedAgents` accepts a manual key, but the check compares its model
against `pureAgents` (generated templates), the pins sidecar, and provider
availability. A manual key has none of these, so the check fails and F6 rewrites the
config on every boot.

**v1 context:** v1's `checkGeneratedConfig` also compares against `pureAgents` and
accepts a mismatch only with a pins record; a manual key failed there too. v2 inherited
that comparison and added provider availability as a third path. The manual-key
rejection is therefore inherited, not a v2 regression; v2's config-only variant
surface makes manual keys more likely, which is why the failure is visible now.

**Minimum change:** When `pureAgents[name] === undefined`, the key is not generated:
skip the model acceptance check and accept the model as authored. Keep mode and
permission checks. Keep the existing model checks for generated variants and base
agents. Do not consult `MODEL_CATALOG`.

**Generated-name guard:** if a key matches the generated name shape (a base role plus a
known variant suffix) but is absent from `pureAgents`, do not silently treat it as
manual. Report it by name and fail the check, so a generated name missing from the
catalog is visible rather than hiding drift.

**Decision:** confirmed on 2026-11-14. Manual keys are accepted as authored; generated
agents keep the strict checks.

**Boundary (n1):** `rewriteDynamicAgentModels` still rewrites manual keys on boot
(`opencode-config.ts:207`). That is out of P2-6's scope; F6 churn stops only when
`--check` is the gate. State this in the change description.

**Non-breakage:** `buildMergedAgents` already preserves manual keys, so the carve-out
only stops `--check` from rejecting a key the generator itself keeps. Generated
variants and base agents keep the template, pins, and provider checks, so drift is
still caught.

**Proof:** Extend `scripts/prove-gen-merge-guards.ts`:
- manual `my-helper` with an arbitrary model and no pins passes;
- generated `dev-gemini` with a drifted model and no pin still fails;
- generated base `dev` with a drifted model still fails;
- a generated-shaped key absent from `pureAgents` is reported by name, not accepted as
  manual;
- the failure message still names pins and provider availability.

**Acceptance:** `--check` passes for manual keys and F6 stops rewriting the config on
every boot; generated drift (variant and base) still fails; the generated-name guard is
observable.

---

### P2-7. Preserve the intentional empty container on first boot

**Location:** `src/utils/opencode-config.ts`, `ensureMinimalProjectContract()` lines
496-551; expansion-failure warning at lines 537-540; success-path warning at line 543.

**v1 context:** v1 writes `agent: {}` on purpose. Its comment says addagent/kick splice
fail-closed on an existing contract without a usable `agent` object, so omitting the
key would make every addagent refuse in exactly the fresh projects this generator
serves. v2 keeps that base doc and adds a `buildExpectedConfig` expansion; on failure
it logs a warning and writes the container. The container is not the bug.

**Problem:** the v2-only fallback can leave a project with an empty roster after a
failed expansion, and the warning is easy to miss. Removing the container, however,
would break the v1 splice contract.

**Minimum change:** keep `agent: {}` in the base doc. Keep writing it on expansion
failure so addagent/kick still have a contract. Make the failure observable: one
explicit `logger.warn` with the config path and reason. The current failure warning at
lines 537-540 names only the error; the path appears only in the success warning at
line 543. Add the path to the failure warning. Do not add a "never persist `agent: {}`"
rule.

**Proof:** Extend `scripts/prove-first-boot-seed.ts`: force the expansion failure and
assert the file contains a usable `agent` object (empty is allowed), the warning
contains the config path, and a subsequent addagent can splice without refusing.

**Acceptance:** a failed first-run expansion leaves a usable contract and one clear
warning that names the path; addagent/kick still work in a fresh project; no new rule
forbids the intentional container.

---

### P2-8. Trust only a complete roster when deriving deletions

**Location:** `AgentManager.ts`, `deletedRoster()` lines 311-386; `recordEmpty()` and
`resetProcessSet` at lines 343-347; branches at lines 351-368; cache write at lines
122-128.

**Problem:** In project scope, every generated variant absent from `config.agent` is
treated as deleted. A partial or half-written config therefore poisons
`setDynamicDeletedAgents` and blocks routing for agents that were never deleted.
Separately, `recordEmpty(true)` unconditionally clears the process deleted set at lines
343-347 whenever the `agent` key is absent or empty (lines 352, 356, 365, 366, 368).
Only the malformed branch at line 362 is guarded. An externally wiped config therefore
resurrects previously kicked agents in routing, bypassing the guard exactly where it is
needed. `pruneUserPreservedAgents([])` at line 345 is a no-op (it loops over the
argument), so the bypass is the deleted set only.

**v1 context:** v1 project deletions are explicit in `.opencode/deleted-agents.json`;
a missing file means no deletions, and a malformed file fails soft. v2 replaced that
with absence from `config.agent`, so a partial config is a new failure mode. This
guard is a v2-specific hardening, not a restoration of v1 behavior.

**Minimum change:** Derive deletions only when the config is generator-complete: all
seven non-tawa base roles must be present (`ALL_AGENTS` minus `tawa`; `addagent` is not
in `ALL_AGENTS`). Apply the guard to the **project branch only**; do not touch the
global `roster.deleted` branch at lines 351-354.

1. Add a module-level `Map<configPath, Set<string>>` recording the last complete
   derivation per config path. The map survives re-initialization in the same process
   and isolates workspaces from each other.
2. On an incomplete config: do not update the process deletion sets; return the last
   trusted set for this path if one exists, otherwise an empty set. Log the refusal
   once at `warn` level with the path and the missing bases.
3. On a complete config: derive deletions exactly as today and record the complete set
   for the path.
4. Gate `recordEmpty(true)`: refuse the reset only when this path previously produced a
   complete derivation; otherwise reset. First boot has no prior complete derivation,
   so it still resets to empty and `agent: {}` behaves as decision 5 requires. A
   kick-all leaves the config at `agent: {}`; the guard refuses the reset, so the
   kicked variants stay blocked.
5. No persistence and no `deleted-agents.json`. The guard is in-memory by design. A
   process restart on a wiped config resurrects kicked agents until the next complete
   read; that residual is reported in P3-11, not fixed with a sidecar.

**Trade-off:** a genuine deletion made while the config is partial is deferred until a
complete config is read. This is intentional: a partial config cannot distinguish a
deletion from a write in progress.

**Non-breakage:** do not restore the sidecar; do not change the complete-config
derivation. The guard only refuses to update the process deletion sets when the config
is not generator-complete, so a genuine deletion in a complete config is still derived
exactly as today.

**Proof:** In `scripts/prove-seed-agents.ts` or `scripts/prove-s029.ts`:
- a fresh manager with a partial config (only `dev`) keeps a materialized variant
  visible and does not add it to the deleted set;
- a complete config with one intentionally absent variant still derives it as deleted;
- after a complete derivation, wiping the config to `agent: {}` does not clear the
  deleted set;
- a different config path does not inherit the first path's guard;
- kick-all leaves the kicked variants in the deleted set and they stay unroutable;
- the refusal logs once with the path.

**Acceptance:** a partial config never adds agents to the deleted set; a complete
config still derives genuine deletions; a wiped config does not resurrect kicked
agents; no cross-path leakage; no `deleted-agents.json`; exactly one warning per
refusal.

---

### P2-9. Read a malformed global roster safely

**Location:** `AgentManager.ts`, global branch of `readOpencodeJsonAgents()`; reader in
`src/utils/opencode-config.ts`, `readTawassulRoster()` line 604.

**Problem:** `readTawassulRoster` throws on malformed JSONC. The outer catch returns
`[]`, so every global agent disappears without a log.

**v1 context:** v1's reader also hard-errors on malformed JSONC ("fail loudly, never
silently resurrect"), but v1's `AgentManager` catch still returned an empty list
silently. The disappearance is inherited; the fix must preserve the hard-error
semantics while making the failure observable.

**Minimum change:** Catch inside the global branch, log the path and reason, and return
the last known good cache. Do not replace it with an empty list on a parse error, do
not treat a malformed roster as an empty roster (that would resurrect deleted agents),
and do not reset `userPreservedAgents` on failure.

**Proof:** Read a valid global roster, corrupt the file, clear the cache, and assert
`getAgents()` still returns the last known list, does not throw, and leaves
`userPreservedAgents` unchanged.

**Acceptance:** a malformed global roster is observable, does not wipe the list, and
does not reset the preservation set.

---

### P2-10. Verify one manager and one refresh timer per host

**Location:** `src/bootstrap/plugin-init.ts` supersede path (lines 526-535, 705-708);
`disposeInstance` (lines 1073-1112); `AgentManager.stopRefresh()`.

**Problem:** 10 initializations in 9 hours, including 3 in 4 seconds. The supersede
path exists with an 8 second bound, but the effect on timers and cold windows is not
measured.

**v1 context:** v1 also creates the 25 second refresh timer and the constructor warm.
v2 adds the `Plugin.define` lifecycle and the supersede path, so re-init churn is the
v2-specific part. Measure before changing anything.

**Minimum change:** Verification first, no code change until a leak is proven. Use
`health()` and the init log to count active managers and timers across repeated
initializations. Record the per-init barrier time in the same log so this item can
correlate. If a leak is proven, stop the previous manager before creating the new one
or reuse the existing manager.

**Acceptance:** repeated initialization leaves one manager and one refresh timer per
host; the number of cold windows does not grow with initialization count; per-init
barrier times are recorded.

---

### P3-11. Report stale state without deleting it

**Location:** `src/services/state-loader-facade.ts`, `src/services/state-persistence.ts`,
`AgentManager.dynamicAgents`, `ModelManager.agentModelMap`.

**Problem:** 5 dynamic entries and 14 stale model-map keys exist. They are harmless at
runtime but produce misleading diagnostics.

**v1 context:** v1 persisted the same runtime maps and did not prune them
automatically. Reporting is the v1-compatible minimum; automatic cleanup would be a
new destructive behavior.

**Minimum change:** Report only. Add counts to `check()`:
- dynamic agents that are not in any roster source;
- model-map keys that are not in the current agent list;
- the process-local deletion guard state: which config paths have a complete
  derivation and which are holding a last trusted set;
- the restart residual: a wiped config after a process restart can resurrect kicked
  agents until the next complete read.

Do not delete agents, do not prune the map automatically, and do not rewrite state in
this plan. Any cleanup is a separate explicit operation with a backup.

**Decision:** confirmed on 2026-11-14. Report only; no automatic prune.

**Acceptance:** the report names the stale counts and the guard state; runtime state is
unchanged.

## Implementation order

1. P0-1 + P0-2 (async setup barrier, prewarm contract, generation counter, shared
   completeness, last-known-good read). Measure the setup delay, the first list, and
   the read count; do not add sync reads.
2. P2-8 (per-path trust guard and the `recordEmpty` gate; same config read).
3. P2-9 (global read safety; same observability rule).
4. P1-4 + P1-5 (both diagnostic loops, dedupe, named model sources, normalized lookup,
   i18n keys).
5. P2-6 (manual-key carve-out, generated-name guard, stops F6 churn).
6. P2-7 (container preserved, failure warning names the path).
7. P2-10 (measurement only).
8. P3-11 (report only).
9. P1-3 + P1-6 (host-side warning and measurement, outside this repository).

## Proof plan

| Item | Proof file | Assertion |
|---|---|---|
| P0-1 | `scripts/prove-seed-agents.ts` | `prewarmRoster()` + setup barrier make the first list equal the post-warm list (fixture-relative, 0 missing); `populated` and `complete` are true; one read; no new sync read; event loop yields; timeout is bounded and the late landing is logged; stub host skips cleanly; partial config reports `complete: false` and delta-0 does not pass; kick during a warm yields a post-write list |
| P0-2 | `scripts/prove-seed-agents.ts` | malformed config logs once and keeps the last good list; an authoritatively empty config caches and does not re-read every call |
| P1-4 | `scripts/prove-seed-agents.ts` or a small name-util proof | config-key dynamic names keep one `@` row; config-absent dynamics appear once, bare; no `@` is synthesized; both diagnostic loops are covered |
| P1-5 | diagnostics helper proof | `opencode.json` model and `tassul.json` model are `configured`; normalized lookup works; stale only when availability proves absence; `unknown` is not stale; `not yet observed` is reserved; i18n keys exist in both files |
| P2-6 | `scripts/prove-gen-merge-guards.ts` | manual key passes without pins; drifted generated variant and drifted base still fail; a generated-shaped key missing from `pureAgents` is named |
| P2-7 | `scripts/prove-first-boot-seed.ts` | failed expansion keeps a usable container, the warning contains the path, and addagent still splices |
| P2-8 | `scripts/prove-seed-agents.ts` or `scripts/prove-s029.ts` | partial config does not poison the deleted set; complete config derives deletions; wiped config does not resurrect kicked agents; no cross-path leakage; kick-all survives; one warning per refusal |
| P2-9 | `scripts/prove-seed-agents.ts` | malformed global roster keeps the last known list, does not throw, and does not reset `userPreservedAgents` |
| P1-6 | manual host probe | first `agent.list` timing, list source, panel count, and event counts are recorded; not part of `gate:proofs` |

No new proof file is required if the existing files above can carry the assertions.
If a new file is added, update `scripts/gate-manifest.json`, `scripts/proof-shards.json`,
and `scripts/prove-proof-catalog.ts`, then run `npm run proof-count`. The expected
proof count remains 183.

## Acceptance criteria

- After P0-1's barrier, the first `getAgents()` equals the post-warm list
  (fixture-relative, 0 missing), with `populated === true` and `complete === true`. A
  config-only variant resolves through the route/available path, a manual key is
  present, and an `.md` base is present. The barrier is bounded (hard bound 2 seconds,
  expected low milliseconds), logs its elapsed time, and logs a late landing on
  timeout. Exactly one config read occurs; no new synchronous read is added at init or
  on a cache miss.
- The host measurement in P1-6 is recorded separately. If the host lists before setup
  resolves or builds the panel from `opencode.json`, that is recorded as a host
  dependency; P0-1 remains plugin-internal and no synchronous read fallback is added.
- A malformed project or global roster produces one explicit log line and preserves
  the last known good list; an authoritatively empty config does not cause a read
  storm.
- `check()` rows equal unique agents (fixture-relative), 0 duplicates, across both
  diagnostic loops. Config-key dynamic names keep their `@` row; dynamic-only names
  appear once, bare; composer suggestions are unchanged.
- `check()` does not show `no model config` for an agent with a configured model in
  `opencode.json` or `tassul.json`; a stale value is never presented as current;
  `unknown` availability is not labeled stale.
- A manual config key passes `checkGeneratedConfig` without pins or provider cache,
  while a drifted generated variant or base still fails, and a generated-shaped key
  missing from `pureAgents` is named.
- A failed first-run expansion leaves a usable `agent` container and one clear warning
  that names the path; addagent/kick still work in a fresh project.
- A partial config never adds agents to the deleted set; a complete config still
  derives genuine deletions; a wiped config does not resurrect kicked agents; the
  guard is per config path; `deleted-agents.json` is not restored.
- `npm run verify` and the relevant proof steps pass; the proof count remains 183.
- No agent is deleted, no roster is rewritten, and `MODEL_CATALOG` is not used as an
  acceptance authority.

## Rejected alternatives

| Alternative | Reason |
|---|---|
| Add `@` to `dynamicAgents` or persist `@name` | Puts dispatch-only agents into composer suggestions; rejected by product requirement |
| Normalize all `getAgents()` names to `@name` | Same suggestion leak and a representation change for routing |
| Strip `@` from a dynamic name that is also a config key | It is host-mentionable; stripping the `@` row creates a false "internal" label and a duplicate |
| Unbounded sleep or wait in `getAgents()` / the render path | Hides the race instead of closing it at the setup boundary |
| A: synchronous config read on cache miss | Not chosen (decision B); v1 proved synchronous startup reads delay session opening. B uses an async barrier |
| B2: synchronous prewarm in the constructor | Reintroduces the v1-proven startup delay; rejected even though it would populate the cache earlier |
| Recreate or delete agents/state | The agents were never deleted; destructive and outside scope |
| Use `MODEL_CATALOG` for acceptance | Forbidden by project policy; provider truth governs. The ban is scoped to acceptance and diagnostics truth |
| Load the global roster inside project scope | Mixes two scopes and violates the one-host rule |
| Fix `agent.list(location)` from the plugin | The host UI is not in this repository |
| Restore v1's `.opencode/deleted-agents.json` sidecar | Conflicts with v2's derivation model; the sidecar would become a second source of truth. Guard the derivation in memory instead |
| Persist the per-path deleted map to disk | Same sidecar problem; a restart residual is reported, not fixed with a new file |
| Require every generated variant present for completeness | Absence is the deletion encoding; this would make every legitimate deletion permanently "incomplete" and keep kicked agents routable forever |
| Treat a missing base as a deletion | Base roles are kick-protected; a missing base is a partial write or damage, not a deletion |
| Refuse to write the minimal contract when expansion fails | Removes the `agent: {}` splice contract v1 deliberately created; addagent/kick would refuse in fresh projects |
| Add `.md` files for generated variants | v1's `skipVariantMd` explains the host would merge config + markdown into a duplicate/diverged agent |
| Treat a malformed roster as an empty roster | Resurrects deleted agents; v1's reader explicitly forbids silent resurrection |
| Add a "never persist `agent: {}`" rule | Breaks the v1 first-boot contract; the container is intentional |
| Literal 34/42 counts in acceptance | Environment-specific; use fixture-relative expectations and first-vs-post-warm delta |

## Open decisions

1. Should the Desktop always request the project location for an open workspace? This
   needs the host owner; it cannot be fixed from this repository (P1-3).
2. If P1-6 shows the host lists agents before setup resolves, confirm the host-side
   fix. Do not fall back to a synchronous read; v1 proved that it delays startup and
   session opening.
3. Resolved (2026-11-14): the deletion trust guard stays process-local and per config
   path, with no persistence; recorded as decisions item 7. The accepted residual is
   that a restart on a wiped config can resurrect kicked agents until the next complete
   read, and it is reported in P3-11.

The cold-read choice (B), the manual-key exception, the dynamic diagnostics section,
the base-role completeness rule, and the report-only stale-state policy are confirmed
and recorded above.

## Status

Implemented on 2026-11-14, uncommitted. P0-1/P0-2 (async roster prewarm barrier at
the setup boundary, bounded at 2 s, generation and sequence ordering, last-good reads,
authoritative empty caching), P1-4 (deduplicated diagnostic rows via `splitAgentRows`,
config-key dynamics keep `@`, dynamic-only names stay bare), P1-5 (configured versus
last-used model labels with provider availability; multi-model `agentModels` sets keep
working), P2-6 (manual config keys pass `checkGeneratedConfig` without pins; generated
bases and variants keep strict checks), P2-7/P2-8/P2-9 (base-role completeness, gated
process-set reset, per-path in-memory deletion guard, observable read failures), and
the first-boot expansion warning with its config path are in the tree.

Evidence: `npm run verify` passes; `npm run gate:proofs` passes all 183 steps;
`prove-seed-agents` covers cold prewarm reuse, truncation, deletion trust, cross-path
isolation, malformed and partial rosters, authoritative empty caching, the bounded
slow read with one warning and a late-landing log, a config write that overtakes an
in-flight warm, the malformed global roster, manual-key preservation after the cold
read, and the P1-5 diagnostic labels, row deduplication, active-path trust line, and
restart residual; `prove-gen-merge-guards` covers the P2-6 manual-key acceptance and
generated base/variant drift.

Residuals: the host agent list/readiness source remains external (P1-3/P1-6); the
deletion guard is process-local and per config path, so a restart on a wiped config can
resurrect kicked agents until the next complete read (P3-11); an external mid-session
deletion that the process deletion set cannot explain is deferred until restart by the
truncation guard, the accepted trade-off. The generated-shaped "absent from
`pureAgents`" branch is structurally unreachable while `buildAgents` and
`checkGeneratedConfig` share one `agentsDir`; the guard is retained as a future
invariant, and the proof asserts every generated name is present in the template
catalog instead.

Remaining after 2026-11-15 implementation (host-side only; the in-repository
review findings are in the Remaining ledger below):

- P1-3 host side: the `agent.list(location)` fix stays in the Desktop host. The plugin
  side is done: the one-time `home-as-project` warning names the workspace config, and
  a bounded post-warm line reports the available agent count.
- P1-6: manual host measurement of setup-versus-list timing, list source, panel count,
  and `agent.updated`/`config.updated` counts. Out of repository.
- P2-10: record a repeated-initialization measurement (one manager and one refresh
  timer per host, per-init barrier timings). Per-init elapsed time is already logged;
  no code change is planned unless a leak is proven.

Closed on 2026-11-15: the P2-9 global-scope proof (malformed roster keeps the last
list, does not throw, and does not reset user-preserved keys); the P0-1 proof gaps
(slow-read bound with one warning and a late-landing log, a warm overtaken by a config
write yielding the post-write list, and an explicit manual-key preservation assertion);
the P3-11 trust line naming the active config path plus the restart-residual advisory
line. The dynamic-agent stale counter was dropped by a six-analyst vote: the existing
dynamic-only section already names those agents, and no provenance signal exists to
distinguish a stale dynamic entry from a manual one. The trust line stays scoped to the
active config path and never enumerates another workspace.

The fan-out review correction (F1) closed on 2026-11-15 after the owner reported that
the repetition guard blocked agent dispatches from the root session. `observeDispatch`
now runs for every session, and only the block is parent-gated: a proven child session
keeps the guard, while the root and an unknown parent are fail-open, matching
`sessionBudgetGuard`. The hook asserts the order (observation before the parent check)
and `prove-usage-shadow` covers the three parent shapes plus the wiring.

## Remaining ledger (2026-11-15)

Out of repository:

- P1-3 host side: the `agent.list(location)` fix belongs to the Desktop host. The
  plugin side is done (one-time `home-as-project` warning naming the workspace config,
  bounded post-warm available-agent count).
- P1-6 host readiness and list-source measurement.
- P2-10 repeated-initialization measurement (one manager and one refresh timer per
  host); no code change is planned unless a leak is proven.

In repository, closed on 2026-11-15:

- R2: a malformed global roster with an empty cache re-read the file and re-logged on
  every `getAgents()` (`AgentManager.ts:464` -> `493`), and the 25 s refresh re-warned
  at `:198` and `:235`. Fixed: all three warn sites now share `warnRosterOnce`
  (`:49`) under the `unreadable` reason, a successful global read calls
  `clearRosterWarnings` (`:481`), and the sync catch caches the last-good list so a
  repeated call is served from cache instead of re-reading. `proveGlobalMalformedRoster`
  now asserts one log line across two sync reads on a cold malformed path.
- R8: `docs/end-user-guide.md:246` and `docs/i18n/ar/end-user-guide.md:235` quoted the
  removed `no model config` label. Fixed: both now quote `has no model configured`,
  the live `checkNoModel` string (`src/i18n/en.json:78`, `ar.json:78`, rendered at
  `src/tools/diagnostics.ts:352`).
- R10: the diagnostics recommendation rows rendered the agent twice
  (`- @dev: @dev has no model configured ...`) because the i18n string already carries
  `{agent}` while `diagnostics.ts:352,356` prefixed it. Fixed: both rows drop the
  prefix, and `proveDiagnosticsRows` asserts the single mention.

In repository, low or informational:

- R6: closed. The slow-read proof asserts a wall-clock bound, so a loaded machine can
  make it flaky; the margin was widened from 400 ms to 1000 ms after the two bounded
  prewarms against a synthetic 250 ms read (`prove-seed-agents.ts:356`). No new proof
  file and no gate step were added, and no runtime code changed; the 183-step count
  holds.
- R7: accepted. The hook-wiring proof asserts the source text rather than executing the
  hook; closing that gap needs a host-shaped harness, which is scope expansion, and the
  detector behaviour is already executed directly.

Accepted residuals (no action):

- R1: `prewarm.complete` may stay stale after a failed global roster; the proof asserts
  the last-good list instead, by design.
- R3: the global roster model label stays generic.
- R4: the count line wording.
- R5: a single `existsSync` per roster read.
- R2 residual: the malformed global roster is still read synchronously on the first
  `getAgents()` after the cache is cleared; the warn is deduped and the failure is
  cached, so the repeated read and the repeated log are gone.
- R9 is closed, not a defect: fan-out clusters are capped at 32 per session and the
  session map is trimmed to 256 (`usage-shadow.ts:100,231,335`), so growth is bounded
  and the root observes (and prunes) on every dispatch after F1.
- P3-11 deletion guard restart gap, external mid-session deletion deferred to restart,
  the structurally unreachable generated-name branch, and the host-side 2.2.x line,
  which revision 19 of the dispatch plan retired when the floor moved to 2.3.0.

Decision 3 is closed: the 2026-11-14 confirmation is decisions item 7 (process-local,
per config path, no persistence), and the residual is reported by the P3-11 restart
line. The five-analyst review of 2026-11-15 agreed that the entry in section
"Open decisions" was stale.

Six reviewers completed the review on 2026-11-14, all with APPROVE WITH CHANGES. Their
findings are folded into P0-1, P0-2, P1-4, P1-5, P2-6, P2-7, P2-8, P2-9, and the proof
and acceptance sections.

The v1 comparison is complete. v1 did not solve the cold-list race; it traded it for a
non-blocking hot path. v2 inherited that trade and added two new risk areas: deletion by
absence from `config.agent`, and a first-boot expansion fallback. The plan fixes the
inherited cold read without touching the v1 contracts (`agent: {}`, config-only
variants, pure-template checks, bare dynamic names).

Decisions confirmed on 2026-11-14: B for the cold read (async setup barrier, no
synchronous read), the manual-key exception, the bare `dynamic (internal, not
mentionable)` diagnostics section, base-role completeness, the per-path in-memory
deletion guard, and report-only stale state. The authoritative remaining list is the
Remaining ledger above; it replaces the earlier three-item summary.
