# Tawassul V2

Tawassul is an OpenCode plugin: a per-workspace team runtime with routing,
handoffs, a goal ledger, mission boards, checkpoints, and a 43-tool surface.
This tree is the only runnable Tawassul plugin. The v1 tree is retired and
read-only.

- Host: OpenCode `2.2.1` audited (accepted `>=2.2.0`; newer majors run untested with a capability probe at init)
- Plugin API: `@opencode/plugin` `^2.2.1`
- Runtime: Node 26.13.0 (pinned in `.nvmrc`) and Bun
- Language: English only; no code comments

## Install

From this directory:

```
nvm use
npm install
npm run build
```

`npm run build` writes `dist/index.js`, the self-contained `dist/global.js`,
and the host entry `.opencode/plugin/tawassul.js`. The host auto-loads that
file for this workspace. A fresh clone needs no config edit for the plugin
itself.

If the host runs with a restricted module resolver, install the plugin peer
once inside the workspace:

```
mkdir -p .opencode
printf '{"type":"module","dependencies":{"@opencode/plugin":"^2.2.1"}}\n' > .opencode/package.json
bun install --cwd .opencode
```

### Consent words

The consent gate accepts the built-in English words and any extra accept/deny
words listed in `~/.config/tawassul-v2/consent-tokens.json`:

```
{
  "accept": ["yes", "ok"],
  "deny": ["no", "stop"]
}
```

Use `TAWASSUL_CONSENT_TOKENS=/path/to/file.json` to point at a different file.
Matching ignores case, surrounding punctuation, Arabic diacritics, and common
letter variants, so a word may be written naturally.

Use the pinned launcher for normal boots:

```
scripts/opencode-v2-iso.sh run --standalone --auto --format json \
  --model opencode/big-pickle "Reply with exactly: OK"
```

The launcher enforces the host floor `>=2.2.0`, accepts newer 2.x and 3.x in
untested mode with a warning, refuses a binary below the floor, applies the
generation guard, runs DB maintenance at the cap, and logs one
`[launcher] watcher mode=… decision=…` line per launch.

### Opt-in global install

A project install stays the default and wins when both exist. A machine-wide
install is a single self-contained file plus a runtime asset folder, and the
installer never edits `opencode.json(c)`:

```
npm run build
npm run install:global          # flat file plus wasm assets and VERSION marker
npm run verify:global           # hashes, host pin, scope, wasm integrity
npm run uninstall:global        # keeps the global roster and state
npm run uninstall:global -- --purge --yes   # archives state beside its old path
```

Before writing anything, the installer refuses when the directory it runs from
already carries a project copy of this plugin in `.opencode/plugin/` or
`.opencode/plugins/` — any `.ts`/`.js` file whose content names the plugin, or
the canonical `tawassul.js` name — naming every copy and the global target, so
the same plugin cannot be installed twice. This tree's own project entry
`.opencode/plugin/tawassul.js` is exempt only when the installer runs from the
repository root. The reverse case is resolved at runtime: when a project copy
and a global copy both exist, the global copy detects its scope and delegates
setup to the workspace project entry, so only one copy takes effect; the plugin
never enforces or removes either one.

The global install is single-owner: the first tree records itself in
`tawassul-install-owner`, and a live owner from another tree is refused before
any write. `--takeover` transfers ownership when a different tree must install.
Uninstall removes only the files the marker recorded, keeps unknown files under
the runtime directory, and leaves state in place unless `--purge --yes` is
given; the purge moves Tawassul state to `<path>.purged-<timestamp>` instead of
deleting it. The global agent roster under `~/.config/opencode/agent/` is kept
either way and must be removed manually. The installer smoke-checks the
resolved DB with `--check` and registers the daily lane (systemd user timer or
cron) with the resolved `OPENCODE_DB` pinned in the unit or cron line.
| Path | Contents |
| --- | --- |
| `~/.config/opencode/plugins/tawassul.js` | self-contained bundle (`dist/global.js`) |
| `~/.config/opencode/tawassul-runtime/wasm/…` | web-tree-sitter and language wasm files |
| `~/.config/opencode/tawassul-runtime/VERSION` | bundle/wasm hashes, version, host pin |

OpenCode v2 loads a direct `.js` file from the global plugins directory but
does not install its dependencies. The global bundle therefore carries `zod`,
`web-tree-sitter` JS, and the real `Plugin.define`, while the wasm files are
copied beside it. The installer refuses v1 artifacts and the retired
package-directory layout. `--dry-run` reports the planned writes; `--force`
replaces an unmarked file and keeps the previous copy as
`tawassul.js.pre-force-<timestamp>`, which `--purge --yes` removes.

## Model failover

`FALLBACK_CHAINS` already ranks the models each role may use. When a provider
refuses a turn (quota, billing, auth, free daily limit), the v2 `retry` hook
moves the session to the next curated entry with `session.switchModel` and lets
the host retry once on that model instead of ending the turn.

The switch is bounded: two moves per session by default, a target is never
retried, and a host that refuses `switchModel` fails closed to the old no-retry
decision. Override the chain per agent (or `*` for every agent) in
`tawassul.json`:

```
{
  "fallback": {
    "enabled": true,
    "maxSwitches": 2,
    "cooldownMs": 750,
    "chains": {
      "dev": ["nvidia-nim/deepseek-ai/deepseek-v4-flash", "google/gemini-flash-lite-latest"],
      "*": ["opencode/big-pickle"]
    }
  }
}
```

Set `"enabled": false` to keep the previous behaviour, where a terminal refusal
ends the turn. The plugin's own rate-limit retry and quota probe stand down for
five minutes while a failover claim owns the session, so a turn is never resumed
twice; after that window the normal recovery paths apply again.

## Routing evals

`analyzeMessage` decides whether a message is a task and who should own it.
`prove-routing-eval` runs a fixed fixture set through it and fails on drift:

- 8 task fixtures must land on their agent and size.
- 21 chatter fixtures — greetings, acknowledgements, plain prose — must not
  reach `auto-status` or above.
- A secret must raise a warning and route nowhere.

The fixture set caught a real defect: the fuzzy matcher compared short
technology keywords as substrings of ordinary words, so `hi` matched `ui`,
`said` matched `ai`, and `carry on` matched the curated typo `arr`. The
matcher now normalizes the text, matches whole words, and only fuzzy matches
keywords of four characters or more, so a two letter keyword can no longer
claim a sentence.

## Prompt payload stability

Every injection runs through one bridge that touches only the last message and
runs at most once per message. A message that arrives without an id gets a
synthetic key pinned on the message object, so a second context pass cannot
derive a new key from the already-injected text, and a text that is already
present is never appended again. Earlier messages are never rewritten, so the
cached prefix stays byte-identical across turns.

`prove-payload-cache` holds this as a property rather than an example: 64
generated payloads are bridged three times each and must stay identical. The
same proof pins the tool schema projection: one shape serializes to the same
bytes on every build, with a stable key order.

## Verify
```
npm run gate:fast    # rules + shell syntax + typecheck + config + facts + contract + parity + catalog
npm run gate:proofs  # 130 proofs, one isolated child process each (the full CI run)
npm run gate:proofs:1  # shard 1 of 4, about a minute, nice 10 (2, 3, 4 for the rest)
npm run gate:smoke   # build + release smoke (one scratch boot)
npm run ci           # all three stages, sequentially, each in its own process
npm run verify       # gate:fast + build
npm run doctor       # per-project scope, DB isolation, router files, orphan servers
```

Each stage is a separate process, so a failure in one stage cannot leave
another stage in a partial state. `npm run ci` runs the three stage processes
in order instead of chaining the proof commands. Use
`npm run gate:proofs -- --only s028 --timings` for one proof and per-step
durations. The manifest is `scripts/gate-manifest.json`;
`prove-proof-catalog` fails when a proof file is missing from it.

The 130 proofs run in about 228s in one pass. For a fast local loop the stage
is split into four balanced shards in `scripts/proof-shards.json` (56.7s of
recorded duration each): `npm run gate:proofs:1` through `gate:proofs:4`, or
`npm run gate:proofs -- --shard 3 --timings`. Each shard runs at niceness 10 so
a side session stays responsive, writes `.opencode/state/gate-proofs-<n>.json`,
and the catalog fails when a shard misses or duplicates a step. Keep
`gate:proofs` as the full run before a release or in CI.

Run all four shards sequentially in one detached worker so this session stays
usable while the work happens:

```
npm run gate:proofs:bg          # start and return immediately
npm run gate:proofs:bg:status   # progress and the last shard results
npm run gate:proofs:bg:wait     # block until the worker finishes (CI)
npm run gate:proofs:bg:stop     # stop the worker and its current proof
```

The worker keeps one shard running at a time; launching the four shards in
parallel would recreate the CPU spike this split removes. Logs go to
`/tmp/opencode/gate-proofs/run-*/shard-<n>.log`, `summary.tsv` records each
result and duration, and the last five runs are kept. A second `start` is
refused while the worker is alive, and a stale lock is reclaimed only after its
pid is gone.

The smoke stage builds once, then boots a scratch workspace with an isolated
`OPENCODE_DB` and checks `initPlugin`, 42 registered tools, a model reply, and
direct `health` plus `help` calls. A broken plugin cannot pass it: a boot that
hangs or times out after loading the plugin fails, and only an explicit
provider refusal code (quota or auth) is accepted in place of the reply.
`TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=0` restores the older transport tolerance
for a machine that cannot reach the provider; a missing plugin boot always
fails.

## Host refresh

A build replaces `.opencode/plugin/tawassul.js`, but the live host keeps the
module it imported. Reloading the host is therefore part of deploying any
plugin change, and no operator command is needed:

```
npm run host:refresh                    # reload + wait for a fresh plugin init
npm run host:refresh -- --verify-only   # check freshness without touching the host
npm run host:refresh -- --restart       # detached service restart (last resort)
```

The helper refuses to reload when the entry's embedded content SHA differs from
`scripts/source-digest.ts` (run `npm run build` first), so a reload never
pretends to load unbuilt code. It resolves the host CLI (env
`TAWASSUL_HOST_CLI`, then the newest Desktop-bundled CLI, then PATH), runs
`opencode-cli reload` from this repository, waits for a new
`Background init completed successfully` line in the plugin log, and compares
the `v2 bundle sha256=` fingerprint the plugin logs at init with the SHA-256 of
the entry file, so the check is content-exact rather than mtime-only. It prints
the live service PID from `~/.local/state/opencode/service.json`. A reload keeps
the PID: the same service process re-imports the plugin. When a reload cannot
produce a fresh init, `-- --restart` schedules
`systemd-run --user --unit=… --on-active=… opencode-cli service restart`
detached (it writes a report to `~/.local/state/tawassul-v2/host-refresh.json`),
because a restart of the running service would end the current session.
`scripts/prove-host-refresh.ts` (the `host-refresh` proofs step, 56 assertions)
exercises all of it against a fake service, log, and CLI.

## Independence

v2 runs from this tree alone: no runtime import, script, or build step references
`/home/htoz/Desktop/tawassyl`. `npm run prove:independence` enforces that,
checks that the only legacy name in `src/` is the read-only state fallback,
and asserts exactly one host entry (`.opencode/plugin/tawassul.js`).

The only v1-era surfaces v2 still touches are read-only:

- the legacy state directory, and only when the v2 file is missing;
- the existing HMAC key, so previously signed state stays verifiable.

The v1 tree is retired: its plugin bundle and MCP server are renamed
`.retired-20261024`, every workspace config sets
`mcp.tawassul.enabled = false`, and the tree is read-only.

## State and migration

| Surface | Path | Rule |
| --- | --- | --- |
| Plugin state | `<project>/.opencode/tawassul-state.json` (project) or `~/.config/tawassul-v2/state` (global) | override `TAWASSUL_V2_STATE_DIR` |
| Predictive router | `<project>/.opencode/predictive-router.json` (project) or `~/.config/tawassul-v2/state/predictive-router.json` (global) | falls back to the global file while the project file is absent |
| Goals, boards, timeline | `<project>/goals`, `<project>/mission-board`, `<project>/timeline` | project scope only |
| Legacy read fallback | `~/.config/tawassyl/state` | read-only, only when the v2 file is absent; never written |
| Data root | `~/.local/share/tawassul-v2` | log at `tawassul/tawassul.log`; N2 at `n2-auto.jsonl` |
| Launcher DB | `~/.local/share/tawassul-v2/opencode-v2.db` | v2 lane only |
| Desktop sidecar DB | `~/.local/share/opencode/tawassul-v2/opencode.db` | owned by the desktop host |
| Bare-host DB | `~/.local/share/opencode/opencode.db` | shared; avoid running several projects against it |
| HMAC key | `~/.config/tawassul/.tawassul-hmac-key` | 32 bytes, readable during migration |

Writes use `TAWASSUL_V2_HMAC_V1:`. Verification also accepts the legacy
`TAWASSUL_HMAC_V1:` and `TAWASSULL_HMAC_V1:` prefixes, so old state remains
readable. Legacy files are never modified.

## Multiple projects

A local install is project-scoped by default: `detectInstallScope` sees the
host entry inside the project, so state, goals, boards, timeline, metrics, and
the predictive router stay inside that project. Two projects therefore do not
share writable plugin state. The remaining shared surfaces are the log, the
read-only HMAC key, and the host database.

- Keep one real copy of `.opencode/plugin/tawassul.js` per project. A symlink
  into the global config makes the module resolve globally, flips the scope,
  and sends `addagent`/`kick` writes to `~/.config/opencode`.
- Never point two live projects at the same `OPENCODE_DB`. Use
  `scripts/opencode-v2-iso.sh` (HMAC-keyed per-project DB) or the desktop
  sidecar. A bare host falls back to the shared database and risks
  `SQLITE_BUSY`.
- The predictive router is per project; a global-scope instance keeps writing
  the global file. `npm run doctor` reports both files and warns when the
  global one is newer.
- `health` prints the install scope, state file, router files, `OPENCODE_DB`,
  the HMAC-expected DB, whether they match, and the model failover state
  (switches, live claims, tracked sessions).
- `npm run doctor` also snapshots every known DB and reports how many sessions
  belong to this project, so a "missing session" is visible as a DB split
  instead of data loss.

The v1 state is frozen reference. Do not copy it, do not point v1 at a
`tawassul-v2` path, and do not point v2 at a v1 or shared DB. The guard is the
boundary:

```
scripts/guard-db-generation.sh --db <path> --expect v1|v2 --json
```

Exit `0` is allowed, `2` is a generation refusal, and `3` is a probe failure
(fail-closed). `CUTOVER.md` records the full dual-generation matrix and the
rollback procedure.

## 43-tool surface

Every tool is callable directly; `help` lists the catalog and each tool carries
its own description. Common entry points:

- `health` — event-loop lag, RSS, timers, DB mode and paths, scope, state paths, pending flushes
- `help` — available tools
- `goal` — goal ledger, board, evidence, close gate
- `handoff` / `fasttrack` — task transfer between agents
- `record` — decisions, fixes, incidents, notes
- `thread` — portable context packs: list, read, pack, continue, revoke (available to every agent)
- `checkpoint` / `codestate` — code snapshots and undo
- `pause` / `resume` / `panic` — workflow control

## Host process model

OpenCode 2.2.1 is a client plus a background service:

- The Desktop app (`/opt/OpenCode/ai.opencode`) starts its own engine:
  `~/.config/ai.opencode.desktop/cli/2.2.1-x64/opencode-cli serve --service`.
  That process is expected and must not be killed.
- The engine writes `~/.local/state/opencode/service.json` (URL, PID,
  password). Every `opencode` client that shares that state directory attaches
  to the same service, so it runs the same plugin instance and the same
  database.
- `opencode pair` only prints one-time links for a running service. A browser
  or another app is a client; the plugin still runs inside the service.
- Any `~/.opencode/bin/opencode serve` process is a separate host. It uses its
  own `XDG_*` profile and database and is not registered in the Desktop
  descriptor.

Rules:

1. Production uses one host: the Desktop plus its sidecar.
2. `scripts/opencode-v2-iso.sh` resolves the host as `TAWASSUL_OPENCODE_BIN`,
   `OPENCODE`, `~/.opencode/bin/opencode`, then the Desktop-bundled CLI. The
   terminal copy is optional.
3. For `run`, `mini`, and the bare TUI the launcher injects `--standalone`, so
   a dev run never attaches to the live desktop service and never leaves a
   detached background host. An explicit `--server`, `--url`, or
   `--standalone` wins.
4. Two hosts at once are for tests only, each with isolated `XDG_*`,
   `OPENCODE_DB`, and state, and never on the same workspace.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A CLI server appears after opening Desktop | It is the desktop sidecar: `opencode-cli serve --service` on `127.0.0.1`. `npm run doctor` classifies every host. |
| A stray `opencode serve` keeps running | It is a separate host, not the sidecar. `npm run doctor` fails on `~/.opencode/bin/opencode serve`; stop that PID. |
| Terminal `opencode` still resolves after uninstall | `~/.opencode/bin` is still on PATH (`~/.bashrc`). `opencode uninstall` also stops the shared service, so do not run it while the Desktop is open. |
| `generation guard refused` | The DB belongs to the other generation; use the v2 DB or a fresh file. |
| `refusing host vX — supported v>=2.2.0` | Install a host at or above the floor; newer majors are accepted untested, pre-2.2 hosts are refused. |
| Plugin registered 0 tools | Run `npm run build`; confirm `.opencode/plugin/tawassul.js` exists. |
| Plugin behaves as if a fix were absent | The live host still holds the pre-build module; run `npm run host:refresh` (it reloads and verifies a fresh init). |
| Boot has no watcher line | Use `scripts/opencode-v2-iso.sh`; a bare host binary skips the launcher policy. |
| Plugin log is empty | `TAWASSUL_LOG_FILE` is unset or set to empty (empty disables the sink). Default is under the data root. |
| State looks stale | Read `health` and the plugin log; do not copy v1 state. |
| Desktop session is "not found" | The desktop sidecar DB differs from the shared DB; `npm run doctor` prints the DB path and per-DB session counts. See `RECOVERY-20261025.md`. |
| Two projects fight over routing data | Rebuild so the router lands in `<project>/.opencode/predictive-router.json`; `npm run doctor` reports both router files. |
| Writes land in the global config | `.opencode/plugin/tawassul.js` is a symlink; replace it with the built file and rerun `npm run doctor`. |

## Docs map

- `PLAN.md` — priority plan and day-by-day history
- `ISSUES.md` — live issue register (hosts, runtime cost, gate, data)
- `UPSTREAM.md` — OpenCode release watch, per-change verdicts, compatibility routine
- `CUTOVER.md` — dual-generation evidence, freeze, retirement, rollback
- `TRIAGE.md` — S-055 A–L verdicts with evidence
- `RECOVERY-20261025.md` — desktop DB split, session merge, multi-project hardening
- `DECOUPLING.md` — namespace and shared-surface decisions
- `SHARED.md` — frozen historical cross-tree issues log
- `RULES.md` — memory cap and sequential heavy-work rules
- `AGENTS.md` — project rules for agents working in this tree
