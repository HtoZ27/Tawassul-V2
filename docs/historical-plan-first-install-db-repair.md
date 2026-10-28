# Repair Plan — Tawassul v2 first-install DB contract

Status: proposed, not implemented.
Scope: `/home/htoz/Desktop/Tawassul V2` only. v1 tree is read-only reference.
Owner: implementation agent (switch agents to execute).

## 0. Settled facts (do not re-derive)

| # | Fact | Anchor |
| --- | --- | --- |
| F1 | DB isolation is impossible on OpenCode: upstream refuses it and credentials live inside the DB | SHARED.md S-041 item 5; #24785, #33321 (not-planned); `credential` table |
| F2 | v1 solved the growth problem: 3.77 GB to 519 MB, boot stalls gone (2 ms to 4 s) | `tawassyl/SESSION_HANDOVER.md` §3; SHARED.md S-040 |
| F3 | v1 shrink + prune were consolidated into one v2 script, with credential protection added | `scripts/opencode-db-maintenance.sh` (`--event-only`, VACUUM, `PROTECTED_TABLES`) |
| F4 | v2 does not depend on v1: a missing v2 script makes the launcher refuse to start | `scripts/opencode-v2-iso.sh:131`; SHARED.md S-041 item 5 [DONE] |
| F5 | v2 live DB: 106 MB, `event` = 0 rows, `session_message` = 60.9 MB, 4 sessions = 40% of the DB in one project | measured on host 2.2.0 |
| F6 | The install ships bundle + wasm + marker only; nothing invokes maintenance | `scripts/install-global.ts` |

Root cause of the first-install defect (F6): the maintenance lane exists and is correct, but no shipped artifact calls it.

## 1. Goals

1. A fresh user boots with zero warnings and a truthful `health` readout.
2. The maintenance lane ships inside the install payload and is verifiable by hash.
3. Something invokes it on a schedule, fail-open, without blocking boot.
4. No user-facing text points at a path the user does not have.
5. Partial installs (bundle only) fail loudly and once.

## 2. Non-goals (explicitly out of scope)

- Per-project DB isolation, `OPENCODE_DB` manipulation, launcher rewrites.
- Session caps, blocking, refusal to boot on size.
- DB replacement, rotation, credential copying or seeding.
- Any SQLite access from plugin code (`SHARED.md:382` stays true).
- Porting the v1 launcher layer beyond what P2 requires.

## 3. Work items

### P0 — truthful user surface (plugin side, no DB access)

Files: `src/bootstrap/db-isolation.ts`, `src/tools/tawa/health.ts`.

1. Delete the two boot warnings (`S8 DB isolation off`, `Per-project DB isolation unavailable`). Both prescribe `scripts/opencode-v2-iso.sh`, which an installed user never receives. Keep `warnIfUnisolatedDb` as an internal, unreferenced helper or remove it with its proof.
2. `health`: rename lane label `shared` to `host-default`; drop `DB expected` and `DB matches isolation` when no isolation is configured; report the DB file size from `stat()` of the resolved path (read-only, not SQLite).
3. Add one non-blocking advisory: when the DB exceeds 2 GiB, print a single line naming the installed command from P1 (`tawassul-runtime/db/opencode-db-maintenance.sh --check`). Never refuse, never repeat within a process.
4. Keep `classifyDbLane` for diagnostics; it must not drive warnings.

Acceptance: fresh boot produces no `⚠️` line; `health` contains lane, path, size, and `session_message` share.

### P1 — ship the maintenance lane

Files: `scripts/install-global.ts`, `scripts/prove-global-install.ts`, `scripts/opencode-db-maintenance.sh`, `scripts/guard-db-generation.sh`.

1. Install `opencode-db-maintenance.sh` and `guard-db-generation.sh` to `tawassul-runtime/db/`, mode 0700.
2. Record both SHA-256 hashes in `tawassul-runtime/VERSION` next to the bundle hash.
3. `--verify` must fail when either script is missing or hash-mismatched.
4. `--uninstall` removes `tawassul-runtime/db/`.
5. Make both scripts location-independent: the guard path must resolve as a sibling (`dirname $0/guard-db-generation.sh`), not `$REPO/scripts/...`. The launcher keeps its current repo-relative behavior.
6. Prove: installed-copy `--check` runs against a synthetic DB and exits 0; hash tamper fails verify.

Acceptance: `npm run verify:global` covers 4 artifacts (bundle, 2 scripts, marker) and fails closed.

### P2 — invocation (the actual missing piece)

Files: `scripts/install-global.ts`, new `scripts/install-maintenance-unit.ts`, `README.md`.

1. Install a systemd user timer on Linux:
   - `tawassul-db-check.service` runs `<runtime>/db/opencode-db-maintenance.sh --check --db <resolved path>`.
   - `tawassul-db-check.timer` runs daily with a 30-minute randomized delay.
   - The unit is fail-open: any error is logged and never blocks boot.
2. macOS and Windows: no automatic unit in this phase; the installer prints the exact manual command.
3. Resolve the DB path once at install time from the live environment (`OPENCODE_DB`, else the host default) and record it in `VERSION`; never set `OPENCODE_DB`.
4. `--uninstall` removes the unit and disables the timer.
5. `doctor-v2.sh` reports: installed lane, script hashes, timer state, DB size, and the last `--check` result.

Acceptance: `systemctl --user list-timers` shows the unit after install; `doctor-v2.sh` reports it; removing the scripts makes doctor fail.

### P3 — partial install detection

Files: `src/services/ast-service.ts`, `scripts/install-global.ts`, `src/bootstrap/plugin-init.ts`.

1. Collapse the AST degradation path to one warning naming the exact missing directory (`tawassul-runtime/wasm`), with the install command.
2. Installer refuses to write `tawassul.js` when the runtime directory cannot be created; a bundle without wasm is not a valid install.
3. If a hand-copied bundle is detected at boot (bundle present, runtime absent), emit one warning per process, not two.

Acceptance: copying only `tawassul.js` yields exactly one actionable line.

### P4 — duplicate plugin guard

Files: `scripts/install-global.ts`.

1. Before writing the global copy, check for `<cwd>/.opencode/plugins/tawassul.js` and refuse with both paths named.
2. Same check in reverse is documented in README, not enforced by the plugin.

Acceptance: install into a project that already has the plugin fails with one message naming both files.

### P5 — verification gate

Files: `package.json`, `scripts/prove-global-install.ts`, `scripts/doctor-v2.sh`.

1. Extend `prove:global-install` to assert the 4-artifact manifest and the location-independent guard path.
2. Add a proof that no user-facing string references `scripts/opencode-v2-iso.sh`.
3. `doctor-v2.sh` gains a `--db-contract` check: lane, size, timer, script hashes.
4. Run `npm run verify`, then `npm run ci` (sequential processes only).

Acceptance: both green; no new warning at a fresh boot.

## 4. Order and dependencies

P0 and P1 are independent and can land together.
P2 depends on P1 (needs the installed scripts).
P3 and P4 are independent and small.
P5 lands last.

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| systemd user units unavailable (Desktop-only session) | fail-open; manual command always printed |
| Installed script cannot find the guard | sibling resolution proven in P1.6 |
| `--check` writes a sibling log and backup dir (DB-SAFETY §6) | document; keep `--check` read-only on the DB itself |
| Path recorded at install goes stale if the host moves its DB | `doctor-v2.sh` compares recorded vs live and reports drift |
| Users on macOS/Windows get no scheduler | explicit manual step, marked in README as unsupported automation |

## 6. Definition of done

1. Fresh install on empty `XDG_*`: zero warnings, `health` truthful, exit 0.
2. `verify:global` validates bundle + 2 scripts + marker, fail-closed.
3. Timer installed on Linux and visible in `doctor-v2.sh`.
4. Bundle-only copy produces one actionable warning.
5. Global + project duplicate produces one actionable error.
6. No installed-user text references repo-only paths.
7. `npm run verify` and `npm run ci` green.
