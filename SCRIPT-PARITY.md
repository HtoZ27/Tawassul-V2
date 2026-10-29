# Script parity audit — v1 `scripts/` against this tree

Date: 2026-10-27, re-verified 2026-10-28 against the v1 source and the installed
host. v1 tree: `/home/htoz/Desktop/tawassyl/scripts` (17 entries, read-only).
v2 tree: `/home/htoz/Desktop/Tawassul V2/scripts` (7 shell scripts).

Purpose: establish which v1 DB-safety and launch-layer scripts reached v2, which were merged, and which are still missing. Input to `PLAN-DB-INSTALL.md`.

Re-verified 2026-10-29: the parity gaps recorded below are closed. The plan's
P0–P7 batches landed `db-env.sh` (portable helpers), `opencode-db-scheduled.sh`
(timer brain plus the always-open rung), the bounded event rung and dry-run
default, the DB-plus-1-GiB space gate, the anchor-preserving window ladder, and
the full `install-global.ts` payload (dependency preflight, timer/cron
registration, one-owner record, smoke, DB scripts, doctor). The remaining rows
are support or measurement tools that do not affect the shipped runtime; they
are listed as out of scope, not as defects.

## Summary (original audit, 2026-10-27)

v2 carried 2,379 script lines in seven shell scripts against v1's 4,484. The
install and scheduling layer was missing, and three retention details were lost
in the merge. All three details and the install layer landed on 2026-10-28; the
tree now carries ten shell scripts and 3,586 lines.

| Status | Count |
| --- | --- |
| Ported | 5 |
| Merged into one script or launcher | 4 |
| Missing (support/measurement only) | 4 |
| Replaced or obsolete | 3 |

## Table

| v1 script | Lines | v2 counterpart | Status | Verdict |
| --- | --- | --- | --- | --- |
| `opencode-db-maintenance.sh` | 550 | `opencode-db-maintenance.sh` (733) | PORTED, vendored V2 fork | Full-file diff is 586 lines, 384 added and 202 removed; the net is +182. The additions are the v2 surfaces: `PROTECTED_TABLES` with `session_v2` and `credential`, the generation guard, the isolation refusal, and the backup dir. All mutations sit behind `require_v2_generation`. |
| `guard-db-generation.sh` | 251 | `guard-db-generation.sh` (258) | PORTED | Full-file diff is 8 lines, 7 added. The v2 copy changes the empty-DB branch from `GEN="v1"` to a table census that refuses v1 content at a v2 path. The path rule at `:83-99` (not `:93-98`) is a precondition, not a substitute: a v2 path with v1 content is still refused at `:245`. `prove-db-retention.ts:91-97` locks the refusal in; E-52 fixed the lock cleanup on both `exit 8` branches and `prove-db-lock.ts` serializes concurrent runs. |
| `boot-scorecard.sh` | 322 | `boot-scorecard-v2.sh` (325) | PORTED | Headers verified; the diff output is 93 lines because the two generations read different log streams. Measurement only, no runtime surface. |
| `tawassul-shrink-db.sh` | 146 | VACUUM path inside maintenance | MERGED, losses restored | The one-shot tool that produced the 3.47 GB to 519 MB result (the 3.77 GB figure in an earlier draft was a misread of the same anchor). It aborted outright while the app was live (`:98`), demanded free space of DB size plus 1 GiB (`:108-111`), and kept the newest N rows per aggregate with `--keep` (`:127-132`). v2 kept the delete and the VACUUM; P2.5/P2.9 restored the bounded newest-N rung, the DB-plus-1-GiB gate, and the anchor row, and the live abort became a VACUUM skip so the prune still runs while the app is open. See `PLAN-DB-INSTALL.md` P2.5 and P2.9. |
| `tawassul-prune-events.sh` | 68 | `--event-only` inside maintenance | MERGED, dry-run kept | v1 skipped silently (exit 0) while the app ran (`pgrep`, `:44-47`), defaulted to a dry run (`:59-62`), and used `PRAGMA busy_timeout=8000` for the delete (`:64`). v2's `--event-only` refuses harder — an `fuser` holder proof that fails closed — and adds `require_v2_generation` (`maintenance:495-509`). v2 keeps the dry-run default: the step reports the would-be count and only `--event-delete` applies it. The remaining difference is the delete timeout: v2 uses `.timeout 60000` for the bounded newest-N batch. |
| `opencode-iso.sh` + `opencode-desktop-iso.sh` | 323 + 359 | `opencode-v2-iso.sh` (329) | MERGED | Generation-scoped, one launcher. v1 fallback removed (S-041.5). |
| `tawassul-env.sh` | 568 | `db-env.sh` + `pin-v2-env.sh` | PORTED (split) | The pin helper stays separate; `db-env.sh` supplies the XDG path, file-size, mtime, mode, date, RAM, and available-bytes helpers with GNU → BSD → python3 rungs, and every helper fails closed when no rung answers. `prove-portability.ts` (26 assertions) covers every rung plus a macOS-like end-to-end prune. |
| `opencode-db-scheduled.sh` | 107 | `opencode-db-scheduled.sh` | PORTED | The timer brain: check always, full run only at cap and quiescent, log rotation. The quiescent rung is the only VACUUM-safe moment; a below-cap rung serves an always-open host (P2). The v1 daily launcher re-assert (`:97-107`) was deliberately not ported, because it would recreate v1 launchers from a v2 tree. |
| `install-tawassul.sh` | 457 | `install-global.ts` | PORTED (launcher skipped) | The installer ships the plugin, the four DB scripts, the doctor and the wasm runtime; probes `sqlite3`, `timeout`/`python3`, `free`, and `fuser` before writing; registers a systemd user timer, then a tagged cron line, then manual; records one owner; runs `maintenance --check` when a DB exists; and verifies size, hash, and exec bit. The stable launcher copy is skipped by S-033 (the Desktop boots the sidecar directly). |
| `d3-report.sh` | 109 | none | OUT OF SCOPE | Rotation drill calculator, read-only. Support tool, not install; no shipped runtime surface. |
| `tawassul-recover-desktop-db.sh` | 310 | none | OUT OF SCOPE | Recovery after a generation rotation. Support tool; the shipped guard and backup lanes cover the runtime path. |
| `tawassul-salvage-v2.sh` | 182 | none | OUT OF SCOPE | Raw export from a rotated DB. Support tool; no shipped runtime surface. |
| `tawassul-cold-boot.sh` | 294 | none | OUT OF SCOPE | Measurement runner. Skipped by S-034; `boot-scorecard-v2.sh` and the smoke/independence boots cover the measurement. |
| `dedup-bash-rules.mjs` | 104 | none | OBSOLETE | v1 config hygiene. No v2 equivalent needed. |
| `generate-opencode-config.mjs` | 334 | none | OBSOLETE | Marked deprecated and quarantined in v1 itself. |
| `tawassul-versions.env` | n/a | `pin-v2-env.sh` + manifests | REPLACED | Version pins now live in package manifests and the pin helper. |

## installer parity, item by item

`install-tawassul.sh` asserted six things. What v2's `install-global.ts` does today:

| v1 installer step | v2 status | Consequence for a fresh user |
| --- | --- | --- |
| Dependency preflight: `sqlite3`, `timeout`/`python3`, `free` | ported | The installer probes all of them plus `fuser`, hard-fails on Linux when a hard dependency is missing, and warns on macOS; `openssl` and `xxd` are not needed by the shipped paths. |
| Backups outside every opencode data dir | ported | Maintenance defaults to `tawassul-v2/backups`, which is outside the host data tree; `prove-db-retention` asserts the location. |
| Daily read-only check via systemd user timer, or cron | ported | The installer registers a systemd user timer at 04:17 with `Persistent=true`, then a tagged cron line, then manual (`TAWASSUL_REGISTER_TRIGGERS` overrides); `--uninstall` removes owned units and the tagged line. |
| Stable launcher copy plus desktop/autostart routing | skipped (S-033) | The Desktop boots the sidecar directly; launcher policy never applies. `opencode-v2-iso.sh` remains for isolated tests and is not shipped. |
| Smoke test (`maintenance --check`) | ported | The installer runs `maintenance --check` when a DB exists and fails closed on a non-zero result; `prove-global-install` drives the installed script through a synthetic v2 DB. |
| One-owner record (`tawassul-install-owner`) | ported | A second tree refuses to install without `--takeover`; `--uninstall` removes the record only when this tree owns it. |

## Schema and naming differences (measured 2026-10-27)

Reading the v1 scripts is not enough: the two generations do not share a schema, and two table names collide. Measured with `sqlite3` on a v1 backup (`opencode-20261015-061352.db`) and the live v2 DB.

| Table | v1 | v2 | Note |
| --- | --- | --- | --- |
| `session` | present | absent | replaced by `session_v2` |
| `session_v2` | absent | present | the real v2 discriminator |
| `message` | present, 18,340 rows | absent | v1 store |
| `part` | present, 82,433 rows | absent | v1 store |
| `session_message` | **present, 0 rows** | present, 14,234 rows | **name collision, not a discriminator** |
| `event` | present, **293,620 rows** | present, **0 rows** | the v1 growth driver |
| `credential` | present | present | protected in both |
| `kv`, `blob`, `blob_ref`, `instruction_*`, `session_inbox`, `worktree` | absent | present | v2-only surfaces |
| `data_migration`, `session_input`, `session_context_epoch`, `session_share`, `todo` | present | absent | v1-only surfaces |

Consequences:

1. **Never detect v2 by `session_message`.** v1 creates the table and leaves it empty. The discriminator is `session_v2` (or `kv` + `migration.v1-v2`), which is what the guard already uses and what the live check confirmed.
2. **The maintenance script is correct on the live DB.** `--check` on the v2 file reported: 106M, pages 26,988, freelist 2,618, cap use 2.9%, "would prune now: v2 0 messages", "event retention: 0 rows". Exit 0.
3. **The 90-day window does bound v2 growth, but it is inert today and too close to the freeze.** v2's mass is live `session_message` rows; the script prunes messages older than the window and never touches a session with any message inside it. Measured 2026-10-28: the file is 3.5 days old, so the window deletes 0 rows and 0 sessions. The bound is the window times the write rate: 90 days at the measured 34 MB/day is about 3.1 GB, against a v1 freeze at 3.47 GB. The most aggressive rule the plan allows, a 3-day floor, deletes 304 rows here and leaves 11 of 74 sessions with zero messages. Window width is therefore not the only axis: a size rung and an anchor row are both required (P2.5).
4. **`event` is empty on this host, and the reason is unknown.** The live v2 DB holds 0 event rows while `event_sequence` holds 66. An earlier version of this audit claimed the host never writes events because the binary has no `INSERT INTO event`. That inference fails a control test: the same search finds no `INSERT INTO session_message` either, and that table grows. The observed zero stands; the cause does not, and the table must be probed per host instead of assumed. Growth on this host is `session_message` (70.08 MB of row data), one `kv` catalog row of 11.25 MB, and 11.11 MB of freelist.
5. **What the v1 shrink actually did.** `tawassul-shrink-db.sh` deleted 2.94 GB of `event` from a 3.47 GB file with freelist 0, then ran `VACUUM`. The arithmetic is close but not exact: 3.47 GB minus 2.94 GB is 0.53 GB (530 MB decimal), about 11 MB above the 519 MB result, which is rounding and page-level overhead. It deleted every `event` row (the table itself survives), touched nothing else, and aborted outright while the Desktop was open. That path cannot be reused on v2, where the event table is empty and the mass is message history that v1 never pruned in this tool.

Observations:

6. **The DB logic exists, but two retention rungs and one default did not survive the merge.** Maintenance, guard, scoring and the event step are all present. The bounded `--keep N` event rung and the DB-plus-1-GiB space gate are not, and the pre-launch event step lost its dry-run default — though it gained a stricter `fuser` holder proof and a generation guard. See the two merged rows above and `PLAN-DB-INSTALL.md` P2.5, P2.9, P2.10.
7. **The gap has two halves.** First, invocation: `opencode-db-scheduled.sh` is the missing piece that turns the maintenance script into a self-running lane, and v1 escalates only at the cap and only when no process holds the DB, so a host that is always open never satisfies it. Keep the quiescent rung, because it is the only VACUUM-safe moment, and add a rung below the cap (P2, P2.5). Second, reach: the guard refuses `--expect v2` on any path without `tawassul-v2` before it reads the schema, so a user who never had a launcher layer has a DB the lane cannot touch, including the documented default path (P0).
8. **The helper library is the hidden dependency.** `tawassul-env.sh` carries `xdg_data_home`, `xdg_config_home`, `tawassul_cap_bytes`, `tawassul_backup_dir`, `tawassul_file_bytes`, `tawassul_avail_bytes`, and the portable replacements for `stat`/`date`/`free`/`df`. The last group is what makes the difference between "maintenance is manual on macOS" and "maintenance cannot run on macOS at all". Port those, not the 568 lines; the watcher and quiet helpers are already covered by `src/utils/quiet.ts` and `scripts/pin-v2-env.sh`.
9. **Dependency preflight is a real first-run failure.** `sqlite3`, `timeout` (or `python3`) and `free` are hard requirements the guard or the maintenance script refuses without; `fuser` is hard on the default run and `--event-only` and soft only at the VACUUM-skip site.
10. **Recovery and salvage are support tools.** They matter only after a generation rotation, but a rotation is exactly when a user has no idea what to do. Keep them out of the install payload, document them in the support runbook.
11. **Cold-boot, dedup and generate-config are correctly excluded.** No runtime surface, or already retired in v1.

## Recommendation

Port, in this order:

1. `opencode-db-scheduled.sh` — port the safety unchanged, keep the quiescent rung, add the below-cap rung and the WAL rung from P2 and P2.5, drop the launcher re-assert — plus `db-env.sh` with the path resolver, the XDG/cap/size helpers and the portable command replacements.
2. Restore the three lost rungs in the maintenance script: `--event-keep N` with the v1 window function, the event step's dry-run default, and the DB + wal + 1 GiB space gate before VACUUM.
3. `install-global.ts` gains the installer's missing steps: dependency preflight, scheduler registration, smoke run, ownership record, and the four DB scripts in the payload.
4. `d3-report.sh`, `tawassul-recover-desktop-db.sh`, `tawassul-salvage-v2.sh` as support scripts in the repo, not in the install payload.

Do not port: `tawassul-cold-boot.sh`, `dedup-bash-rules.mjs`, `generate-opencode-config.mjs`.
