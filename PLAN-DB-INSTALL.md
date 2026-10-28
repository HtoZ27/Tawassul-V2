# Plan — Tawassul v2 first-install DB contract

Status: partly implemented — P0 guard items 1-4, the milestone-ms cutoff fix (F32),
the boot warn-sites deletion with the health key-presence field (4b), and the
XDG-aware sidecar path (7) landed 2026-10-28 in the repo tree with isolated
trials. Second batch, same day: `scripts/db-env.sh` (P2.11/12 helper subset,
probes D1-D6), the P2.4/P2.5 core in `opencode-db-maintenance.sh` (window ladder
90→45→21→7→3 over the message-level session-floor query, 3000-row batches with
a 2500 ms busy timeout and a short pause, the unreachable-remainder report,
--target-bytes/--max-bytes/--batch-rows/--max-batches, nothing-to-do gates that
write no backup, size-aware keep count 2 above 1 GiB), P2.9/P2.10 (--event-keep
N with the ROW_NUMBER newest-per-aggregate delete, dry-run default with an
explicit --event-delete, the cap-lane call site updated), and the new
`scripts/opencode-db-scheduled.sh` (P2.1-P2.3/P2.6/P2.7 wiring: WAL rung with
the TRUNCATE-then-PASSIVE fallback observed blocking on a held reader, in-use
rung bounded backup+prune while held, quiescent rung behind the fuser gate, no
launcher re-assert). Trials SL2-SL9 plus the scheduler rung run passed with 87
fast-gate proofs and prove-db-retention green. Third batch, same day — P1
landed: `scripts/install-global.ts` stages the four db scripts into
`tawassul-runtime/db/` at 0700, records their SHA-256 hashes plus the
dependency-probe marks in the VERSION marker, extends `--verify` fail-closed
over size, hash, and the exec bit (a marker without the db payload refuses),
and `--uninstall` removes the payload with the runtime; the install-time
preflight is loud on Linux (hard-gap exit) and warn-only on macOS, and the
smoke resolves through the installed `db-env.sh` and only runs when a DB
exists. P1.8 is proven by extending `scripts/prove-global-install.ts`
(synthetic v2 DB driven through OPENCODE_DB, smoke output asserted, the
installed `--check` exiting 0, tamper/exec-bit/missing-payload refusals, byte
fidelity against the repo source, uninstall sweep) — `npm run ci` is green
end to end. Fourth batch, same day — P2 item 5 landed: the quiescent reclaim
now checkpoints TRUNCATE first, then rebuilds with `VACUUM INTO` (sqlite3
≥ 3.27) and swaps the file atomically, clearing the stale -wal/-shm; a swap
failure falls back to the in-place VACUUM; the F27 space gate (free ≥
db+wal+1 GiB, TAWASSUL_VACUUM_MIN_FREE overridable) refuses the reclaim
fail-closed; and fuser_holders switched to `fuser -s` with an rc protocol
(0 no holders / 3 held / 1 unreliable) — the stderr filename header no longer
mislabels a held DB as unreliable, verified against a live holder. Trials
Q1-Q7 (into-swap shrink 17M→728K with journal=wal preserved and
quick_check=ok, F27 refusal rc=7, shim-fallback to in-place VACUUM 4.9M→52K,
held run pruning 960 rows with VACUUM correctly refused) all passed in
`/tmp/opencode/tw-isol/`. Fifth batch, same day — P3 landed in full
(items 1-8): the plugin-side trigger (`src/services/db-maintenance-trigger.ts`)
spawns the installed scheduler detached at boot and re-arms every 6 h behind a
24 h stamp gate and a machine-global lock dir with 25 h stale reclaim
(trials T1-T6: 4.8 ms arm, stamp rc=0 written, lock released, fresh-stamp
suppression, single-flight, stale reclaim, missing-script and missing-DB
fail-open); the scheduler trap stamps `rc=<n>/at=<ts>` on EXIT and clears the
trigger lock; the installer registers the OS trigger (systemd user timer at
04:17 with a 600 s random delay and Persistent=true, then a tagged cron line,
then manual — `TAWASSUL_REGISTER_TRIGGERS=off|systemd|cron|manual` overridable),
records the resolved value in the marker, and `--uninstall` removes owned
units (ExecStart content check) and the tagged cron line; `doctor-v2.sh` kept
its committed census contract (d05, 28 assertions) and gained the
"db maintenance contract" section (marker artifact hashes, all three
triggers, resolved-vs-probe path with drift, size+WAL, quick_check, the
last-run stamp); it now ships in the install payload (DB_SHIP id "doctor")
and the global-install proof asserts it (108 assertions). A real-systemd
registration trial on this host passed end to end (install → timer enabled
with the isolated ExecStart → uninstall → zero tawassul units left); the
trial also surfaced and removed a live v1 timer (tawassul-db-check.timer)
that was executing the retired v1 tree daily against the real DB, and the
stale `~/.opencode` plan-only directory (archived to
docs/historical-plan-first-install-db-repair.md first). `npm run ci` is green
end to end. Open: the remaining §5 order (P4, P5, P6, P7). Sixth batch,
same day — P4 landed: stat -c, date -d, free -m and df -B1 --output=avail are
routed through db-env.sh helpers with GNU-first then BSD then python3 rungs
(tawassul_file_bytes gained the python3 getsize rung and its second case now
falls through instead of returning early, tawassul_mtime_epoch for stamp
freshness, tawassul_file_mode for the swap chmod, tawassul_date_epoch_days
with the POSIX date +%s arithmetic fallback preserved in cutoff_ms,
tawassul_free_ram_mb with the macOS vm_stat parser and a python3
/proc/meminfo rung, tawassul_avail_bytes already POSIX df -Pk) and every
helper fails closed when no rung answers; opencode-db-maintenance.sh now
sources its sibling db-env.sh (installed and repo layouts both stage it as a
sibling) and refuses loudly when it is missing; the doctor stamp uses
tawassul_mtime_epoch. prove-portability.ts (25 assertions, in the proof
gate) covers every rung of every helper plus fail-closed refusals and the
end-to-end macOS-like run (BSD shims shadow GNU stat/date/df, free and
vm_stat truly absent, python3 present): maintenance --check completes with
correct sizes and a small prune completes deleting 320 rows. No automation
claim changed. `npm run ci` is green end to end. Seventh batch, same day — P5
landed in full: the AST degradation path collapsed to one warning per process
(a module-level once-guard shared by both former warn sites, the message
naming `tawassul-runtime/wasm` and `npm run install:global`, and a
`web-tree-sitter` wasm-root pre-check that skips `Parser.init` entirely so the
wasm runtime emits no emscripten abort noise at all — 9 noise lines before,
zero now, verified in an isolated four-file module copy); `passiveSelfCheck`
now returns silently unless the project plugin directory exists, so a global
install or a fresh workspace never warns and never names repo-only build
commands (the dist branch names `npm run install:global` instead); the
installer refuses with one actionable line when the runtime layout cannot be
created (a plain file occupying `tawassul-runtime`, `plugins`, or `db`), and
never writes the bundle in that state. `prove-partial-install.ts` (24
assertions, in the proof gate) covers the degraded lane (exactly one
tawassul line, the message contract, no abort noise, repeated init attempts
still one line), the healthy lane (zero warnings, parser ready), all three
self-check projects (fresh, present-but-unbuilt, built), the installer
refusal plus dry-run behavior, the shipped bundle text, and the absence of
repo-only build commands in `src/`. DoD 8 and DoD 10 are now satisfied.
`npm run ci` is green end to end. Open: P6, P7. Eighth batch, same day — P6
landed: before writing anything the installer refuses when the directory it
runs from carries a project copy of the plugin at
`<cwd>/.opencode/plugins/tawassul.js`, failing closed with one message that
names both the project copy and the global target and states the plugin would
be loaded twice (the check sits before the bundle read, so it also fires under
`--force` and under `--dry-run`, and no partial write can happen); the README
documents the reverse case without enforcing it. `prove-global-install.ts`
grew to 115 assertions (the duplicate refusal, both named paths, no write
while the copy exists, and success once it is removed, all against a separate
isolated global dir). Isolated trials in `/tmp/opencode/tw-isol/p6` also
confirmed: the repo lane itself is not blocked (its own `.opencode/plugin`
singular dev entry is outside the guard), an install from another directory
succeeds while the project copy stays byte-identical (no enforcement, no
removal — DoD 9), and uninstall removes only the global bundle and runtime.
DoD 9 is now satisfied. `npm run ci` is green end to end. Open: P7.
Scope: this tree only. The v1 tree is read-only reference.
Evidence: every anchor below was read on 2026-10-27 or 2026-10-28 from the
named file at the named line, or measured on the installed host 2.2.0 and on a
`.backup` copy of the live database. Upstream evidence comes from
`anomalyco/opencode` issues and pull requests, cited by number. Section 0b
records where an earlier draft of this plan was wrong, including one fact whose
evidence did not survive a control test.
Companion: `SCRIPT-PARITY.md` (the v1 script audit this plan depends on).

## 0. Settled facts

| # | Fact | Anchor |
| --- | --- | --- |
| F1 | DB isolation is impossible on OpenCode: upstream refuses it and credentials now live inside the DB | `SHARED.md` S-041 item 5 (launcher); `credential` table in the host schema; upstream not-planned (no issue number in `SHARED.md` - a gap, not a verified citation) |
| F2 | v1 solved the growth problem: 3.47 GB to 519 MB, boot stalls gone (2 ms to 4 s) | `SHARED.md` S-040 (`SHARED.md:714`, 848,540 pages); `SESSION_HANDOVER.md` §3; the 3.77 GB figure in an earlier draft was a misread of the same anchor |
| F3 | The v1 shrink and event prune live on in v2, with a generation guard and credential protection added, but the merge kept only the wholesale delete and the VACUUM and dropped v1's bounded per-aggregate rung, its dry-run default and its larger space gate | `scripts/opencode-db-maintenance.sh`, `scripts/guard-db-generation.sh`; F24, F25, F27 |
| F4 | The launcher refuses to run unmaintained: a missing v2 maintenance script exits 2, a missing guard exits 2 | `scripts/opencode-v2-iso.sh:120-123`, `:133-136` |
| F5 | Live DB 2026-10-27: main 110,542,848 B, WAL 16,595,392 B, `session_message` 79 MB, `kv` 10 MB, freelist 2,915 pages (11.4 MB), `journal_mode=wal`, `auto_vacuum=0`, 3.2 days of use, about 34 MB/day in the main file | `dbstat`, `PRAGMA` and `stat` on `$OPENCODE_DB` |
| F6 | The install ships the bundle, the wasm assets, and the `VERSION` marker only: no scheduler, no launcher, no owner record, no `tawassul.jsonc`/`tawassul.json` (those two are removed by `purge()`, never written) | `scripts/install-global.ts:438-451` |
| F7 | The v1 installer and the v1 timer brain were never ported | `SCRIPT-PARITY.md` |
| F8 | v1 and v2 do not share a schema and `session_message` exists in both (empty in v1); the discriminator is `session_v2` | `SCRIPT-PARITY.md` schema table; `guard-db-generation.sh:188-252` |
| F9 | `--check` on the live DB is clean: 106M, freelist 2,618 pages, 0 prunable, 0 event rows, exit 0 | measured 2026-10-27 |
| F10 | Growth is `session_message` plus one `kv` catalog row plus freelist; `auto_vacuum=0` means freed pages are reused and never returned without VACUUM | `dbstat`, `PRAGMA` on the live DB |
| F11 | v1's timer brain always checks and runs the full lane only at the cap **and** with `fuser` proving no holder; it never escalates on uncertainty. v2's launcher cap lane (`scripts/opencode-v2-iso.sh:137-163`) is a different artifact, not a port of this | `tawassyl/scripts/opencode-db-scheduled.sh:68`, `:72-95` |
| F12 | v1's launcher lane is the other half: at/over the cap it prunes events pre-exec, then triggers a background backup+prune with `--allow-in-use` behind a 24 h cooldown mark and launches immediately; VACUUM cannot run there | `scripts/opencode-v2-iso.sh:137-163` |
| F13 | Every full run copies and rotates a full backup even when the prune would delete nothing; 5 copies are kept | `opencode-db-maintenance.sh:552-579`, `:71` |
| F14 | Host 2.2.0 holds 0 `event` rows after 3.5 days while `event_sequence` holds 66 rows. The binary has `CREATE TABLE event`, `DELETE FROM event` and `DELETE FROM event_sequence`. A string search finds no `INSERT INTO event`, but the same search finds no `INSERT INTO session_message` either, and that table demonstrably grows, so the absence of the literal proves nothing: the writing path is undetermined and the zero-row state is unexplained | live DB; control-tested strings of `opencode-cli` 2.2.0 |
| F15 | The host's own answer to "where is my DB": `opencode debug paths` prints a `db` line. With `OPENCODE_DB` unset it printed `~/.local/share/opencode/opencode.db`; with it set it printed that value. There is no `db` subcommand in 2.2.0 | measured 2026-10-27 on `~/.config/ai.opencode.desktop/cli/2.2.0-x64/opencode-cli` |
| F16 | One host can carry several DB files: this machine has `~/.local/share/opencode/tawassul-v2/opencode.db` (live, 110 MB), `~/.local/share/opencode/opencode.db` (24.8 MB, last written Oct 25) and `~/.local/share/tawassul-v2/opencode-v2.db` (13.6 MB, Oct 25) | `stat` on all three |
| F17 | The maintenance script refuses implicit selection: `--db` or `OPENCODE_DB` only, and a set-but-missing `OPENCODE_DB` fails closed | `opencode-db-maintenance.sh:158-169` |
| F18 | The guard decides the path before the content: with `--expect v2`, any path not containing `tawassul-v2` is refused at `:93-98`, so the content probes at `:187-252` never run. `prove-db-retention.ts:91-97` locks that in by copying a v2-content DB to a temp path and asserting rc=2 | `guard-db-generation.sh`; `scripts/prove-db-retention.ts` |
| F19 | The prune is message-level with a session floor: it deletes messages older than the window but never touches a session that has any message inside the window | `opencode-db-maintenance.sh:582-611` |
| F20 | The maintenance script is Linux-only in five constructs: `stat -c` (`:218`, `:713`), `date -d` (`:436`, `:583`), `free -m` (`:306`), `df -B1 --output=avail` (`:673`). `numfmt` is guarded. The portable pattern already exists at `:139` and `opencode-v2-iso.sh:29` | same files |
| F21 | v1's doctrine is Linux full, macOS manual, Windows WSL, and its installer never fails for an inapplicable piece: it prints the manual step and continues | `tawassyl/scripts/install-tawassul.sh:404-423`; `tawassyl/docs/DB-SAFETY.md:63-70` |
| F22 | v1's shrink was a separate one-shot tool, not the scheduler: guard `--expect v1`, probe for `event`/`message`/`part`/`session`, refuse while the Desktop runs, require `--yes`, require free space of DB size plus 1 GiB, `.backup` plus `quick_check` plus a session probe, then `DELETE FROM event` and `VACUUM`, then `quick_check` plus unchanged session count plus a non-empty `message` probe | `tawassyl/scripts/tawassul-shrink-db.sh:70-141` |
| F23 | The v1 shrink is approximately closed: 2.94 GB of `event` in a 3.47 GB DB, 174,758 rows, freelist 0, leaving about 0.53 GB, which is close to the 519 MB result but 11 MB short; the difference is rounding and page-level overhead, not a separate deletion | `tawassul-shrink-db.sh:4-9`; `tawassyl/SESSION_HANDOVER.md:46`; `tawassyl/docs/BOOT-STALL-FIX-PLAN-2026-10-19.md:22` |
| F24 | v1 also kept a bounded event rung, `--keep N`, which deleted all but the newest N rows per aggregate by `row_number() OVER (PARTITION BY aggregate_id ORDER BY seq DESC)`. v2's port kept only the wholesale `all\|off` switch and lost the bounded form | `tawassul-shrink-db.sh:127-132`; `opencode-db-maintenance.sh:44`, `:60-62`, `:394-396` |
| F25 | v1's pre-launch event prune skipped silently (exit 0) while the app was running via `pgrep`, defaulted to a dry run that only printed the count, and used `PRAGMA busy_timeout=8000` for the delete. v2's `--event-only` refuses harder in one respect — an `fuser` holder proof that fails closed — and adds `require_v2_generation` (`:495-509`), but v1 already ran a generation guard of its own, so that part is not new. What v2 lost is the dry-run default — it deletes on the first call — and its delete uses `.timeout 60000` against v1's 8 s | `tawassyl/scripts/tawassul-prune-events.sh:44-47`, `:59-67`; `opencode-db-maintenance.sh:396`, `:495-509` |
| F26 | Host 2.2.0 sets `busy_timeout = 5000`, `synchronous = NORMAL`, `cache_size = -64000` and `wal_checkpoint(PASSIVE)` on its own connection, and the only checkpoint form in the binary is PASSIVE, with no TRUNCATE | strings of `opencode-cli` 2.2.0 (both installed copies report `opencode v2.2.0`) |
| F27 | v2's own space gate for VACUUM is `AVAIL_BYTES < DB_SIZE_BEFORE`, that is one main-file copy, blind to the WAL. v1 demanded the DB size plus 1 GiB. v2 is a regression here, not a port | `opencode-db-maintenance.sh:673-684`; `tawassul-shrink-db.sh:108-111` |
| F28 | Live composition on 2026-10-28: 74 sessions, 14,050 `session_message` rows, 70.08 MB of row data, five sessions holding 70.2 percent of it, `assistant` rows 94.3 percent of it, largest single row 156 KB, `kv` 11.27 MB of which one `models-dev:v2:catalog` row is 11.25 MB, freelist 2,712 pages (11.11 MB) whose free pages contain model-catalog JSON. The freelist is a moving target (2,618, 2,915 and 2,712 pages on three reads), so it is not a health signal | `dbstat`, `PRAGMA`, `SUM(length(...))` and a freelist page walk on a `.backup` copy |
| F29 | The 90-day window deletes nothing on this host: 0 rows and 0 sessions are older than the window. The 3-day floor, which is the most aggressive rule the plan allows, deletes 304 rows and leaves 11 of 74 sessions with zero messages. The delete cost 448 ms against a 2 ms no-op, so 1.47 ms per row and about 3,400 rows per 5 s | measured on a `.backup` copy with the shipped SQL |
| F30 | Host 2.2.0 has no `db` subcommand; its subcommands are `upgrade`, `uninstall`, `acp`, `api`, `debug`, `auth`, `mcp`, `plugin`, `models`, `stats`, `mini`, `run`, `session`, `service`, `reload`, `pair`, `serve`. `session` does expose `delete`, `export` and `import`. `uninstall --help` still prints "keeping session data, configuration, and state", the exact text issue 55310 called misleading | `opencode-cli --help` and `opencode-cli session --help` on 2.2.0; upstream issue 55310 |
| F31 | v1's scheduler re-asserts the v1 launcher layer on every run through `install-tawassul.sh --refresh-launchers`. A literal port would recreate v1 launchers from a v2 tree, which `AGENTS.md` makes a defect | `tawassyl/scripts/opencode-db-scheduled.sh:97-107` |
| F32 | The shipped prune SQL never matched this host's timestamps. Every timestamp column in both generations is INTEGER epoch-milliseconds (v2 min 1792851857409, v1 4 rows from 1792839018852), but the cutoff was built as epoch-seconds (`date +%s`), so `time_updated < cutoff` matched nothing: the 90-day window and the 3-day floor both count 0 with the shipped SQL. With an ms cutoff the same 3-day floor counts 304 rows — that is where F29's figure came from, and F29's "with the shipped SQL" anchor was wrong. Both hosts agree because both write ms. The fix is a `cutoff_ms` helper (seconds × 1000, arithmetic overflow-safe to year 5138, POSIX-portable fallback when `date -d` is absent) used at both call sites | `PRAGMA table_info` + `typeof`/min/max probes on the live v2 DB, the live v1 DB, and a `.backup` copy, seconds vs ms cutoffs compared side by side |

Root cause, corrected: three faults, not one. Nothing shipped invokes the
maintenance lane. The guard refuses every DB path that does not contain
`tawassul-v2`, which is every DB of a user who never installed the v1 launcher
layer, including the documented default. And the lane that would run is itself
weaker than the v1 tool it came from: it lost the bounded event rung, the
dry-run default and the larger space gate (F24, F25, F27).

## 0b. Corrections to the earlier draft

Successive drafts of this plan rested on claims that the code, the installed host
or a control test contradicts. They are listed because the design changed with
them, and the final rows were corrected during the 2026-10-28 verification
round, including two of the author's own inferences.

| Earlier claim | Truth | Anchor |
| --- | --- | --- |
| The only gap is that nothing invokes maintenance | There is a second gap: on the documented default path the guard refuses the run at all | F18, F15 |
| `auto_vacuum=0`, `journal_mode=delete` | `journal_mode=wal`; the WAL was 16.6 MB live, so db+wal is the size that matters | F5 |
| The 90-day window cannot bound v2 growth | It bounds growth at about 90 days of writes — 90 × 34 MB/day is about 3.1 GB against an observed v1 freeze at 3.47 GB. It bounds, but too close to the freeze. That, not unboundedness, justifies a size rung | F5, F19 |
| The new rule is "delete whole oldest sessions" | The shipped SQL is already message-level with a session floor. Shrinking the window cutoff is the minimal, provable change and never deletes a session | F19 |
| Two boot warnings prescribe the launcher script | Two warn sites prescribe the launcher (`:87` OPENCODE_DB branch, `:106` shared path); the third (`:100`, no HMAC key) prescribes nothing. The "three" was an overcount | `src/bootstrap/db-isolation.ts` |
| The plugin carries the trigger and the installer is only reinforcement | v1's split is two roles with different powers: only the quiescent run may VACUUM; the in-use run is backup+prune+events. Neither substitutes for the other | F11, F12 |
| `opencode db path` is documented but absent from 2.2.0, so use a fallback | The installed host answers `opencode debug paths` with a `db` line. That is the authority and it must be preferred over any hardcoded path | F15 |
| macOS should get "manual steps" instead of automation | v1 already printed manual steps. What is missing is that the script itself dies on macOS, so even the manual step cannot work | F20, F21 |
| The launcher and the plugin cover the always-open host | They cover it only at the 4 GiB cap. Below the cap nothing runs while the app is open, so an always-open host is unbounded until the cap | F11, F12 |
| Event retention is a v1 concern and v2 growth is entirely `session_message` | The event table is empty here, but the emptiness is unexplained and the wipe is still wired: the launcher proves v2 and then deletes every event row. Growth is `session_message` plus one 11.25 MB `kv` catalog row plus freelist | F14, F22, F28 |
| The v1 shrink is the same operation as v2's VACUUM, so it was ported whole | Same idea, weaker safety. v1 aborted outright while the app was open, demanded DB size plus 1 GiB free, and kept the newest N events per aggregate. v2 turned the abort into a VACUUM skip while still pruning, kept the wholesale delete, and reduced the space gate to one DB copy, blind to the WAL | F22, F24, F27 |
| The 90-day window is the binding constraint | It deletes nothing on a 3.5-day-old database. The binding constraint is the absence of a size rung, and the first rung costs 11 sessions that would reopen empty | F29 |
| The v2 binary never writes events, so the event table can be ignored | The claim rested on a string search that also fails for `session_message`, which grows. The zero-row observation stands; the causal claim does not | F14 |
| Porting the v1 scheduler is a straight copy | Its last block re-asserts v1 launchers daily, which the ownership boundary in `AGENTS.md` makes a defect for v1 entries and hosts | F31 |
| The maintenance script can run on the documented default path | It refuses it: `*/.local/share/opencode/opencode.db` (and `.opencode-backups/*`) exits 2 unless `--allow-archive` and an interactive `YES`. `--check` also passes through the ban, so P1.7's install-time smoke fails on the default path and L2/L5 have no working lane | `opencode-db-maintenance.sh:192-206` |
| v2's `--event-only` event step dropped all three of v1's protections | It kept and strengthened the holder refusal — `fuser` failing closed instead of `pgrep`, plus `require_v2_generation`. Only the dry-run default is gone, and the delete timeout is 60 s against v1's 8 s | F25 |
| 3.77 GB was the v1 shrink's pre-state | The anchor `SHARED.md` S-040 says 3.47 GB (848,540 pages); 3.77 GB in an earlier draft was a misread of the same anchor. The arithmetic closes only on 3.47 | F2, F23 |
| `fuser` is a soft dependency | It is hard on the default run and `--event-only` (fail-closed, exit 3); soft only at the VACUUM-skip site. `free` (procps) is also hard and was omitted from the preflight | F10, P1.6 |
| The window ladder removes history from dormant sessions only | The window ladder alone does; the solver's in-session rung cuts live/heavy sessions down to the anchor. The two must be stated separately | P2.5 |
| Default 0 on a proven v1 database | Unreachable: mutation paths sit behind `require_v2_generation` and the guard refuses v1 content. The dispatch rule is dead as written | P2.9, P0.1 |
| `wal_checkpoint(TRUNCATE)` needs no quiescence | It needs exclusive access to the WAL; on an always-open host it can return `SQLITE_BUSY`. Needs a result check and a fallback | P2.6, F26 |
| The installer fails on missing hard deps | Conflicts with F21/P4.2 ("never fails for an inapplicable piece"). The §5 order also runs the P1.7 smoke before P4 portability lands | P1.6, P4.2, §5 |
| `passiveSelfCheck` is silent on a healthy install | It warns on every global install and fresh workspace, pointing at repo-only commands. Goal 1, DoD 1, DoD 10 cannot be met without a work item that modifies `plugin-init.ts` | P5, P7.2 |
| F29 was measured with the shipped SQL | It was measured with an ms cutoff. The shipped SQL matched nothing (epoch-seconds vs INTEGER ms), so its true product was "deletes 0 rows, always, on both hosts" — a silent total loss of the retention feature. The shipped SQL was not ported correctly; all seven analysts missed it | F32 |

## 1. Goals

1. A fresh user boots with zero warnings and a truthful `health` readout.
2. The DB the host actually uses is maintainable, whatever path the host chose.
3. The maintenance lane ships inside the install payload, hash-verified.
4. Something invokes it on every lane, fail-open, without blocking boot.
5. No user-facing text points at a path the user does not have.
6. Partial installs fail loudly, once.
7. The database stays bounded while the app stays open.

## 1b. User-first contract

The user never opens a terminal, never reads a runbook, and never closes the
Desktop app. Any protection that depends on those three acts is not protection.

| The user never... | Therefore the design must... |
| --- | --- |
| runs a command | act automatically, or not at all |
| reads a warning | not rely on warnings as the safety net |
| closes the app | not depend on a quiescent database for the growth bound |
| watches disk usage | act below the pain threshold, before the freeze |
| debugs a failure | fail open, log quietly, never block work |

Consequence: **the growth bound must not be coupled to VACUUM.** Deleting rows
bounds growth because SQLite reuses freelist pages; VACUUM only returns space to
the OS and needs an idle database. v1 knew this and split the work in two: the
launcher lane prunes in place at the cap, and the timer lane VACUUMs only when
`fuser` proves quiet. Keep both, and add a rung below the cap so the in-place
lane fires before the freeze rather than at the cap.

## 2. Non-goals

- Per-project DB isolation, `OPENCODE_DB` manipulation as policy, launcher rewrites.
- Blocking boot on size, refusing to launch over a cap.
- DB replacement, rotation, credential copying or seeding.
- SQLite access from plugin code (`SHARED.md:382` stays true).
- Choosing which of several DB files on a host is "the" DB by discovery order.
  Only the host answers that (F15), and only for itself.

## 3. Lane and platform coverage

Every lane must be named, and every lane must have an answer. "Lane" is how the
host is started; "platform" is what may run unattended.

| # | Lane | DB the host uses | Trigger today | Gap | Closed by |
| --- | --- | --- | --- | --- | --- |
| L1 | Desktop with a v1-style launcher shadow (this machine has one) | the launcher's `OPENCODE_DB` | v1 launcher: at cap only, in-use only | v1 code, 4 GiB-only trigger, guard refuses foreign paths | P2, P3 |
| L2 | Desktop with no launcher shadow (the default Desktop user) | the host default | none | nothing ever runs | P0, P1, P3 |
| L3 | Desktop with the plugin from a global install | the host default | none | the plugin carries no trigger | P3 |
| L4 | Project-scoped install (`<project>/.opencode/plugins`) | the host default | none | same | P3 |
| L5 | Terminal CLI, no launcher, no env | `OPENCODE_DB` unset, host default | none | nothing runs, and the guard blocks manual use | P0, P3 |
| L6 | Terminal CLI under the v2 profile env | the profile DB | none | same | P0, P3 |
| L7 | Headless host (`serve --service`, no window) | the service DB | a timer, if one was installed | the installer ships none | P3 |

| Platform | What runs unattended | Doctrine |
| --- | --- | --- |
| Linux with user systemd | the timer unit, plus the plugin trigger | full automation |
| Linux without systemd | the plugin trigger; a cron line is printed | full automation via the plugin |
| macOS | nothing unattended; the plugin trigger is the only automation, and it is not started by the OS | v1 doctrine: guard protects, maintenance manual. Print the exact command; never fail. The command must actually run on macOS (P4) |
| Windows | nothing native; WSL only | v1 doctrine: WSL only |
| Any platform, no scheduler | the plugin trigger | the contract |

L1 is a defect state of this machine, not a target: `AGENTS.md` makes a v1
launcher a defect. The plan does not adopt it; it reports it (P3.7) and works
without it.

## 4. Work items

### P0 — the host's DB must be maintainable, and the user surface must be truthful

Files: `scripts/guard-db-generation.sh`, `scripts/opencode-db-maintenance.sh`,
`scripts/prove-db-retention.ts`, `src/bootstrap/db-isolation.ts`,
`src/tools/tawa/health.ts`.

1. Add `--path-rule enforce|warn` to the guard, default `enforce`. `enforce` is
   today's behaviour and stays the launcher's choice, because there the host
   will open the file and a wrong path means a migration on open. `warn` is the
   maintenance lane's choice, because there only `sqlite3` opens the file and
   the content answer is the real question. In `warn` mode: `session_v2`, or
   `kv.migration.v1-v2`, proves v2; a DB with tables and no v2 marker is still
   refused as v1 content; a missing or empty file is fresh; the path suspicion
   is reported in the `warnings[]` array instead of refusing.
2. `require_v2_generation` (`opencode-db-maintenance.sh:411-426`) passes
   `--path-rule warn`.
3. Update `prove-db-retention.ts:91-97`: keep the enforce-mode refusal, and add
   warn-mode acceptance of v2 content at a foreign path plus warn-mode refusal
   of v1 content at that path. `gate:proofs` fails until the flag and the proof
   land in the same change.
4. Carve out the archive ban (`opencode-db-maintenance.sh:192-206`) so the
   documented default path is not refused: either exempt it explicitly or gate
   it on v1 content rather than on the path string. `--check` and the install
   smoke must pass on it.
4b. Delete two of the three boot warn sites (`db-isolation.ts:86-91` and
   `:105-110`); both prescribe `scripts/opencode-v2-iso.sh`, which an
   installed user never receives. Keep or replace the third (`:100`, "no HMAC
   key") with a `health` field that reports key presence, because it names a
   real condition rather than the launcher.
5. Resolve the effective DB path, and say which source answered:
   `OPENCODE_DB`; else the `db` line of `opencode debug paths` (used by
   `health` and `doctor`, which are user-invoked, not boot); else the documented
   default under the XDG data root. Report `DB path (host default)`, rename the
   `shared` lane to `host-default`, drop `DB expected` and
   `DB matches isolation` when no isolation is configured, and report size from
   `stat()` of the resolved path with the main/WAL split.
6. Boot must not spawn the host binary to learn the path: at init use
   `OPENCODE_DB` and the documented default only. The interactive tools may call
   `opencode debug paths`, once, and cache the answer.
7. Make `isDesktopSidecarDbPath` (`db-isolation.ts:31`) XDG-aware instead of
   hardcoding `~/.local/share`, so a moved data root is reported truthfully.
8. No user-facing size warning: the user cannot act on it. Log size at debug
   level for support.
9. Keep `classifyDbLane` for diagnostics only; it must not drive warnings.

Acceptance: a boot on a host whose DB sits at the documented default emits no
warning line; `health` names lane, path, size and WAL, and the resolution
source; the guard proof covers both path-rule modes.

### P1 — ship the maintenance lane

Files: `scripts/install-global.ts`, `scripts/prove-global-install.ts`, plus the
scripts listed.

1. Install to `tawassul-runtime/db/`, mode 0700:
   - `opencode-db-maintenance.sh`
   - `guard-db-generation.sh`
   - `opencode-db-scheduled.sh` (ported per P2)
   - `db-env.sh` (the helper subset from P2.12)
2. Record all four SHA-256 hashes in `tawassul-runtime/VERSION`.
3. `--verify` fails when any artifact is missing or mismatched.
4. `--uninstall` removes `tawassul-runtime/db/`.
5. Make the installed copies location-independent. The maintenance script
   resolves its guard sibling from `dirname $0`; the guard does not, so either the
   installer places the guard where the maintenance script expects it, or a work
   item adds sibling resolution to the guard. The v1 scheduled script uses
   `$REPO/scripts/...` (`opencode-db-scheduled.sh:15-16`), so the port must use
   siblings instead.
6. Dependency preflight at install time: `sqlite3`, `timeout` or `python3` (the
   guard refuses without one) and `free` (procps; the maintenance script refuses
   without it). `fuser` is hard on the default run and on `--event-only` and
   soft only at the VACUUM-skip site. A missing hard dependency is an
   install-time failure, not a silent runtime one, provided it does not conflict
   with F21's never-fail doctrine (see §0b).
7. Ownership record and one install-time smoke run (`--check` against the
   resolved DB, read-only), so a broken lane is caught at install. On macOS this
   smoke run must wait for P4's portability fixes, or P4 must land before P1
   in §5.
8. Prove: the installed `--check` runs against a synthetic DB and exits 0; a
   tampered hash fails verify.

Acceptance: `npm run verify:global` covers bundle + 4 scripts + marker,
fail-closed; the smoke run happens during install.

### P2 — port the scheduler brain with both rungs

Files: new `scripts/opencode-db-scheduled.sh`, new `scripts/db-env.sh`,
`scripts/opencode-db-maintenance.sh`, `scripts/install-global.ts`.

v1's skeleton is right and is kept whole. What changes is the escalation, which
today can only fire at the cap and only when the app is closed, so on an
always-open host it can never fire.

1. Keep from v1 unchanged: `--check` on every run; failure-closed `fuser`
   handling (never escalate on uncertainty); the full run only when the DB is
   proven quiescent, because that is the only VACUUM-safe moment; log rotation
   (keep 3).
2. Do not port `opencode-db-scheduled.sh:97-107`. It re-asserts v1 launchers on
   every run, and a v1 launcher is a defect here (F31).
3. In-use rung, new: when db+wal is at or above the soft limit, run
   backup + prune + verify with `--allow-in-use --ignore-low-ram`. VACUUM
   self-skips when the DB is held, and the growth bound never depends on it.
   Note that `--allow-in-use` skips the protected-table fingerprint both before
   and after mutation, so this rung — the only one that fires on an always-open
   host — runs without the credential/session protection the other rungs carry.
   Measured reason: the app was held for the whole measured window, and v1 froze
   at 3.47 GB, below its own 4 GiB trigger.
4. Keep every write transaction short. The host sets `busy_timeout = 5000` on
   its own connections (F26), so a Tawassul write that holds the lock longer
   than that turns the user's next turn into a silent `SQLITE_BUSY`. Measured
   cost is 1.47 ms per deleted row (F29), so the ceiling is about 3,400 rows per
   transaction. Prune in bounded batches with a short pause between them, and
   set Tawassul's own busy timeout below the host's, at 2500 ms, so the sidecar
   yields first instead of last. A run that cannot finish its batches exits
   without an error line and resumes next cycle.
5. Quiescent rung, corrected shape, at or above the hard cap and proven quiet:
   `PRAGMA wal_checkpoint(TRUNCATE)` first, then the reclaim. `VACUUM` in WAL
   mode writes the rebuilt file through the WAL; upstream measured 56 GB of WAL
   from a 104 GB database in 45 minutes without completing (pull 43456). The
   rung therefore needs v1's space gate back, db + wal + 1 GiB (F27), and where
   the host offers `VACUUM INTO` it should write a new file and swap it in
   instead of rewriting in place. The reclaim never shares a step with the
   prune.
6. WAL rung, new and cheapest: the host only ever issues
   `wal_checkpoint(PASSIVE)` (F26), which never truncates, so the WAL sits at
   16.6 MB on a 110 MB database. Above 64 MB, issue
   `PRAGMA wal_checkpoint(TRUNCATE)`. It needs no VACUUM, but it needs an
   exclusive lock on the WAL, so on an always-open host it can return
   `SQLITE_BUSY`; check the result and fall back to a PASSIVE checkpoint with a
   logged retry rather than treating success as guaranteed.
7. Do nothing when there is nothing to do: 0 prunable rows, 0 event rows, and
   below the soft limit means no copy and no rotation. Today every run copies a
   full backup even when it would delete nothing; at a 2 GiB DB with 5 kept
   copies that is 10 GiB of invisible disk for zero benefit. Make the keep count
   size-aware (2 above 1 GiB, 5 below).
8. Add `--max-bytes` and `--target-bytes` to the maintenance script, implemented
   as a window solver over the existing prune query (rule in P2.5). Do not
   invent a new deletion unit.
9. Event retention dispatches on generation and stops being wholesale. The
   `all|off` switch descended from v1's `DELETE FROM event`, which was correct
   only because v1 kept history in `message`/`part`; on a pure-v2 database that
   sentence is false and the table is the replay log (F22, F24). Restore v1's
   bounded form as `--event-keep N`, keeping the newest N rows per aggregate,
   which is also the shape upstream proposes for an append-only log. Because
   mutation paths sit behind `require_v2_generation`, a proven v1 database never
   reaches this dispatch; the only reachable cases are v2 (default 1) and
   unproven (delete nothing). The "default 0 on v1" clause is therefore dead
   code unless P0.1's warn mode is extended to allow v1-generation mutation,
   which the plan does not currently specify.
10. Restore v1's dry-run default for the event step: print the count and delete
    nothing until the flag is explicit. v2 already keeps v1's refusal and
    strengthens it with an `fuser` holder proof and the generation guard, so only
    the dry run is missing; its 60 s delete timeout is also longer than v1's 8 s
    and should come down to 2500 ms like every other Tawassul write (F25, P2.4).
    The launcher's cap-lane call site (`scripts/opencode-v2-iso.sh:147`) must
    pass the explicit delete flag, otherwise the cap lane stops retaining events.
11. Resolve the DB path once, by the documented mechanism, and pass it with
    `--db` (the maintenance script refuses implicit selection, F17). Put that
    resolution in `db-env.sh` so the scheduler, the installer and `doctor-v2.sh`
    all use one implementation.
12. Port only the helper subset needed, as `db-env.sh`: `db_resolve_path`,
    `xdg_data_home`, `xdg_config_home`, `tawassul_cap_bytes`,
    `tawassul_file_bytes`, `tawassul_avail_bytes`, `tawassul_backup_dir`, plus
    the portable `stat`/`date`/`free`/`df` replacements from P4. Do not port the
    watcher or quiet helpers: those are already covered by `src/utils/quiet.ts`
    and `scripts/pin-v2-env.sh`.

Acceptance: on a synthetic DB above the soft limit and held by another process,
the run prunes to target in batches that each finish under 5 s, keeps every
session with at least one message, skips VACUUM, verifies the backup, and exits
0. Below the soft limit with nothing prunable it exits without writing a backup.
A WAL above 64 MB is truncated without a prune. On a v2 database the event step
prints what it would keep and deletes nothing until the flag is explicit.

### P2.5 — retention rule (decided)

The bound the 90-day window provides is about 90 days of writes. On this host
that is 90 × 34 MB/day, about 3.1 GB, against a v1 freeze measured at 3.47 GB.
So the window does bound, but it lands within 400 MB of the freeze, and a user
who writes faster lands past it. The fix is a rung, not a new deletion unit.

Sizing evidence: this install reached 110 MB of main file plus 16.6 MB of WAL in
3.2 days with one heavy project, so the 2 GiB soft limit is about two months at
this rate, and a 1.5 GiB target about six weeks.

Decision, judged from the user's side:

| Rule | Value | Why |
| --- | --- | --- |
| Soft limit | 2 GiB db+wal | about two months at the measured rate, and well below the observed freeze |
| Target after prune | 1.5 GiB | leaves room for a heavy week without re-pruning |
| Hard cap | 4 GiB, unchanged | backstop that forces the deepest prune, not the trigger |
| Deletion unit | messages, with the existing session floor | the shipped SQL already does this; only the cutoff moves |
| Window ladder | 90 → 45 → 21 → 7 → 3 days | the first window that fits the target; the least history loss that bounds |
| Floor | 3 days | never prune a message newer than the floor |
| Order | oldest activity first | newest work always survives |
| VACUUM | opportunistic, quiescent-only | cosmetic; never required for the bound |
| Anchor | keep the newest message of every session | without it the 3-day floor leaves 11 of 74 sessions with zero messages, and a session that reopens blank reads as data loss (F29) |
| Event unit | newest N rows per aggregate, N=1 on v2, 0 on v1 | bounded, upstream-aligned, and never a wholesale wipe (P2.9, F24) |

The window ladder alone never touches a session that has any message inside the
window, so it removes history from dormant sessions only. The solver's
in-session rung is a separate, later step: it cuts a live or heavy session down
to its anchor when the window ladder cannot reach the target. The anchor keeps
the last message of each such session so that it never reopens empty.

The case the ladder works hardest against is not a corner case. Five sessions
hold 70.2 percent of the row data on this host, `assistant` rows are 94.3
percent of it, and upstream measured 85 GB still held by live sessions after
every session older than 30 days was deleted. Window pruning alone therefore
cannot bound a host whose mass sits inside the floor. The solver must try the
in-session rung next, oldest messages first, down to the anchor, and report the
estimate it could not reach. That case is stated, not hidden.

User-visible effect: an old session still opens, with less history, after a
prune. No session is ever deleted.

### P3 — triggering: two roles, three triggers

Files: new `src/services/db-maintenance-trigger.ts`, `src/bootstrap/plugin-init.ts`,
`scripts/install-global.ts`, `README.md`, `scripts/doctor-v2.sh`.

The installer is not the contract: a project install, a hand-placed bundle, and
the Desktop sidecar never run it. The plugin is the only component present on
every lane, so the plugin carries the trigger.

1. Role B, the in-use lane (prune, no VACUUM): at init, if the installed lane
   exists and the last run is older than 24 h, spawn the installed scheduler
   detached, stdio ignored, never awaited. Resolve the lane from
   `import.meta.url`: `<plugin dir>/../tawassul-runtime/db/` for a global
   install, `<repo>/scripts/` for a project install. The scheduler resolves the
   DB path itself (P2.11); the plugin passes no path. Also decide and state
   whether the over-cap launch refusal in `scripts/opencode-v2-iso.sh:164-172`
   stays (which contradicts the 1b contract) or goes, and add the launcher to
   this work item's Files list so P2.10's call site and the refusal branch are
   both addressed.
2. Re-arm an unref'd in-process interval (6 h) so a host that never restarts
   still evaluates the soft limit. This is the only trigger that exists on L2,
   L4, L5 and L6, and the only one that fires while the app stays open.
3. Role A, the quiescent lane (the only VACUUM window): a Linux systemd user
   timer (daily, randomized delay) or a cron line, registered by the installer
   where a scheduler exists. On macOS and Windows, print the exact command and
   never fail, which is v1's doctrine (F21) and its installer behaviour.
4. The plugin never touches SQLite: it `stat()`s the stamp and the DB and
   spawns the installed script. `SHARED.md:382` stays true.
5. Fail-open: a missing script, missing `sqlite3`, a refused run or a locked DB
   is logged at debug and retried next cycle. Boot is never blocked and no
   user-facing line is emitted.
6. One machine-global single-flight lock under the v2 state root, so several
   workspaces do not spawn at once.
7. `--uninstall` removes every trigger it installed and nothing else: it never
   opens, deletes, vacuums or rotates the database or a backup. Upstream's own
   `uninstall` still advertises "keeping session data" while issue 55310 reports
   188 sessions lost, so the promise is stated explicitly and proven by a hash
   comparison (F30, P7.6).
8. `doctor-v2.sh` reports: artifacts and hashes, each trigger found, the
   resolved path and its source, every other DB file the host might be using
   (F16), size and WAL, last run result, and drift between the recorded and the
   live path. A v1 launcher shadow (L1) is reported as a defect, not adopted.
   Because this is the user-facing diagnostic the plan leans on (P3.8, P7.4,
   DoD 4), it must be added to P1's install payload; otherwise an installed user
   cannot run it.

Acceptance: with the app open, no OS scheduler, and a stale stamp, a fresh boot
runs the lane without blocking; removing the script leaves boot unaffected;
`systemctl --user list-timers` shows the unit where systemd exists; doctor names
every trigger it found and every DB file it saw.

### P4 — portability, so that "manual" is a real option on macOS

Files: `scripts/opencode-db-maintenance.sh`, new `scripts/db-env.sh`.

Doctrine keeps macOS manual, and v1's installer already printed the manual step.
What is missing is that the step cannot run: five Linux-only constructs abort
the script (F20). v1 solved the same problem in `tawassul-env.sh`, and v2's own
code already uses the portable pattern at `opencode-db-maintenance.sh:139` and
`opencode-v2-iso.sh:29`.

1. Route `stat -c`, `date -d`, `free -m` and `df -B1 --output=avail` through
   `db-env.sh`, each with the GNU form first and the BSD or `python3` form as
   fallback, and fail closed when neither exists.
2. No automation claim changes: the plan does not add launchd or Task Scheduler
   units, and the installer still prints instead of failing.

Acceptance: on a macOS-like environment (GNU-only commands removed from `PATH`)
the maintenance script completes `--check` and a small prune instead of dying at
the size line, and the shell portability proof covers it.

### P5 — partial install detection

Files: `src/services/ast-service.ts`, `scripts/install-global.ts`,
`src/bootstrap/plugin-init.ts`.

1. Collapse the AST degradation path to one warning naming
   `tawassul-runtime/wasm`, with the install command.
2. The installer refuses to write `tawassul.js` when the runtime directory
   cannot be created.
3. A held-over bundle without its runtime emits one warning per process, not two.
4. Fix `passiveSelfCheck` (`plugin-init.ts:73-88`) so a global install or a
   fresh workspace with no `<project>/.opencode/plugins/tawassul/dist/index.js`
   does not warn and does not point at repo-only build commands.

Acceptance: copying only `tawassul.js` yields exactly one actionable line.

### P6 — duplicate plugin guard

Files: `scripts/install-global.ts`.

1. Before writing, refuse when `<project>/.opencode/plugins/tawassul.js` exists,
   naming both paths.
2. Document the reverse case in README; do not enforce it from plugin code.

Acceptance: installing into a project that already has the plugin fails with one
message naming both files.

### P7 — verification gate

Files: `package.json`, `scripts/gate-manifest.json`,
`scripts/prove-global-install.ts`, `scripts/doctor-v2.sh`,
`src/bootstrap/plugin-init.ts`.

1. Extend `prove:global-install` to assert the manifest (bundle, 4 scripts,
   marker) and sibling-guard resolution.
2. Add a proof that a clean boot emits no warning: no user-facing string
   references `scripts/opencode-v2-iso.sh`, and the self-check and `initAudit`
   paths stay silent on a healthy install, including global installs and fresh
   workspaces.
3. Add the guard path-rule proof (P0.3) and the portable-command proof (P4).
4. Add `doctor-v2.sh --db-contract`: lane, path and source, size and WAL,
   triggers, hashes, drift, other DB files seen.
5. Add a retention proof: after a prune at the 3-day floor, every session on a
   synthetic 74-session database still holds at least one message, and no
   `session_v2` row is deleted (P2.5, F29).
6. Add a mutation-scope proof: the maintenance script deletes only from tables
   on its mutable allow-list; `blob` and `blob_ref` are **not** currently on the
   protected list (`opencode-db-maintenance.sh:128` names `instruction_blob`,
   not `blob`/`blob_ref`), so either add them in the same change or reword the
   proof to assert the list as it exists and that a table in neither list is
   refused.
7. Add an uninstall proof: the database and every backup hash are byte-identical
   after `--uninstall` (P3.7).
8. Add an event-retention proof: on a v2 database the default keeps the newest
   row per aggregate, the step defaults to a dry run, and an unproven generation
   deletes nothing (P2.9, P2.10).
9. Add a space-gate proof: VACUUM refuses when free space is below db + wal +
   1 GiB (P2.5, F27).
10. Run `npm run verify`, then `npm run ci`, sequentially.

Acceptance: both green; fresh boot clean.

## 5. Order

P0 first: it changes what a maintainable DB is, and every later item depends on
that. Then P1 and P2 together (the payload and the brain), then P2.5 inside P2,
then P3, then P4, then P5 + P6, then P7.

P0.3 and P7.3 must land with P0.1 or the proofs fail; that is the intended
coupling.

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Host always open, so the quiescent VACUUM window never arrives | the in-use rung bounds growth without VACUUM; VACUUM stays opportunistic (P2.3) |
| The app is open for months and the in-use rung is the only thing that runs | the in-use rung carries the same action policy as v1's launcher lane (backup + prune + events, no VACUUM), but its trigger fires at 2 GiB instead of 4 GiB, and it skips the protected-table fingerprint while it runs |
| Content-decided generation lets a v2 lane touch a foreign path | only `sqlite3` opens the file there, v1 content is still refused, the path suspicion is recorded, and the launcher keeps `enforce` (P0.1) |
| Scheduled prune contends with the host for the write lock | `wal` is the live mode and a failed run retries next cycle, but the host is not immune: it waits 5000 ms and then fails the turn. So the writes are batched under 5 s (about 3,400 rows at the measured 1.47 ms per row) and Tawassul's own timeout is 2500 ms so it yields first (P2.4, F26, F29) |
| VACUUM fills the disk through the WAL | `wal_checkpoint(TRUNCATE)` first, v1's db + wal + 1 GiB space gate, `VACUUM INTO` plus a swap where available, and never a reclaim in the same step as the prune (P2.5, F27) |
| Event retention wipes a replay log on a v2 host | `--event-keep` with N=1 replaces the wholesale delete, dispatch is by proven generation, the step returns to v1's dry-run default, and it keeps v2's `fuser` holder refusal while its delete timeout comes down from 60 s (P2.9, P2.10, F24, F25) |
| A dormant session reopens with no messages at all | an anchor row per session is kept, so the worst case is a short session, never an empty one (P2.5, F29) |
| One or five sessions hold most of the volume, so the window ladder never reaches the target | the in-session rung runs after the window ladder, and the solver reports the target it could not reach instead of silently stopping (P2.5, F28) |
| The window ladder removes history the user wanted | the window ladder alone touches only dormant sessions; the in-session rung cuts live sessions to the anchor, backup first, and 3 days is the hard floor (P2.5) |
| A single session holds more than the target inside the floor | the in-session rung runs down to that session's anchor, oldest message first, and the solver reports any part of the target it still could not reach instead of silently stopping (P2.5, F28) |
| Five full backups of a multi-GiB DB | size-aware keep count: 2 above 1 GiB, 5 below (P2.4) |
| WAL grows independently of the main file | size is db+wal everywhere, and the WAL was 16.6 MB in a 110 MB DB on this host (F5) |
| A missing dependency turns into a silent runtime failure | install-time preflight, hard on `sqlite3` and on `timeout`/`python3`, soft on `fuser` with stated degradation (P1.6) |
| The resolved path goes stale after a host or config change | resolve per run by the documented mechanism; doctor reports drift and every DB file seen (P0.5, P3.8) |
| The plugin trigger is blocked by a sandbox that denies spawn | fail-open, debug only; the timer is reinforcement on Linux, and on macOS there is no automation claim (P3.5) |
| macOS and Windows get no automation | stated doctrine, and P4 makes the printed manual step actually runnable on macOS |
| Ported scheduler drifts from v1 semantics | the escalation change is explicit in P2.3 and P2.5; every safety step is ported unchanged and proven |
| `--check` writes a sibling log | documented; the DB itself stays read-only |
| Schema drift between host versions changes table names again | detect by `session_v2`, never by `session_message`; doctor probe |
| Two DB files on one host, maintenance aims at the wrong one | the host is the only authority; `debug paths` plus doctor's inventory (F15, F16, P3.8) |

## 7. Definition of done

1. Fresh install on empty `XDG_*`: zero warnings, truthful `health`, exit 0.
2. A v2-native DB at the documented default path is maintained: the guard
   accepts it in `warn` mode and still refuses v1 content there, and the
   maintenance script's archive ban (`:192-206`) is carved out or gated so the
   default path is not refused.
3. `verify:global` validates bundle + 4 scripts + marker, fail-closed.
4. A run happens with the app open and no OS scheduler, visible in
   `doctor-v2.sh`, fail-open.
5. A synthetic heavy DB above the soft limit is pruned to target while a second
   process holds it, and the file stops growing over a 7-day replay.
6. Below the soft limit with nothing prunable, a run writes no backup.
7. On a GNU-stripped `PATH` the maintenance script completes a check and a small
   prune instead of aborting.
8. Bundle-only copy produces one actionable warning.
9. Global plus project duplicate produces one actionable error.
10. No installed-user text references repo-only paths, and no protection depends
    on the user running, reading, or closing anything.
11. A prune at the 3-day floor leaves every session with at least one message.
12. `--uninstall` leaves the database and every backup byte-identical.
13. On a v2 database the event step is a dry run that keeps the newest row per
    aggregate, and deletes nothing when the generation is unproven.
14. VACUUM refuses when free space is below db + wal + 1 GiB.
15. `npm run verify` and `npm run ci` green.
