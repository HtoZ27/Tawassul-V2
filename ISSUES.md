# Tawassul V2 — Issue Register

Status date: 2026-10-26 · Gate: `npm run ci` rc=0 (3 isolated stages, 42 proof files, smoke pass)
Real global install: not performed (opt-in; see I-01).
Active P0: none open — E-12 (state writes reported before they happen) and
E-13 (a rejected state file replaced by an older backup) are resolved. The
running host still predates the current build (G-13).
Register note: the third-round evaluation (2026-10-26) added E-11..E-41 and
re-confirmed C-02, C-03, P-10, B-02, E-02, and G-13 without duplicating them.
Stability view: `STABILITY.md` classifies all 52 open entries by whether they
block use, lose data, or misreport, and gives the wave order.
`SHARED.md` audit (2026-10-26): all 57 frozen entries are dispositioned in
`VERIFICATION-20261026.md`; the only gaps that were actionable in this tree are
`P-11` (from S-057) and `G-14` (the S-053 guard fixture), both now closed.

Purpose: one durable place for open issues, evidence, and the next action, so
development context survives session loss. Severity: P0 (can corrupt state or
freeze a boot), P1 (correctness or measurement gap), P2 (quality/parity).
State: `open`, `in_progress`, `blocked`, `done`.

## Owner decisions

- **Bash permission is off-limits (2026-10-26).** Do not change the `bash`
  permission of any agent, in `opencode.json` or in the roster. The host's
  own agent-invocation path depends on it, so tightening it can break
  delegation itself. Consequence for this register: guard fixes must never
  be implemented by editing a `bash` permission entry, and no safety hook may
  convert an infrastructure error on `bash` into a hard block (see the note
  in E-18). Guard code may still inspect and refuse a *specific* command.
- **D-00 (2026-10-25): v1 is retired permanently.** It will not work in any
  project again. It is not a compatibility target: any v1 plugin entry, v1
  host, or v1 global dependency is a defect. v2 is the only plugin. Two hosts
  run only in isolated tests. Evidence: a Desktop-wide scan finds exactly one
  active flat `tawassul.js` entry (this tree); the six other workspaces and
  the v1 tree have `.retired-20261024` markers and no active `tawassul.js`.
  Correction (2026-10-25): that scan matched flat files only. Three
  directories also carried `plugins/tawassul/index.ts`: `gtttt` and `paassss`
  exported a v1-only shape and failed the v2 plugin schema (P-07, resolved
  2026-10-26), while the v1 tree `tawassul` exported `{ id, server, setup }` and booted a
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
- Full `npm run ci` after removal: rc=0, 26 `PROOF PASS` (25 steps plus the
  catalog), `SMOKE PASS`.
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
- Hazard before the fix: `scripts/opencode-v2-iso.sh` ended with
  `exec "$OPENCODE_BIN" "$@"` and did not force `--standalone`. If the client
  saw a service descriptor, it could attach to the Desktop server, where
  `OPENCODE_DB`/`XDG_*` from the launcher had no effect. Dev runs could then
  write to the live DB and state.

### H-04 Service descriptor is the single source of truth — done

Resolution: `scripts/doctor-v2.sh` prints the descriptor URL and PID, checks
that the PID is alive, reports the resolved `opencode` on PATH, flags a
terminal install and a `~/.opencode/bin` PATH export, and lists every
Desktop-bundled CLI with its version.

Measured 2026-10-26: descriptor PID `1537214`, URL
`http://127.0.0.1:49374`, started 03:46:40; parent app PID `1536678` started
03:46:25. The sidecar's `/proc/1537214/environ` carries
`OPENCODE_DB=/home/htoz/.local/share/opencode/tawassul-v2/opencode.db`; the
app parent carries no `OPENCODE_*` variables. The doctor now compares that
live DB with the shell's `OPENCODE_DB` and fails when they differ.

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

### I-01 Real global install is not performed — verified, deferred (owner opt-in)

State of this machine (2026-10-26): no global Tawassul install exists.
`~/.config/opencode/` contains `opencode.jsonc`, `package.json` (`{}`),
`package-lock.json`, `service.json`, and `.gitignore`; there is no
`plugins/`, no `tawassul-runtime/`, and no `tawassul-v2/`. The v1 terminal
install `~/.opencode`, the v1 Bun package
`~/.bun/install/global/node_modules/opencode-ai`, and the v1 binary
`~/.bun/bin/opencode` are also absent. The only live host is the Desktop
sidecar, and it loads the project bundle.

Reference and paths: the v1 docs place a global install under
`~/.config/opencode/plugins/` (or `~/.opencode` for the terminal install);
the v2 installer writes the flat file
`~/.config/opencode/plugins/tawassul.js` plus
`~/.config/opencode/tawassul-runtime/VERSION` and `wasm/`. The paths do not
collide, and the installer refuses a v1 package directory at the target.

V2 compatibility check (2026-10-26, no install): the host pin is v2.1.4 and
`~/.config/ai.opencode.desktop/cli/2.1.4-x64/opencode-cli` reports
`opencode v2.1.4`. `bun scripts/install-global.ts --dry-run` exits 0 and
would write a 2,297,954-byte self-contained bundle (SHA-256 prefix
`4c867fa0`) plus four wasm assets; all four wasm files resolve from
`node_modules`, and no v1 artifact blocks the install. Scope detection
returns `global` for the projected
`~/.config/opencode/plugins/tawassul.js` and `project` for the project
bundle. Nothing was written: the config directory still has only its five
original files.

Next: on explicit request, run `npm run build`, `npm run install:global`,
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

### B-03 `tool-run-log.json` is 3.1 MB pretty-printed — open

Measured 2026-10-26 05:28: 3,288,019 bytes and 1,909 runs, still growing
(3,245,127 bytes / 1,867 runs at 05:24; the 2.72 MB / 1,908-run figure in the
audit was already stale). `ToolRunLog.load()` parses the whole file at boot;
`save()` serializes the whole array with `JSON.stringify(..., null, 2)` and
rewrites the file. Next: append-only JSONL with rotation at 2000 entries and
a compact save.

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

Cleanup on this machine (2026-10-25, owner approved): 33 `.bak.*` files were
pruned to 2 per base across `.opencode/`, the project root, the global v2
state dir, and the legacy v1 state dir, and 75 stale `*.tmp` write leftovers
were removed from `~/.config/tawassul/state` (108 files in total). Measured
before: 35 live backups plus 5 new ones in a single hour (288/day rate for the
router); measured after: at most 2 per base everywhere.

Caveat (2026-10-26): the live host still wrote five router backups because the
loaded process predates `fa8fd71`; the cap holds for the source and the
rebuilt bundle, not for a running pre-fix process (G-13).

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

Tightened 2026-10-26: the report line now distinguishes an observed model
reply from a boot-only run. It prints `model reply` only when the `SMOKE`
text was actually received; otherwise it prints
`SMOKE PASS (no model reply)` so a quota-skipped boot can never be read as a
real round trip. `TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=1` turns the missing
reply into exit 5, and the default remains boot-tolerant. The latest full
`npm run ci` printed `SMOKE PASS: host v2.1.4, scratch boot, 42 tools, model
reply, health + help`.

---

## Data and state (P1)

### D-01 Three database paths — resolved by role assignment (2026-10-26), residual risk D-05

Re-raised by evaluation finding E-08; the owner adopted the recommended roles
on 2026-10-26.

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

Re-measured 2026-10-26 05:28: sidecar 22 `session_v2` rows, 2,541
`session_message` rows, 5 `project` rows, 29,343,744 bytes plus a 10,460,712
byte WAL (39,804,456 total); shared 14 `session_v2` plus 2 legacy `session`
rows and 1,268 `session_message` rows, 24,780,800 bytes; launcher 14
`session_v2` rows, 13,627,392 bytes, no `session` table. The 13/14/14 figure
in the 2026-10-25 note is obsolete.

Schema check against the OpenCode 2.1.4 reference
(`extracted_files/opt/OpenCode/resources/app.asar` and `opencode-cli`): the
host resolves `F4(o)` as `process.env.OPENCODE_DB` or `opencode.db` for the
`latest/dev/beta/next/prod` channels, resolved against
`$XDG_DATA_HOME/opencode`, and passes it as `database.path`. The live sidecar
therefore follows the same rule. The live v2 schema has **no** `message` or
`part` tables; its history is `session_message`. Any maintenance that assumes
the legacy schema would have failed after taking a backup.

The Desktop descriptor points every client at the sidecar, so the CLI and
launcher paths are only used by isolated runs.

Decision (2026-10-26): the owner adopted the recommendation. The sidecar DB
is the canonical single write path; the shared DB is legacy read-only for the
D-02 import; the launcher DB is test-only. Nothing is deleted or moved.
`scripts/doctor-v2.sh` now prints the canonical DB, labels the two
non-canonical copies, passes when sessions exist only in those declared
roles, and fails when an undeclared database holds sessions or when the
canonical DB is empty while a copy holds them. The host still sees only the
sidecar; D-02 imported the 14 shared and 14 launcher sessions on 2026-10-26
(26 new sessions, 384 messages). The copies stay read-only as backup
material.

Residual risk (D-05, 2026-10-26): the roles are a declaration, not yet an
enforced write barrier. The doctor's census is a fixed list: `$db`, the
canonical path, `$SHARED_DB`, `$LAUNCHER_DB`, and the v1
`opencode-projects/<hmac>` path (`doctor-v2.sh:89,218-221`). The current v2
CLI launcher writes `opencode/tawassul-v2/projects/<hmac>/opencode.db`
(`opencode-iso.sh:124,130,135`), which is never probed. The "read-only"
shared and launcher copies are only warned about, never checked against their
14/14 import baseline (`doctor-v2.sh:229`). A second v2 CLI database with
sessions, or a new write into a legacy copy, therefore still passes. The
roles remain the right stabilization choice; D-05 records the enforcement
gap and the recommended bounded census, baseline guard, and no-auto-move
decision.

### D-02 Old sessions are not imported — done (2026-10-26)

Source: `/home/htoz/Videos/New Folder/` (old DBs, storage, snapshots).

Import executed 2026-10-26 05:51 against the canonical sidecar while the host
was live. Pre-import backup:
`/home/htoz/.local/share/opencode-backups/20261026/opencode-pre-import-20261026-055107.db`
(31,125,504 bytes, `integrity_check=ok`, 22 `session_v2` / 2,712
`session_message`; SHA-256 in the adjacent `.sha256` file). Scope: the 12
shared-DB sessions absent from the sidecar and all 14 launcher sessions, with
their 342 + 42 `session_message` rows. The 2 shared sessions already present
were skipped by ID.

Result: 26 sessions and 384 messages imported; canonical totals 48 sessions
and 3,100 messages at commit (3,110 after the host's next writes).
`integrity_check=ok`, `foreign_key_check` empty, zero duplicate session or
message IDs, zero duplicate `(session_id, seq)`, zero orphan messages.
Protected counts unchanged: project 5, credential 6, instruction_blob 22,
instruction_state 22, worktree 2, event 0, event_sequence 24. The live
`GET /api/session` returns 48 rows including the three spot-checked imported
IDs, and `doctor-v2.sh` passes `one canonical session DB: OPENCODE_DB 48/48`.

The shared and launcher DBs were read from copies and were not modified
(mtimes still 2026-10-25). Not imported: the two legacy `session` rows plus
4 `message` / 2 `part` rows in the shared DB, and the v1 archives
`/home/htoz/Videos/New Folder/opencode/opencode.db` (223 `session`) and
`opencode-desktop.db` (280 `session`), because they use the v1 schema with no
`session_v2`; they stay read-only. The 90-day `session_message` retention
still applies to imported history; run maintenance with `--prune-days 0` if
it must be kept indefinitely.

### D-03 Project state moved to `.opencode` but root leftovers remain — done (2026-10-26)

E-06 fixed the write path: `stateFile` is
`join(projectStateDir, fileName)` in `src/bootstrap/service-factory.ts:196`,
so new state lands under `<project>/.opencode`.

Scan run 2026-10-26: the root held exactly five leftovers —
`collective-memory-515c5c5d.json` (2,752 bytes) plus a zero-byte
`.bak.1792903295011.eb0c96a3c9c8`, and `cost-transparency.json` (25,718 bytes)
plus two backups (24,216 and 24,563 bytes). No `trust-score*` or
`background-coordinator*` files existed. The root copies were older than the
live `.opencode` files, and nothing in the tree reads them.

Resolved 2026-10-26: all five root leftovers were deleted with owner
approval. The scratch area was also cleaned (1.09 GB under `/tmp/opencode`,
including four `v1tree-*` copies at ~946 MB total). The live copies remain
under `.opencode`.

### D-04 DB maintenance could mutate the wrong DB or schema — fixed (2026-10-26)

Owner-approved protection plan. Before this fix the maintenance lane fell back
implicitly to the isolated launcher DB, mutated `message`/`part` without a
schema probe, and could leave the launcher above the 4 GiB cap. On the live
v2 schema the prune would have failed *after* taking the backup.

Fixed in `scripts/opencode-db-maintenance.sh` and
`scripts/opencode-v2-iso.sh`:

- **Explicit target only.** `--db` or `OPENCODE_DB`; no implicit fallback.
  `--plan` prints the contract for review.
- **Mutation allowlist.** Only `message`, `part`, `session_message`, and
  `event` may be deleted; every mutation re-checks the allowlist.
- **Protected census.** `session`, `session_v2`, `project`, `workspace`,
  `worktree`, `project_directory`, `permission`, `credential`, `account*`,
  `migration`, `kv`, `instruction*`, `session_inbox`, `session_pending`,
  `session_share`, `todo`, `event_sequence`. Counts are compared before and
  after; any change exits 9 before VACUUM and names the verified backup.
- **v2 schema.** `session_message` is pruned with the same fresh-session
  guard as the legacy `message` path; an unprovable schema refuses. The
  backup probe compares `session_v2`, `session`, and `session_message`.
- **Cap.** Default 4 GiB (`TAWASSUL_DB_CAP_BYTES`), measured on DB + WAL.
  Event-only exits 9 when the cap remains; the full run exits 9 when the cap
  remains after VACUUM. The launcher refuses an unmeasurable or over-cap DB
  unless `TAWASSUL_ALLOW_OVER_CAP=1`, and starts background maintenance only
  when event retention actually relieved the cap.
- **Proof.** `scripts/prove-db-retention.ts` now asserts the allowlist and
  census, implicit-target refusal, v2-only schema, protected-table survival,
  backup contents, and the cap exit code.

Evidence: isolated proof passes; a real-schema copy of the live DB completed
full maintenance with a verified backup (`session_v2=21`, `session=0`,
`session_message=2519`), all protected counts unchanged, and 38 MB → 22 MB;
the full `npm run ci` passes. D-01 roles were adopted on 2026-10-26: the
sidecar is canonical, the shared DB is legacy read-only, and the launcher DB
is test-only.

### D-05 Doctor census misses the v2 CLI namespace and accepts legacy growth — open (P1)

D-01 declared the roles, but `doctor-v2.sh` enforces them over a fixed list of
five paths rather than a bounded census. It counts `$db`, the canonical path,
`$SHARED_DB`, `$LAUNCHER_DB`, and `expected` (`:218-221`); `expected` is the
v1 namespace `~/.local/share/opencode-projects/<hmac>/opencode.db` (`:89`).
The v2 CLI launcher writes a different namespace:
`~/.local/share/opencode/tawassul-v2/projects/<hmac>/opencode.db`
(`opencode-iso.sh:124,130,135`, with `mkdir -p` at `:133`). Nothing in the
doctor enumerates that tree, so a database there is never counted. It cannot
trigger the "undeclared database" failure (`:223`) or the "canonical DB has no
sessions while a legacy/test copy does" failure (`:225`) unless the caller
happens to export its path as `OPENCODE_DB`. The same fixed-list limitation
applies to every other `opencode-projects/<hash>` database.

Latent today, not active: `~/.local/share/opencode/tawassul-v2/projects/`
contains only `c9f1bc47443da701/`, the HMAC of `/home/htoz/Desktop/tawassyl`,
and that directory has no `opencode.db`. The current root
(`/home/htoz/Desktop/Tawassul V2`) hashes to `20744975b9574157`, so a v2 CLI
launch from this tree would create the first unprobed database. The role
assignment never said the CLI lane cannot run; it only labelled the old
launcher file as test-only.

Second gap: "read-only" is not checked. The shared copy is legacy read-only
and the launcher copy is test-only, but the doctor only warns that they are
retained (`:229`). It does not compare their counts with the 14/14 D-02
baseline, so a process that opens either copy and writes a session still
passes. The declaration prevents nothing by itself; only a growth check does.

Recommended shape (D-05, owner decision 8; not implemented):

- Bounded census: enumerate `opencode.db` up to depth 3 under
  `~/.local/share/opencode`, `~/.local/share/tawassul-v2`, and
  `~/.local/share/opencode-projects`, skip symlinks, open read-only, classify
  every hit, and fail on any path with sessions that is not canonical, the
  shared legacy copy, the launcher test copy, or the v1 HMAC path. Cap the
  scan (for example 32 files) and fail closed when the cap is reached.
- Baseline guard: record shared=14 and launcher=14 at the D-02 import and
  fail when either grows; allow a deliberate import only through an explicit
  flag. This is the difference between a label and an enforced role.
- CLI namespace: either declare the v2 project DB as a test-only role in the
  census and fail when it holds sessions, or require an explicit isolated-test
  flag before the launcher creates or opens a non-canonical DB. Do not merge
  it automatically.
- No boot-time auto-move: the sidecar can be live with a WAL, the copies may
  be read-only or stale, and there is no freshness proof. A failed move can
  leave the canonical empty, which is the failure D-01 exists to prevent.
  D-02 already did the one-time import with a verified backup; later copies
  need an explicit, backed-up import.

Verdict: the owner's role choice is correct as the stabilization step and
should be kept. It becomes the structural guarantee the owner asked for only
when D-05 closes the census and growth gaps.

---

## Product gaps (P2 unless noted)

- **P-01** `select`/`input` elicitation: fixed in `ccb2cb6`. Unbridged types
  now throw a visible error instead of returning `undefined`; `noReply` uses
  `session.synthetic` and never queues a model turn. The plugin SDK 2.1.4 has
  no select bridge, so an unbridged tool call fails closed rather than
  guessing. The host protocol does expose `session.form.create/reply/list/
  cancel`, but `@opencode/plugin` 2.1.4 does not surface it; closing P-01 for
  real needs the SDK form surface or a direct protocol client. P1 per E-03.
- **P-02** A goal closed from `completed` writes a `dropped` tombstone; the
  digest counts stay correct, the label is cosmetic. Next: accept the label as
  cosmetic, or write `completed` for a `completed`-origin close; no data is at
  risk either way.
- **P-03** N2 assistant dedup set is capped at 512; long sessions can
  re-process an old message. Next: raise the cap or evict by age, and measure
  a 500-message session for the current miss rate first.
- **P-04** Independence is proven statically; a real boot with the v1 tree
  renamed is still missing. `scripts/prove-v2-independence.ts` scans
  `src/**/*.ts` and `scripts/**/*.{ts,sh}`, checks the launcher by literal
  filename, and walks the repo except `node_modules`, `.git`, and `dist` for
  a single `tawassul.js` entry. It does not inspect the v1 tree's bootable
  package entry (H-09).
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
  `dist/index.js` and are not discovered; `gtttt` and `paassss` carried a
  v1-only `index.ts` and were discovered (P-07, both deleted 2026-10-26); the
  v1 tree's `index.ts` was renamed to `index.ts.retired-20261025` on
  2026-10-25 (H-09, done) and is now inert like the six. The six inert
  package directories still need owner approval for deletion (pending
  decision 3).
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
  doctor scan. P1. Resolved 2026-10-26: the owner deleted both package
  directories; the G-08 doctor scan now passes both workspaces.
- **P-11** `addagent` reports a model as "outside the known catalog" when the
  provider actually serves it. `src/tools/agent-management.ts:594` tests the
  resolved `fullModel` against `MODEL_CATALOG` only; the provider reader
  `getAllProviderModelTokens` (`src/core/model-registry.ts:152`) is already
  shipped and is never consulted by the advisory. Observed 2026-10-24 while
  adding three analyst variants: `opencode/glm-5.3-flash-free`,
  `opencode/beam-free`, and `opencode/nemotron-3.5-super-vl-free` were all
  `active` in the provider listing and each produced a false
  `addagentUnverifiedModel` warning. The path is fail-open, so the agent is
  created, but three false warnings teach the operator to ignore the fourth
  one — the typo that is accepted and only fails at first spawn. Same
  workflow, second gap: `parseKickInput` computes the model suffix
  (`src/tools/agent-kick-helpers.ts:38`) but uses it only for the wildcard
  branch, so `remove analyst with model X` resolves to the protected base
  role instead of `analyst-<suffix>`, while `addagent` derives the variant.
  Next: parse the provider out of `fullModel` and warn only when the id is
  absent from the static catalog *and* unresolved in
  `getProviderModelTokens(provider)`; keep fail-open and the existing message
  for genuine unknowns. In the same pass, apply the derived suffix to a bare
  base spec in `parseKickInput` so both tools resolve the same phrasing to the
  same agent. P2 — recorded as S-057 before `SHARED.md` was frozen.

  Resolved 2026-10-26: `src/core/model-registry.ts` now exports
  `isModelServedByProvider` (exact slug match against the provider cache, no
  partial-token match) and `shouldWarnUnverifiedModel` (alias, then static
  catalog, then provider cache). `src/tools/agent-management.ts:594` calls the
  helper, so the advisory is silent for every model the provider serves.
  `parseKickInput` now reuses `deriveVariantSpec` for a single bare base, so
  `remove analyst with model X` targets `analyst-<suffix>`; an explicit tag and
  a non-base spec are unchanged. `prove-s028` grew from 30 to 45 assertions
  (provider-served model, case-insensitive lookup, unserved model still warns,
  alias suppression, static catalog, bare provider id, the addagent call site,
  and four kick cases). Typecheck and `npm run check:rules` green.

---

## Evaluation report triage (feat-bc3edbad, round 1)

Source: independent audits of `94ccda8..ef566e8`, 10 findings. Triaged against
HEAD `d740865` on 2026-10-25. "Fixed" means the code changed and a check
exists; "stale" means the finding no longer matches the tree.

### E-01 execute.before swallowed ToolBlockedError — fixed; proof gap in G-05

Original severity: critical. `src/v2/setup.ts:56-59` adds `isBlockError`
and rethrows `ToolBlockedError` / `ConsentBlockedError`; the bridge catches
only other errors. The seven `blockTool()` call sites in
`src/hooks/tool-execute.ts:185-266` now reach the host. Census: eight
`blockTool` occurrences in that file — one definition at `:105` plus seven
calls at `:185`, `:197`, `:206`, `:224`, `:250`, `:254`, and `:266`.

Remaining: no proof that a blocked tool actually fails a live run (G-05).

### E-02 v1 config hook is not bridged — open (partially mitigated)

Original severity: critical. `plugin.config` is only logged at
`src/v2/setup.ts:375-379`; the v2 host never calls it. The hook at
`src/bootstrap/plugin-init.ts:837-840` therefore does not run, so the tawa and
addagent permission repair (`ensureTawaToolPermissions` and
`ensureAddAgentToolPermissions`, `plugin-init.ts:101-129`) is not applied at
boot. Dynamic models are repaired by a separate path:
`repairProjectConfigBoot` is called at `plugin-init.ts:479` and rewrites
`DYNAMIC_MODEL_SENTINEL` entries (`opencode-config.ts:374-385`), so only the
permission/roster half is missing.

Mitigations: `gen-opencode-config` bakes models and permissions into
`opencode.json`, and `execute.before` denies `BLOCKED_TOOLS` for tawa via
`isBlockedForAgent` (`setup.ts:62-67`). Risk: a hand-edited or stale config,
or a roster changed after generation, is not repaired at boot.

Next: apply the permission helpers from the v2 boot path (a config writer or
a `ctx.app`/`ctx.permission` bridge), then prove a denied tawa tool fails and
addagent permissions are present. This is the live half of G-05.

### E-03 noReply queues a user turn; select/input unbridged — fixed (P-01)

Original severity: major. `isNoReply` mapped `body.noReply === true` to
`delivery: "queue"` (`src/v2/client-shim.ts:47,55`). AskChannel injects the
question with `noReply: true` (`src/bootstrap/plugin-init.ts:308`), so every
consent question became a queued user turn instead of a transcript-only
render. `src/v2/ask.ts:40` handled only `type === "confirm"`; select/input
returned `undefined`.

Fixed in `ccb2cb6`: `noReply` now goes through `session.synthetic` (no model
turn), and unbridged select/input throws a visible error. `prove-v2-ask-bridge`
asserts both. The host still has no select result channel; a future host form
API can replace the fail-closed path.

### E-04 Legacy state path and quarantine — fixed

Original severity: major. `legacyStateCandidateDirs()` now includes both
`~/.config/tawassyl/state` and `~/.config/tawassul/state`
(`src/utils/state-paths.ts:39-47`), and `legacyFallbackFor` resolves both the
v2 state dir and a project `.opencode` parent (`state-paths.ts:83-95`).
Rejected files go to `quarantinePath()` under the v2 state dir
(`src/services/persist-utils.ts:106-112`), not into the legacy tree.

### E-05 `--expect v2` accepted v1 content — fixed; matrix/proof gap in G-06

Original severity: major. `scripts/guard-db-generation.sh:245` now refuses
`marker-v1-content` when the v2 lane finds a non-empty DB with no
`session_v2` marker. The `--expect v2` + v1-content row is missing from
`CUTOVER.md` section 3, and the `marker-v1-content` path has no proof; the
only guard proof covers `non-v2-path` (G-06). Residual (V-29): the v1 lane
still warns and proceeds when a `session` table exists but no v1-positive
marker does (`:229`); the table census bounds it to a recognizable v1 shape,
and the v2 lane refuses the same DB with `marker-v1-content`.

### E-06 Project state written to the repo root — fixed; leftovers in D-03

Original severity: major. `service-factory.ts:196` defines `stateFile` as
`join(projectStateDir, fileName)`, so collective memory, trust score, cost
transparency, and background coordinator state land in
`<project>/.opencode`. The root `collective-memory-515c5c5d.json` and its
empty `.bak` are leftovers (D-03).

### E-07 Independence proof is static — open (P-04)

Original severity: major. `scripts/prove-v2-independence.ts` scans
`src/**/*.ts` and `scripts/**/*.{ts,sh}` for v1 paths/imports, checks the
launcher by literal filename, and walks the repo except `node_modules`,
`.git`, and `dist` for a single `tawassul.js` entry. It is static: it never
boots with the v1 tree unreachable and does not inspect the v1 tree's
bootable package entry (H-09). Next: the expanded action is P-04; this entry
adds the H-09 case.

### E-08 Three database paths — resolved by role assignment (D-01)

Original severity: major. The evaluation cites the 2026-10-25
"cannot find this session" incident (`RECOVERY-20261025.md`). D-01 adopted
the recommendation on 2026-10-26 without moving files: sidecar canonical,
shared legacy read-only, launcher test-only. The doctor enforces the roles
and rejects undeclared session DBs; D-02 imported the legacy rows on
2026-10-26 (26 sessions, 384 messages).

### E-09 SDK pin mismatch — fixed; agreement check in G-07

Original severity: major. Current pins: root `devDependencies` `^2.1.4`,
`.opencode/package.json` `2.1.4`, root `node_modules` `2.1.4`,
`.opencode/node_modules` `2.1.4`, lockfile `2.1.4`. No CI assertion keeps
them in agreement (G-07).

### E-10 Reverted working tree / tsc failure — stale

Original severity: minor. At the audit baseline `d740865`, `git status` was
clean apart from five known untracked files; `tsc --noEmit` passed and
`npm run ci` was green. The finding described an intermediate working-tree
state, not the baseline. Next: none; the entry stays closed and only
documents the audit's baseline.

---

## Verification of the six-agent evaluation (2026-10-26)

The six reports were re-checked claim by claim; the full ledger is
`VERIFICATION-20261026.md` (50 entries: 34 confirmed, 5 partial, 8 refuted
or not observed, 3 sound). `npm run ci` was re-run on 2026-10-26 and passed
(28 proof steps, smoke with a real model reply).

New or widened defects from that verification:

### C-01 Consent gating is keyed on `bash`, the host sends `shell` — fixed (P0)

`src/hooks/guards/shared/limits.ts` only recognized `bash`, `delete`, and
`kick`; the v2 host names the command tool `shell`
(`@opencode/protocol` `"server.shell"`, and the plugin's own metrics record
`"tool":"shell"`). `requiresConsent("shell", {command:"git push --force"})`
returned false, so every dangerous-command pattern was unguarded.

Fixed in `8ccdd9a`: `normalizeToolName` and the v2 bridge canonicalize
`shell` to `bash` before any guard runs, `CONSENT_TOOLS` also accepts the raw
alias, and `prove-shell-alias` covers normalization, consent, the dangerous
pattern guard, and the tawa block. The proof is in `gate:proofs`.

### B-06 atomic prune evicts the numbered backup chain — fixed (P1)

Runtime probe 2026-10-26: with `.bak.0`, `.bak.1`, and `.bak.orphan-*`
present, one `atomicWriteFile` kept the timestamped backup and the orphan
and deleted both numbered backups. `src/utils/atomic.ts` sorted the whole
`.bak.` namespace descending and kept two.

Fixed in `d012c55`: the atomic prune matches only its own
`.bak.<timestamp>.<hex>` names; numbered backups and orphans are excluded.
`prove-backup-cap` seeds both schemes and asserts the numbered chain survives.

### B-07 `.bak.orphan-*` is never cleaned — fixed (P1)

`StateManager.cleanOrphanedTmp` only removed `*.tmp` and `*.delta`;
`lifecycle-controller.ts:229` creates `.bak.orphan-<ts>` at shutdown. Fixed
in `d012c55`: cleanup keeps only the newest orphan and removes older ones;
the numbered chain is untouched. `prove-backup-cap` covers it.

### B-08 A state file above 5 MB is never backed up — fixed (P1 latent)

`StateManager.MAX_BACKUP_FILE_SIZE` was 5 MB and rotation returned without a
copy above it. The live state file is 49,853 bytes, so the cap was not
active, but growth would have silently stopped recovery copies.

Fixed in `6564ac1`: 5 MB is now a warning threshold
(`BACKUP_SIZE_WARN_BYTES`); rotation logs a warning and backs up anyway.
`prove-backup-cap` writes a 5 MB+ state file and asserts the full copy exists.

### B-09 No gate proof covers the backup cap — fixed (P2)

Fixed in `d012c55`: `prove-backup-cap` performs repeated atomic writes,
asserts exactly two atomic backups remain, and asserts the numbered chain and
newest orphan survive. It runs in `gate:proofs`.

### B-10 Boot-repair config backups have no cap — fixed (P3)

`opencode-config.ts` wrote an extra `opencode.json.bak.<ts>` before
`atomicWriteFile`, so each repair produced two backups and the manual one was
uncapped. Two existed at audit time; repeated repairs could exceed the owner
cap.

Fixed in `6564ac1`: both repair paths now use the atomic backup only, so the
two-copy cap applies. `prove-backup-cap` runs three config repairs and asserts
exactly two atomic backups and no uncapped timestamped file.

### P-08 Later rejected-state copies are dropped — done (2026-10-26)

`persist-utils.ts:111-113` kept the first `${base}.rejected.` file and
returned early for every later one, so only the first tampered payload was
recoverable.

Resolved 2026-10-26: each rejection is written under its own
`${base}.rejected.<ms>.<seq>-<rand>` name, the quarantine keeps the newest
`MAX_REJECTED_COPIES` (5) copies per base name, and the oldest are pruned
first. The sequence component makes same-millisecond rejections sort in
insertion order, so the cap never drops a newer copy. `prove-p08` rejects the
same file three times, asserts both early copies keep their own bytes, grows
the set to eight, and checks the five survivors are the newest and distinct
(10 assertions).

### P-09 Legacy state lookup prefers the retired v1 directory — done (2026-10-26)

`state-paths.ts:7-9,44-45` checked `tawassyl` before `tawassul` and returned
the first existing candidate with no freshness comparison, so a stale retired
file shadowed the live v1-era state.

Resolved 2026-10-26: `legacyStatePath` and `legacyFallbackFor` share
`newestExisting()`, which picks the candidate with the newest mtime and, on an
exact tie, keeps the non-retired `tawassul` directory; a single or absent
candidate keeps the documented default. `prove-p09` runs in an isolated child
with `HOME` pinned (so `homedir()` cannot be cached from the parent) and walks
newer-retired, newer-router, tie, single, and absent cases (11 assertions).

### G-10 H-09 rename has no automated check — open (P2)

The isolated-boot transcript exists, but no gate references
`retired-20261025`.

### G-11 Proof catalog pins floors, not the exact set — open (P2)

`scripts/prove-proof-catalog.ts:61` asserts `proofFiles.length >= 25` and
`:89` asserts `proofs.length >= 24`; the current set is 29 files and 28 proof
steps. A proof file and its gate step can be removed together and the catalog
still passes as long as both floors are met. The catalog counts itself in the
fast stage.

Next: pin the exact sorted file list (or its hash) and the exact proof-step
count, update the pin when a proof is added, and fail on any unrecorded
addition or removal. The related register drifts from the same audit are
corrected in place (H-02 proof count, E-05 line, E-07/P-04 wording).

### G-12 Six high-stakes closures have no CI artifact — open (P2)

H-02, H-07, P-05, and P-07 are prose evidence only; P-07 was resolved by
owner deletion on 2026-10-26; H-06 has a doctor warning; E-09 has pins but no
agreement check. The full list and evidence are in
`VERIFICATION-20261026.md` (V-52).

### I-11 No committed CI transcript — open (P3)

The gate result is not an artifact; the 2026-10-26 run is recorded in
`VERIFICATION-20261026.md`.

Corrections to existing entries:

- B-03 now records 3,288,019 bytes and 1,909 runs (2026-10-26 05:28).
- B-04 cleanup arithmetic is corrected to 33 `.bak.*` plus 75 `*.tmp`.
- D-01 records 22/14/14 at the final check; the owner adopted the
  canonical/legacy/test roles on 2026-10-26 (2026-10-26).
- G-09 is tightened: a boot-only run is labelled, and
  `TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=1` makes it exit 5.
- E-02: `plugin.config` is uninvoked, but dynamic model repair does run via
  `repairProjectConfigBoot`; only permission repair is missing.
- E-05 now cites the refusal at `:245` and records the v1-lane
  positive-evidence warning (V-29).
- E-07/P-04 now state that the independence proof scans
  `scripts/**/*.{ts,sh}`; it does not skip that tree (V-32).
- H-02 records 26 `PROOF PASS` at the 2026-10-25 baseline (25 steps plus the
  catalog); H-03 labels its evidence as pre-fix (V-32/V-35).
- G-11 records the remaining catalog-floor gap (V-32).

---

## Side-evaluation verification (2026-10-26, second pass)

Source: the final side evaluation of the bash/consent layer. Verified against
HEAD `3582e85` plus the live host, the plugin log, and the installed
`@opencode/*` 2.1.4 packages. The core diagnosis is confirmed: the consent
loop and all text routing are dead on v2. Its guard evidence is taken from a
stale running build, so several mechanism claims do not match HEAD.

### C-02 Consent loop and text routing are dead on v2 — done (2026-10-26)

The chain was complete and code-proven before the fix:

- `src/v2/setup.ts:90-108` builds the v1 hook input as
  `{ message: { role }, parts: [] }`; the real message text
  (`last.content`) is only used for the reverse write at `:109-115`.
- `getMessageContent` (`src/utils/format.ts:17-27`) reads only
  `output.message.text` or `output.parts[].text`, so it returns `""`.
- `src/hooks/message-updated.ts:563-575` passes that empty string to
  `askChannel.onUserMessage`; `parseUserReply("")` returns `undefined`
  immediately (`src/services/ask-channel-parse.ts:33-35`).
- `ctx.ask` is a getter returning `tawaCtx.askChannel`
  (`src/bootstrap/hooks-registration.ts:321-324`), and
  `askChannelInstance` is also set, so `consent-gate-guard.ts:237` takes the
  blocking branch, skips `deferConsent`, and races the ask against 25 s
  (`:307-328`). The answer never arrives, so every consent-gated command ends
  in `ConsentBlockedError("consentHostDenied")`.

Impact: any `git push`, `rm -rf /abs`, `sudo`, `delete`, or `kick` that
reaches the gate is refused after about 25 s regardless of what the user
types. The deferred-question path, the 10-minute approval cache
(`:46`), `@tawa` detection, dispatch intents, effort analysis, elicitation
gates, priority classification, and context nudges all consume the same empty
string and are equally dead. `prove-v2-ask-bridge` checks `client-shim` bodies
only, and the smoke run never invokes bash.

Resolved 2026-10-26: `runChatMessageBridge` now seeds `v1Output.parts` with
shallow copies of the real `last.content` parts (or one text part for string
content), sets `message.text` for string content, and writes back only
hook-added text parts plus text edits to seeded parts. Original parts are
neither dropped nor duplicated; string content stays a string unless a part
was added. `ToolExecuteBeforeContext` gains `chatOnlyAsk?: boolean`; the
tool-execute context sets it in `hooks-registration.ts`, so
`consent-gate-guard.ts` takes the deferred path when the only ask channel is
the chat bridge, while the blocking host-ask race stays as a fail-closed belt.
`scripts/prove-c02.ts` (48 assertions) covers array seeding, text-edit
write-back, string content, dedupe, and marker preservation, plus a live
isolated boot: the first user message reaches the hook, the gate defers and
injects the marked question, a `yes` answer caches approval, the retry
passes, a real `git push origin main` to a local bare remote lands the commit,
a different `git push origin dev` still asks, a `no` answer caches denial, and
the original approval remains scoped to its command. Wired as the `c02`
proofs step; `npm run ci` green (31 proof steps, smoke pass).

### C-03 No-agent sessions skip every guard — open (P1)

`src/hooks/validation-pipeline.ts:273-276` returns `true` early when
`!input.agent && !isTawaRelated`. `bash` is not a Tawassul tool, so a session
where the host omits the agent bypasses the consent gate, the dangerous
pattern stage, and the permission guard entirely. In that case `git push` and
`rm -rf /` pass silently; the failure mode is fail-open, not the 25 s denial
described for agent-bearing sessions. `isManagedAgent` itself treats a missing
agent as trusted (`src/utils/agent.ts:47`), so nothing later restores the
check.

Next: require an agent identity for shell/delete/kick, or run the consent and
pattern stages before the early return, and add a proof that a missing agent
cannot bypass them.

### P-10 Bash guard coverage is split; the `permissionGuard` bash branch is dead — open (P1)

`permissionGuard` appears only in `VALIDATION_PIPELINE`
(`validation-pipeline.ts:144`), which runs for tawa-related tools only. It is
not in `ESSENTIAL_STAGES` (`:199-213`), which is the path for an ordinary
`bash` call. `bash` is not `isTawassulTool`, so the tier check
(`bash: "admin"` at `permission-guard.ts:46`) and the `DANGEROUS_PATTERNS`
loop at `:295` are unreachable for bash at HEAD. The only live pattern check
is `bashDangerousPatternsStage` (`:72-87`), and it runs only for managed
agents; an unmanaged name such as `build` and a no-agent session do not reach
it (C-03).

Consequence for evidence: the 11 `PERMISSION_BLOCKED` entries with
`pattern: "rm\\s+-rf\\s+\\/"` in
`~/.local/share/tawassul-v2/tawassul/tawassul.log` cannot be produced by
HEAD. HEAD would log `BASH_DANGEROUS_BLOCKED`, and that event has zero
entries. Those blocks came from the stale build in G-13.

Next: keep exactly one bash pattern stage on every path that can execute a
shell command, or delete the dead branch and document that host permissions
are the only bash gate. Do not "fix" `permissionGuard.ts:295` alone; it is not
the active blocker.

### B-11 Predictive-router rewrites its file every 5 minutes — open (P2)

`src/features/predictive-router.ts:398` includes `exportedAt: Date.now()` in
`exportData()`. `writeIfChanged` (`service-factory.ts:283`) therefore always
sees a change, and the 5-minute timer (`:289-293`) rewrites the full file plus
a timestamped backup. Live evidence: five backups under
`~/.config/tawassul-v2/state/` at exactly 5-minute intervals
(05:03, 05:08, 05:13, 05:18, 05:23), all 1134 bytes, next to the live file.
This defeats the dirty-only claim in TRIAGE section C and grows the backup
family without bound on a fixed build.

Next: exclude `exportedAt` from the comparison (or from the persisted bytes),
add a proof that two identical exports produce no write, and keep the cap at
two.

### B-12 `panic` backup is best-effort and never pruned — open (P2)

`src/tools/system-controls.ts:222-231` copies `tawassul-state.json` to
`tawassul-state.panic-backup-<uuid>.json`, logs a warning on failure, and
proceeds with `clearAllState()`; with no `stateDir` it writes no backup at
all. The name matches none of the prune families in `atomic.ts:29`
(`.bak.<digits>.<12hex>`), so it accumulates forever. `ALLOWED_AGENTS` is
`["@analyst"]` (`:178`), so the main user cannot run the reset from the main
session while a single delegated agent decision can wipe the history.

Next: make the backup mandatory (refuse to clear when it fails), add
`panic-backup-*` to a capped prune family, and decide whether the owner
session may call it.

### G-13 The live host keeps pre-build code until restart — open (P1)

The Desktop process started 2026-10-26 03:46:40
(`~/.local/state/opencode/service.json`, pid 1537214), while
`.opencode/plugin/tawassul.js` was rebuilt at 06:22. The live state proves
the loaded code is older than `fa8fd71` (2025-10-25 20:24): five
`predictive-router.json` backups exist although `MAX_BACKUPS` is 2 in the
source and `atomic.ts:29-37` prunes to it. `B-04` therefore describes the
source, not the running host; the same applies to any guard evidence taken
from the log before a restart.

Next: make `doctor-v2.sh` print process start time against the entry-file
mtime and build hash, fail (or warn loudly) when the entry is newer than the
process, and state the restart requirement in README and the release smoke
output.

Corrections to the side evaluation:

- The log holds 11 `rm` blocks, not 10, and records only the pattern, not the
  command text; "all were legitimate cleanups" is an inference from RULES.md
  rule 2, not logged evidence. Four of the 11 predate the current process
  start (03:46:40).
- The claim that `permission-guard.ts:91-102` is the live blocker, and that
  the RBAC `bash: admin` row overrides `bash: allow` in
  `.opencode/agents/dev.md`, does not hold at HEAD (P-10). Both are dead for
  bash because `permissionGuard` never runs on the bash path.
- `> /dev/null` and `chown` are blocked only for managed agents through
  `bashDangerousPatternsStage`; an unmanaged or no-agent session does not
  reach that stage.
- `curl|bash` is not gated by the plugin, but the host `BASH_READ_ONLY` map
  denies `curl *` for every agent that uses it. The agents whose config grants
  `bash: allow` (dev, tester, and their variants) have no such host deny.
- File modes: `.opencode/plugin/tawassul.js` and `dist/index.js` are 0644,
  not 0600. The state files and `~/.config/tawassul/.tawassul-hmac-key` are
  0600.
- README does not mention consent at all; the unreachable "reply yes / ok"
  instruction (with an Arabic approval token) is only in
  `src/i18n/en.json:82`.
- `FACTS.md` exists at `src/FACTS.md`; only a root copy is missing, and no
  document map in README/PLAN/AGENTS references it.
- `P-01`: the 2.1.4 host protocol does have `session.form.create/reply/
  list/cancel` (`node_modules/@opencode/protocol/dist/groups/session.d.ts`),
  but `@opencode/plugin` 2.1.4 does not expose it (zero `session.form`
  references in `dist`). The fail-closed path stays until the SDK exposes
  forms or the plugin calls the protocol client directly.

### G-14 The generation guard's orphaned-WAL branch has no fixture — done (2026-10-26)

`scripts/guard-db-generation.sh:110` warns on an orphaned `-wal` sidecar,
`:117` copies the DB plus companions when the direct probe fails, and `:175`
retries the probe against that copy. No proof exercises any of those three
lines: `prove-db-retention.ts` covers refusal and the dual session probe,
`prove-backup-cap.ts` covers `.bak.orphan-*` pruning (a different family), and
`prove-v2-independence.ts` only asserts that the launcher points at the local
guard. S-053 recorded this as the v1 guard's missing fixture; the same branch
is live in the v2 guard, so the gap transferred with the file.

Impact: the guard fails closed today, so the exposure is a false refusal on a
healthy DB with a stray `-wal`, not a wrong delete. It also means the
snapshot-copy path has never run under a test.

Next: construct a marker DB with a `-wal` and no `-shm`, make the direct probe
fail deterministically (exclusive lock held by the fixture), and assert the
snapshot copy is used, the retry returns the expected generation, and the
original DB, `-wal`, and `-shm` are byte-identical afterwards.

Resolved 2026-10-26: `scripts/prove-gen-guard-wal.ts` (the `gen-guard-wal`
proofs step, 45 assertions) builds a WAL-mode DB whose `session_v2` marker
exists only in the `-wal`, removes the `-shm`, and holds a POSIX exclusive
lock on the DB file so the direct probe fails with `database is locked`. It
asserts the orphan warning, the retry window (≈4 s), the snapshot copy reading
the v2 marker, and byte-identical DB and WAL afterwards; a locked DB with no
`-wal` exits 3 (`probe-failed`); an unusable `TMPDIR` exits 3 instead of
reading a failed copy as "no markers"; a lock that clears is retried without a
copy; and the v1 lane refuses a v2 marker visible only through the WAL
(`marker-session_v2`). The orphaned fixture has no `-shm` to compare, so the
proof instead asserts that the locked path never creates one next to the live
DB. Observed while building it: a successful direct read of an orphaned WAL
re-materializes `-shm` (SQLite behaviour); the guard does not modify DB
content, and the copy path never touches the live files.

---

## Pending owner decisions

1. ~~H-09~~ — done 2026-10-25. The owner renamed
   `/home/htoz/Desktop/tawassyl/.opencode/plugins/tawassul/index.ts` to
   `index.ts.retired-20261025`; an isolated boot of the final tree loads no
   plugin and writes no state.
2. ~~P-07~~ — done 2026-10-26. The owner deleted the v1-only entries;
   `/home/htoz/Desktop/gtttt` and `/home/htoz/Desktop/paassss` have no
   `.opencode` at all. `doctor-v2.sh` passes
   `external tree has no live v1 entry` for both. Only six inert
   `tawassul.js.retired-20261024` files remain in other workspaces.
3. Delete the 12 `tawassul.js.pre-refresh-*` copies, the 14
   `*.retired-20261024` files, and the six inert `dist`-only
   `.opencode/plugins/tawassul/` package dirs (`athan new vrsion`,
   `ciel-osk-workspace`, `dart22222222`, `vpro`, `vusial 2`, `vusual`).
4. ~~Delete the `/tmp/opencode` artifacts~~ — done 2026-10-26. All scratch
   under `/tmp/opencode` was removed (about 1.09 GB, including the four
   `v1tree-*` copies and the probe/build directories); the directory is empty.
   P-07 is also done; the only remaining exit item is the opt-in global
   install (I-01).
5. ~~D-01 roles~~ — done 2026-10-26. The sidecar is canonical, the shared DB
   was legacy read-only for the completed D-02 import, and the launcher DB
   is test-only; no file was deleted or moved. `doctor-v2.sh` prints the canonical DB, labels the
   non-canonical copies, and fails on an undeclared session DB. Residual
   enforcement gap: D-05 (item 8).
6. ~~Keep or drop the untracked `scripts/check-shared-anchors.mjs`,
   `scripts/port-from-v1.mjs`, and `test-utils.ts`~~ — done 2026-10-26. All
   three were deleted; the two transfer tools referenced the retired v1 tree
   and the independence proof no longer whitelists them. The root
   `collective-memory*` and `cost-transparency*` leftovers were deleted with
   their backups; the live copies are under `.opencode`.
7. Legacy state residue (done 2026-10-25): the 75 stale `*.tmp` files and the
   extra `.bak.*` files under `~/.config/tawassul/state/` were removed with the
   B-04 cleanup; the single remaining router file stays as the permitted
   read-only legacy fallback. Its root-level siblings were deleted on
   2026-10-26 under item 6.
8. D-05 enforcement shape — open. Recommended: keep the D-01 roles and
   replace the fixed-path census with a bounded read-only census, fail when
   the shared or launcher-legacy copy grows past the 14/14 D-02 baseline, and
   declare the v2 CLI namespace as an explicit test-only role (or require
   `TAWASSUL_ALLOW_SECOND_DB=1` before creating a non-canonical DB). Do not
   auto-move at boot: the sidecar can be live with a WAL, and a failed move
   can leave the canonical empty. Alternative rejected: automatic
   newest-copy import on every boot.

## Verification baseline (for regression)

Known open defect at baseline time: `gate:smoke` used to fail with rc=3
whenever the provider's free-tier quota was exhausted; fixed 2026-10-25 (G-09).
Both `gate:smoke` and the full `ci` now pass with the quota exhausted.

- `npm run verify`: `gate:fast` plus the build (`dist/index.js` and `dist/global.js`).
- `npm run gate:fast`: 6 steps, about 11.7 s.
- `npm run gate:proofs`: 28 proofs, one child each, about 24.3 s.
- `npm run gate:smoke`: build + release smoke, about 20.2 s.
- `npm run ci`: rc=0, 29 `PROOF PASS` (28 proof steps plus the catalog),
  `SMOKE PASS: host v2.1.4, scratch boot, 42 tools, health + help`, about 60 s.
- Re-verified 2026-10-26: `npm run ci` rc=0, 28 proof steps (28,163 ms),
  `SMOKE PASS` with a real model reply (the provider-refusal branch was not
  exercised). The full claim-by-claim audit is `VERIFICATION-20261026.md`.
- The baseline above was measured with no `opencode` on PATH: the launcher and
  smoke both resolve the Desktop-bundled CLI.
- Bundles identical: `dist/index.js` and `.opencode/plugin/tawassul.js`
  (1,858,782 bytes). The opt-in global bundle is `dist/global.js`
  (2,296,549 bytes, self-contained).
- `prove-global-install` is one of the 28 proof steps: flat layout, bundle
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
  `paassss` exposed a v1-only `index.ts` until the owner deleted both
  package directories on 2026-10-26 (P-07 done).
- The smoke accepts a provider transport error only after `initPlugin` and
  `v2 registered 42 tools` are confirmed; a missing plugin boot fails.

---

## Third-round evaluation (2026-10-26, six-agent gap audit)

Source: the consolidated devil's-advocate evaluation, then a targeted gap
audit in which each of the six analysts was given the consolidated list and
one surface, and asked to report only what the list did not already cover.
Surfaces: host runtime (`analyst-gemini`), v2 API fidelity
(`analyst-beam-free`), security (`analyst-pickle`), tools (`analyst-mimo`),
state and concurrency (`analyst-deepseek`), evidence integrity
(`analyst-glm-5.3-flash-free`). Checked against HEAD `b55f9df` plus the
working tree.

Result: 31 new entries. Nine items from the consolidated report are **not** new
— six already carry register IDs (C-02, C-03, P-10, B-02, E-02, G-13) and
three were refuted claims — so they are re-confirmed under their existing IDs
instead of being duplicated. Four agent claims were merged into an existing
entry; one claim was rejected; one surface reported nothing missing. Every new
entry below was re-read in the source by the main session before being
written; line numbers are from HEAD `b55f9df`.

Dedup rule used here: if a finding already has a register ID, the new
evidence is appended to that entry, not given a new number.

### Already registered — re-confirmed, no new ID

- **C-02** consent loop and text routing are dead. Confirmed again at
  `src/v2/setup.ts:93-102`: `v1Output.parts` is `[]` and `message.text` is
  never set, so `getMessageContent` returns `""`.
- **C-03** no-agent sessions skip every guard
  (`src/hooks/validation-pipeline.ts:273-276`). Amplification found this
  round: a *named but unrecognized* agent also bypasses, because
  `src/hooks/tool-execute.ts:166` returns early when
  `normalizedAgent && !isManagedAgent(normalizedAgent)`. C-03 covers the
  missing-agent case; the unrecognized-name case is the same defect and the
  same fix.
- **P-10** the `permissionGuard` bash branch is dead.
- **B-02** schema retry hides tools. Exact budget: 750 ms initial wait plus
  20 × 500 ms ≈ 10.25 s.
- **E-02** `plugin.config` is never bridged. The round-3 report initially
  listed this as new; it is not.
- **G-13** the live host keeps pre-build code until restart.

### New P0

#### E-11 Skill gate deadlocked every agent that has no capability record — done (2026-10-26)

`src/hooks/guards/skill-gate-guard.ts:19-21` blocks `edit`, `write`, and
`bash` when `ctx.capabilityTracker.getCapabilities(agent)` is empty. The
tracker is only written on handoff completion
(`src/services/handoff-service.ts:176,181`), lives in memory
(`src/context-class.ts:183`), and is never seeded from the agent definition
or `opencode.json`. A fresh process therefore has zero capabilities for every
agent, so the first edit of every subagent is refused with a message telling
it to route through `task(...)` — which it cannot do, because routing also
requires work it cannot perform. This is a hard deadlock, not a slowdown.

Live consequence: any delegated implementation task in a new session fails at
its first write, and the failure is attributed to the agent rather than to
the gate.

Resolved 2026-10-26: `CapabilityTracker.seedCapability` records a declared
capability without fabricating attempts or success rates, and
`seedCapabilitiesFromRoster` seeds every roster agent from its md frontmatter
(or `agentModels[...].capability`). `TawassulContext.seedCapabilities()` runs
in `lifecycleInit` after the agent mds are ensured. The tracker now
serializes to the state file (`capabilities` in `StateData`, a strict schema
entry, a max-attempts merge, and restore on load), so learned rates survive a
restart. The guard no longer blocks on an empty record: it logs one throttled
warning per agent and allows, because the pipeline already filters unmanaged
actors (`tool-execute.ts:166`) — an empty record is a seed fault, not a
routing decision. `prove-e11` covers the seeder, the fail-open
warning/throttle, a live context seeding two agents, and a save/load
round-trip (29 assertions).

#### E-12 `saveState()` reports success before anything is written — done (2026-10-26)

`src/services/state-persistence.ts:607-613`:

```
this.saveDirty = true;
this.scheduleDeferredSave();
if (this._saveCompletionPromise) await this._saveCompletionPromise;
```

The awaited promise belongs to a save that was *already in flight*. If none
is, the method returns immediately and the actual write happens later on a
debounced timer (10 s in quiet mode). Callers that do
`await ctx.saveState()` and then report success — for example
`src/tools/record.ts:123` and `src/tools/tawa/task-orchestrate.ts:44` — are
therefore reporting a write that has not happened.

Impact: a crash, a kill, or a host restart inside the debounce window loses
the record or handoff the user was told was stored. Combined with E-13, the
lost write can also be replaced by an older generation on the next boot.

Next: make `saveState()` resolve only after the dirty generation it
observed has been persisted (track a generation counter and await that
generation), and add a proof that a kill immediately after `record()` keeps
the record.

Resolved 2026-10-26: `StatePersistence` keeps a `dirtyGeneration` and a
`persistedGeneration`. Every mutation marks the state dirty and increments the
dirty generation; `doSave` records the generation it built the payload from and
advances `persistedGeneration` only after the atomic write succeeds.
`saveState()` cancels the pending debounce, awaits a save of the observed
generation, and repeats (bounded to five attempts) when a mutation lands while
a save is in flight. `saveDirty` is now derived from the two generations, so
the deferred timer and `flushSaves` cannot clear a newer mutation. A skipped
write (isolation or lock loss) logs a warning instead of reporting success
silently. `prove-e12` covers durability without a flush, a mutation during an
in-flight save, and a real `SIGKILL` immediately after `record()` keeps the
record (14 assertions).

#### E-13 A rejected state file is silently replaced by an older backup — done (2026-10-26)

`src/context/managers/StateManager.ts:594` returns `null` when the HMAC does
not verify, logging only `State file rejected: <path>`. `loadFromFile`
(`:693`) treats `null` exactly like "file missing" and walks
`<path>.bak.0` … `.bak.N`, adopting the first readable generation
(`:685-705`). No quarantine, no user-visible error.

The damage is then made permanent: `rotateBackups` (`:241-262`) copies the
current file — the rejected one — over `.bak.0` with
`copyFile(fp, bakBase + ".0")` on the next full save, destroying the newest
good backup.

Impact: tampering, a truncated write, or a key change rolls the project back
one or more generations with no signal, and then overwrites the evidence.
Records and handoffs vanish while the session looks healthy.

Next: distinguish "absent" from "present but rejected", quarantine the
rejected file (the helper already exists in
`src/services/persist-utils.ts:106-112`), refuse to rotate a rejected file
over `.bak.0`, and surface a startup error.

Resolved 2026-10-26: `StateManager` now records every rejected path with its
reason (hmac, prototype-pollution, schema, unreadable) and clears the mark
once the file verifies again. `loadFromFile` preserves the rejected bytes as a
quarantine copy and logs an error that names the file, the reason, the backup
fallback, and the rotation rule. `rotateBackups` refuses a rejected primary, so
the newest good `.bak.0` survives until an operator restores a readable file.
`getDiskRevision` now answers with the loaded revision when no primary is
readable, which is what makes recovery from a backup writable again instead of
a permanent revision-conflict loop. A tampered primary keeps the session
read-only by design, and `saveState` reports that as memory-only instead of
success. `prove-e13` covers the quarantine copy, the startup error, the
rotation guard, the read-only save, and the healed write that resumes rotation
(27 assertions).

### New P1

#### E-14 Tool failures are recorded as successes — open (P1)

`src/v2/setup.ts:292-307` receives the host's `execute.after` payload, which
carries `status: "completed" | "error"` (authoritative in
`node_modules/@opencode/plugin/dist/promise/tool.d.ts`), but maps both
branches to the same v1 shape with `title: ""`. The v1 side then infers
success from a non-empty output string (`src/hooks/tool-execute.ts:166`
onward). A v2 error result is non-empty, so every failure is counted as a
success.

Impact: agent health, capability success rate, rating, dedup, and the circuit
breaker all consume this bit. A consistently failing agent is promoted, and a
broken tool never trips the breaker.

Next: carry `status` through the adapter and use it as the success signal;
keep the string heuristic only as a fallback for v1-shaped results.

#### E-15 Streaming, auto-save, and notifiers listen for v1 events — open (P1)

`src/hooks/tool-output-stream.ts:86` and `:100` match
`message.part.delta` and `message.part.updated`. The v2 host emits
`session.text.*`, `session.tool.*`, and `session.execution.*`
(`src/v2/event-adapter.ts` maps only part of the family). On the supported
host the stream therefore never sees a delta.

Impact: live tool output, auto-save triggers, compression triggers, and
background notifications are silent on v2 while appearing healthy in tests
that feed synthetic v1 events.

Next: map the v2 families in the adapter and delete the v1 listeners from the
v2 path; add a proof that a real `session.tool.*` event reaches the stream.

#### E-16 The write-back drops later text parts — done (2026-10-26)

At audit time `src/v2/result-bridge.ts` collected every text part, joined it,
and assigned `result.content = [{ type: "text", text: nextText }]`. By HEAD
the non-text parts were already preserved, but every text part after the
first was still dropped: a `[text, file, text]` result became
`[text, file]`, so a redaction hook silently deleted the second text part.

Impact: long outputs lost their part boundaries and later text segments
disappeared before the model saw them.

Resolved 2026-10-26: `writeBackV1Output` replaces only the first text part in
place and appends every remaining part verbatim (text and non-text). The
string-content and no-text branches are unchanged. `prove-v2-compat.ts` was
inverted from asserting the loss to asserting preservation, with added cases
for a no-text result (text prepended), a string result, and redaction to an
empty string. `bun scripts/gate.ts proofs` green (29 steps).

#### E-17 `tool.definition` is unregistered, so schemas are placeholders — open (P1)

The v2 setup never registers the definition hook, so the host advertises the
placeholder schema (`additionalProperties: true`) and `makeV2Tool` does not
run a zod parse before dispatch.

Impact: the model can send arbitrary arguments, invalid arguments reach
handlers, and a schema regression cannot be detected from the host side. This
is also why B-02's window is dangerous rather than merely slow.

Next: register the definition hook, or validate with the real schema in
`makeV2Tool` before calling the handler.

#### E-18 Hook errors are swallowed and the guard fails open — open (P1)

`src/v2/setup.ts` wraps non-block hooks in `try/catch` and continues on
error. A guard that throws — for example on an unexpected payload shape — is
therefore silently disabled for the rest of the session, with one warn line.

Impact: the failure mode of every safety hook is "off". A payload change in a
host update turns the guard layer into a no-op without failing the gate.

Next: classify hooks. Safety hooks (consent, permission, blocked tools) must
rethrow; cosmetic hooks may fail open with telemetry.

Owner constraint: do not extend this to `bash` infrastructure errors. The
host's agent invocation runs through `bash`, so a hook that turns an
unexpected error on a `bash` call into a hard block would disable delegation
itself. Fail closed on the *decision* (consent denied, tool blocked), fail
open with a loud log on *infrastructure* faults.

#### E-19 Outputs over 50,000 characters are cut with no marker — done (2026-10-26)

`src/hooks/tool-execute.ts:673-674` built `scanText` as
`outputText.slice(0, 50_000)` for threat scanning. Line `:747` then assigned
`output.output = svc.truncateToolOutput(scanText)`. Because `scanText` was
already at most 50,000 characters and `truncateToolOutput` only adds the
head/tail split and the `[N chars truncated]` marker when its input *exceeds*
the cap (`src/services/context-compressor.ts:22-27`), the marker path was
unreachable here.

Impact: any `bash` or `read` result over 50k was silently truncated to its
first 50k — usually the head, while the error or final result lives in the
tail. Unlike `src/tools/web.ts`, nothing was saved to a temp file.

Resolved 2026-10-26: the scan keeps its 50k slice, but delivery truncates the
full `outputText`, so the head and tail survive under the
`[N chars truncated]` marker. The privacy path now redacts the full text
before that truncation, so a secret beyond the scan slice is redacted instead
of silently dropping the tail; previously it set the quarantine flag and
skipped the marker path entirely. `prove-e19` feeds a 120k `bash` result and
asserts the head, the tail, the exact removed count, and the cap; a second
case hides an `sk-` secret in the head and asserts it is redacted while the
tail and marker survive (11 assertions).

#### E-20 Shutdown does not await async cleanup callbacks — done (2026-10-26)

`src/services/lifecycle-controller.ts:265` iterates `cleanupCallbacks` and
calls `cb()` without `await`. The registered callbacks include
`() => handoffLedger.dispose()` and `() => timelineStore.dispose()`
(`src/bootstrap/service-factory.ts:799,801`), both async and both setting
`disposed = true` before awaiting their flush.

Impact: the buffered tail of `handoff-ledger.jsonl` and
`timeline/events.jsonl` is dropped on every clean shutdown, and the
unawaited rejection is swallowed by the surrounding `try/catch`.

Next: await each callback (`for (const cb of …) await cb()`), or make the
signature `() => void | Promise<void>` and drain them with `Promise.all`.

Resolved 2026-10-26: `addCleanupCallback` accepts `() => void | Promise<void>`
in both the controller and the manager, and `destroy()` awaits each callback
in registration order, logging a failed one at warn level and continuing.
`prove-e20` registers a slow async callback, a writer, a thrower, a follower,
and the real `HandoffLedger.dispose`; it asserts the awaited order, the marker
on disk when `destroy()` resolves, that a failure does not stop the chain, and
that the buffered ledger tail is written exactly once (9 assertions).

#### E-21 After eight save failures the shutdown flush is a silent no-op — done (2026-10-26)

`src/services/state-persistence.ts:678`:
`if (this.saveFailureCount >= StatePersistence.MAX_SAVE_FAILURES) return;`
No log, no event, no final attempt. `destroy()` calls `flushSaves()` and only
logs if it throws, so a short-circuit is invisible.

Impact: a transient disk problem (full disk, read-only mount, lock
contention) that accumulates eight failures guarantees the whole session's
state is discarded at exit with zero diagnostics.

Next: log at error level, attempt one last write with a bypass flag, and
report the failure to the user.

Resolved 2026-10-26: `flushSaves` no longer returns early when the failure
count is exhausted. It logs an error, performs one forced final write, and if
that write throws it increments the count, logs that the session state is not
on disk, and rethrows so `destroy()` reports at error level. The give-up path
after the retry loop is also error level now. `doSave` resets the failure count
only after a clean save; previously any direct save cleared it, which defeated
the backoff gate. `prove-e21` covers the forced write after eight failures,
the successful path, and a terminal failure that rejects with a clear error
(9 assertions).

#### E-22 Dropped-handoff penalties are computed after persistence is closed — done (2026-10-26)

`src/services/lifecycle-controller.ts` calls `flushSaves()` (`:143`), then
`markDisposing()` (`:207`), then `detectDroppedHandoffs()` (`:219`).
`markDisposing()` makes `StatePersistence.doSave` return at its guard
(`state-persistence.ts:704`) and disarms the timer, so the rating mutation
that `detectDroppedHandoffs` performs (`RatingManager.ts:264`) can never be
written.

Impact: dropped-handoff penalties are always lost, and because
`_countedDroppedHandoffs` is in memory they are recomputed and re-lost on
every restart — a permanently unmeasurable signal.

Next: run `detectDroppedHandoffs` before `flushSaves`, or allow a final
forced write after `markDisposing`.

Resolved 2026-10-26: `destroy()` now detects dropped handoffs before the
shutdown flush, so the rating mutation is written by that flush and survives a
restart. `prove-e22` asserts the on-disk penalty, the read-back after a
restart, and that a completed handoff is never counted (5 assertions).

#### E-23 The goal store locks the file, not the goal — done (2026-10-26)

`src/services/goal-store.ts:442` called
`this.lockManager.acquireLock(this.metaPath, owner, id)` while building the
owner string from `id`. `FileLockManager` keys locks by *file*, so the second
concurrent mutation — even of a different goal — got `acquired: false`, and
`withLock` returned `null`, which `mutate` reported as
`{ ok: false, reason: "locked" }` with no wait or retry.

Impact: any turn that issued two `goal(...)` calls in parallel silently lost
one, with a reason that blamed a lock that did not exist.

Resolved 2026-10-26: the file lock is the right scope (every mutation rewrites
the whole ledger), so it stays keyed on `metaPath`; `withLock` now retries
`acquireLock` up to 20 times at 50 ms before reporting `locked`. A held lock is
therefore waited out instead of losing the write, while the resurrection proof
still sees the losing mutation re-check the goal and return `not-found`
rather than writing a ghost. `prove-e23` runs three concurrent creates, two
concurrent updates to different goals, and two concurrent evidence appends;
it reloads from disk after each and asserts none were dropped, then holds the
file lock for 120 ms and asserts a mutation waits and commits (13
assertions).

#### E-24 Saga ids restart at `SAGA-001` and overwrite the previous journal — done (2026-10-26)

`src/services/saga-coordinator.ts:81` initialised `_sagaSeq = 0` and
`:91` returned `SAGA-${seq}` without seeding from
`listJournalRecords()`. `journalPath` (`:95`) mapped the id straight to
`sagas/<id>.json` and `persist()` used a plain write.

Impact: the first saga of a new process overwrote the recovery record of the
first saga of the previous process. `resumeSaga()` could then resume or skip
the wrong transaction, and the completed-step history of the earlier saga was
gone.

Resolved 2026-10-26: the constructor scans the journal directory and seeds
`_sagaSeq` from the highest `SAGA-<n>.json` id, so a new process continues the
sequence; resumed ids (`SAGA-<n>-resumed.json`) are ignored by the scan. The
journal writes through `atomicWriteFile` with `backup: false`, so a torn write
cannot leave a partial record and the write creates no backup family.
`prove-e24` restarts a coordinator over the same directory, asserts the id
advances and the earlier record survives, seeds from a manually written
`SAGA-009`, and checks there are no temp or backup leftovers (11 assertions).

#### E-25 AskChannel answers questions on the user's behalf under load — open (P1)

`src/services/ask-channel.ts:214-217`: when `_capacityOk(sessionID)` is
false, the channel logs a warning and returns
`Promise.resolve(defaultFor(kind))`. `defaultFor` (`:288-292`) returns
`kind.default` for a confirm, `""` for select/input, and `[]` for
multiselect. Callers such as `src/services/agent-management.ts:1005-1007`
treat the value as a user decision.

Impact: with 8 pending questions in one session or 100 overall, a select is
answered with the empty string and a confirm with its default. Consent asks
use `default: false` (`consent-gate-guard.ts:260,308`), so consent fails
closed — but every other elicitation silently fabricates an answer, and
neither the caller nor the user can tell.

Next: return a distinct `ASK_UNAVAILABLE` result instead of a synthetic
reply, and make callers fail closed.

#### E-26 The iteration budget hard-blocks every tool at 50 calls — done (2026-10-26)

`src/services/iteration-budget.ts` set `DEFAULT_SUBAGENT_LIMIT = 50`;
`consume` returned false once the budget was spent and the caller blocked
*all* tools with `budgetExhausted`. There was no partial-result path and no
per-agent override in practice.

Resolution (2026-10-26): the budget is now self-scaling. It keeps a per
`agent@session` limit, raises it by `budgetStepPercent` (default 50) whenever
the agent exhausts it while working, and stops at
`initial × budgetCeilingFactor` (default 4). A per-agent `iterationBudgets`
entry is treated as an absolute pin and is never extended.

New config keys in `tawassul.jsonc` (global) or the project `tawassul.json`:

```jsonc
{
  "adaptiveBudgets": true,
  "projectScale": "medium",
  "budgetStepPercent": 50,
  "budgetCeilingFactor": 4,
  "budgetTiers": { "shallow": 60, "moderate": 100, "deep": 160, "analyze-first": 320 }
}
```

`projectScale` multiplies the base (small 0.7, medium 1.0, large 1.6). The
tier is chosen per `task(...)` call from `analyzeEffort(desc).thinking_effort`
in `budgetGuard`, so a one-line fix starts at `shallow` and a full audit at
`analyze-first` without any manual tuning. Effective subagent budgets with
the defaults: shallow 60, moderate 100, deep 160, analyze-first 320, each
extendable to 4× that (240, 400, 640, 1280). The untiered floor is 60 and
the parent floor is 90.

Verified with a 16-case runtime probe (defaults, tier assignment, one
extension of +50 %, explicit pin never extended, adaptive off, large-project
scaling, ceiling, configurable tier base) and `npm run verify` (`GATE PASS:
fast`, build complete).

Remaining: the block still stops the agent rather than degrading to
read-only tools. Next: allow `read`, `grep`, and `glob` after the ceiling so
the agent can return a partial result instead of nothing.

#### E-27 The smoke gate passes a boot that never produced a reply — open (P1)

`scripts/release-smoke.sh:103-111` downgrades a non-zero boot to
`SMOKE PASS (no model reply)` when the output merely matches
`ECONNRESET|Transport:|socket connection|ETIMEDOUT|timed out|timeout`, or
when `BOOT_RC` is 124. The plugin-boot markers (`initPlugin`,
`v2 registered 42 tools`) are checked, but a plugin that hangs, or that
breaks after boot, produces exactly those markers plus a timeout.

Impact: `README.md:96` claims "a broken plugin cannot pass it". A C-02-class
regression — plugin boots, routing dead, run times out — passes green. The
only end-to-end gate in `npm run ci` cannot distinguish it from provider
flakiness.

Next: require a model reply by default (`TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=1`
already exists as opt-in), and narrow the tolerance to a provider refusal
code rather than the word "timeout".

### New P2

#### E-28 `patch` and `apply_patch` are absent from `BLOCKED_TOOLS` — open (P2)

The host maps `write`, `patch`, and `apply_patch` to the `edit` permission,
and the tawa config denies `edit`, so the bypass is not currently
exploitable. It is not listed in `BLOCKED_TOOLS`, so the protection rests
entirely on one config line that a regeneration can change.

Next: add both names, and assert the list in a proof.

#### E-29 One failing web request trips the Firecrawl breaker for 60 s — open (P2)

`src/tools/web.ts:58` constructs `CircuitBreaker(3, 60_000)`. Both
`firecrawlPost` and `firecrawlGet` call `recordFailure` inside the
*per-attempt* catch (`:489`, `:520`), before the retry backoff. With
`maxRetries = 3` a single request contributes four failures and opens the
breaker; `evaluate` then throws for every subsequent fetch, search, map, and
crawl for 60 s.

Impact: one bad URL or one transient outage escalates into a global outage of
the entire web surface.

Next: record one failure per request, not per attempt; reset the counter on
success of the final attempt only.

#### E-30 `applyPatch` has a prefix-check escape and a cross-device write — open (P2)

`src/services/apply-patch.ts:69` validates with
`fullPath.startsWith(path.resolve(options.baseDir))`, so `/base/dir2/x`
passes when the base is `/base/dir`. The realpath guard at `:74-81` sits in a
`try/catch` that swallows, so it is skipped when the target does not exist
yet — a symlinked parent is therefore not resolved. The write goes to
`os.tmpdir()` and is `rename`d (`:106-107`), which fails `EXDEV` across
filesystems and leaks the temp file.

Current reach: `applyPatch` has no caller in `src/`; only
`scripts/prove-disclosure.ts:32` counts it. It is a latent escape in the only
in-repo patch writer.

Next: compare with `path.relative` plus a separator check, resolve the parent
directory rather than the file, and write the temp file inside the target
directory.

#### E-31 Event metrics are written to a collector that is thrown away — open (P2)

`src/context-class.ts:190` initialises `metricsCollector = new
MetricsCollector()` with no path. The constructor passes it to
`new EventHub(this.timerManager, this.metricsCollector)` (`:423`) and then
replaces the field with a path-backed collector (`:429`). `EventHub` keeps the
original reference, and `MetricsCollector.saveToDisk()` returns early when
`filePath` is null.

Impact: `eventhub.dlq.added`, `eventhub.backpressure.drop`, and
`eventhub.emitwait.timeout` — the only signals that listeners are failing or
events are being dropped — are permanently unobservable.

Next: construct the path-backed collector first and pass it to `EventHub`.

#### E-32 The proof catalog enforces floors, not exact counts — open (P2)

`scripts/prove-proof-catalog.ts:61` asserts `>= 25` proof files and `>= 24`
proof steps. `PLAN.md:166-167` specifies exactly one `prove:` script per
file and 25 files; the tree now has 29. The checker stays green, which is why
the 25-vs-29 drift documented in the README could appear at all.

Next: assert equality against a manifest, and make the docs read the manifest
instead of restating a number.

#### E-33 The client shim silently drops user-facing side effects — open (P2)

`src/v2/client-shim.ts:77-85` implements `tui.appendPrompt` and
`tui.showToast` as log-only no-ops, and `:91` hardcodes
`serverUrl: undefined`.

Impact: rate-limit warnings, review prompts, and toast notifications never
reach the user on v2; model-injection text loses the host URL it is built
from. Both failures are silent.

Next: bridge `showToast` to the host notification API, or make the shim throw
so callers know the capability is missing.

#### E-34 `chat.message` message-level mutations are discarded — open (P2)

`src/v2/setup.ts:99-115` builds `v1Output.message` and never reads it back:
after the hook returns, only `v1Output.parts` are pushed into the host
content. Any hook that changes `message.role`, `agent`, or `model` has no
effect.

Next: apply `v1Output.message` to the host payload, or remove the field from
the v1 shape so the limitation is explicit.

#### E-35 Tool result titles and metadata are lost on v2 — open (P2)

`src/v2/adapters.ts:50-72` maps only `output` and `metadata`;
`src/v2/setup.ts:295,304` hardcodes `title: ""` for both the completed and
the error branch.

Impact: every status title ("🌐 Web Fetch", "🚨 Panic Reset Complete", the
cache-hit distinction) is invisible to the user and the model. Separately,
`src/tools/direct-response.ts:37,45` returns a `requiresTask` field that no
consumer reads and that the adapter drops, while the schema description still
tells the model it influences routing.

Next: pass `title` through the adapter and delete `requiresTask` or wire it.

#### E-36 A failed crawl is returned as a successful result — open (P2)

`src/tools/web.ts:849-865` breaks the poll loop on `failed` or `cancelled`
and then returns a normal result with `title: "🕸️ Web Crawl"` and the status
encoded only in prose. No throw, no error metadata, no cache entry.

Impact: combined with E-14, a failed multi-page crawl is recorded as a
success and is indistinguishable from a legitimately empty site without
parsing the text.

Next: return an error result for `failed`/`cancelled`.

#### E-37 The v2 type shim is weaker than the host contract — open (P2)

`src/v2/types.ts:16` declares `signal?: AbortSignal` and `:90`
`permission?: V2Permission` although both are required by the host;
`:56` omits the model-scoping options that `ModelHooks` supports; `:66`
accepts an unconstrained string for the tool hook name although only
`execute.before` and `execute.after` exist.

Impact: missing host APIs and invalid hook names compile cleanly, so the
compiler cannot catch a broken bridge. This is the mechanism behind several
entries above.

Next: derive the shim types from `@opencode/plugin` instead of restating them.

#### E-38 Schema-refresh disposal does not await the in-flight refresh — open (P2)

`src/v2/setup.ts:225-228` sets `stopRefresh = true` and calls
`void refresh.catch(...)`, so a refresh already in progress can call
`ctx.tool.reload()` after the registration is disposed.

Impact: a reload against a disposed tool domain during shutdown or reload.

Next: keep the refresh promise and await it in the dispose path.

#### E-39 `isBlockedUrl` is a pre-flight string check only — open (P2)

`src/tools/web.ts:216-281` normalises the hostname and rejects private
ranges, but never resolves DNS, never re-checks after a redirect, and the
actual fetch happens on the Firecrawl server. It is applied to `fetch`,
`map`, and `crawl`.

Impact: the plugin's SSRF guarantee is weaker than the code suggests; the
real egress boundary is Firecrawl's.

Next: document the trust boundary, and re-validate the final URL when the
response exposes one.

### New P3

#### E-40 Shell scripts carry comments that no gate can see — open (P3)

`AGENTS.md:24` states comments are forbidden and that shell is kept
comment-free "by review". `scripts/check-v2-rules.mjs:33` scans only
`.ts`, `.mjs`, and `.json`; `check:sh` runs `bash -n` only. In practice
`scripts/release-smoke.sh:2-4` and `scripts/boot-scorecard-v2.sh:2-17` carry
comment headers.

Impact: the rule is stated as enforced but is unenforced for seven scripts,
and the "by review" premise is already false.

Next: either extend the checker to shell or state the exemption explicitly in
`AGENTS.md`.

#### E-41 There is no unit suite, and some proofs assert the defect — open (P3)

Validation is 32 `scripts/prove-*.ts` integration scripts. There is no
`tests/` directory and no assertion-level unit coverage of the bridge, the
guards, or the stores. `scripts/prove-v2-compat.ts` asserted the multi-part
loss described in E-16 as expected behaviour until 2026-10-26.

Impact: a defect that is proven becomes a specification, and a regression in
the bridge is invisible to the gate.

Next: invert the assertions that encode defects, and add targeted cases
for C-03, E-12, E-14, and E-19. Progress 2026-10-26:
`prove-v2-compat.ts` now asserts part preservation (E-16 closed),
`prove-e11` covers the skill-gate seed, fail-open, and persistence (E-11
closed), and `prove-c02` covers the bridge seed/write-back plus the live
consent answer/execute loop (C-02 closed).

### Corrections to existing entries

- **B-12**: `src/tools/system-controls.ts:232` appends
  `t("panicBackupCreated")` whenever `stateDir` is set, including when the
  `copyFile` at `:226` threw. The tool reports a backup that does not exist,
  which is worse than the missing prune already recorded.
- **B-02**: the window is 750 ms plus 20 × 500 ms ≈ 10.25 s, not "about
  10 s"; the placeholder schema served during the window is
  `additionalProperties: true` (E-17).
- **E-07 / P-04**: unchanged. `scripts/prove-v2-independence.ts:35-97` is a
  static text scan; round 3 found no behavioural proof to add.
- **I-09**: unchanged. `scripts/prove-global-install.ts:147-149` still calls
  the coexistence helpers directly instead of booting a dual-copy workspace.

### Agent claims rejected or merged

- Merged into **C-03**: "unmanaged agent names bypass the pipeline"
  (`analyst-pickle`, MISSING-01) — same early return, same fix.
- Merged into **E-17**: "placeholder schemas are advertised while init is
  pending" (`analyst-pickle`, MISSING-08).
- Merged into **E-39**: "the SSRF check is string-based" (`analyst-pickle`,
  MISSING-05) — already recorded, now with the DNS/redirect caveat.
- Duplicate of **E-07 / P-04**: the static independence proof
  (`analyst-glm-5.3-flash-free`, FA-02).
- Duplicate of **I-09**: the unit-only coexistence proof
  (`analyst-glm-5.3-flash-free`, FA-04).
- **Rejected**: "batchread enables bulk exfiltration"
  (`analyst-pickle`, MISSING-07). Reading files the process can already read
  is the tool's purpose; `resolveSafe` bounds it to the project. Not a defect.
- **Unverified, not registered**: "`getTaskAgents` trusts `output.args`"
  (`analyst-pickle`, MISSING-03) and "quarantine only fires on critical
  patterns" (MISSING-04). Both describe plausible weaknesses but the round-3
  read did not establish a concrete failing path. Left here so the next pass
  can decide rather than re-derive.

### Coverage of the gap audit

- `analyst-gemini` (host runtime): reported **NONE**. No host-side finding
  survived the dedup list.
- `analyst-beam-free` (v2 API fidelity): 7 findings, 5 registered
  (E-33, E-34, E-37, E-38) after grouping, 2 folded into E-37.
- `analyst-pickle` (security): 8 findings, 1 registered as new evidence
  (C-03 amplification), 3 merged, 1 rejected, 2 unverified.
- `analyst-mimo` (tools): 8 findings, 7 registered (E-19, E-30, E-35, E-36,
  E-29, E-25, and the B-12 correction), 1 folded into E-35.
- `analyst-deepseek` (state): 8 findings, all 8 registered (E-12, E-13, E-20,
  E-21, E-22, E-23, E-24, E-31).
- `analyst-glm-5.3-flash-free` (evidence): 5 findings, 3 registered (E-27,
  E-32, E-40), 2 duplicates.

Net: of the 20 findings in the consolidated report, 6 were already registered
(C-02, C-03, P-10, B-02, E-02, G-13) and 3 were refuted claims, so 11 were new
and are recorded as E-11, E-14, E-15, E-16, E-17, E-18, E-26, E-28, E-32,
E-39, and E-41. The gap audit then added 20 more that the consolidated report
had missed, almost entirely in state durability and shutdown ordering
(E-12, E-13, E-19, E-20, E-21, E-22, E-23, E-24, E-25, E-27, E-29, E-30,
E-31, E-33, E-34, E-35, E-36, E-37, E-38, E-40).
