# Tawassul V2 — Issue Register

Status date: 2026-10-25 · Gate: `npm run ci` rc=0 (3 isolated stages, 25 proofs, smoke pass)

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

---

## Host copies and processes (P0 — current work)

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

### H-02 Terminal CLI duplicate — blocked (final manual removal)

Outcome (2026-10-25):

- `opencode uninstall` completed. Its scope is cache, service descriptor, and
  the background service: `~/.cache/opencode` is now empty (8 KB, empty
  `bin`), the shared service was stopped, and
  `~/.local/state/opencode/service.json` was removed.
- The uninstaller deliberately leaves the binary as **manual removal**:
  `~/.opencode/bin/opencode` is still present (240,416,944 bytes), so
  `command -v opencode` still resolves and `~/.bashrc:139` still exports
  `~/.opencode/bin` into `PATH`.
- The Desktop restarted its sidecar after the uninstall. The descriptor was
  recreated (`pid 805568`, `http://127.0.0.1:49374`), the plugin booted, and
  `v2 registered 42 tools` with `INIT_AUDIT ... "health":"healthy"` and no
  plugin errors. Port 36923 is no longer listening; only 49374 listens, and
  the UI returns HTTP 200. That is the current single-host shape, not a
  defect.
- `scripts/release-smoke.sh` now resolves explicit env → `OPENCODE` →
  `~/.opencode/bin/opencode` → the Desktop-bundled CLI, so the gate survives
  the final removal. Tested with a temporary HOME that has no `~/.opencode`.

Remaining action: remove `~/.opencode` and the `PATH` line with owner
approval. Do not rerun `opencode uninstall` while the Desktop is open: it
stops the shared service and removes the shared cache again.

Evidence:

- `~/.opencode/bin/opencode` (240 MB) + `~/.opencode/bin/opencode2` wrapper.
- `~/.bashrc:139` exports `~/.opencode/bin` into `PATH`.
- `dpkg -l opencode` is the **Desktop app** (`/opt/OpenCode`), not the CLI;
  removing that package would delete the Desktop app.
- `opencode uninstall --dry-run` lists the binary as manual removal, plus the
  shared service and `~/.cache/opencode`. Running it while the Desktop is
  open is unsafe.

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

### H-06 Global config still installs the v1 plugin SDK — open

Evidence: `~/.config/opencode/package.json` depends on
`@opencode-ai/plugin@1.17.14`, and `~/.config/opencode/node_modules` still
contains the v1 package. The global config has no plugin entry today, so it is
inert, but it is exactly the leftover that lets v1 load again.

Next: remove the v1 dependency from the global config (owner approval), or
leave it intentionally unused and documented. `~/.cache/opencode` is shared
with the Desktop and must not be removed.

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

Measured 2026-10-25: fast 11.2 s (6 steps), proofs 21.1 s (24 proofs), smoke
11.6 s (2 steps), total about 44 s. The smoke keeps the plugin-boot evidence
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

### D-01 Three database paths — open

- Desktop sidecar: `~/.local/share/opencode/tawassul-v2/opencode.db`
- Shared CLI DB: `~/.local/share/opencode/opencode.db`
- Launcher DB: `~/.local/share/tawassul-v2/opencode-v2.db`

The Desktop descriptor points every client at the sidecar, so the CLI and
launcher paths are only used by isolated runs. Unifying them needs an explicit
decision because it touches live sessions.

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
- **P-06** Legacy global config `~/.config/opencode/package.json` still pins
  `@opencode-ai/plugin@1.17.14`; it is unused but stale (see H-06).

---

## Pending owner decisions

1. Remove `~/.opencode` (240 MB) and the `PATH` line. `opencode uninstall`
   already completed its own scope; the binary remains by design as manual
   removal. Ready now: the launcher and `release-smoke.sh` fall back to the
   Desktop-bundled CLI. Do not rerun `opencode uninstall` while the Desktop is
   open.
2. Delete `/tmp/opencode/smoke-probe` (orphan stopped, port 38335 closed).
3. Delete the six `tawassul.js.pre-refresh-*` copies and the root
   `collective-memory*` files.
4. Choose one `OPENCODE_DB` for the Desktop sidecar (D-01).
5. Keep or drop the untracked `scripts/check-shared-anchors.mjs`,
   `scripts/port-from-v1.mjs`, and `test-utils.ts`.
6. Remove the v1 SDK dependency from `~/.config/opencode` (H-06).

## Verification baseline (for regression)

- `npm run verify`: `gate:fast` plus the single-file build.
- `npm run gate:fast`: 6 steps, about 11.2 s.
- `npm run gate:proofs`: 24 proofs, one child each, about 21.1 s.
- `npm run gate:smoke`: build + release smoke, about 11.6 s.
- `npm run ci`: rc=0, 25 `PROOF PASS`, `SMOKE PASS: host v2.1.4, scratch
  boot, 42 tools, health + help`, about 44 s.
- Bundles identical: `dist/index.js` and `.opencode/plugin/tawassul.js`
  (1,858,356 bytes).
- The smoke accepts a provider transport error only after `initPlugin` and
  `v2 registered 42 tools` are confirmed; a missing plugin boot fails.
