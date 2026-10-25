# Tawassul V2 — Issue Register

Status date: 2026-10-25 · HEAD: post-H-01..H-05 · Gate: `npm run ci` rc=0 (25 proofs, smoke pass)

Purpose: one durable place for open issues, evidence, and the next action, so
development context survives session loss. Severity: P0 (can corrupt state or
freeze a boot), P1 (correctness or measurement gap), P2 (quality/parity).
State: `open`, `in_progress`, `blocked`, `done`.

## Owner decisions

- **D-00 (2026-10-25): v1 is retired permanently.** It will not work in any
  project again. It is not a compatibility target: any v1 plugin entry, v1
  host, or v1 global dependency is a defect. v2 is the only plugin. Two hosts
  run only in isolated tests.

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

### H-02 Terminal CLI duplicate — blocked (owner consent)

Evidence:

- `~/.opencode/bin/opencode` (240 MB) + `~/.opencode/bin/opencode2` wrapper.
- `~/.bashrc:139` exports `~/.opencode/bin` into `PATH`.
- `dpkg -l opencode` is the **Desktop app** (`/opt/OpenCode`), not the CLI;
  removing that package would delete the Desktop app.
- `opencode uninstall --dry-run` removes the binary **and stops the shared
  background service** (the Desktop sidecar) and deletes
  `~/.local/state/opencode/service.json`. It also removes `~/.cache/opencode`,
  which the Desktop shares. Running it while the Desktop is open is unsafe.

Decision: Desktop-only is the target. Do not use `opencode uninstall` here.
After the launcher fallback landed, remove only `~/.opencode` and the `PATH`
line, with owner approval. The launcher now runs on the Desktop-bundled CLI.

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

### G-01 CI spawns about 35 separate npm/bun processes — open

`ci` chains `verify` (4 sub-commands), 5 checks, 25 proofs, and the smoke gate.
Samples: `prove:state-namespace` 232 ms, `prove:v2-compat` 416 ms,
`prove:disclosure` 2042 ms, `prove:goal-capture` 3363 ms. Process startup is a
large share of the small proofs.

Next: one `scripts/gate.mjs` runner with a manifest, `bun` child processes,
`--tier fast|full`, `--only`, `--timings`, and one summary.

### G-02 No fast tier — open

The full gate is the only entry point, so it competes with live work
(1.5 GB memory cap in `RULES.md`). Next: `npm run gate` fast tier (rules,
shell syntax, typecheck, config, facts, catalog) and `npm run gate -- full`.

### G-03 Catalog parses the CI string — open

`prove-proof-catalog` requires each proof to appear in the `ci` string. After
the runner lands, the manifest becomes the source of truth and the catalog
validates the manifest instead.

### G-04 No boot budget proof — open

Nothing fails when boot time regresses. Next: `prove:boot-budget` with a
measured budget (candidate 150 ms from init to 42 tools).

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
- **P-05** `tawassul.js.pre-refresh-*` copies exist in six workspaces and need
  owner approval before deletion.
- **P-06** Legacy global config `~/.config/opencode/package.json` still pins
  `@opencode-ai/plugin@1.17.14`; it is unused but stale.

---

## Pending owner decisions

1. Remove `~/.opencode` (240 MB) and the `PATH` line. Ready now: the launcher
   falls back to the Desktop-bundled CLI. Do not run `opencode uninstall`
   while the Desktop is open (it stops the shared service and removes the
   shared cache).
2. Delete `/tmp/opencode/smoke-probe` (orphan stopped, port 38335 closed).
3. Delete the six `tawassul.js.pre-refresh-*` copies and the root
   `collective-memory*` files.
4. Choose one `OPENCODE_DB` for the Desktop sidecar (D-01).
5. Keep or drop the untracked `scripts/check-shared-anchors.mjs`,
   `scripts/port-from-v1.mjs`, and `test-utils.ts`.
6. Remove the v1 SDK dependency from `~/.config/opencode` (H-06).

## Verification baseline (for regression)

- `npm run verify`: rules, shell syntax, `tsc --noEmit`, single-file build.
- `npm run ci`: rc=0, 25 `PROOF PASS`, `SMOKE PASS: host v2.1.4, 42 tools`.
- Bundles identical: `dist/index.js` and `.opencode/plugin/tawassul.js`
  (1,858,356 bytes at `4316793`).
