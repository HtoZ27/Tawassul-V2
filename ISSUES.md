# Tawassul V2 — Issue Register

Status date: 2026-10-25 · Gate: `npm run ci` rc=0 (3 isolated stages, 26 proof files, smoke pass)
Real global install: not performed (opt-in; see I-01).

Purpose: one durable place for open issues, evidence, and the next action, so
development context survives session loss. Severity: P0 (can corrupt state or
freeze a boot), P1 (correctness or measurement gap), P2 (quality/parity).
State: `open`, `in_progress`, `blocked`, `done`.

## Owner decisions

- **D-00 (2026-10-25): v1 is retired permanently.** It will not work in any
  project again. It is not a compatibility target: any v1 plugin entry, v1
  host, or v1 global dependency is a defect. v2 is the only plugin. Two hosts
  run only in isolated tests. Evidence: a Desktop-wide scan finds exactly one
  active flat `tawassul.js` entry (this tree); the six other workspaces and
  the v1 tree have `.retired-20261024` markers and no active `tawassul.js`.
  Correction (2026-10-25): that scan matched flat files only. Three
  directories also carried `plugins/tawassul/index.ts`: `gtttt` and `paassss`
  export a v1-only shape and fail the v2 plugin schema (P-07, still open),
  while the v1 tree `tawassul` exported `{ id, server, setup }` and booted a
  v2 plugin in a v2 host — the owner renamed that entry the same day (H-09,
  done). The decision stands; the scan was incomplete and G-08 fixes it.

---

## Host copies, processes, and retired-tree hazards (P0)

### H-01 Orphan terminal server survives uninstall — done

Resolution (2026-10-25): `kill 329218` stopped the process gracefully; port
38335 is closed and the Desktop ports 36923/49374 remain. The probe directory
`/tmp/opencode/smoke-probe` is still on disk pending owner approval.

Evidence (2026-10-25):

- PID `329218`, parent `1`, started 2026-10-24 17:13:45.
- Command: `~/.opencode/bin/opencode serve --port 0`, listening `127.0.0.1:38335`.
- `cwd=/tmp/opencode/smoke-probe`, `XDG_DATA_HOME=/tmp/opencode/smoke-probe/xdg2`,
  `TAWASSUL_V2_STATE_DIR=/tmp/opencode/smoke-probe/state2`.
- It is not registered in `~/.local/state/opencode/service.json`, so
  `opencode service stop` cannot see or stop it.

Root cause: a detached `serve` from an isolated probe outlived its parent.
`opencode uninstall` removes binaries, not running processes.

### H-02 Terminal CLI duplicate — done

Outcome (2026-10-25):

- `opencode uninstall` completed. Its scope is cache, service descriptor, and
  the background service: `~/.cache/opencode` became empty, the shared service
  was stopped, and `~/.local/state/opencode/service.json` was removed.
- The uninstaller deliberately leaves binaries as **manual removal**. With
  owner approval, `~/.opencode` (230 MB) was moved out and then deleted, and
  `~/.bashrc:139` (`export PATH=/home/htoz/.opencode/bin:$PATH`) was removed.
  `~/.bashrc` still parses, and a new login shell reports no `opencode`.
- The Desktop restarted its sidecar after the uninstall. The descriptor was
  recreated (`pid 805568`, `http://127.0.0.1:49374`), the plugin booted, and
  `v2 registered 42 tools` with `INIT_AUDIT ... "health":"healthy"` and no
  plugin errors. Port 36923 is no longer listening; only 49374 listens, and
  the UI returns HTTP 200. That is the current single-host shape, not a
  defect.
- `scripts/release-smoke.sh` resolves explicit env → `OPENCODE` →
  `~/.opencode/bin/opencode` → the Desktop-bundled CLI, so the gate survives
  the removal. Confirmed live: it resolves
  `~/.config/ai.opencode.desktop/cli/2.1.4-x64/opencode-cli`.
- `scripts/doctor-v2.sh` now warns when a non-pinned `opencode` appears on
  PATH, when the v1 Bun global package is installed, when Bun exposes an
  `opencode` binary, and when the global config pins the v1 plugin SDK.

Remaining hazard: the bun-installed v1 binary (H-07). Do not rerun
`opencode uninstall` while the Desktop is open: it stops the shared service
and removes the shared cache again.

Evidence:

- `~/.opencode` absent; `~/.bashrc` has no `~/.opencode/bin` export; a fresh
  login shell finds no `opencode`.
- Launcher prints `opencode v2.1.4`; smoke resolves the Desktop CLI.
- Full `npm run ci` after removal: rc=0, 25 `PROOF PASS`, `SMOKE PASS`.
- `dpkg -l opencode` is the **Desktop app** (`/opt/OpenCode`), not the CLI;
  removing that package would delete the Desktop app.

### H-03 Launcher can attach to the live Desktop service — done

Resolution: `launcher_host_bin` resolves explicit env → terminal copy →
Desktop CLI, and the launcher injects `--standalone` for the bare TUI, `run`,
and `mini`. `serve` and explicit `--server`/`--url`/`--standalone` are left
alone. `prove:boot-gate` covers all four cases.

Evidence:

- `~/.local/state/opencode/service.json` holds the active descriptor:
  `{"url":"http://127.0.0.1:49374","pid":805568,"version":"2.1.4",...}`,
  written by the Desktop at boot. `opencode service status` prints that URL.
- `scripts/opencode-v2-iso.sh` ends with `exec "$OPENCODE_BIN" "$@"` and does
  not force `--standalone`. If the client sees a service descriptor, it can
  attach to the Desktop server, where `OPENCODE_DB`/`XDG_*` from the launcher
  have no effect. Dev runs would then write to the live DB and state.

### H-04 Service descriptor is the single source of truth — done

Resolution: `scripts/doctor-v2.sh` prints the descriptor URL and PID, checks
that the PID is alive, reports the resolved `opencode` on PATH, flags a
terminal install and a `~/.opencode/bin` PATH export, and lists every
Desktop-bundled CLI with its version.

### H-05 Single-host rule — done

Resolution: `AGENTS.md` ownership boundary item 4 and `README.md` "Host
process model" state that production uses the Desktop plus its sidecar, and
that two hosts are test-only with isolated `XDG_*`, `OPENCODE_DB`, and state.

### H-06 Global config still installs the v1 plugin SDK — done

Evidence before removal: `~/.config/opencode/package.json` depended on
`@opencode-ai/plugin@1.17.14`, and `~/.config/opencode/node_modules` held the
v1 package plus 26 transitive dependencies. The global config had no plugin
entry (`opencode.jsonc` contains only `$schema`), so it was inert, but it was
exactly the leftover that lets v1 load again.

Removal (2026-10-25, owner approval):

- Backed up `package.json` and `package-lock.json` to
  `/tmp/opencode/global-config-v1-backup-20261025/`.
- `npm uninstall @opencode-ai/plugin` removed 27 packages;
  `package.json` is now `{}`, the lock has zero packages, and the empty
  `node_modules` directory was removed.
- `grep -rn "opencode-ai/plugin\|1.17.14" ~/.config/opencode` finds nothing.
- Doctor now reports no warning, and the live sidecar still answers HTTP 200.

Why v2 is unaffected: v2 is not a global dependency. It is the built bundle
`.opencode/plugin/tawassul.js` (1.8 MB) plus `.opencode/package.json`
(`@opencode/plugin 2.1.4`), auto-discovered from the project's `.opencode/plugin`
directory. The project config has no `plugin` key and still boots 42 tools.

`~/.cache/opencode` is shared with the Desktop and must not be removed.

### H-07 Bun global still installs a v1 binary — done

Evidence (2026-10-25):

- `~/.bun/bin/opencode` was a symlink to
  `../install/global/node_modules/opencode-ai/bin/opencode.exe`, and that
  binary reports `1.17.14`. `~/.bun/bin` is on `PATH` (`~/.bashrc:123`), so
  after `~/.opencode` was removed this became the only `opencode` a shell
  could resolve.
- The symlink was quarantined to
  `/tmp/opencode/opencode-v1-bun-symlink-20261025`; a new login shell then
  reported no `opencode`, and the launcher and smoke fell back to the Desktop
  CLI.
- With owner approval, `bun remove -g opencode-ai` removed the package
  (`1 package removed`). `~/.bun/install/global/package.json` is now `{}`,
  `~/.bun/install/global/node_modules/opencode-ai` is absent, and
  `~/.bun/bin/opencode` no longer exists.
- A scan of `~/.bun/bin`, `~/.opencode/bin`, `~/.local/bin`, `/usr/local/bin`,
  and `/usr/bin` finds no `opencode` binary; `npm ls -g` shows none either.
  Doctor now reports `no 'opencode' on PATH` with no Bun warning.

The quarantined symlink under `/tmp/opencode` is now dangling and can be
deleted with the other approved temp cleanup.

### H-08 Global install assumed a package directory the host never installs — done

Evidence (2026-10-25): OpenCode v2 discovers a direct `.js` file under
`~/.config/opencode/plugins/`, but it does not install that file's
dependencies and does not install from `~/.config/opencode/package.json`. A
probe importing `zod` failed with `Cannot find package 'zod' imported from
…/plugins/probe.js`; adding a config-root `package.json` created no
`node_modules` and changed nothing. A package directory's dependencies are
not installed either. v1 worked only because its OpenCode ran `bun install`
from the config root, which v2 dropped.

Discovery is a separate rule: the host loads `plugins/<dir>/index.ts`,
`plugins/<dir>/index.js`, or a direct `plugins/<name>.js`, but ignores
`<dir>/dist/index.js` alone. A v1-shaped default export is rejected with
"Plugin must export a default definition with an id and an effect or setup
function" (P-07); a dual `{ id, server, setup }` export boots the v2 half
(H-09).

Resolution: the global install is one self-contained file,
`~/.config/opencode/plugins/tawassul.js`, built from `dist/global.js`. It
carries `zod`, the `web-tree-sitter` JS, and the real `Plugin.define` resolved
to `@opencode/plugin/promise/plugin` (an identity function), so no host module
resolution is needed. The four tree-sitter wasm files live under
`~/.config/opencode/tawassul-runtime/wasm/`, and
`~/.config/opencode/tawassul-runtime/VERSION` records the bundle/wasm hashes,
version, and host pin. `scripts/install-global.ts` writes that layout, refuses
v1 artifacts and the retired package directory, and never edits
`opencode.json(c)`.

Proof: in an isolated HOME the host logs `loading plugin` for the flat file,
creates the global roster and agents, and `astquery` on `sample.ts` returns
the function symbol through the runtime wasm. `npm run prove:global-install`
asserts the layout, self-containment, hashes, scope, refusal paths, repair,
and purge.

### H-09 The retired v1 tree still boots a v2 plugin — done (2026-10-25)

The v1 tree `/home/htoz/Desktop/tawassyl` is a read-only reference, but its
package exposed `.opencode/plugins/tawassul/index.ts` exporting
`{ tawassul, default }`; `plugin.ts` default was
`{ id: "tawassul", server: tawassul, setup: createV2Setup() }`. Its
`v2/setup.ts` is a full v2 bridge with no runtime `@opencode/plugin` import,
so the v2 host can load it without the v1 SDK. The v1 tree's `opencode.json`
has no `plugin` key, so auto-discovery applies.

Evidence (2026-10-25, isolated copy of the package plus its parent
`node_modules`, isolated HOME, host v2.1.4):

- Host log: three `loading plugin` lines for
  `.../plugins/tawassul/index.ts`; no `failed to load plugin`.
- It created 16 files in the scratch project's `.opencode/agents` (8 agents
  plus 8 backups), plus `tawassul-state.json`, `tool-run-log.json`,
  `activity-metrics.json`, `vector-index.json`, and `feature-index.json`.
- It created `~/.config/tawassul`, `~/.local/share/tawassul`, and
  `~/.cache/tawassul` in the isolated HOME.

Why P0: opening the folder in the Desktop would execute retired-tree code,
write state and agents into that workspace, and touch the legacy global
paths that the v2 legacy fallback reads. It also violated D-00 and the
"one plugin copy" rule.

Attempted neutralization from this side (2026-10-25) failed: `git mv` and plain
`mv` both refuse permission. `/home/htoz/Desktop/tawassyl`,
`.opencode/plugins`, and `.opencode/plugins/tawassul` are mode `0555` owned by
`htoz`, `index.ts` was mode `0444`, and `.git/index.lock` is not writable
either. The reference tree was deliberately locked read-only at retirement.

Resolution (2026-10-25, owner-run): the file is now `index.ts.retired-20261025`
— same size (4336 bytes), same mode (`0444`), and the same original mtime
(Oct 21 07:14), so it is a rename, not a rewrite. The package directory still
holds the rest of the v1 source and `dist/`, and both plugin boards are
unchanged otherwise.

Verification (2026-10-25): an isolated boot of a copy of the final tree shows
zero `loading plugin` and zero `failed to load plugin` lines for
`plugins/tawassul`, zero agents created, and no `tawassul-state.json`,
`tool-run-log.json`, `activity-metrics.json`, `vector-index.json`, or
`feature-index.json`. rc=1 came from the provider free limit, not the plugin.
The package directory is now as inert as the six `dist`-only ones.

Remaining follow-up (not blocking): add a doctor/release scan for
`plugin(s)/*/index.{ts,js}` (G-08) so a rename is never the only defense.

---

## Global install follow-ups (P2 unless noted)

The flat self-contained install is implemented and proven at the file level
(H-08). The items below are the remaining gaps; none of them blocks the
project install, which stays the default.

### I-01 Real global install is not performed — blocked (owner opt-in)

State of this machine (2026-10-25): `~/.config/opencode/` contains
`opencode.jsonc`, `package.json` (`{}`), `package-lock.json`, `service.json`,
and `.gitignore`; there is no `plugins/`, no `tawassul-runtime/`, and no
`tawassul-v2/`. The only live host is the Desktop sidecar, and it loads the
project bundle.

Why blocked: the owner asked that a real machine-wide install not run until
explicitly requested.

Next: on request, run `npm run build`, `npm run install:global`,
`npm run verify:global`, then boot the Desktop (or an isolated HOME) and
confirm one `loading plugin` line for the flat file, 42 tools, and a working
`astquery`.

### I-02 Installer host discovery is Linux-only — open

`hostCandidates()` splits `PATH` on `":"` (`scripts/install-global.ts:128`),
looks only for `opencode` (no `opencode.cmd` or `opencode.exe`), and hardcodes
the Linux Desktop CLI path
`~/.config/ai.opencode.desktop/cli/<ver>/opencode-cli`. On Windows the `PATH`
separator is `";"` and the executable suffix differs; on macOS the Desktop
CLI location differs.

Next: use `delimiter` from `node:path`, probe `opencode`, `opencode.cmd`,
and `opencode.exe`, add the macOS Desktop path, and add a unit proof with a
fake `PATH`. No cross-platform CI exists.

### I-03 `--purge` keeps global agent files — open

`purge()` removes global state files but deliberately keeps
`~/.config/opencode/agent/*.md` and prints "remove them manually"
(`scripts/install-global.ts:377-382`). The README lists
`uninstall:global -- --purge` without saying that the roster survives.

Next: either move the agent files to a timestamped backup and remove them, or
state the exception in README and `--help`, and assert the chosen behavior in
`prove-global-install`.

### I-04 Stale wasm files are not pruned on upgrade — open

`install()` writes the four current assets but never removes files under
`tawassul-runtime/wasm/` that are absent from `VERSION`. A package or asset
rename leaves dead files behind; `verify` ignores them.

Next: after writing the current assets, walk `WASM_DIR`, remove files not in
the marker manifest, prune empty directories, and cover it in the proof.

### I-05 `--force` overwrites an unmarked file without a backup — open

When `plugins/tawassul.js` exists with no Tawassul marker, `install()` fails
unless `--force`; with `--force`, `writeAtomic` replaces the file in place and
keeps no copy. A user file at that name is lost.

Next: before a forced replacement, rename the existing file to
`tawassul.js.pre-force-<timestamp>`; document how to remove it, or include it
in `--purge`.

### I-06 Missing-wasm auto `npm install` is untested — open

`resolveAssets(true)` runs `npm install --no-audit --no-fund` in the repo when
an asset is missing. That mutates the working tree, needs network access, and
is not exercised by the proof (the proof always finds the local wasm files).

Next: either drop the auto-install and fail with the exact `npm install`
command, or add a proof that injects an empty asset root and asserts the
install path, with no network in CI.

### I-07 No bundle freshness check — open (P1)

The installer only checks that `dist/global.js` exists and scans it for bare
imports. It cannot tell whether the file matches the current `src/` or the
current git commit, so an old build can be installed and then marked with the
current package version.

Next: embed the git SHA (or a source hash) at build time, compare it with
`git rev-parse HEAD` (or a build stamp) in the installer, and record it in
`VERSION`.

### I-08 Global bundle boot cost is unmeasured — open (P1)

The project bundle boot is measured (`initPlugin` 8-23 ms, 350-550 ms to 42
tools). The global bundle is larger (2,296,549 bytes vs 1,858,782) and adds
runtime wasm loading from `~/.config/opencode/tawassul-runtime/wasm/`, but
its boot time has not been recorded.

Next: run an isolated-HOME boot with the flat global file and record
`loading plugin` to `registered 42 tools`; compare with the project bundle.
Fold the result into B-05/G-04.

### I-09 Project-over-global priority is only a unit proof — open (P1)

`prove-global-install` calls `claimCoexistence` and `isCoexistenceOwner` with
a global token and a project token and asserts that the project supersedes.
It does not boot a host with both `~/.config/opencode/plugins/tawassul.js`
and `<workspace>/.opencode/plugin/tawassul.js` present.

Next: in an isolated HOME, install the global file, add the project file,
boot once, and assert the host log shows one effective plugin (no duplicate
tool registration, project scope wins). This is the live counterpart of the
unit claim.

### I-10 The successful host boot is manual, not in CI — open (P1)

The flat-file boot evidence (global roster, agents, `astquery` through runtime
wasm) was produced by hand in an isolated HOME. `prove-global-install` runs
the installer and inspects files; the smoke stage boots the project bundle,
not the installed global file.

Next: add an opt-in slow proof (or a release checklist with the transcript
path) that runs the Desktop CLI with `HOME`/`XDG_*` isolated, the flat global
file installed, and asserts `loading plugin`, 42 tools, and one tool call.

---

## Runtime cost (P1)

### B-01 Schema work is duplicated at boot — open

`collectToolSchemas` runs before registration and again after readiness, then
`ctx.tool.reload()` reloads all tools. Observed boot: `initPlugin` 8–23 ms,
then 350–550 ms to `registered 42 tools`.

Next: generate schemas at build time, read one JSON file at boot, and skip
`tool.reload()` when the schema hash is unchanged.

### B-02 Retry budget can hide tools for 10 s — open

`SCHEMA_RETRY_ATTEMPTS=20` × `SCHEMA_RETRY_DELAY_MS=500`. During that window
the host shows placeholder schemas. Next: readiness event or 6 attempts
(about 3 s), with one warning line.

### B-03 `tool-run-log.json` is 2.2 MB pretty-printed — open

`ToolRunLog.load()` parses the whole file at boot; `save()` serializes the whole
array with `JSON.stringify(..., null, 2)` and rewrites the file. Next:
append-only JSONL with rotation at 2000 entries and a compact save.

### B-04 Backups exceeded the owner cap — done (2026-10-25)

Owner requirement: at most 2 backups per state file. Two mechanisms existed
and they disagreed with each other and with the register:

- `src/utils/atomic.ts` had `MAX_BACKUPS = 5` and prunes to that count, so the
  timestamped scheme `.bak.<ts>.<hex>` kept 5 per file.
- `src/context/managers/StateManager.ts` had `MAX_BACKUPS = 3` with a rotation
  that actually keeps `MAX_BACKUPS + 1` files (`.bak.0` through `.bak.N`), so
  the numbered scheme kept 4.
- `ISSUES.md` itself said 3, and the two code sites disagreed with each other.

Resolution: `atomic.ts` is now 2, and `StateManager.MAX_BACKUPS` is 1 so its
rotation also ends at 2 files. Verified by an isolated probe (6 consecutive
writes of one file leave exactly 2 backups) and by the built bundle containing
both new constants.

Cleanup on this machine (2026-10-25, owner approved): 41 redundant files
removed — 33 `.bak.*` pruned to 2 per base across `.opencode/`, the project
root, the global v2 state dir, and the legacy v1 state dir, plus 75 stale
`*.tmp` write leftovers in `~/.config/tawassul/state`. Measured before: 35
live backups plus 5 new ones in a single hour (288/day rate for the router);
measured after: at most 2 per base everywhere.

### B-05 Tool schema payload is unmeasured — open

42 tool schemas are sent with every request and may dominate session load.
Next: measure total schema bytes and estimated tokens before changing
anything; pair the result with G-04's boot budget.

---

## Verification gate (P1 unless noted)

### G-01 CI spawns about 35 separate npm/bun processes — done

Resolution: `npm run ci` is now `bun scripts/gate.ts all`. It spawns three
stage processes sequentially (`fast`, `proofs`, `smoke`) and each proof is one
`bun` child inside the proof stage. The old 30-command `&&` chain is gone.

Measured 2026-10-25: fast 11.7 s (6 steps), proofs 21.3 s (25 proofs), smoke
13.8 s (2 steps), total about 47 s. The smoke keeps the plugin-boot evidence
when the model provider returns a transport error and only fails when
`initPlugin` or 42 registered tools are missing.

### G-02 No fast tier — done

Resolution: `npm run gate:fast` runs rules, shell syntax, typecheck, config,
facts, and the proof catalog. `npm run gate:proofs` and
`npm run gate:smoke` are separate commands. `npm run gate:proofs -- --only
s028 --timings` runs one proof with per-step durations. Each stage is its own
OS process, so the heavy stages cannot corrupt the fast checks.

### G-03 Catalog parses the CI string — done

Resolution: `scripts/gate-manifest.json` is the source of truth.
`prove-proof-catalog` validates the manifest (every `prove-*.ts` file wired
exactly once, every target exists, `ci` is the umbrella with no `&&`, and
`verify` remains `gate:fast` plus the build). It runs in the fast stage.

### G-04 No boot budget proof — open

Nothing fails when boot time regresses. The smoke records `initPlugin` and
`registered 42 tools` but does not enforce a budget. Next: `prove:boot-budget`
with a measured budget (candidate 150 ms from init to 42 tools).

### G-05 No live blocked-tool proof — open (P1)

`isBlockError` rethrows `ToolBlockedError` and `isBlockedForAgent` denies the
tawa list (`src/v2/setup.ts:56-67`), but no proof runs a blocked tool through
a live host and asserts the run fails. The proofs never mention
`ToolBlockedError` or `BLOCKED_TOOLS`.

Next: in an isolated host run, ask tawa to call `bash` (or trigger the dedup
guard) and assert a tool error and no side effect; add a unit test that
`isBlockError` rethrows both error names.

### G-06 Guard matrix has no v2-content regression proof — open (P1)

`--expect v2` now refuses v1 content with `marker-v1-content`, but
`CUTOVER.md` section 3 has no row for it. The only generation-guard proof is
the `non-v2-path` refusal in `prove-db-retention.ts:82`; the
`marker-v1-content` path is untested. `prove-v2-independence.ts:66` only
checks the launcher's guard string.

Next: add the row to `CUTOVER.md` and a proof that builds a synthetic v1 DB
at a `tawassul-v2` path, runs `--expect v2`, and asserts rc=2 and
`reason=marker-v1-content`; add the reverse `--expect v1` row too.

### G-07 SDK pins are not asserted in CI — open (P2)

The pins agree today (E-09), but nothing fails when `package.json`,
`.opencode/package.json`, the lockfile, and the installed package diverge.
The host pin (`2.1.4`) is checked by the global installer and `verify:global`
but not by the fast gate.

Next: a fast check that reads all four versions plus the host pin and fails on
disagreement, wired into `gate:fast`.

### G-08 No Desktop-wide plugin-entry census — open (P2)

`doctor-v2.sh` checks this project's entry and the global install, but it does
not enumerate other workspaces. The 2026-10-25 scan that found "exactly one
active entry" matched flat `tawassul.js` files only and missed three
`plugins/tawassul/index.ts` entries (H-09, P-07).

Next: add an opt-in `doctor-v2.sh --scan-desktop` that enumerates
`plugin(s)/*.{js,ts}` and `plugin(s)/*/index.{js,ts}`, flags v1 shapes and
dual `setup` exports, and prints a count per workspace. Add a fixture proof
for one v1-only package entry and one dual entry.

### G-09 The smoke gate fails on a provider quota refusal — done (2026-10-25)

`scripts/release-smoke.sh` treats a non-zero boot exit as a gate failure unless
it is a timeout or a transport-shaped error (`ECONNRESET`, `ETIMEDOUT`,
`timed out`, `timeout`). A provider refusal such as `provider.free-limit`
(status 429, `FreeUsageLimitError`) is not tolerated, so the smoke fails even
though the plugin boot is healthy. Observed 2026-10-25: `initPlugin=7.20ms`,
`v2 registered 42 tools` three times, `INIT_AUDIT health: healthy`, schemas
refreshed — and the gate still exited 3 on the 429.

Root cause is partly self-inflicted: the smoke links
`$HOME/.local/share/opencode/auth.json` as `AUTH_SRC`, but that file does not
exist on this host (credentials live in the sidecar `credential` table), so the
scratch boot always uses the anonymous free endpoint.

Resolution (2026-10-25): the tolerated-error branch now accepts a provider
refusal (`provider.<name>`, `FreeUsageLimitError`, a 429 status, or the free-limit
text) and prints "model reply unavailable (provider refused — quota or auth) —
plugin boot verified, continuing". The missing `AUTH_SRC` file no longer fails
silently: the smoke warns that the scratch boot runs on the anonymous free
endpoint so a quota refusal is expected.

Verified with the quota actually exhausted: `npm run gate:smoke` and then the
full `npm run ci` both pass, with `INIT_AUDIT health: healthy`, 42 registered
tools, and health + help executed. Remaining nit: the smoke cannot pick a
quota-free provider because no `auth.json` exists on this host; that needs an
owner decision on where the real credential source lives.

---

## Data and state (P1)

### D-01 Three database paths — deferred by owner (2026-10-25)

Re-raised by evaluation finding E-08; the decision below is unchanged.

Owner instruction (2026-10-25): this plugin ships to end users. A missing
session is data the user cannot recover, so the defect must be removed
structurally rather than mitigated by documentation. Acceptable shapes are a
single deterministic write path plus fail-closed detection of a second
project database, or an automatic move with a verified backup. A warning the
user never reads is not acceptable.

- Desktop sidecar: `~/.local/share/opencode/tawassul-v2/opencode.db`
  (21 MB + 9.5 MB WAL, written continuously; `OPENCODE_DB` is set by
  `~/.config/tawassul/launchers/opencode-desktop-iso.sh` for the v2 lane).
- Shared CLI DB: `~/.local/share/opencode/opencode.db` (24 MB, last write
  2026-10-25 04:35; no live process holds it).
- Launcher DB: `~/.local/share/tawassul-v2/opencode-v2.db` (13 MB, dev and
  smoke runs only).

The Desktop descriptor points every client at the sidecar, so the CLI and
launcher paths are only used by isolated runs. Unifying them needs an explicit
decision because it touches live sessions.

Measured on 2026-10-25, the sidecar already uses the dedicated DB, and the
three files carry three different roles rather than three competing choices.
Recommendation (not adopted): sidecar DB canonical, shared DB legacy read-only
for the D-02 import, launcher DB test-only. Nothing would be deleted or moved.
Owner deferred the decision; the three paths stay as they are.

Next: the owner names the three roles (pending decision 5). Until then this
issue has no engineering action.

### D-02 Old sessions are not imported — open

Source: `/home/htoz/Videos/New Folder/` (old DBs, storage, snapshots).
Next: import only after D-01 is decided (pending decision 5), with a backup
and a generation guard, and keep the import read-only.

### D-03 Project state moved to `.opencode` but root leftovers remain — open

E-06 fixed the write path: `stateFile` is
`join(projectStateDir, fileName)` in `src/bootstrap/service-factory.ts:196`,
so new state lands under `<project>/.opencode`. The root
`collective-memory-515c5c5d.json` and its empty `.bak` are old leftovers;
they are untracked and need owner approval before deletion. A scan for other
root `collective-memory*`, `trust-score*`, `cost-transparency*`, and
`background-coordinator*` files is still missing.

Next: run that scan, keep anything v2 still reads, and delete the rest with
owner approval (pending decision 6).

---

## Product gaps (P2 unless noted)

- **P-01** `select`/`input` elicitation: host `permission.assert` returns only
  confirm; `src/v2/ask.ts:40` returns `undefined` for every other type. In
  addition, `isNoReply` maps AskChannel's `noReply: true` to
  `delivery: "queue"` (`src/v2/client-shim.ts:47,55`), so a consent question
  becomes a real queued user turn and burns a model turn. Next: bridge or
  fail closed, and render the question without a queued turn. P1 per E-03.
- **P-02** A goal closed from `completed` writes a `dropped` tombstone; the
  digest counts stay correct, the label is cosmetic. Next: accept the label as
  cosmetic, or write `completed` for a `completed`-origin close; no data is at
  risk either way.
- **P-03** N2 assistant dedup set is capped at 512; long sessions can
  re-process an old message. Next: raise the cap or evict by age, and measure
  a 500-message session for the current miss rate first.
- **P-04** Independence is proven statically; a real boot with the v1 tree
  renamed is still missing. `scripts/prove-v2-independence.ts` scans
  `src/**/*.ts` and the launcher, matches a literal plugin filename, and skips
  `scripts/*.sh`, `tests/`, `.opencode/`, `dist/`, and dynamically built
  paths. It does not inspect the v1 tree's bootable package entry (H-09).
  Next: boot a scratch workspace with the v1 tree renamed, census
  `opencode.json` plugin/mcp keys and `plugin(s)/*/index.*`, follow symlinks,
  scan every tracked file, and assert one effective host entry. P1.
- **P-05** Residue across six workspaces: 12 `tawassul.js.pre-refresh-*`
  copies and 14 `*.retired-20261024` files (7 `tawassul.js` plus 7
  `tawassul.mjs`, across the six workspaces and the v1 tree). A name probe
  proved these are not loadable: only files whose suffix is exactly
  `.js`/`.ts` load, and both `.opencode/plugin` and `.opencode/plugins` are
  scanned. Nine package directories also exist at `.opencode/plugins/tawassul/`
  (the six plus `gtttt`, `paassss`, and the v1 tree): six contain only
  `dist/index.js` and are not discovered; `gtttt` and `paassss` carry a
  v1-only `index.ts` and are discovered (P-07); the v1 tree's `index.ts` was
  renamed to `index.ts.retired-20261025` on 2026-10-25 (H-09, done) and is now
  inert like the six. Deletion or neutralization needs owner approval
  (pending decision 3).
- **P-06** Legacy global config `~/.config/opencode/package.json` pinned
  `@opencode-ai/plugin@1.17.14`; done — H-06 removed the v1 SDK pin and the
  file is now `{}` with no `node_modules`.
- **P-07** Two full v1 source trees, `gtttt` and `paassss`, expose
  `.opencode/plugins/tawassul/index.ts` with a v1-only `{ id, server }`
  default and `.opencode/node_modules/@opencode-ai/{plugin,sdk}` 1.18.25. The
  v2 host discovers `plugins/<dir>/index.ts` (proved with a synthetic plugin)
  and logs `failed to load plugin`: "Plugin must export a default definition
  with an id and an effect or setup function." The run continues, but every
  boot in those workspaces logs a failure and D-00 is violated. Next: with
  owner approval, rename the two `index.ts` files to
  `index.ts.retired-20261025` (or remove the package dirs), and add the G-08
  doctor scan. P1.

---

## Evaluation report triage (feat-bc3edbad, round 1)

Source: independent audits of `94ccda8..ef566e8`, 10 findings. Triaged against
HEAD `d740865` on 2026-10-25. "Fixed" means the code changed and a check
exists; "stale" means the finding no longer matches the tree.

### E-01 execute.before swallowed ToolBlockedError — fixed; proof gap in G-05

Original severity: critical. `src/v2/setup.ts:56-59` adds `isBlockError`
and rethrows `ToolBlockedError` / `ConsentBlockedError`; the bridge catches
only other errors. The seven `blockTool()` sites in
`src/hooks/tool-execute.ts:185-266` now reach the host.

Remaining: no proof that a blocked tool actually fails a live run (G-05).

### E-02 v1 config hook is not bridged — open (partially mitigated)

Original severity: critical. `plugin.config` is only logged at
`src/v2/setup.ts:377-381`; it is not called. The dynamic model fix and the
tawa/addagent permission repair (`src/bootstrap/plugin-init.ts:85-126`,
wired at `plugin-init.ts:838-840`) therefore never run on the v2 host.
Mitigations: `gen-opencode-config` bakes models and permissions into
`opencode.json`, and `execute.before` denies `BLOCKED_TOOLS` for tawa via
`isBlockedForAgent` (`setup.ts:62-67`). Risk: a hand-edited or stale config,
or a roster changed after generation, is not repaired at boot.

Next: apply the three helpers from the v2 boot path (a config writer or a
`ctx.app`/`ctx.permission` bridge), then prove a denied tawa tool fails and
addagent permissions are present. This is the live half of G-05.

### E-03 noReply queues a user turn; select/input unbridged — open (P-01)

Original severity: major. `isNoReply` maps `body.noReply === true` to
`delivery: "queue"` (`src/v2/client-shim.ts:47,55`). AskChannel injects the
question with `noReply: true` (`src/bootstrap/plugin-init.ts:308`), so every
consent question becomes a queued user turn instead of a transcript-only
render. `src/v2/ask.ts:40` handles only `type === "confirm"`; select/input
return `undefined`.

Next: route AskChannel through `permission.assert`, fall back to `ctx.ask`,
and either bridge select/input or fail closed with a visible error. Tracked
as P-01; this entry keeps the evaluation evidence.

### E-04 Legacy state path and quarantine — fixed

Original severity: major. `legacyStateCandidateDirs()` now includes both
`~/.config/tawassyl/state` and `~/.config/tawassul/state`
(`src/utils/state-paths.ts:39-47`), and `legacyFallbackFor` resolves both the
v2 state dir and a project `.opencode` parent (`state-paths.ts:83-95`).
Rejected files go to `quarantinePath()` under the v2 state dir
(`src/services/persist-utils.ts:106-112`), not into the legacy tree.

### E-05 `--expect v2` accepted v1 content — fixed; matrix/proof gap in G-06

Original severity: major. `scripts/guard-db-generation.sh:236-243` now
refuses `marker-v1-content` when the v2 lane finds a non-empty DB with no
`session_v2` marker. The `--expect v2` + v1-content row is missing from
`CUTOVER.md` section 3, and the `marker-v1-content` path has no proof; the
only guard proof covers `non-v2-path` (G-06).

### E-06 Project state written to the repo root — fixed; leftovers in D-03

Original severity: major. `service-factory.ts:196` defines `stateFile` as
`join(projectStateDir, fileName)`, so collective memory, trust score, cost
transparency, and background coordinator state land in
`<project>/.opencode`. The root `collective-memory-515c5c5d.json` and its
empty `.bak` are leftovers (D-03).

### E-07 Independence proof is static — open (P-04)

Original severity: major. `scripts/prove-v2-independence.ts` scans
`src/**/*.ts` plus the launcher for v1 paths/imports and matches a literal
host filename. It skips `scripts/*.sh`, `tests/`, `.opencode/`, `dist/`, and
dynamic paths, and never boots with the v1 tree unreachable. It also misses
the v1 tree's bootable package entry (H-09). Next: the expanded action is
P-04; this entry adds the H-09 case to it.

### E-08 Three database paths — deferred by owner (D-01)

Original severity: major. Unchanged. The evaluation cites the 2026-10-25
"cannot find this session" incident (`RECOVERY-20261025.md`). D-01 keeps the
recommendation without moving files; the action is pending decision 5.

### E-09 SDK pin mismatch — fixed; agreement check in G-07

Original severity: major. Current pins: root `devDependencies` `^2.1.4`,
`.opencode/package.json` `2.1.4`, root `node_modules` `2.1.4`,
`.opencode/node_modules` `2.1.4`, lockfile `2.1.4`. No CI assertion keeps
them in agreement (G-07).

### E-10 Reverted working tree / tsc failure — stale

Original severity: minor. `git status` is clean apart from five known
untracked files; `tsc --noEmit` passes and `npm run ci` is green at
`d740865`. The finding described an intermediate working-tree state, not
HEAD. Next: none; the entry stays closed and only documents the audit's
baseline.

---

## Pending owner decisions

1. ~~H-09~~ — done 2026-10-25. The owner renamed
   `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/index.ts` to
   `index.ts.retired-20261025`; an isolated boot of the final tree loads no
   plugin and writes no state.
2. **P-07:** with approval, rename the v1-only `index.ts` entries in
   `/home/htoz/Desktop/gtttt/.opencode/plugins/tawassul/` and
   `/home/htoz/Desktop/paassss/.opencode/plugins/tawassul/` (or remove the
   package dirs). Both are discovered and fail to load on every boot.
3. Delete the 12 `tawassul.js.pre-refresh-*` copies, the 14
   `*.retired-20261024` files, and the six inert `dist`-only
   `.opencode/plugins/tawassul/` package dirs (`athan new vrsion`,
   `ciel-osk-workspace`, `dart22222222`, `vpro`, `vusial 2`, `vusual`).
4. Delete the `/tmp/opencode` artifacts from this work: `global-probe`
   (20 MB), `global-e2e` (23 MB), `pkg-probe` (8.7 MB),
   `build-global-test` (2.2 MB), `build-self` (3.0 MB), `bundled-probe`
   (404 KB), `pkg-shape-probe`, `gtttt-probe`, `v1tree-probe`,
   `v1tree-verify`, `name-shape-probe`, `parse-test.ts`, and `ci-full.log`; also
   the older `smoke-probe`
   (orphan stopped, port 38335 closed), the dangling
   `opencode-v1-bun-symlink-20261025`, and
   `global-config-v1-backup-20261025`. The `~/.opencode` tree was already
   deleted in H-02; there is no backup of it under `/tmp/opencode` (the
   earlier pending text was wrong). `schema-payload` was deleted on
   2026-10-25 after the quota diagnosis. `v1-retire-backup` (six old
   `opencode.json` copies) needs a separate keep/delete decision.
7. Legacy state residue (done 2026-10-25): the 75 stale `*.tmp` files and the
   extra `.bak.*` files under `~/.config/tawassul/state/` were removed with the
   B-04 cleanup; the single remaining router file stays as the permitted
   read-only legacy fallback. Its root-level siblings (`cost-transparency.json`,
   `collective-memory-515c5c5d.json`) are still pending under item 6.
5. D-01: name the sidecar DB canonical, the shared DB legacy read-only, and the
   launcher DB test-only. No file is deleted. Deferred on 2026-10-25.
6. Keep or drop the untracked `scripts/check-shared-anchors.mjs`,
   `scripts/port-from-v1.mjs`, and `test-utils.ts`, plus the root
   `collective-memory*` files.

## Verification baseline (for regression)

Known open defect at baseline time: `gate:smoke` used to fail with rc=3
whenever the provider's free-tier quota was exhausted; fixed 2026-10-25 (G-09).
Both `gate:smoke` and the full `ci` now pass with the quota exhausted.

- `npm run verify`: `gate:fast` plus the build (`dist/index.js` and `dist/global.js`).
- `npm run gate:fast`: 6 steps, about 11.7 s.
- `npm run gate:proofs`: 25 proofs, one child each, about 21.3 s.
- `npm run gate:smoke`: build + release smoke, about 13.8 s.
- `npm run ci`: rc=0, 26 `PROOF PASS` (25 proof steps plus the catalog),
  `SMOKE PASS: host v2.1.4, scratch boot, 42 tools, health + help`, about 47 s.
- The baseline above was measured with no `opencode` on PATH: the launcher and
  smoke both resolve the Desktop-bundled CLI.
- Bundles identical: `dist/index.js` and `.opencode/plugin/tawassul.js`
  (1,858,782 bytes). The opt-in global bundle is `dist/global.js`
  (2,296,549 bytes, self-contained).
- `prove-global-install` is one of the 25 proof steps: flat layout, bundle
  hash, four wasm assets, `VERSION` marker, scope detection, v1/legacy
  refusal, unmarked target refusal, `--force`, tamper repair, coexistence
  unit claim, uninstall, dry run, purge, and verify-missing.
- Isolated-HOME host boot of the flat global file (manual, host v2.1.4):
  `loading plugin` for `plugins/tawassul.js`, global roster plus agents
  created, `astquery sample.ts` returned the function symbol through
  `tawassul-runtime/wasm/`, no `failed to load plugin`.
- Real machine state: `~/.config/opencode/` has no `plugins/`, no
  `tawassul-runtime/`, and no `tawassul-v2/`; the real global install is not
  performed (I-01).
- Shape probe (host v2.1.4): `plugins/a-dist/dist/index.js` was not
  discovered; `plugins/b-index-ts/index.ts` and `plugins/c-index-js/index.js`
  were. A v1-only `{ id, server }` export failed with "Plugin must export a
  default definition with an id and an effect or setup function"; a dual
  `{ id, server, setup }` export booted (H-09).
- Name probe (host v2.1.4): `plugins/flat-ok.js` and `plugin/singular.js`
  loaded, while `flat-ok.js.pre-refresh-20261020` and
  `flat-ok.js.retired-20261024` did not. Both the singular `plugin/` and the
  plural `plugins/` directories are scanned, and suffixed copies are inert.
- H-09 closure (2026-10-25): after the owner renamed
  `tawassyl/.opencode/plugins/tawassul/index.ts` to
  `index.ts.retired-20261025`, an isolated boot of a copy of the final tree
  shows zero plugin-load lines for `plugins/tawassul`, zero agents, and no
  state files. The v1 tree package directory is now inert. `gtttt` and
  `paassss` still expose a v1-only `index.ts` (P-07, open).
- The smoke accepts a provider transport error only after `initPlugin` and
  `v2 registered 42 tools` are confirmed; a missing plugin boot fails.
