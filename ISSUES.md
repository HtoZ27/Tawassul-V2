# Tawassul V2 — Issue Register

Status date: 2026-10-25 · Gate: `npm run ci` rc=0 (3 isolated stages, 26 proof files, smoke pass)

Purpose: one durable place for open issues, evidence, and the next action, so
development context survives session loss. Severity: P0 (can corrupt state or
freeze a boot), P1 (correctness or measurement gap), P2 (quality/parity).
State: `open`, `in_progress`, `blocked`, `done`.

## Owner decisions

- **D-00 (2026-10-25): v1 is retired permanently.** It will not work in any
  project again. It is not a compatibility target: any v1 plugin entry, v1
  host, or v1 global dependency is a defect. v2 is the only plugin. Two hosts
  run only in isolated tests. Evidence: a Desktop-wide scan finds exactly one
  active plugin entry (this tree); the six other workspaces and the v1 tree
  have `.retired-20261024` markers and no active `tawassul.js`.

---

## Host copies and processes (P0 — complete)

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
`node_modules` and changed nothing. A package directory is not installed
either. v1 worked only because its OpenCode ran `bun install` from the config
root, which v2 dropped.

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

### B-04 Backups accumulate without a cap — open

`predictive-router.json.bak.*`: 5 files in 25 minutes (one per 5-minute save),
about 288 per day. Next: keep the newest 3 per file and let `sweep:state`
remove older ones.

### B-05 Tool schema payload is unmeasured — open

42 tool schemas are sent with every request and may dominate session load.
Measure total schema bytes and estimated tokens before changing anything.

---

## Verification gate (P1)

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

---

## Data and state (P1)

### D-01 Three database paths — deferred by owner (2026-10-25)

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

### D-02 Old sessions are not imported — open

Source: `/home/htoz/Videos/New Folder/` (old DBs, storage, snapshots).
Import only after D-01 is decided, with a backup and a generation guard.

### D-03 Project state moved to `.opencode` but root leftovers remain — open

`collective-memory-515c5c5d.json` and its empty `.bak` remain in the project
root. They are untracked and need owner approval before deletion.

---

## Product gaps (P2)

- **P-01** `select`/`input` elicitation: host `permission.assert` returns only
  confirm; the design decision is still open.
- **P-02** A goal closed from `completed` writes a `dropped` tombstone; the
  digest counts stay correct, the label is cosmetic.
- **P-03** N2 assistant dedup set is capped at 512; long sessions can
  re-process an old message.
- **P-04** Independence is proven statically; a real boot with the v1 tree
  renamed is still missing.
- **P-05** Six workspaces hold 12 inert `tawassul.js.pre-refresh-*` copies and
  one `tawassul.js.retired-20261024` each (`vusial 2`, `vpro`, `vusual`,
  `athan new vrsion`, `dart22222222`, `ciel-osk-workspace`), plus the v1 tree.
  No project loads a v1 plugin: a Desktop-wide scan finds exactly one active
  entry, `/home/htoz/Desktop/Tawassul V2/.opencode/plugin/tawassul.js`. The
  copies need owner approval before deletion.
- **P-06** Legacy global config `~/.config/opencode/package.json` pinned
  `@opencode-ai/plugin@1.17.14`; done — H-06 removed the v1 SDK pin and the
  file is now `{}` with no `node_modules`.

---

## Pending owner decisions

1. Delete `/tmp/opencode/smoke-probe` (orphan stopped, port 38335 closed), the
   dangling quarantined v1 symlink, the `~/.opencode` backup under
   `/tmp/opencode`, the global-config backup, and the 12
   `tawassul.js.pre-refresh-*` plus 7 `.retired-20261024` copies.
2. D-01: name the sidecar DB canonical, the shared DB legacy read-only, and the
   launcher DB test-only. No file is deleted. Deferred on 2026-10-25.
3. Keep or drop the untracked `scripts/check-shared-anchors.mjs`,
   `scripts/port-from-v1.mjs`, and `test-utils.ts`, plus the root
   `collective-memory*` files.

## Verification baseline (for regression)

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
- The smoke accepts a provider transport error only after `initPlugin` and
  `v2 registered 42 tools` are confirmed; a missing plugin boot fails.
