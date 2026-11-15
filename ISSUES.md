# Tawassul V2 — Issue Register

Status date: 2026-10-29 · Gate: `npm run ci` rc=0 (3 isolated stages, 103 proof files / 100 proof steps, 4 smoke steps, transcript in `docs/CI-TRANSCRIPT.md`)
Real global install: not performed (owner declined on 2026-10-29; isolated sandbox validation only; see I-01).
Active P0: none open — E-12 (state writes reported before they happen) and
E-13 (a rejected state file replaced by an older backup) are resolved. The
project entry is rebuilt from this tree, and `npm run host:refresh` reloads the
live host and verifies a fresh plugin init, so G-13 is resolved.
Register note: the third-round evaluation (2026-10-26) added E-11..E-41 and
re-confirmed C-02, C-03, P-10, B-02, E-02, and G-13 without duplicating them.
Upstream watch (2026-10-29): `UPSTREAM.md` and
`src/upstream/registry.json` assess OpenCode v2.2.1 item by item; the throttle
correction stays on E-44, the recoverable-quota probe became E-54, and the
host `/goal` mirror is E-55.
Stability view: `STABILITY.md` classifies all open entries by whether they
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

Historical hazard (2026-10-25): the bun-installed v1 binary (H-07). It was
removed the same day, the doctor reports no `opencode` on PATH, and no Bun
binary is linked. The uninstall caution still applies: do not rerun
`opencode uninstall` while the Desktop is open, because it stops the shared
service and removes the shared cache again.

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

### I-01 Real global install is not performed — verified; owner declined the install (2026-10-29)

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

Owner decision (2026-10-29): no real global install on this machine. The
installer and the DB lane are validated with isolated sandbox experiments
only: `npm run prove:global-install` rehearses the whole lifecycle in a
temporary HOME (install, verify, tamper repair, uninstall, and purge, with
the real host untouched), and `scripts/prove-db-lock.ts` serializes
concurrent maintenance runs issued from two separate project copies against
one synthetic DB (see E-52). The install stays opt-in if the owner ever
re-opens the decision: `npm run build`, `npm run install:global`,
`npm run verify:global`, then boot the Desktop (or an isolated HOME) and
confirm one `loading plugin` line for the flat file, 42 tools, and a working
`astquery`.

### I-02 Installer host discovery is Linux-only — done (2026-10-29)

`hostCandidates()` used to split `PATH` on `":"`, look only for `opencode`,
and hardcode the Linux Desktop CLI path. On Windows the separator and
executable suffix differ; on macOS the Desktop CLI location differs.

Resolved 2026-10-29: the installer splits with `delimiter` from `node:path`,
probes `opencode`, `opencode.cmd`, and `opencode.exe`, and adds the macOS
Desktop root plus `LOCALAPPDATA` on Windows. `scripts/prove-host-discovery.ts`
(`host-discovery`, 10 assertions) builds five fake hosts (bare, `.cmd`,
`.exe`, macOS, Windows) and asserts each is discovered in order and readable.

### I-03 `--purge` keeps global agent files — resolved (2026-10-28)

`purge()` removes global state files but deliberately keeps
`~/.config/opencode/agent/*.md`. The README listed
`uninstall:global -- --purge` without saying that the roster survives.

Resolved 2026-10-28 by stating the exception rather than deleting user files:
`--help` prints "the purge keeps the global agent roster
(~/.config/opencode/agent)", the README says the same, and the purge reports
`kept N agent file(s) in <dir>`. `prove-global-install` seeds
`agent/keeper.md`, asserts it survives `--purge --yes`, and asserts the report
line, so the documented behavior cannot drift silently.

### I-04 Stale wasm files are not pruned on upgrade — done (2026-10-29)

`install()` wrote the four current assets but never removed files under
`tawassul-runtime/wasm/` that were absent from `VERSION`, so a package or
asset rename left dead files behind.

Resolved 2026-10-29: after writing the current assets the installer walks
`WASM_DIR`, removes every file absent from the new marker manifest, prunes
empty directories (`staleWasmFiles`/`pruneStaleWasm`), and reports the count.
`prove-global-install` seeds a stale asset and an empty directory, reruns the
install, and asserts both are gone while the four live assets remain.

### I-05 `--force` overwrites an unmarked file without a backup — done (2026-10-29)

When `plugins/tawassul.js` existed with no Tawassul marker, `install()` failed
unless `--force`; with `--force`, `writeAtomic` replaced the file in place and
kept no copy.

Resolved 2026-10-29: before a forced replacement the installer renames the
target to `tawassul.js.pre-force-<timestamp>`; `--purge --yes` removes those
backups and prints the count, and `--help` documents both. The extended
`prove-global-install` asserts the backup content survives, the new bundle is
written, and the purge sweep removes every `pre-force` file.

### I-06 Missing-wasm auto `npm install` is untested — done (2026-10-29)

`resolveAssets(true)` used to run `npm install --no-audit --no-fund` in the
repo when an asset was missing, mutating the working tree and needing network
access; the proof never exercised it.

Resolved 2026-10-29: the auto-install path was removed. A missing asset now
fails closed with the exact remediation command (`npm install` in the repo
root, or `npm run install:global`), and `TAWASSUL_ASSET_ROOTS` lets the proof
inject an empty asset root with no network. `prove-global-install` asserts the
failure message and the override path.

### I-07 No bundle freshness check — done (2026-10-26)

The installer only checked that `dist/global.js` exists and scanned it for bare
imports. It could not tell whether the file matches the current `src/` or the
current git commit, so an old build could be installed and then marked with
the current package version.

Resolved 2026-10-26: `build-v2.mjs` stamps `dist/global.js` and
`dist/index.js` with a `TAWASSUL_SOURCE_SHA=<sha>` marker taken from
`git rev-parse HEAD`; the installer reads that marker, refuses to install a
bundle whose SHA differs from HEAD, records `sourceSha` in the VERSION marker,
and `verify()` fails when the installed bundle is stale against HEAD.
`upToDate()` also treats a missing or mismatched `sourceSha` as outdated.

Revised 2026-10-28: comparing against `git rev-parse HEAD` was circular — any
commit, including a commit that changes no source file, made a bundle built
seconds earlier look stale, and a dirty tree could not be distinguished at all.
`scripts/source-digest.ts` now hashes the sorted `src/**` file list plus
`build-v2.mjs` and `package.json` (64 hex chars). The build embeds
`TAWASSUL_CONTENT_SHA`, the installer stores `contentSha` in the VERSION
marker, refuses a bundle whose digest differs from the live tree, and
`verify()` fails with "installed bundle is stale" when the marker digest and
the tree digest diverge. The old `TAWASSUL_SOURCE_SHA` marker stays for
provenance only and no longer gates anything. `prove-bundle-freshness` rebuilds
and asserts both bundles and the project entry carry the current content digest
and that the digest is not the commit id (11 assertions).

### I-08 Global bundle boot cost is unmeasured — done (2026-10-29)

The project bundle boot was measured (`initPlugin` 8-23 ms, 350-550 ms to 42
tools), but the larger global bundle with runtime wasm loading had no boot
record.

Resolved 2026-10-29: `scripts/prove-global-boot.ts` installs the flat file into
an isolated HOME, boots the host, and records `loading plugin` -> `v2
registered 42 tools` plus `initPlugin`. Measured on host 2.2.1: load to
registered 3.6-4.0 s and `initPlugin` 10-52 ms; the project bundle measured
3.8 s in the same run. The smoke stage runs it after the build as
`global-boot`.

### I-09 Project-over-global priority is only a unit proof — done (2026-10-29)

`prove-global-install` proved the coexistence helpers in isolation but never
booted a host with both `~/.config/opencode/plugins/tawassul.js` and
`<workspace>/.opencode/plugin/tawassul.js` present.

Resolved 2026-10-29: the host loads both files but only the project copy takes
effect. `src/v2/setup.ts` detects the global scope and delegates to the
workspace project entry (`projectEntryCandidates`/`loadProjectSetup`), logging
`global copy delegates to the project copy at <path>`; any load failure falls
back to the global setup. `prove-global-boot` asserts both load lines, the
delegation path, 42 registered tools, and no load failure, and
`prove-setup-delegation` covers the unit matrix (14 assertions: flat and
package entries, foreign id, broken entry, retired fixture).

### I-10 The successful host boot is manual, not in CI — done (2026-10-29)

The flat-file boot evidence was produced by hand in an isolated HOME;
`prove-global-install` inspected files, and the smoke stage booted only the
project bundle.

Resolved 2026-10-29: `global-boot` is now a smoke-stage step. It runs the
Desktop CLI with `HOME`/`XDG_*` isolated, the flat global file installed, and
asserts `loading plugin`, 42 tools, `initPlugin`, and direct `health` + `help`
calls. A provider quota refusal is tolerated only when the boot markers are
present, so the check stays automatic without network credit.

---

## Runtime cost (P1)

### B-01 Schema work is duplicated at boot — done (2026-10-26)

`collectToolSchemas` runs before registration and again after readiness, then
`ctx.tool.reload()` reloads all tools. Observed boot: `initPlugin` 8–23 ms,
then 350–550 ms to `registered 42 tools`.

Resolved 2026-10-26: the per-shape cache already makes the second collection
cheap (measured in the isolated boot harness: 14.7 ms first, 0.3 ms cached,
42/42 identical schema objects), so the real duplicate was the unconditional
host reload. The setup now records a fingerprint of the schemas it registered
with the host; the post-readiness refresh re-collects, compares the
fingerprint, and only calls `ctx.tool.reload()` when it differs. On a boot
where init is ready inside the 750 ms window the host has just registered
those exact schemas, so the reload is skipped with a "reload skipped" line; a
boot that registered placeholders because init was late still reloads once
when the real schemas arrive. Build-time schema generation was evaluated and
rejected: the registry depends on runtime services (`timeline` and `goal` are
conditional), so a stub registry would emit a different tool set. `prove-b01`
covers the fingerprint, the cached second collection, both boot paths, and the
refresh contract (23 assertions).

### B-02 Retry budget can hide tools for 10 s — done (2026-10-26)

`SCHEMA_RETRY_ATTEMPTS=20` × `SCHEMA_RETRY_DELAY_MS=500`. During that window
the host showed placeholder schemas.

Resolved 2026-10-26: the budget is now 6 attempts at 500 ms (about 3 s of
retrying, under 4 s including the 750 ms initial wait), and the refresh
lifecycle default matches. The give-up path emits exactly one warning naming
the 6-attempt budget, and a refresh that becomes ready mid-way stops polling
and reloads once. `prove-b02` covers the sleep count, the single warning, the
mid-way ready path, the setup budget, and the constants (15 assertions).

### B-03 `tool-run-log.json` is 3.1 MB pretty-printed — done (2026-10-26)

Measured 2026-10-26 05:28: 3,288,019 bytes and 1,909 runs, still growing.
`ToolRunLog.load()` parsed the whole file at boot and `save()` serialized the
whole array with `JSON.stringify(..., null, 2)`.

Resolved 2026-10-26: `save()` now writes one compact JSON object per line and
`load()` accepts both the new JSONL form and the legacy `{ runs: [...] }`
envelope, so existing state files keep working. The in-memory rotation cap
(2000 entries, pruning to 1500) bounds the persisted file. `prove-b03` covers
the JSONL format, round-trip load, rotation, and backward-compatible legacy
load (12 assertions).

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

### B-05 Tool schema payload is unmeasured — done (2026-10-26)

42 tool schemas are sent with every request and may dominate session load.

Resolved 2026-10-26: the adapter now exposes `measureSchemaPayload`, which
sums the serialized byte size of every registered schema and estimates tokens
at one per four bytes, and the setup logs that measurement whenever the schema
set changes (initial registration and a post-readiness refresh that actually
differs). `prove-b05` covers the empty, single, multi, and real-collection
cases plus determinism (10 assertions).
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

### G-04 No boot budget proof — done (2026-10-26)

Nothing failed when boot time regressed. The smoke records `initPlugin` and
`registered 42 tools` but did not enforce a budget.

Resolved 2026-10-26: `prove-boot-budget` boots the real plugin in an isolated
HOME, measures the time from init to registered tools, and fails when it
exceeds 2000 ms (measured ~780 ms). The candidate 150 ms figure from the
issue was infeasible because the 750 ms readiness wait alone exceeds it, so
the budget guards against a 2.5x regression instead. Registered in the gate
catalog and package scripts (2 assertions).

### G-05 No live blocked-tool proof — done (2026-10-29)

`isBlockError` rethrew `ToolBlockedError` and `isBlockedForAgent` denied the
tawa list, but no proof ran a blocked tool through a live host.

Resolved 2026-10-29: `isBlockError` is exported and
`scripts/prove-blocked-tool.ts` (`blocked-tool`, 14 assertions) drives the
live `execute.before` hook. Tawa `bash`, `edit`, and `write` calls fail with
`ToolBlockedError` and leave no side effect, while `read` and a dev `bash`
call pass; unit cases assert both error names are rethrown so an unblocked
path cannot swallow them.

### G-06 Guard matrix has no v2-content regression proof — done (2026-10-29)

`--expect v2` now refuses v1 content with `marker-v1-content`, but
`CUTOVER.md` section 3 had no row for it. The only generation-guard proof was
the `non-v2-path` refusal in `prove-db-retention.ts`; the `marker-v1-content`
path was untested.

Resolved 2026-10-29: `scripts/prove-guard-matrix.ts` (the `guard-matrix` gate
step, 22 assertions) builds a synthetic v1 DB (`session`, `session_message`,
`data_migration`) at a `tawassul-v2` path and asserts `--expect v2` exits 2
with `verdict=refused`, `reason=marker-v1-content`, and `generation=v1`; the
same content at a plain path is accepted by `--expect v1`. The reverse row
builds a synthetic `session_v2` DB at a plain path and asserts `--expect v1`
exits 2 with `marker-session_v2`, plus `--path-rule warn` records
`non-v2-path` and still refuses v1 content by content. `CUTOVER.md` section 3
now carries both rows, the kv-migration marker row, and the empty/fresh rows.

### G-07 SDK pins are not asserted in CI — done (2026-10-29)

The pins agreed at the declaration level, but nothing failed when
`package.json`, `.opencode/package.json`, the lockfiles, the installed
package, and the host range diverged. The new fast step
`scripts/check-sdk-pins.ts` (`sdk-pins`, 14 assertions) reads all of them plus
`src/upstream/registry.json` (`auditedThrough`, newest `hostContract`), the
installer `HOST_MIN`/`HOST_AUDITED`, and the smoke
`MIN_VERSION`/`AUDITED_VERSION`, and fails on disagreement.

The check immediately found a real drift: `.opencode/package-lock.json` still
pinned `@opencode/plugin` 2.1.4 while `.opencode/package.json` and the
installed package were 2.2.0. `npm install --package-lock-only` in
`.opencode` repaired the lockfile; the check is green.

### G-08 No Desktop-wide plugin-entry census — done (2026-10-29)

`doctor-v2.sh` checked this project's entry and the global install, but it did
not enumerate other workspaces; the 2026-10-25 scan matched flat
`tawassul.js` files only and missed three `plugins/tawassul/index.ts` entries
(H-09, P-07).

Resolved 2026-10-29: `doctor-v2.sh --scan-desktop` enumerates
`plugin(s)/*.{js,ts}` and `plugin(s)/*/index.{js,ts}`, classifies each
workspace as v2, v1-only, dual, unknown, or retired, prints per-workspace and
total counts, and exits 1 on any active finding.
`scripts/prove-desktop-scan.ts` (`desktop-scan`, 25 assertions) seeds flat,
package, dual, unknown, and retired fixtures, including paths with spaces, and
asserts the classification and the early exit.

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

### D-01 Three database paths — done (2026-10-27)

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

Residual risk (D-05) was closed on 2026-10-27: the doctor now runs a bounded
census over all three data roots, fails on undeclared databases with
sessions, holds the shared and launcher copies to their 14/14 import
baselines, declares the v2 CLI namespace test-only, and fails closed at the
32-file cap (see D-05). The roles are now enforced rather than declared.

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

### D-05 Doctor census misses the v2 CLI namespace and accepts legacy growth — done (2026-10-27)

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

Recommended shape (D-05, owner decision 8; implemented 2026-10-27):

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

Evidence (2026-10-27, `2cc8c25`): `doctor-v2.sh` now runs a bounded census
(depth 4 under `~/.local/share/opencode`, depth 3 under
`~/.local/share/tawassul-v2` and `~/.local/share/opencode-projects`, symlinks
skipped, 32-file cap) and classifies every hit as canonical, shared, launcher,
sidecar, v1 HMAC, v2 CLI test, or undeclared. Undeclared databases with
sessions, v2 CLI databases with sessions, unreadable snapshots, and a reached
cap fail closed; a non-OpenCode file is skipped with a warning. The shared and
launcher copies are held to the 14/14 D-02 baselines: growth fails unless
`TAWASSUL_ALLOW_LEGACY_GROWTH=1` is set for a deliberate import, and a shrink
warns. `scripts/prove-d05.ts` runs 28 assertions in an isolated HOME (clean
layout, undeclared v2 and v1 databases, both baselines, the explicit import
flag, the CLI namespace, the cap, symlink skip, an unreadable DB, a
non-OpenCode file, and source-hash immutability); it fails on `40b9c3a` and
passes on `2cc8c25`. Live doctor: `PASS bounded census found 6 database
file(s)`, canonical 71/72, shared 14/14, launcher 14/14, rc=0. `npm run ci`
passes with 73 proof files / 72 registered steps.

### D-06 Goal item ids are reused after archiving, so `done` is silently skipped — fixed (2026-10-27)

`GoalStore.update` derived new item ids from `next.items.length` in the
`itemsAdd` path, ignoring `completedItems`. Once a goal's items had been
archived, the counter restarted and produced ids that already existed in the
archive. The `done` branch then looked up the archived entry first and ran
`if (archived) continue`, so the live item stayed at `in_progress`/`pending`
while the tool returned success.

Live evidence: `G-001-I3` and `G-001-I4` are in exactly this state. Two
`goal` updates appended their evidence and reported success (09:19), the
ledger `updatedAt` advanced, and both items stayed pending because round-2
archives with the same ids still exist. Progress stayed at 82% and the goal
could not close. The goal-level evidence note already recorded the symptom as
"item ids I3/I4 are duplicated by the goal store".

Fixed in `3082f73`:

- `itemsAdd` takes the next index from the highest numeric suffix across
  `items` and `completedItems`, so a new id never collides with the archive.
- The `done` branch keys off the live item. It archives the live item even
  when an archived duplicate exists, and treats a missing live item as already
  archived (idempotent re-complete).
- The restore path uses `findLast`, so the newest archive wins over a stale
  duplicate.

`scripts/prove-goal-item-ids.ts` runs 19 assertions and fails on `2806193` at
"a new item never reuses an archived id"; it also covers the legacy duplicate
repair, idempotent re-complete, and newest-archive restore. Wired as the
`goal-item-ids` proofs step; `npm run verify` (`GATE PASS: fast`, build) and
`npm run gate:proofs` (75 steps) are green.

Residual: the live `G-001` snapshot keeps the stuck items until the host
reloads the new build. Re-apply I3/I4 after the next restart; the repair path
in the fix then archives them instead of skipping them.

### D-07 Goal items could not record owner wording changes or owner drops — fixed (2026-10-27)

The `goal` update path accepted item state transitions only. An item title was
immutable, so an owner wording correction could not be recorded, and there was
no way to say that the owner decided an item is not needed. Every non-`done`
item also counted as unfinished, so a retained-but-cancelled item blocked close
forever, and `runTodoReconcile` could flip it back through a later todo status.

Fixed in the goal store and tool:

- `GoalItemState` adds `dropped` in both `src/types/goal-types.ts` and
  `GoalItemStateSchema`, so the tool enum accepts it.
- `GoalUpdatePatch` adds `itemTitles`; the update path rewrites an active item
  or the newest archived copy, refuses a blank title with `required`, and
  refuses an unknown id with `unknown-item`.
- `itemStates: dropped` requires the same recorded item evidence as `done`
  (`item-evidence`), keeps the item visible in `items`, and can move a closed
  archived item back as dropped without losing its evidence.
- Progress, `checkCloseInvariant`, `hasIncompleteItems`, and the roster
  fraction count dropped as resolved; `applyReconcileTodo` skips an owner-
  dropped item so a later todo can never resurrect the owner's decision.
- The tool gains `itemTitle`, the update guard accepts `itemId` with a title
  or evidence alone, and the `itemState`/`itemEvidence` descriptions name the
  dropped contract.

`scripts/prove-goal-item-update.ts` runs 19 assertions: title rewrite, blank
and unknown refusals, evidence-required drop, progress at 50%, done archive,
pending vs dropped close invariants, full close at 100%, and a dropped item
surviving todo reconcile. Wired as the `goal-item-update` proofs step;
`npm run verify` was green at that baseline (83 proofs); the current gate runs
110 proofs-stage steps.

---

## Handoff lifecycle (P1)

### E-42 `handoff` create and every `override` action return no tool result — fixed (2026-10-27)

Observed live on the restarted host (build `2806193`) on 2026-10-27:
`handoff` create, `override` redirect, `override` force-complete, and
`override` cancel each mutated state correctly — `status` showed H-009
pending, then completed, then pending after `undo`, and a redirected H-010
kept the new target — while the tool result was `Tool result missing`.
Read-only and error paths returned normally: `handoff` undo printed
`↩️ H-009 reverted to pending`, a refused rescue printed its message, and a
`goal` update with `metadata: { goal }` returned normally.

Impact: a caller could not learn the new handoff id from the create result
and could not tell a successful override from a failed one without re-reading
`status`. The lifecycle mutations themselves are sound, and RBAC is enforced:
complete is limited to the assignee or `@analyst`, cancel to the creator, and
rescue requires an already-accepted handoff.

Root cause (2026-10-27): the host stores tool-part metadata as JSON. In
`@opencode/schema@2.2.0`, `ToolStateCompleted.metadata` is
`Record<string, Schema.Json>`, but the v1 bridge returned the live handoff
entry unchanged. A freshly created entry carries `checkpoint: undefined` and
`decisionRuleId: undefined`, so the completed-state encoding failed, the host
left the part at `running`, and the provider-side normalizer replaced the
absent result with `Tool result missing`. Entries loaded from disk have no
undefined keys, which is why the `override` redirect of the older H-008
returned normally while create and cancel of the fresh H-009/H-010/H-011 did
not. The live session DB confirmed it: the create and cancel parts stayed
`running`, while the H-008 redirect part was `completed`.

Fix: `jsonSafeValue` and `jsonSafeMetadata` in `src/v2/result-bridge.ts`
drop undefined values, functions, symbols, and cycles, map non-finite numbers
to null, convert dates and bigints, and turn undefined array slots into null.
They are applied in `toV2Result`, the after-hook write-back, and the error
write-back. `scripts/prove-e42.ts` covers 38 assertions: the fresh-entry
precondition, the handoff metadata round trip, the no-mutation guarantee, and
the after-hook path. Lifecycle logic is unchanged.

Live verification (2026-10-27 10:33 UTC, 2.2.0 host after the bundle reload):
`handoff` create returned `## 🤝 Handoff H-012` and `override` cancel returned
`✅ **H-012 cancelled**`. The session DB records both parts as `completed`,
with `metadata.handoff` present and JSON-safe; `feedback` and `helpRequest`
survive on create.

---

## Upstream compatibility (2026-10-27)

`UPSTREAM.md` is the standing watch for OpenCode releases, and
`src/upstream/registry.json` records the audited subset with a verdict per
change. The gate checks the registry offline; `npm run check:upstream` reads
the live changelog and fails when a release has not been assessed.

### E-43 `execute` (Code Mode) was not covered by the tawa tool guard — fixed (2026-10-27)

`BLOCKED_TOOLS` lists `edit`, `write`, `bash`, and the lifecycle tools, and
`BLOCKED_TOOL_ALIASES` adds `patch`/`apply_patch`. The host's Code Mode tool
(`execute`) was in neither list, so `isBlockedToolForTawa("execute")` returned
false and `execute.before` let tawa start a Code Mode script that can call
`tools.*`, including the host's MCP proxies. The 2.2.0 note that MCP tools are
exposed directly when `execute` is denied confirms that `execute` is the
container the guard must refuse.

Fixed by `BLOCKED_META_TOOLS = ["execute"]` and `isBlockedToolForTawa`, which
keeps `execute` out of the permission-key list (no unknown host key) while
refusing it by name for tawa. Normal managed agents keep `execute`.
`scripts/prove-e28.ts` grows to 38 assertions: the helper, `checkBlockedTools`,
`SecurityPolicy.enforce`, the permission repair, and the generator validator.

Residual: this is hook-level enforcement. A host-level `execute: "deny"`
entry is pending proof that the config schema accepts it on 2.2.0; until then
the name check is the guard. Live verification needs a host reload
(`npm run host:refresh`; G-13, E-51).

---

### E-44 The plugin retried transient rate limits that the 2.2.0 host already retries — fixed (2026-10-27)

OpenCode 2.2.0 retries throttled provider requests itself (`#58866`) instead
of reporting them as context overflows. The plugin still ran
`handleRateLimitError` for every rate-limit message, so a transient 429 could
be retried twice: once by the host and once by the plugin's backoff prompt. On
a host without the change (2.1.4) the plugin retry is still the only one.

Fixed by reading the host version from `ctx.app.version` into `PluginInput`,
and by `shouldDeferRateLimitToHost` in `src/services/free-limit.ts`. On hosts
at or above 2.2.0 a parsed transient rate limit is left to the host retry;
daily limits, unknown hosts, and malformed versions keep the legacy path.
`scripts/prove-e44.ts` covers 41 assertions: version parsing, the
2.1.4/2.2.0/2.2.1 boundary, typed/text/throttled transients, daily-limit and
hard-quota exclusion, the host-version mapping, and the
`handleRateLimitError` wiring (no notice or timer when deferred, one of each
on legacy).

---

### E-45 Shutdown cleanup could outlive the host's ten-second cap — fixed (2026-10-27)

OpenCode 2.2.0 exits after ten seconds when shutdown hangs (`#58817`). The
plugin's dispose path awaits the full `destroy()` chain (prefs flush, state
flush, a two-second structural drain, several persistence flushes), so a slow
disk or a hung writer could push the host past the cap and lose the final
state flush.

Fixed by `disposeWithinBudget` in `src/hooks/dispose.ts`: the hook returns
after `DISPOSE_BUDGET_MS` (7,500 ms), leaves a 2.5-second margin under
`HOST_SHUTDOWN_CAP_MS` (10,000 ms), and logs the release at warn level. The
timer is unref'd, a fast destroy returns `completed`, and a hung destroy no
longer blocks the host. The state flush remains early in `destroy()` so it
runs before the optional drains. `scripts/prove-e45.ts` covers 14 assertions:
the budget constants and margin, fast/hung/rejecting destroys, the hook
outcome and elapsed time, and the pending-handoff warning path.

---

### E-46 `health` called the desktop sidecar DB a mismatch — fixed (2026-10-27)

The 2.2.0 Desktop host pins `OPENCODE_DB` to
`~/.local/share/opencode/tawassul-v2/opencode.db` (the per-project sidecar),
which `scripts/doctor-v2.sh` already accepts as isolated. `health` knew only
the HMAC-keyed CLI path `~/.local/share/opencode-projects/<hash>/opencode.db`
and printed `DB matches isolation: no`, so a correctly isolated runtime looked
like a misconfiguration.

Fixed by `classifyDbLane` and `isDesktopSidecarDbPath` in
`src/bootstrap/db-isolation.ts` (five lanes: `desktop-sidecar`, `host-default`,
`isolated`, `custom`, `unset`) and by the `DB lane` line in
`src/tools/tawa/health.ts`. The sidecar lane reports `DB isolated: yes`; the
`DB matches isolation` line keeps its exact comparison against the HMAC-keyed
path, so the host-owned sidecar path reports `no` there by design. Host-default,
custom, unset, and keyed lanes keep their exact-path comparison. Sibling
prefixes (`tawassul-v2-backup`, `opencode-projects-old`) do not match either
lane. `scripts/prove-e46.ts` covers 30 assertions over the XDG-aware data root:
every lane, whitespace handling, the keyed path from a temp HMAC key, the
sibling boundaries, and the health output for
sidecar/host-default/keyed/custom/unset.

### E-47 Operator cancellation was scored as a dropped handoff — fixed (2026-10-27)

The cancellation saga in `src/services/handoff-service.ts` ran
`core.recordHandoffDropped` against the sender on every deliberate cancel, so
`buildCancellationEffects` turned operator cleanup into a red
`handoffsDropped` flag and a -20 health score per cancel. The live state showed
three false drops for `tawa` (H-005..H-007), five for `build` (H-009..H-013),
and four for `general` (H-001..H-004). Every one was a deliberate cancellation,
so no work was lost. `detectDroppedHandoffs` already covers the real case: an
accepted handoff left unfinished at shutdown.

Fix:

- The cancellation effect is removed, so a deliberate cancel no longer touches
  `handoffsDropped` for either side.
- `STATE_VERSION` is 5 with migration 5: for every cancelled handoff the
  migration subtracts one false drop from the sender's counter, clamped at
  zero, so the inflated live counts are repaired on the next load. Genuine
  drops survive, recipients are never charged for cancellations they received,
  and a current-version state is never repaired twice.

`scripts/prove-cancel-metric.ts` runs 17 assertions: a real cancel through
`HandoffService` leaves both ratings at zero and stays zero after shutdown, and
leaves the recipient health counts, circuit state, capability tracker, shared
memory, and training evaluator unchanged; the migration zeroes tawa (three
cancellations), leaves build at 2 of 3 (one genuine drop), never charges the
recipient (general stays 1), and a second pass does not subtract again. Wired as
the `cancel-metric` proofs step; `npm run verify` was green at that baseline (87 proofs); the current gate
runs 110 proofs-stage steps.

### E-48 Deliberate cancellation still scored failures in the tracker stack — fixed (2026-10-27)

After E-47 removed `recordHandoffDropped`, `buildCancellationEffects` still ran
the failure side of six effects against the recipient:
`healthTracker.onHandoffFailed`, `circuitBreaker.recordFailure`,
`trainingEvaluator.markOutcomeByAgent(..., "failure")`,
`sharedMemory.addHandoffRecord(... success: false)`,
`capabilityTracker.updateCapability(..., false)`, and a negative
`conflictLearner` CANCEL outcome. A deliberate operator cancel therefore lowered
the recipient capability score, could open its circuit after three cancels, and
wrote a failed handoff into shared memory even though no work was attempted.

Fix: a cancellation keeps only the status change, file-lock release, and queue
removal. Health, circuit-breaker, capability, training, shared-memory, and
conflict-learning state stay untouched. The `cancel-metric` proof now asserts the
five tracker snapshots and the conflict-learner memory are identical after the
cancel.

### E-49 `handoff` undo double-charged `agentErrors` and kept every completion credit — fixed (2026-10-27)

`handoff(undo:)` set the status back to pending and then ran
`agentErrors[from] -= 1` a second time: completion had already decremented it, so
undo either removed an unrelated error or clamped at zero. It also left the
recipient rating credit, health completion count, capability attempt, team stat,
gamification points, and shared-memory record in place, and recorded a negative
conflict-learner outcome for a handoff that had actually completed. Undoing a
cancelled handoff decremented the sender error too.

Fix: `HandoffService.undoHandoff` is the single path. It restores the sender
error (`+1`) only when the previous status was completed; removes the rating
completion, health completion count, capability attempt and success (the exact
inverse of the decay update), team stat, gamification count and action points
(awarded achievements remain sticky), and the shared-memory record; records no
conflict-learner outcome; and reopens a cancelled handoff without touching
counters. The tool fallback mirrors it. New inverses:
`RatingManager.revertHandoffCompleted`,
`HealthTracker.onHandoffCompletionReverted`,
`CapabilityTracker.revertCapabilityUpdate`, `StatsCollector.revertHandoff`, and
`GamificationManager.revertAction`. `scripts/prove-handoff-undo.ts` runs 35
assertions, including the second completion/undo cycle, the cancelled reopen, and
the refused recipient undo.

### E-50 `handoff` rescue credited the stalled recipient as completed — fixed (2026-10-27)

`handoff(rescue:)` set the stalled original to completed and called
`recordHandoffCompleted(original.to)`, so an agent that never finished the work
received the full completion credit while the completion saga's health,
capability, and memory credits were skipped. The precondition only rejected
pending and completed, so a cancelled or already closed handoff could be rescued
again.

Fix: `HandoffService.closeForRescue` requires an accepted or paused original,
sets `status = "closed"` with `rescue = true`, records a health failure (not a
completion), releases file locks and the queue, and leaves `handoffsDropped` at
zero. The tool creates the rescue entry as before and no longer calls
`recordHandoffCompleted`. `parallel-aggregator` and `resumeInterruptedSagas`
treat `closed` as terminal. `scripts/prove-handoff-rescue.ts` runs 22 assertions:
the stalled original is closed, the completion rating/health/memory credits stay
untouched, the health failure is recorded, a double rescue and a pending rescue
are refused, a non-analyst cannot rescue, and a paused original can.

---

## English-only surface (2026-10-27)

The owner required every shipped string to be English, with no Arabic matchers
left in code and no Arabic left in the stored feature index. Seven files were
exempt by exact path in `scripts/check-v2-rules.mjs`; the exemption list and the
`arabicAllowedFile` branch are now deleted, so every scanned file is checked.

- `src/hooks/message-updated.ts`: the Arabic `tawa` mention and Arabic dispatch
  verbs are gone; English mention and dispatch patterns are unchanged.
- `src/hooks/guards/consent-gate-guard.ts` and `src/services/ask-channel-parse.ts`:
  approval and rejection accept English tokens only. An Arabic "yes" no longer
  passes the consent gate; it is treated as an unrecognized answer.
- `src/hooks/guards/task-rejection-guard.ts`: the analytical-framing and
  execution-intent patterns are English-only.
- `src/tools/agent-add-helpers.ts` and `src/tools/agent-management.ts`: add and
  remove commands parse English verbs and `with model ... from ...` only, so the
  Arabic command form stops working.
- `src/i18n/en.json`: the consent prompt and kick examples are English-only.

`src/services/feature-index-english.ts` keeps the stored feature index English:
`FeatureIndex.fromJSON` routes entries through `normalizeLegacyFeatureEntry`,
which restores the English text for the six legacy entries and strips Arabic
runs (or applies an English fallback) for anything else; `register` sanitizes new
entries the same way. This survives the previous build rewriting the file from
memory, because the normalization runs again on every load.
`scripts/prove-feature-index-english.ts` covers 13 assertions: legacy names and
descriptions, unknown mixed entries, registration remainders and fallbacks, and
idempotent normalization.

The shipped bundles are covered too. The global build inlines zod with
`external: []`, so `dist/global.js` carried every `zod/v4/locales/*.js` table,
including 173 lines of Arabic, even though no Tawassul string is Arabic. The
source gate never sees build output. `build-v2.mjs` now rewrites each
non-English zod locale module to re-export the English one; the build does not
inspect its output for Arabic at all. After the rebuild,
`dist/global.js`, `dist/index.js`, and `.opencode/plugin/tawassul.js` contain
zero Arabic lines; `dist/global.js`, `dist/index.js`, and the plugin entry all
define `GoalItemStateSchema` with the `dropped` state.

`npm run check:rules` scans 428 files with zero exemptions; `npm run verify` was
green at that baseline (87 proofs); the current gate runs 110 proofs-stage steps.

---

## Product gaps (P2 unless noted)

- **P-01** `select`/`input` elicitation: fixed in `ccb2cb6`. Unbridged types
  now throw a visible error instead of returning `undefined`; `noReply` uses
  `session.synthetic` and never queues a model turn. The plugin SDK has no
  select bridge, so an unbridged tool call fails closed rather than guessing.
  The host protocol exposes `session.form.create/reply/list/cancel`, but
  `@opencode/plugin` 2.2.1 still does not surface it. Done 2026-10-29: accept
  the fail-closed limitation; `prove-v2-ask-bridge` asserts that `select` and
  `multiselect` fail with a visible error, and a future SDK form surface can
  replace the path without changing the tool contract. P1 per E-03.
- **P-02** A goal closed from `completed` writes a `dropped` tombstone; the
  digest counts stay correct, the label is cosmetic. Done 2026-10-29: accept
  the label. The dropped tombstone is the internal removal marker that lets
  replay count the prior terminal state and remove the goal from the live
  set; writing `completed` there would re-open the deleted goal. `bumpTerminal`
  counts `completed`, `verified`, or `dropped` from the prior state, and
  `prove-goal-capture` asserts that deleting a completed goal keeps one
  completed count, never a dropped count, and that replay agrees.
- **P-03** N2 assistant dedup set is capped at 512; long sessions can
  re-process an old message. Done 2026-10-29: `prove-n2-cap` measures the
  boundary. A 500-message session and the exact 512-message boundary record
  the oldest text part with no miss; the 513th assistant message evicts the
  oldest, and only a burst of 513 assistant messages before the first text
  part of the process can miss. The cap stays 512: `done` stops the hook
  after the first record, so the set is a bounded pre-record buffer, and
  raising it would only enlarge that buffer without changing the common path.
- **P-04** Done 2026-10-29: the static independence proof now scans tracked
  files, the package-entry shape, and symlinks, and
  `scripts/prove-independence-boot.ts` boots the built bundle in a v1-free
  HOME/workspace and asserts loads, tools, and the absence of v1 state (see
  E-07).
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

### E-02 v1 config hook is not bridged — done (2026-10-26)

Original severity: critical. `plugin.config` was only logged at
`src/v2/setup.ts:375-379`; the v2 host never called it. The hook at
`src/bootstrap/plugin-init.ts:837-840` therefore did not run, so the tawa and
addagent permission repair (`ensureTawaToolPermissions` and
`ensureAddAgentToolPermissions`) was not applied at boot. Dynamic models were
already repaired by `repairProjectConfigBoot` (`plugin-init.ts:479`), so only
the permission half was missing.

Mitigations: `gen-opencode-config` bakes models and permissions into
`opencode.json`, and `execute.before` denies `BLOCKED_TOOLS` for tawa via
`isBlockedForAgent`. Risk: a hand-edited or stale config, or a roster changed
after generation, was not repaired at boot.

Resolved 2026-10-26: the two helpers moved to
`src/utils/agent-permission-repair.ts`, and `applyBootRepairs` now parses the
config, applies `applyPermissionRepairs` beside the model repair, and splices
the agent section only when a value actually changes. The boot writer is the
existing `repairProjectConfigBoot` path that `initPlugin` already calls, so no
new host API is required. A scoped rule such as tawa's read-only bash
allowlist is preserved instead of being replaced by a blanket deny; an
explicit `allow`/`ask` on a blocked tool is tightened to `deny`; a missing
blocked key is added as `deny`. The generator runs the same repair, so a fresh
config needs no boot write, and `write` joins the official permission keys so
the generated file validates. `prove-e02` covers the repair, the preserved
scope, idempotence, the combined model+permission pass, the project-only
boundary, and generator consistency (27 assertions).

Scope decision (V-13, 2026-10-29): the boot repair stays project-only. It
reads `opencode.json`/`opencode.jsonc` in the project directory and never
rewrites the user-global config. A project plugin does not own a user-wide
file: several workspaces and host instances share it, the boot path has no
cross-project write lock, and a rewrite would change permissions for every
workspace at once. The runtime `execute.before` deny for `BLOCKED_TOOLS`
remains the guarantee for a stale global config, `gen-opencode-config` writes
the same repaired shape for a generated project file, and the only global
write is the opt-out roster seed in `ensureGlobalRosterSeed`. `prove-e02`
pins the boundary by leaving a stale global config byte-identical beside a
repaired project config.

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

P-01 disposition (2026-10-29): accept the fail-closed limitation. The host
protocol has `session.form.create/reply/list/cancel`, but `@opencode/plugin`
2.2.1 does not surface it, and a direct protocol client would duplicate the
host transport for one tool type. The tool contract stays honest: `select` and
`multiselect` fail with `cannot be delivered` instead of guessing or hanging;
a future SDK form surface can replace the path without changing the caller.

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

### E-07 Independence proof is static — done (2026-10-29)

Original severity: major. `scripts/prove-v2-independence.ts` was a static
scan and never booted with the v1 tree unreachable; it also did not inspect
the v1 tree's bootable package entry (H-09).

Resolved 2026-10-29 in two halves:

- Static: the proof now scans every tracked source, script, and config file
  (not just `src/`), asserts no package-directory plugin entry exists anywhere
  in the tree (the H-09 shape), follows symlinks, and fails if any escapes the
  repo or points at the v1 tree.
- Dynamic: `scripts/prove-independence-boot.ts` (`independence-boot`, smoke)
  boots the built bundle in an isolated HOME and workspace that contain no v1
  tree. It asserts every `loading plugin` line is the scratch v2 entry, no log
  line names the v1 tree or a package entry, no plugin load fails, 42 tools
  register with `initPlugin`, and the HOME has none of the v1 state
  directories (`tawassul`/`tawassyl`).

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

### G-10 H-09 rename has no automated check — done (2026-10-29)

The isolated-boot transcript existed, but no gate referenced
`retired-20261025`.

Resolved 2026-10-29: the `--scan-desktop` step classifies a restored
`plugins/*/index.{js,ts}` v1 entry and a dual `setup` export, and
`prove-desktop-scan` asserts both are reported with the retired marker. The
repo census in `prove-v2-independence` also asserts this tree has no
package-directory plugin entry, so the H-09 shape cannot reappear here.

### G-11 Proof catalog pins floors, not the exact set — done (2026-10-29)

`scripts/prove-proof-catalog.ts` used to assert `proofFiles.length >= 25` and
`proofs.length >= 24`, so a proof file and its gate step could be removed
together and the catalog still passed.

Resolved 2026-10-29: the catalog now pins the exact sorted proof-file list
(`PINNED_PROOF_FILES`) and the exact proofs-stage step count
(`PINNED_PROOF_STEPS`), and fails on any unrecorded addition or removal. The
counts are updated in the same change that adds or removes a proof.

### G-12 Six high-stakes closures have no CI artifact — done (2026-10-29)

H-02, H-07, P-05, and P-07 were prose evidence only; H-06 had a doctor
warning; E-09 had pins but no agreement check (V-52).

Resolved 2026-10-29: `scripts/prove-closure-artifacts.ts`
(`closure-artifacts`, 40 assertions) pins each closure to a gate-wired proof
and to literal evidence markers. H-02 maps to `prove-host-discovery` plus the
doctor PATH/terminal-copy checks, H-06 to `check-sdk-pins` plus the global SDK
pin check, H-07 to the doctor's Bun-global checks, P-05/P-07 to the desktop
scan and its retired/package markers, and E-09 to `check-sdk-pins`. The
`d05-doctor-census` and `desktop-scan` proofs execute `doctor-v2.sh`, so
removing a link fails CI.

### I-11 No committed CI transcript — done (2026-10-29)

The gate result was not an artifact in the tree; the 2026-10-26 run was
recorded only in `VERIFICATION-20261026.md`.

Resolved 2026-10-29: each stage now writes
`.opencode/state/gate-<stage>.json`, and the `npm run ci` umbrella aggregates
them into `docs/CI-TRANSCRIPT.md` (date, node/bun/platform, per-step result
and duration, overall result) and prints the path. Staged runs write only the
sidecar; the umbrella rewrites the committed transcript.

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
- E-07/P-04 now state that the independence proof scans every tracked source,
  script, and config file plus symlinks, and that the dynamic half boots in a
  v1-free HOME (V-32).
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

### C-03 No-agent sessions skip every guard — done (2026-10-27)

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

Fixed in `078d895` by taking the second shape. `src/hooks/tool-execute.ts`
no longer returns early for a named but unrecognized agent: the call runs
`runPipeline`, whose existing unmanaged-agent branch re-checks the tawa
redirect and roster boundaries and runs the consent gate, and a rejection now
throws the tool block instead of returning silently.
`src/hooks/validation-pipeline.ts` runs `consentGateGuard.check` before the
no-agent early return whenever `requiresConsent` matches, so a session without
an agent identity can no longer execute sudo, `git push`, or `rm -rf /`
unseen. Safe commands still take the early return, which keeps the P-10
design: the consent gate is the by-design barrier for dangerous commands and
host permissions remain the fallback for everything else.

`scripts/prove-c03.ts` boots the plugin in an isolated HOME with a real
AskChannel and asserts 19 behaviours: a no-agent dangerous command is blocked
with one synthetic question in the root UI session and no host dialog, the
chat `yes` lets it pass, an unrecognized agent (`build`) cannot push, its
cached `no` keeps it blocked without a second question, safe commands from
both lanes pass with no question, and a managed agent still parks its own
question. The proof fails on `a35b344` at the first no-agent assertion and
passes on `078d895`; it is wired as the `c03-agentless-guard` proofs step, and
`npm run verify` plus the full proofs stage are green (74 proof files / 73
registered steps).

### P-10 Bash guard coverage is split; the `permissionGuard` bash branch is dead — done (2026-10-26)

`permissionGuard` appeared only in `VALIDATION_PIPELINE`, which runs for
tawa-related tools only, so the `DANGEROUS_PATTERNS` bash loop was unreachable
for bash. The only live pattern check was `bashDangerousPatternsStage`, and it
ran only for managed agents; the 11 `PERMISSION_BLOCKED` entries in the live
log came from the stale build (G-13).

Resolved 2026-10-26 (G-002-I2, commit `02ee382`): the dead branch and the live
stage are both deleted; bash is no longer hard-denied by any plugin stage.
The by-design gate for dangerous commands is the consent gate, which asks
(sudo, `rm -rf` on absolute paths, fork bombs, disk tools) and still refuses
without an ask channel; the over-broad idioms (`> /dev/null`, `chown`,
`chmod 777`, `eval`) fall back to host permissions by documented acceptance.
`prove-g002i2` fails on the previous code at the first denied cleanup command
and covers eight command families plus the intact refusal path (37
assertions). The C-03 bypass for unmanaged and no-agent sessions was closed on
2026-10-27 (see C-03).

### G-02-D The bash tier stays settled and the consent set is irreversible-only — done (2026-10-27)

The first G-002 change moved `bash` from admin tier to agent tier and changed
the guard fallback from admin to agent. The owner correction restored the
settled v1 bash model: `TOOL_TIERS` maps `bash` to `admin` with an `admin`
fallback, and no bash permission entry in the roster or `opencode.json` was
touched.

The second change is kept: `CONSENT_DANGEROUS_PATTERNS` is now
irreversible-only. Every `git push` entry is removed, the blanket absolute
path removal rule is replaced by root, home, HOME expansion, and the system
directories (`/etc`, `/usr`, `/var`, `/boot`, `/root`, `/home` and its direct
accounts), `curl|bash` and `wget|sh` are added, and the destructive rules are
case-insensitive so `Rm -Rf /` and `RM -RF ~` are caught. `prove-g002i4`
covers 16 gated and 11 ungated commands plus the shell alias and the set shape
(37 assertions); `prove-g002i2`, `prove-shell-alias`, and the `prove-c02` live
chain drive their consent walkthrough through `sudo git push`, which still
reaches a real remote after approval. The P-10 hard-denial removal and the live
consent answer-loop proof stay.

### G-02-C The consent answer loop had no live proof — done (2026-10-26)

The consent gate only ever rejected commands in tests; no proof walked the
production defer path end to end, so a dead answer loop would ship silently.

Resolved 2026-10-26 (commit `27054e6`): `prove-g002i3` boots the real plugin in
an isolated HOME with the ask channel enabled, then drives the same wiring the
hooks register (`chatOnlyAsk`, `askChannelInstance`): a consent-gated bash call
parks exactly one question in the channel, the first attempt is blocked with
the awaiting-approval message, a root user answer of `yes` is consumed by the
channel instead of the model, and the same command passes on retry and
executes; a `no` answer keeps it blocked. A mutation that disconnects the
`onResolve` wiring fails the retry assertion, so the proof catches a dead
answer loop (17 assertions).

Extended 2026-10-27 (commit `ab270d0`): the proof now calls the real
`tool.execute.before` hook from the booted plugin instead of a hand-built
channel, so the question is rendered by the registered AskChannel through
`session.synthetic` into the root session's transcript — the surface the
OpenCode chat UI displays. It asserts the ask marker, the exact command, the
acceptance tokens, root-session targeting, that the question is not queued as
a model turn, and that the host permission dialog is not used; the chat `yes`
and `no` replies then drive the gate. 21 assertions.

### G-03-A The daily free limit was blind-retried like a transient 429 — done (2026-10-26)

When the OpenCode Zen free daily quota is spent the host emits the typed error
`provider.free-limit` (FreeUsageLimitError, 429) with a `retryAfterMs` reset
delay. The plugin's event hook read only the error message string, so a spent
daily quota looked like any other rate limit: it blind-retried an already dead
session up to five times on the backoff budget and injected retry prompts,
while the reset delay never reached the user.

Resolved 2026-10-26 in two steps: `src/services/free-limit.ts` (commit
`35b212e`) recognizes the typed error — including the form nested under an
`error` field — and its delay in milliseconds, a seconds string, or an absolute
reset timestamp, with a text fallback for `Free usage limit reached` and its
variants and a distinct transient signal for a plain rate limit; the parser
never guesses a missing delay (`prove-g003i1`, 43 assertions). The event hook
(commit `a775d1b`) runs `evaluateFreeLimitBridge` behind the `freeLimit.noRetry`
config flag, which is off by default: when on, a recognized daily limit skips
the retry entirely and logs the reset delay, a transient rate limit keeps the
legacy retries, and any parse failure falls back to legacy so a malformed error
can never become a hard block (`prove-g003i2`, 33 assertions). The config
schema and config type gain the `freeLimit` block with `notice` and `noRetry`
toggles.

### G-03-B The free-limit bridge had no user-visible notice and broke typed transients — done (2026-10-26)

The bridge stopped the blind retry but the user still saw nothing: the reset
delay only reached the log, so a spent daily quota looked like a silent stop.
Wiring the prompt-shape change into the event hook also exposed a regression:
the hook read only a string error, so a structured `provider.rate-limit`
object flattened to nothing, never reached `matchesRateLimit`, and a transient
limit silently stopped retrying while the bridge was on.

Resolved 2026-10-26 in four commits. `buildFreeLimitNotice` (commit `cdf44d0`)
renders one notice for a daily-limit decision: the reset time as the delay
added to the current clock in ISO form with a whole-minute estimate, the
shared-quota guidance (the free quota is shared across models on the same
identity, so switching key or model does not help), and a plain statement that
retrying will not help; a delay-less decision renders the same guidance with no
invented reset time and a non-daily decision renders nothing (25 assertions).
The notice strings come from `en.json` keys with the English text kept as the
default, and the `freeLimit` block (`notice`, `noRetry`) is schema-validated
and defaults off, so an unconfigured install is byte-for-byte legacy (29
assertions, commit `c360b54`). The event hook now flattens a structured error
into its message, type, and name before the legacy check and the default
rate-limit patterns include the hyphenated `rate-limit` spelling, so typed
transients keep retrying while the daily limit short-circuits to the notice
(8 live assertions, commit `99ed373`). `prove-g003i6` collects the four
contract cases the goal names — typed error, missing `retryAfterMs`, transient
429 unchanged, and flag-off deep-equal to legacy across ten inputs and five
off-configs — and its snake_case case caught one more parser gap, now fixed by
`rate[ _-]?limit` (84 assertions, commit `afdfd34`).

The bridge and the notice are additive and config-gated; AFRouter and
free-provider routing stay external user-land setup only.

### B-11 Predictive-router rewrites its file every 5 minutes — done (2026-10-26)

`src/features/predictive-router.ts:398` included `exportedAt: Date.now()` in
`exportData()`. `writeIfChanged` (`service-factory.ts:283`) therefore always
saw a change, and the 5-minute timer (`:289-293`) rewrote the full file plus
a timestamped backup. Live evidence: five backups under
`~/.config/tawassul-v2/state/` at exactly 5-minute intervals
(05:03, 05:08, 05:13, 05:18, 05:23), all 1134 bytes, next to the live file.
This defeated the dirty-only claim in TRIAGE section C and grew the backup
family without bound on a fixed build.

Resolved 2026-10-26: `exportData()` no longer embeds a timestamp, so an
unchanged router serialises to identical bytes and `writeIfChanged` skips the
write, the mtime bump, and the backup. `prove-b11` exports twice with a delay
between, saves five unchanged exports and asserts none wrote, then makes a
real change and asserts it does write while the backup family stays at the
two-copy cap (8 assertions).

### B-12 `panic` backup is best-effort and never pruned — done (2026-10-26)

`src/tools/system-controls.ts:222-231` copied `tawassul-state.json` to
`tawassul-state.panic-backup-<uuid>.json`, logged a warning on failure, and
proceeded with `clearAllState()`; with no `stateDir` it wrote no backup at
all. The name matched none of the prune families in `atomic.ts:29`
(`.bak.<digits>.<12hex>`), so it accumulated forever. `ALLOWED_AGENTS` is
`["@analyst"]` (`:178`), so the main user cannot run the reset from the main
session while a single delegated agent decision can wipe the history.

Resolved 2026-10-26: the backup is now mandatory. `backupBeforePanic` copies
the state file to `<stamp>-<uuid>` inside the `panic-backup-` family and
prunes that family to the three newest; any failure aborts the tool with
`panicBackupFailed` and leaves `clearAllState()` uncalled. A missing state
file is distinguished from a failed copy: the reset proceeds and reports
`panicNoStateFile` instead of claiming a backup exists. `prove-b12` runs a
confirmed panic, checks the clear happens only after the copy exists and the
report names the file, seeds five old backups and asserts the cap keeps the
three newest, runs with no state file, and forces an unreadable state file to
assert nothing is cleared (11 assertions).

The `ALLOWED_AGENTS = ["@analyst"]` allow-list is left as it is: widening it
is a policy decision about who may wipe history, not a defect in the backup
path, and the operator can already reach it through `@analyst`.

### G-13 The live host keeps pre-build code until restart — fixed (2026-10-28)

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

Resolved 2026-10-28 by `scripts/host-refresh.sh` (the E-51 fix, below). The
suggested doctor check — process start time against the entry-file mtime — is
the wrong clock after a reload: a reload re-imports the entry without starting
a new process, so process start only ever grows older. The supported signal is
the newest plugin-init line in `~/.local/share/tawassul-v2/tawassul/tawassul.log`
plus the `v2 bundle sha256=` fingerprint logged at init, compared with the entry
file; `npm run host:refresh -- --verify-only` reports it on demand.

### E-51 Deploying a plugin fix still required a manual host restart — fixed (2026-10-28)

`npm run build` rewrote `.opencode/plugin/tawassul.js`, but the Desktop service
kept the module it had imported, so a repair shipped in `dist/` stayed
unreachable until the operator restarted the service by hand: the only
documented refresh path was `opencode-cli service restart`, which kills the
running session (G-13 records the same defect as a missing staleness check).
`opencode-cli reload` exists and was never verified, so nobody could tell
whether it re-read the entry file, and nothing failed when a stale host kept
running.

Fix: `scripts/host-refresh.sh` (`npm run host:refresh`) is the single refresh
path. It parses the embedded `TAWASSUL_CONTENT_SHA` out of
`.opencode/plugin/tawassul.js`, recomputes the source digest through
`scripts/source-digest.ts`, and refuses a reload when they differ
("plugin entry is stale ...; run npm run build"). It resolves the host CLI
(`TAWASSUL_HOST_CLI`, then the newest Desktop-bundled CLI, then PATH), runs
`opencode-cli reload` from this repository, and polls the plugin log until a
`Background init completed successfully` line is newer than the moment the
reload started, so a reload that cannot load the entry fails instead of
reporting success. The plugin now logs
`v2 bundle sha256=<hash> bytes=<n> entry=<path>` immediately before that line,
and the helper compares the hash with the SHA-256 of the entry file, so the
check is content-exact: rebuilding an unchanged entry updates its mtime without
creating a false stale result, and a reload that loaded different bytes fails.
`-- --verify-only` performs the same check without touching the host. A log
from a host that predates the fingerprint falls back to the entry mtime.
`-- --restart` is the automated fallback: it schedules
`systemd-run --user --collect --unit=… --on-active=… opencode-cli service
restart` detached, and the detached job restarts the host, verifies the init,
and writes `~/.local/state/tawassul-v2/host-refresh.json` (status, init
timestamp, service PID, unit). The detached schedule is required because
restarting the running service from inside a session ends that session.

`scripts/prove-host-refresh.ts` (the `host-refresh` proofs step, 56 assertions)
covers CLI discovery from the Desktop tree, a successful reload, a reload with
no fresh init, a reload whose live bundle differs, a missing plugin log,
`--verify-only` (fresh, stale, digest mismatch, and live-bundle mismatch), the
fingerprint utility, the mtime fallback, the restart dry run, and the detached
restart path producing a fresh and a stale report. At the time,
`prove-proof-catalog` counted 100 proof files / 97 steps; the tree is now at
103 / 100.

Live check 2026-10-28 (the server restart reset the PID to 3157):
`npm run host:refresh -- --verify-only` matched the logged bundle fingerprint
with the entry file's SHA-256; `npm run host:refresh` then printed
`host-refresh: OK mode=reload init=2026-10-28T22:06:08.241Z pid=3157`, the log
recorded `v2 registered 42 tools` at 22:06:08.833Z, and the service PID stayed
3157. The earlier reload at 12:30:27.054Z kept pid 1249993 and registered 42
tools, so both runs load the new bundle without an operator restart.

### E-52 The maintenance lock loser deleted the holder lock — fixed (2026-10-29)

The single-run lock was ported from the v1 tree with its EXIT trap intact:
the trap removes `$LOCK_DIR` whenever the variable is set, but both loser
branches (exit 8 when a live holder owns the lock, and exit 8 after a
contested reclaim) left `LOCK_DIR` pointing at the holder's directory. A
losing run therefore deleted the live winner's lock, and a third run could
enter while the winner still worked. An isolated sandbox reproduced it
deterministically: with a live holder pid recorded in the lock, the loser
exited 8 and removed the lock, and the next run completed with rc=0 while
the holder was alive. The retired v1 tree carries the same flaw; it is not
fixed there.

Fix: `scripts/opencode-db-maintenance.sh` clears `LOCK_DIR` in both exit-8
branches before exiting, so only the owner that created the lock removes it.
`scripts/prove-db-lock.ts` (the `db-lock` step, 26 assertions) stages the DB
scripts into two separate project copies, asserts a loser keeps the live
holder lock and leaves the DB byte-identical, asserts dead-owner reclaim, and
runs a four-way concurrent wave (one winner observed, losers exit 8 and name
the contended lock) with `PRAGMA integrity_check` clean before and after.

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
3. ~~Delete the workspace residue~~ — declined by the owner on 2026-10-29. The
   owner will replace the v1-loaded plugin with v2 in each project manually
   after the fixes finish; no agent may delete files outside this tree.
   Measured residue at the decision point: ten `tawassul.js.pre-refresh-*`
   copies in five workspaces, twelve `*.retired-20261024` files (six
   `tawassul.js`, six `tawassul.mjs`), and five inert `dist`-only
   `.opencode/plugins/tawassul/` package dirs (`ciel-osk-workspace`,
   `dart22222222`, `vpro`, `vusial 2`, `vusual`). The retired v1 source tree
   `tawassyl` stays a read-only reference. The owner decided this on
   2026-10-29, and it replaces the earlier delete proposal.
4. ~~Delete the `/tmp/opencode` artifacts~~ — done 2026-10-26. All scratch
   under `/tmp/opencode` was removed (about 1.09 GB, including the four
   `v1tree-*` copies and the probe/build directories). The directory has since
   been reused as owner and session scratch (logos, art, and probe scripts),
   so it is not empty and is not an agent cleanup target; `/tmp` is cleared on
   reboot, which removes it automatically. P-07 is also done; the only
   remaining exit item is the opt-in global install (I-01).
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
8. ~~D-05 enforcement shape~~ — done 2026-10-27. The recommended shape is
   what shipped: a bounded read-only census with a 32-file cap, a 14/14
   baseline guard on the shared and launcher copies (growth only through
   `TAWASSUL_ALLOW_LEGACY_GROWTH=1`), the v2 CLI namespace classified as
   test-only and failed when it holds sessions, and no boot-time auto-move.
   `scripts/prove-d05.ts` proves it with 28 assertions; see D-05.

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

#### E-14 Tool failures are recorded as successes — done (2026-10-26)

`src/v2/setup.ts:292-307` received the host's `execute.after` payload, which
carries `status: "completed" | "error"` (authoritative in
`node_modules/@opencode/plugin/dist/promise/tool.d.ts`), but mapped both
branches to the same v1 shape with `title: ""`. The v1 side then inferred
success from a non-empty output string. A v2 error result is non-empty, so
every failure was counted as a success.

Impact: agent health, capability success rate, rating, dedup, and the circuit
breaker all consume this bit. A consistently failing agent was promoted, and a
broken tool never tripped the breaker.

Resolved 2026-10-26: the adapter already tagged the v1 metadata with
`status: "error" | "completed"` (synthetic when the tool set none); the
consumer now reads it. `src/hooks/tool-execute.ts` decides `success` from
`metadata.status` first and only falls back to the non-empty-output heuristic
when the result carries no recognised status, so v1-shaped results keep their
old meaning. `prove-e14` drives the real after hook: an error result with a
long message is logged as an error and three of them trip the tool-loop guard,
a completed result with empty text counts as a success and clears that count,
and untagged or unrecognised statuses fall back to the string heuristic
(11 assertions).

#### E-15 Streaming, auto-save, and notifiers listen for v1 events — done (2026-10-26)

`src/hooks/tool-output-stream.ts:86` and `:100` matched
`message.part.delta` and `message.part.updated`. The v2 host emits
`session.text.*`, `session.tool.*`, and `session.execution.*`
(`src/v2/event-adapter.ts` mapped only the execution family). On the supported
host the stream therefore never saw a delta.

Impact: live tool output was silent on v2 while appearing healthy in tests
that fed synthetic v1 events. `n2-auto` already read `session.text.*`
natively, so auto-save and compression kept working.

Resolved 2026-10-26: the adapter now maps the text and tool families —
`session.text.delta` to `message.part.delta`, and `session.tool.called`,
`.progress`, `.success`, `.failed` to `message.part.updated` with a `tool`
part whose state moves from `running` to `completed` or `error`. The v2 tool
events carry only a call id, so the setup bridge records `id -> tool` in
`execute.before` (capped at 500 entries) and passes a `toolOf` resolver to the
mapper; a call with no recorded name maps to a part the stream skips instead
of printing the wrong label. Every mapped event is still preceded by the raw
v2 event, so the v2-native listeners keep their input. The stream hook gained
an injectable `logLine` so the proof observes the emitted lines.
`prove-e15` runs the called/progress/success/failed sequence through the real
mapper and the real hook, asserts the head is printed once and the tail only
once, checks the untracked and failed cases, and keeps a v1-shaped part
working (15 assertions).

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

#### E-17 `tool.definition` is unregistered, so schemas are placeholders — done (2026-10-26)

The v2 setup never registers a definition hook, so the host advertised the
placeholder schema (`additionalProperties: true`) and `makeV2Tool` did not run
a zod parse before dispatch.

Impact: the model could send arbitrary arguments, invalid arguments reached
handlers, and a schema regression could not be detected from the host side.
This was also why B-02's window was dangerous rather than merely slow.

Resolved 2026-10-26: the host has no `definition` hook (only `transform`, the
`tool` editor, and `execute.before/after`), so the fix takes the second path
from the entry. `makeV2Tool` builds a `z.object(def.args)` validator at
registration and parses the arguments before dispatch; a failed parse throws
`Invalid input for tool "<name>": <path>: <message>`, which the host records
as a tool error, and the handler is never called. A tool that declares no
arguments keeps the permissive placeholder and dispatches unchanged. The
advertised `input` remains the schema produced by `buildToolJsonSchema`, which
`prove-e17` asserts is the real one with `required: ["count"]`. The stub
`buildValidator` helper was removed in the same edit (16 assertions).

#### E-18 Hook errors are swallowed and the guard fails open — done (2026-10-26)

`src/v2/setup.ts` wrapped the safety bridges in `try/catch` and continued on
every error. Two paths failed open: a consent or tool-block decision raised
from `chat.message` was logged and dropped, and the `execute.before` bridge
ignored the v1 `output.error` contract entirely, so a guard that reported a
denial through the documented field was treated as an allow.

Impact: the failure mode of a safety hook was "off". A payload change in a
host update could turn the guard layer into a no-op without failing the gate.

Resolved 2026-10-26: the bridges now classify errors. A `ConsentBlockedError`
or `ToolBlockedError` is rethrown from `chat.message` and `execute.before`
instead of being swallowed, and a non-blank `output.error` set by the before
hook blocks the call with that message. Infrastructure faults still fail open,
but loudly: `reportSafetyHookFailure` logs at error level and writes a
`V2_SAFETY_HOOK_FAIL_OPEN` audit event. The `bash` rule is preserved — a
thrown infrastructure error on a `bash` call does not become a hard block, so
delegation keeps working. `prove-e18` covers both decisions, both fail-open
paths, the argument rewrite, and the blank-error case (14 assertions).

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

Resolved 2026-10-26: every mutation rewrites the whole ledger, so the file
lock stays keyed on `metaPath`, but it is no longer the only guard. Mutations
queue in-process before taking the lock, `withLock` retries `acquireLock` up to
20 times at 50 ms for cross-process contention, and the release is awaited.
This matters because the file lock alone has an acquire window where two
callers can both win — reproduced as two parallel evidence appends each
cloning the same snapshot and losing one entry. `prove-e23` runs three
concurrent creates, two concurrent updates to different goals, and two
concurrent evidence appends; it reloads from disk after each and asserts none
were dropped, then holds the file lock for 120 ms and asserts a mutation waits
and commits (13 assertions, stable over repeated runs). The resurrection
proof now starts a mutation, deletes during it, and asserts the goal is absent
in memory and after a reload, with a later mutation returning `not-found`.

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

#### E-25 AskChannel answers questions on the user's behalf under load — done (2026-10-26)

`src/services/ask-channel.ts:214-217` returned `Promise.resolve(defaultFor(kind))`
when `_capacityOk(sessionID)` was false, and the same synthetic value on a
disposed channel. `defaultFor` returned `kind.default` for a confirm, `""` for
select, and `[]` for multiselect, and callers treated that as a user decision.

Impact: with 8 pending questions in one session or 100 overall, a select was
answered with the empty string and a confirm with its default. Consent asks
used `default: false`, so consent failed closed — but every other elicitation
silently fabricated an answer, and neither the caller nor the user could tell.

Resolved 2026-10-26: the channel returns the distinct `ASK_UNAVAILABLE`
sentinel when it is disposed or at either cap, and writes an
`ASK_UNAVAILABLE` audit event with the reason, kind, session, and pending
count. Disposing settles a pending question as unavailable instead of a fake
answer; a real user reply and the documented confirm default on timeout are
unchanged. Callers fail closed: the `review` tool reports that the question
could not be delivered and never assumes approval, a bulk `kick` reports the
undelivered confirmation through `kickBulkConfirmRequired` and removes
nothing, a dismissed review counts as a rejection, and the elicitation gate
returns `reason: "unavailable"` instead of selecting an option. `prove-e25`
covers both caps, disposal, deferred refusal, the gate, review, and kick (29
assertions).

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

#### E-27 The smoke gate passes a boot that never produced a reply — done (2026-10-26)

`scripts/release-smoke.sh:103-111` downgraded a non-zero boot to
`SMOKE PASS (no model reply)` when the output merely matched
`ECONNRESET|Transport:|socket connection|ETIMEDOUT|timed out|timeout`, or
when `BOOT_RC` was 124. The plugin-boot markers (`initPlugin`,
`v2 registered 42 tools`) were checked, but a plugin that hangs, or that
breaks after boot, produces exactly those markers plus a timeout.

Impact: `README.md:96` claimed "a broken plugin cannot pass it". A C-02-class
regression — plugin boots, routing dead, run times out — passed green. The
only end-to-end gate in `npm run ci` could not distinguish it from provider
flakiness.

Resolved 2026-10-26: the transport tolerance is gone. `release-smoke.sh` now
requires a reply by default (`TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY` defaults to
1), and the only tolerated no-reply is an explicit provider refusal code
(`provider.*`, `FreeUsageLimitError`, `"status": 429`, `Free usage limit`),
reported as `SMOKE PASS (no model reply — provider refused the model call)`.
A boot that hangs or times out after the plugin markers exits 3, the same as
any other boot failure. Setting `TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=0`
restores the old tolerance deliberately and the pass message names the switch.
`prove-e27` runs the real script against a stub host in four modes — hang,
opt-out hang, provider refusal, real reply — and asserts the exit code and the
reporting for each (11 assertions).

### New P2

#### E-28 `patch` and `apply_patch` are absent from `BLOCKED_TOOLS` — done (2026-10-27)

The host maps `write`, `patch`, and `apply_patch` to the `edit` permission,
and the tawa config denies `edit`, so the bypass is not currently
exploitable. It is not listed in `BLOCKED_TOOLS`, so the protection rests
entirely on one config line that a regeneration can change.

Next: add both names, and assert the list in a proof.

Fixed in `3fdb540`, but not by adding the names to `BLOCKED_TOOLS`. That array
is also the permission-key source for the generated and repaired `tawa`
config (`gen-opencode-config.ts`, `agent-permission-repair.ts`), and
`validateAgents` rejects keys that are neither official permission keys nor
registered Tawassul tools; `patch`/`apply_patch` are neither, so adding them
made `prove-e02` fail with `unknown permission key "patch"`. The host maps
both to the `edit` permission, which the config already denies.

The fix names them separately: `BLOCKED_TOOL_ALIASES =
["patch", "apply_patch"]` and `isBlockedToolForTawa(tool)`, used by
`SecurityPolicy.checkBlockedTools`, `SecurityPolicy.enforce` (the
`security-policy` pipeline stage), and the v2 bridge's `isBlockedForAgent`
pre-check in `src/v2/setup.ts`. Tawa is now refused by name even if the
`edit: deny` line is regenerated away, while the generated config keeps only
valid permission keys. `apply_patch` was already recognized as a mutating
host tool in `code-state-auto.ts`, so the name is live, not hypothetical.

`scripts/prove-e28.ts` asserts 31 behaviours: the seven original blocked
tools, the two aliases, the helper, `checkBlockedTools` and `enforce` for
`tawa`/`@tawa`, normal managed agents staying allowed, the boot repair writing
`edit: deny` without invalid `patch`/`apply_patch` keys, the repaired set
passing `validateAgents`, and an explicit scoped `patch` rule surviving
untouched. It fails on `dee2ffb` at the alias assertion and passes on
`3fdb540`; it is wired as the `e28-blocked-tools` proofs step, and the full
`npm run ci` is green (75 proof files / 74 registered steps).

#### E-29 One failing web request trips the Firecrawl breaker for 60 s — done (2026-10-26)

`src/tools/web.ts:58` constructs `CircuitBreaker(3, 60_000)`. Both
`firecrawlPost` and `firecrawlGet` called `recordFailure` inside the
*per-attempt* catch (`:489`, `:520`), before the retry backoff. With
`maxRetries = 3` a single request contributed four failures and opened the
breaker; `evaluate` then threw for every subsequent fetch, search, map, and
crawl for 60 s.

Impact: one bad URL or one transient outage escalated into a global outage of
the entire web surface.

Resolved 2026-10-26: both helpers record the failure once, when the request
finally gives up, instead of on every attempt. A user abort is not counted as
a service failure, the retry loop is unchanged, and the breaker still opens at
three separate failed requests and still fails fast afterwards. `prove-e29`
drives the real web tool against a stubbed upstream: one failing request costs
exactly one failure and the next request still reaches the upstream, three
separate failures open the breaker, a success clears the count, and an abort
is ignored (18 assertions).

#### E-30 `applyPatch` has a prefix-check escape and a cross-device write — done (2026-10-29)

`src/services/apply-patch.ts:69` validated with
`fullPath.startsWith(path.resolve(options.baseDir))`, so `/base/dir2/x`
passed when the base was `/base/dir`. The realpath guard at `:74-81` sat in a
`try/catch` that swallowed, so it was skipped when the target did not exist
yet — a symlinked parent was therefore not resolved. The write went to
`os.tmpdir()` and was `rename`d (`:106-107`), which failed `EXDEV` across
filesystems and leaked the temp file.

Current reach: `applyPatch` has no caller in `src/`; only
`scripts/prove-disclosure.ts:32` counts it. It is a latent escape in the only
in-repo patch writer.

Resolved 2026-10-29: containment is `path.relative` plus a separator check
(`isInside` / `isInsideOrEqual`), the parent is resolved through the nearest
existing ancestor (`resolveAncestor`), and a realpath check rejects a symlinked
parent, a symlinked target, and a symlinked `.bak`. The temp file is written in
the target directory with the target mode preserved and `rename`d in place, and
a failure unlinks it. `prove-e30` covers traversal, sibling prefixes, a missing
base, symlinked parent/target/backup, nested creation, mode preservation, dry
run, lock release, failure cleanup, directory targets, and tmpdir isolation
(31 assertions).

#### E-31 Event metrics are written to a collector that is thrown away — done (2026-10-26)

`src/context-class.ts:190` initialised `metricsCollector = new
MetricsCollector()` with no path. The constructor passed it to
`new EventHub(this.timerManager, this.metricsCollector)` (`:423`) and then
replaced the field with a path-backed collector (`:429`). `EventHub` kept the
original reference, and `MetricsCollector.saveToDisk()` returns early when
`filePath` is null.

Impact: `eventhub.dlq.added`, `eventhub.backpressure.drop`, and
`eventhub.emitwait.timeout` — the only signals that listeners are failing or
events are being dropped — were permanently unobservable.

Resolved 2026-10-26: the path-backed collector is built right after the
install scope is known and before `EventHub` is constructed, so the hub and
the context field are the same object; the later reassignment is gone.
`prove-e31` builds a real context, emits an event whose listener throws,
asserts `eventhub.dlq.added` lands on the context collector, saves it and
reads the counter back from `metrics.json`, then checks a second context pairs
its own hub and starts with no inherited count (8 assertions).

#### E-32 The proof catalog enforces floors, not exact counts — done (2026-10-29)

`scripts/prove-proof-catalog.ts` asserted `>= 25` proof files and `>= 24`
proof steps, so a file and its gate step could disappear together. The tree
now has 103 files.

Resolved by G-11: the catalog pins the exact sorted file list and the exact
proofs-stage step count, and fails on any unrecorded addition or removal.
The floor assertions are gone.

#### E-33 The client shim silently drops user-facing side effects — done (2026-10-26)

`src/v2/client-shim.ts:77-85` implemented `tui.appendPrompt` and
`tui.showToast` as log-only no-ops, and `:91` hardcoded
`serverUrl: undefined`.

Impact: rate-limit warnings, review prompts, and toast notifications never
reached the user on v2; model-injection text lost the host URL it is built
from. Both failures were silent. Worse, the fake `appendPrompt` made the ask
renderer resolve to `"append"`, so every question was logged and never shown
while the ask channel waited for an answer.

Resolved 2026-10-26: the shim exposes only the capability it really has. There
is no v1 TUI on v2, so the fake `appendPrompt`/`showToast` handles are gone and
the ask renderer resolves to the transcript, where questions are injected with
the ask marker and a real session id. The rate-limit retry and exhaustion
notices use the same synthetic transcript path through `notifySession`, which
returns `false` and logs when the bridge is missing instead of pretending; the
toast-only `TAWASSUL_ASK_APPEND_PROMPT` flag is retired with the append mode.
`serverUrl` is derived from `OPENCODE_SERVER_PORT`/`OPENCODE_PORT` (an invalid
port is ignored rather than guessed), so the model-injection text keeps the
host URL. `prove-e33` covers the shim surface, renderer resolution, question
delivery, both rate-limit notices, the undelivered path, and the server URL (28
assertions).

#### E-34 `chat.message` message-level mutations are discarded — done (2026-10-26)

`src/v2/setup.ts:99-115` built `v1Output.message` and never read it back:
after the hook returned, only `v1Output.parts` were pushed into the host
content. Any hook that changed `message.role`, `agent`, or `model` had no
effect.

Impact: a hook that rerouted the request — promoted a message to `system`,
switched the agent, or overrode the model — was silently ignored on v2 while
the same hook worked on v1.

Resolved 2026-10-26: the bridge reads `v1Output.message` back. A valid role
(`system`, `user`, `assistant`, `tool`) replaces the host message role, a
non-blank `agent` replaces the request agent, and a `model` in either
`provider/model` or `{ providerID, modelID }` form replaces the request model;
an unknown role, a blank agent, or an unparseable model is ignored instead of
corrupting the request. A replaced `message.text` wins over part edits for
string content, while array content keeps the part-level path. `prove-e34`
drives role, agent, model, text, append, edit, no-op, invalid-role, and dedupe
cases (13 assertions).

#### E-35 Tool result titles and metadata are lost on v2 — done (2026-10-26)

`src/v2/adapters.ts:50-72` mapped only `output` and `metadata`;
`src/v2/setup.ts:295,304` hardcoded `title: ""` for both the completed and
the error branch.

Impact: every status title ("🌐 Web Fetch", "🚨 Panic Reset Complete", the
cache-hit distinction) was invisible to the user and the model. Separately,
`src/tools/direct-response.ts:37,45` returned a `requiresTask` field that no
consumer reads and that the adapter drops, while the schema description still
told the model it influenced routing.

Resolved 2026-10-26: the v2 result type has no title field, so `toV2Result`
keeps the v1 title in the result metadata under `tawassul.title` instead of
dropping it, and leaves a tool's own `metadata.title` (a web page title)
untouched. The `execute.after` bridge seeds `output.title` from that key and
writes a changed or cleared title back into the result or error metadata, so
hooks see a real title instead of `""`. The model still receives only the
content, but the title is no longer lost: the UI and any metadata consumer can
read it. `requiresTask` is deleted from the direct-response schema and result
because nothing read it. `prove-e35` covers the adapter round-trip, the
after-hook edit and clear paths, and the reduced direct-response schema
(18 assertions).

#### E-36 A failed crawl is returned as a successful result — done (2026-10-26)

`src/tools/web.ts:849-865` broke the poll loop on `failed` or `cancelled`
and then returned a normal result with `title: "🕸️ Web Crawl"` and the status
encoded only in prose. No throw, no error metadata, no cache entry.

Impact: combined with E-14, a failed multi-page crawl was recorded as a
success and was indistinguishable from a legitimately empty site without
parsing the text.

Resolved 2026-10-26: the crawl now throws `WebTerminalError` with the upstream
reason as soon as the status is `failed` or `cancelled`, and the tool's outer
catch rethrows that error after cleaning up temp outputs, so the host records
the call as an error result. A completed crawl still returns its pages, a
completed crawl with no pages is still a normal empty result, and a
non-terminal Firecrawl failure (for example a failed start request) keeps the
readable error result it had before. `prove-e36` drives the real web tool
against a stubbed Firecrawl server across the failed, cancelled, completed,
empty, and non-terminal cases (10 assertions).

#### E-37 The v2 type shim is weaker than the host contract — done (2026-10-29)

`src/v2/types.ts` now derives the bridge contract from `@opencode/plugin`
instead of restating it:

- `V2ToolContext` is the host `ToolContext`, so `signal` is required.
- `V2Permission` is `Pick<PermissionDomain, "assert" | "hook">` and
  `V2Context.permission` is required.
- `V2Tool.hook` is `ToolDomain["hook"]`, so only `execute.before` and
  `execute.after` typecheck.
- `V2Session.hook` is `ModelHooks<SessionHooks>`, so hook names are narrowed
  and model-scoped hooks accept `{ providerID }`.
- `V2SessionIdle` is the host `SessionIdle`; `V2Registration` is the host
  `Registration`.

`src/v2/setup.ts` casts only at the two v1 adapter boundaries: the mutable
session event consumed by the chat bridge and the mutable after-hook result.
`prove-e37` asserts the required fields, the exact tool hook names, the
provider scope, and the host declarations (15 assertions); it is wired as
gate step `e37`.

#### E-38 Schema-refresh disposal does not await the in-flight refresh — done (2026-10-26)

`src/v2/setup.ts:225-228` set `stopRefresh = true` and called
`void refresh.catch(...)`, so a refresh already in progress could call
`ctx.tool.reload()` after the registration was disposed.

Impact: a reload against a disposed tool domain during shutdown or reload.

Resolved 2026-10-26: the retry loop moved to `startSchemaRefresh`
(`src/v2/schema-refresh.ts`), which returns the in-flight `done` promise and a
`stop` that sets the flag and awaits it. The setup keeps the handle and awaits
`stop()` before running any registration cleanup, and the loop checks the stop
flag again after `refresh()` so a stopped refresh never calls `reload()`. A
failed probe or reload is logged inside the lifecycle instead of rejecting the
detached task. `prove-e38` covers the helper lifecycle and the setup disposal
ordering, including a reload that is still in flight (16 assertions).

#### E-39 `isBlockedUrl` is a pre-flight string check only — done (2026-10-29)

`src/tools/web.ts` keeps the preflight and adds a post-response check:

- `blockedFinalUrl` reads `metadata.sourceURL`, `metadata.url`, or a
  top-level `url` and re-applies `isBlockedUrl` when it differs from the
  requested URL.
- `fetch` returns `redirect blocked` before any content is read or cached.
- `map` drops links that resolve to private or local targets and reports the
  count.
- `partitionCrawlDocs` separates safe crawl pages; the tool reports blocked
  pages and fails closed when every page is blocked.
- The tool description states the trust boundary: Firecrawl performs the
  egress, and the plugin only re-checks the final URL the response exposes.

`prove-web-ssrf` now covers the helper, a blocked redirect, a clean redirect,
a top-level final URL, a missing final URL, map filtering, and crawl
partitioning against a stubbed Firecrawl server (39 assertions). DNS
resolution remains Firecrawl's responsibility; the plugin cannot pin the
address it never resolves.

### New P3

#### E-40 Shell scripts carry comments that no gate can see — done (2026-10-29)

`AGENTS.md` now states the gate scope explicitly: the comment ban covers
`.ts`, `.mjs`, and `.json` under the scanned paths, while shell comments are
allowed for operational notes and must be English. Markdown and YAML may
document behaviour. The old wording claimed shell was kept comment-free by
review, which was already false: six of the ten shell scripts carry comment
headers or inline safety notes.

This is a policy closure, not a checker change. `check-v2-rules.mjs` still
rejects every non-directive comment in the scanned extensions, `prove-rule-gate`
still proves that, and `check:sh` still parses every shell script. The shell
comments stay where they are because they document destructive database
operations and exit codes that the syntax check cannot express.

Impact: the rule no longer claims a guarantee it does not enforce, and no
safety documentation was deleted to satisfy a gate that never read it.

#### E-41 There is no unit suite, and some proofs assert the defect — done (2026-10-29)

Validation is 105 `scripts/prove-*.ts` files, run as 102 isolated
`gate:proofs` steps plus the catalog in `gate:fast` and two boot proofs in
`gate:smoke`. The old body said 32 scripts; that count was stale. There is
still no `tests/` directory, and this closure keeps it that way by decision.

The proof harness is the unit harness. Each proof imports the shipped module,
calls the real function, asserts the observable result, exits non-zero on the
first failure, and runs in its own child process, so module state, locks, and
environment cannot leak between cases. `prove-proof-catalog` pins the file
list and fails when a proof is unwired or wired twice. A second runner would
duplicate the same assertions behind another entry point and another
isolation boundary.

The defect-encoding assertions are inverted: `prove-v2-compat` now asserts
part preservation (`E-16` closed), `prove-e11` covers the skill gate
(`E-11` closed), `prove-c02` covers the bridge seed/write-back and the live
consent loop (`C-02` closed), and the four named cases are covered directly:
`prove-c03` 19 assertions, `prove-e12` 15, `prove-e14` 11, and `prove-e19` 11.

`docs/VALIDATION.md` records the model, the stage split, the four cases, the
steps for adding a proof, and the limits. A regression in the bridge fails
`prove-c02`, `prove-e17`, or `prove-v2-compat`; a guard or store regression
fails its named proof on every `ci`.

### E-53 The S-053 task census never got a disposition — done (2026-10-29)

`SHARED.md` S-053 closes with a census of seven unchecked v1 tasks. Every item
now has its own row in `docs/SHARED-PARITY.md`; `S-053.3` reads `verified` and
the entry re-derives to `verified`.

| Census item | Row | Disposition |
| --- | --- | --- |
| Pause during a live session | `S-053.4` | anchored: `src/tools/system-controls.ts:79` persists the paused scope, the affected handoffs, and the original statuses; `prove-handoff-rescue` covers the paused-handoff path |
| A task longer than 420s | `S-053.5` | anchored: `src/hooks/tool-execute.ts:67` sets the 420-second task timer and logs the timeout warning |
| Image-gen 401 retry | `S-053.6` | anchored: `src/tools/image-gen.ts:190` refreshes the token once, then fails closed on a second 401 |
| Confidentiality at rest | `S-053.7` | n-a: state is HMAC-signed for integrity, not encrypted; the plugin stores no provider credentials, which stay in the host or the OS keyring |
| User-level rate limiting | `S-053.8` | n-a: a single-user local plugin has no multi-user layer; provider quotas are classified and transient limits defer to the host |
| Shared-memory signing | `S-053.9` | verified: `src/utils/crypto.ts:20` writes `TAWASSUL_V2_HMAC_V1:` and `prove-state-namespace` asserts the signature and the legacy reads |
| Deleted-agent persistence | `S-053.10` | verified: `src/scripts/gen-opencode-config.ts:57` reads the user-owned list and `prove-seed-agents` proves the seed never overwrites it |

Result: three anchored rows, two out-of-scope rows with a written reason, and
two verified rows. The parity ledger moved from 70 requirements with one
`partial` row to 70 requirements with none; `gate:fast` now rejects any new
`partial` row that lacks an issue.

### E-54 A bare "quota exceeded" message is now a recoverable quota with delayed probes (2026-10-29)

`quota exceeded` is not a final stop. Providers restore a quota through a grace
period, a top-up, or a trial bucket reset, so both earlier treatments were
wrong: deferring it to the 2.2.1 host retry burned attempts on a billing error,
and treating it as `free-daily-limit` stopped permanently without a probe.

The parser now returns a dedicated `quota-exhausted` signal. The wording lives
in `QUOTA_TEXT_PATTERNS` (`quota exceeded`, `insufficient_quota`,
`exceeded your current quota`), `isQuotaExhausted` exposes the predicate, and
`DEFAULT_RATE_LIMIT_PATTERNS` keeps the same strings so the event reaches
`handleRateLimitError`. `shouldDeferRateLimitToHost` still returns false for
this signal, so the host never owns the decision.

`scheduleQuotaProbe` in `src/bootstrap/plugin-init.ts` schedules a delayed
probe at 5, 10, and 20 minutes (`QUOTA_PROBE_BASE_MS` 5 minutes,
`QUOTA_PROBE_MAX` 3, 30-minute cap). A pending probe is de-duplicated per
session, the attempt count survives each fired probe, the fourth quota error
sends the final notice instead of scheduling a timer, and (because
`promptAsync` only confirms enqueue) a stale counter is retired after six
hours so a later episode starts again at five minutes. The new
`quotaRetryScheduled`, `quotaRetryExhausted`, and `quotaRetryPrompt` strings
explain the recovery window. `scripts/prove-e44.ts` now covers 62 assertions,
including the signal, the no-deferral rule, the 5/10/20 sequence,
de-duplication, persistence across a resolved probe prompt, and exhaustion;
`scripts/prove-g003i1.ts` asserts the text fallback and the predicates.

### E-55 The host `/goal` reached 2.2.1 with no plugin surface (2026-10-29)

OpenCode 2.2.1 ships `opencode.goal` (`get` plus the `changed` event) and the
opt-in `experimental.idle` session hook. Neither is exported from
`@opencode/plugin`, so the plugin had no way to read the host goal, and a
second continuation would have raced the host's own `/goal` run.

Decision: the host goal is mirrored read-only. `src/services/host-goal.ts`
normalises the state (`active|paused|complete`, objective, rounds, maxRounds,
reason, stalls, boot, updatedAt) and caches it per session with a 5-second TTL
and a 256-session cap; a broadcast `changed` event refreshes or clears the
cache. `src/v2/host-goal.ts` declares the RPC domain structurally with a
StandardSchema passthrough, so no `@opencode/schema` import and no bundle
growth is needed: the host client decodes only Effect schemas, so the payload
passes through unchanged. `src/v2/setup.ts` attaches the mirror at boot and
disposes it with the other registrations. `goal(host: true)` and
`goal(get: "host")` read it, `goal(board: true)` appends it, and every write
form (`update`, `close`, `delete`, `evidence`) rejects the literal `host` and
points at `/goal pause|resume|clear`.

`experimental.idle` is registered exactly once: it records the host background
snapshot for `task-control`, notes idleness for continuity detection, and
finalizes a dispatched task when its child session idles (`E-57`). It never
prompts or continues a session, so the host `/goal` keeps sole ownership of
continuation.
`prove-host-goal` covers normalisation, TTL and cap, changed-event updates and
clears, read errors, the tool surface and write guard, the RPC bridge, the
missing-RPC path, the single idle registration, and the `goal.d.ts`
contract (42 assertions).

### E-56 The v1 cold-boot gate is a recorded failure and v2 has no cold-boot runner — out of scope (owner decision 2026-10-30)

The S-033 launch wave cannot be accepted on port parity alone. The v1 M3
cold-boot evidence at `/home/htoz/tawassyl-measure/scorecard.log` records 14
scored boots (cases 7-17): 10 rows are `overall=FAIL`, every one with
`N2=FAIL`; only cases 11 and 15-17 pass. `~/tawassyl-measure/REPORT.md`
attributes the stall to the host file watcher on a rotational disk (94.7s
session-open refresh, ~197s readiness), not to the plugin's ~4-12s init. The
v1 plan's M3 exit gate accepts only "all N met, or a proven FAIL"
(`/home/htoz/Desktop/tawassyl/docs/BOOT-STALL-FIX-PLAN-2026-10-19.md` §5), so
the wave is a proven FAIL, not a pass.

v2 ships `scripts/boot-scorecard-v2.sh` but no cold-boot runner and no recorded
v2 N1-N5 run.

Decision (2026-10-30): the owner declared the cold-boot gate out of scope for
v2. The failure stays documented, v2 makes no N1-N5 claim, and the scorecard
remains available for anyone who wants to score a window. `S-033.3` is `n-a`;
the plugin-side port and the host-installer duty keep their own rows. Re-open
only with a new owner decision and a fresh v2 cold-boot run that meets N1-N5.

### E-57 A 2.3.0 subagent dispatches in the background, so the tool result is not the task's end — fixed (2026-11-13)

OpenCode 2.3.0 makes subagents background by default (`#63382`): the `task`
tool returns at dispatch with the child session ID in `metadata.sessionID`,
and the child reports back whenever it becomes idle. The same release
(`#63675`) keeps the child report "still running" while the child's own
background work is alive, so an idle is not terminal in that case either.

The plugin treated the dispatch result as the task's end: it overwrote the
host `completed` status, credited a success, advanced the pipeline, logged a
`TASK_COMPLETED` event, and nudged the analyst before the child had worked.
`src/services/dispatch-ledger.ts` now records a dispatch keyed by the child
session ID, and `src/hooks/tool-execute.ts` treats that result as a dispatch,
not a completion. The terminal arrives from `experimental.idle` for the
child; `session.execution.failed` and `session.execution.interrupted` take
the failure path, and an interrupted dispatch emits nothing so the circuit
breaker and self-heal do not fire on a user cancel. An idle whose own
background snapshot still names the child is skipped, and the next idle
finalizes. An idle that beats the ledger write is buffered for 60 s, and the
ledger keeps at most 200 sessions.

`prove-task-dispatch` (20 assertions) and `prove-task-finalize`
(29 assertions) cover the predicate, the terminal, the deferral, the buffer,
the failure paths, and the caps.

### E-58 2.2.7 endpoints no longer wait for plugins to load — guarded (2026-11-13)

OpenCode 2.2.7 removes the five-second plugin-load wait from `rpc.call` and
`agent.list` (`#62796`). A call made during boot can now reach a host with no
plugin registration. The host-goal mirror already tolerates a missing or
failed RPC (`src/v2/host-goal.ts` catches the call and returns no goal) and
refreshes on the broadcast `changed` event, so the mirror degrades to
"unavailable" and recovers on the next event. No code change is needed.

### E-59 `opencode run` waits for background jobs the prompt started — tracked (2026-11-13)

OpenCode 2.2.6 makes `opencode run` wait, with no time limit, for the
background shell commands, subagents, and image jobs that its prompt started
(`#60699`). The release smoke runs a prompt that starts none, so the 60 s cap
in `scripts/release-smoke.sh` still holds and `D15` stays open. If the smoke
prompt ever dispatches a subagent, the wait becomes unbounded and the cap
needs a real measurement first.

### E-60 A host compaction buffer above 25 percent compacts before the plugin's transfer gate — tracked (2026-11-13)

OpenCode 2.2.5 accepts a percentage `compaction.buffer` (`#60647`). The plugin
keeps its own 25 percent / 16k-floor reserve and does not read the host
buffer, so a host configured above 25 percent compacts earlier than the
plugin's transfer gate expects. No host config channel exists yet, and the
default matches, so this stays a tracked gap rather than a code change.

### E-61 The model catalog capped host-declared windows and limits — fixed (2026-10-31)

OpenCode 2.2.4 raised the OpenCode Go limits for DeepSeek V4.1 Flash
(`#60625`) and let provider overrides set names, limits, and variants
(`#60597`). The plugin's catalog had no V4.1 Flash entries, so both models were
treated as unknown and capped at the 128k minimum; `resolveModelWindow` also
returned `min(host limit, catalog limit)`, so an override that raised a known
model above its public limit was ignored.

The catalog now carries the measured windows (free 200k/32k output at zero
cost, Go 1M/384k output), and the `min(host, catalog)` cap was removed by owner
decision: a host declaration at or above the 2k sanity floor is taken verbatim,
the catalog fills only an absent declaration, and the fallback is 200k.
`docs/UPSTREAM-EVAL-2.2.3-2.2.5.md` records the measurements and the proof
update.

### Corrections to existing entries

- **B-12**: `src/tools/system-controls.ts:232` appends
  `t("panicBackupCreated")` whenever `stateDir` is set, including when the
  `copyFile` at `:226` threw. The tool reports a backup that does not exist,
  which is worse than the missing prune already recorded.
- **B-02**: the window is 750 ms plus 20 × 500 ms ≈ 10.25 s, not "about
  10 s"; the placeholder schema served during the window is
  `additionalProperties: true` (E-17).
- **E-07 / P-04**: done 2026-10-29. The independence proof now scans tracked
  files, the package-entry shape, and symlinks, and
  `prove-independence-boot` boots the built bundle in a v1-free HOME and
  workspace, asserting loads, tools, and no v1 state (see E-07).
- **I-09**: done 2026-10-29. The dual-copy proof boots both copies; the global
  copy delegates to the project entry and logs the path (see I-09).

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
