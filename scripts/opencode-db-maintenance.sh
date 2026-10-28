#!/usr/bin/env bash
# opencode-db-maintenance.sh — V2 LOCAL COPY (vendored maintenance lane;
# the target DB is explicit: --db or OPENCODE_DB, never an implicit path).
#
# Prevents the working DB from growing back to tens of GB (23.8 GB observed:
# 5.8M pages, 971K parts — the root cause of the frozen local server, since
# opencode queries better-sqlite3 synchronously on its event loop).
#
# What it does, in order (each step safe to stop):
#   1. REFUSE if the target DB is in use by a live process (or free RAM < 1.5GB)
#      unless --allow-in-use / --ignore-low-ram. A checkpoint/VACUUM against a
#      live WAL is a footgun. (--force = both, deprecated.)
#   2. BACKUP via SQLite's online backup API (".backup") — consistent snapshot
#      regardless of WAL state — to $BACKUP_DIR, keeping the last N backups.
#      The backup must pass quick_check + a session-count probe or we abort.
#   3. PRUNE old messages (message/part for legacy schema, session_message for
#      the v2 schema; sessions are NEVER deleted — other tables reference them).
#      Offset is wall-clock, messages touching fresh sessions are kept, so
#      active work is never emptied. Also applies host `event` retention when
#      the DB is quiescent: every event row predates the current run while
#      session history stays in message/part/session_message.
#   4. VACUUM — rebuilds the file, reclaims every freed page (the actual shrink).
#      Runs ONLY when no process holds the DB (re-checked here); otherwise it is
#      skipped with a notice — live VACUUM is forbidden under every flag.
#   5. REPORT before/after sizes. Exit non-zero on any safety refusal.
#      Exit: 2 refusal/usage · 3 probe failure · 4 backup failure · 5 mutation
#      failure · 6 VACUUM failure · 7 disk space · 8 lock contention ·
#      9 cap remains or protected-table mismatch.
#
# Event retention policy (S-040): the host `event` table is append-only with no
# retention path; at tens of thousands of rows it freezes the synchronous SQLite
# server. The launchers enforce the cap (3GiB warning, 4GiB trigger): at/over the
# cap they run this script with --event-only before exec, then start a background
# backup+prune. A full run also deletes every event row when nothing holds the
# DB. Live runs never delete events (a delete mid-run can starve the host).
#
# The legacy archive ~/.local/share/opencode/opencode.db is NEVER an implicit
# target: selecting it requires --allow-archive plus an interactive CONFIRM.
#
# Usage:
#   opencode-db-maintenance.sh [--db PATH] [--prune-days N] [--backup-dir DIR]
#                              [--keep-backups N] [--check] [--force]
#                              [--allow-in-use] [--ignore-low-ram]
#                              [--allow-archive] [--event-retention all|off]
#                              [--event-only] [--cap-bytes N] [--plan]
#
# Defaults:
#   --db          OPENCODE_DB env only. There is no implicit fallback: pass --db
#                 or set OPENCODE_DB, otherwise the run refuses (D-01).
#                 (OPENCODE_DB set-but-missing fails closed; archive needs
#                 --allow-archive + CONFIRM.)
#   --prune-days  90 (0 disables pruning entirely — backup+VACUUM only)
#   --backup-dir  ~/.local/share/tawassul-v2/backups
#   --keep-backups 5 (minimum 1 — 0 would rotate away every backup)
#   --check       read-only: report sizes (+ prune/vacuum/event would-be deltas)
#                 and exit 0 — never touches the DB (immutable reads; the
#                 in-use refusal does not apply, the RAM floor still does).
#   --force       DEPRECATED: equals --allow-in-use --ignore-low-ram.
#                 Still never authorizes a live VACUUM (always skipped).
#   --event-retention all|off  delete host event rows before VACUUM when the DB
#                 is quiescent (default all; off keeps them).
#   --event-only  delete host event rows and exit (no backup/prune/VACUUM);
#                 requires a quiescent DB — the launcher path at the cap.

set -euo pipefail

H="$(cd "$(dirname "$0")" && pwd -P)"
. "$H/db-env.sh" 2>/dev/null || {
  echo "❌ db-env.sh must sit next to this script (ship payload broken)." >&2
  exit 2
}

# ── option parsing ────────────────────────────────────────────────────────────
DB_PATH=""
PRUNE_DAYS=90
BACKUP_DIR="${HOME}/.local/share/tawassul-v2/backups"
KEEP_BACKUPS=5
TARGET_BYTES=0
MAX_BYTES=0
EXPLICIT_KEEP=0
PRUNE_BATCH=3000
PRUNE_MAX_ITER=2000
PRUNE_ITER=0
EVENT_KEEP=1
EVENT_DELETE_EXPLICIT=0
case "$PRUNE_BATCH" in (''|*[!0-9]*) echo "❌ --batch-rows must be a positive integer (got: $PRUNE_BATCH)" >&2; exit 2 ;; esac
case "$PRUNE_MAX_ITER" in (''|*[!0-9]*) echo "❌ --max-batches must be a positive integer (got: $PRUNE_MAX_ITER)" >&2; exit 2 ;; esac
[ "$PRUNE_BATCH" -ge 1 ] && [ "$PRUNE_MAX_ITER" -ge 1 ] || { echo "❌ --batch-rows/--max-batches must be >= 1" >&2; exit 2; }
MODE="run"
ALLOW_IN_USE=0
IGNORE_LOW_RAM=0
ALLOW_ARCHIVE=0
FORCE_WARN=0
EVENT_RETENTION="all"
COOLDOWN_MARK_TO_CLEAR=""
CAP_BYTES="${TAWASSUL_DB_CAP_BYTES:-4294967296}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --db) DB_PATH="${2:?--db needs a path}"; shift 2 ;;
    --cooldown-mark) COOLDOWN_MARK_TO_CLEAR="${2:?--cooldown-mark needs a path}"; shift 2 ;;
    --prune-days) PRUNE_DAYS="${2:?--prune-days needs a number}"; EXPLICIT_PRUNE=1; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:?--backup-dir needs a path}"; shift 2 ;;
    --keep-backups) KEEP_BACKUPS="${2:?--keep-backups needs a number}"; EXPLICIT_KEEP=1; shift 2 ;;
    --target-bytes) TARGET_BYTES="${2:?--target-bytes needs a number}"; shift 2 ;;
    --max-bytes) MAX_BYTES="${2:?--max-bytes needs a number}"; shift 2 ;;
    --batch-rows) PRUNE_BATCH="${2:?--batch-rows needs a number}"; shift 2 ;;
    --max-batches) PRUNE_MAX_ITER="${2:?--max-batches needs a number}"; shift 2 ;;
    --check) MODE="check"; shift ;;
    --event-only) MODE="event"; shift ;;
    --cap-bytes) CAP_BYTES="${2:?--cap-bytes needs a number}"; shift 2 ;;
    --plan) MODE="plan"; shift ;;
    --event-retention) EVENT_RETENTION="${2:?--event-retention needs all|off}"; shift 2 ;;
    --event-keep) EVENT_KEEP="${2:?--event-keep needs a number}"; shift 2 ;;
    --event-delete) EVENT_DELETE_EXPLICIT=1; shift ;;
    --allow-in-use) ALLOW_IN_USE=1; shift ;;
    --ignore-low-ram) IGNORE_LOW_RAM=1; shift ;;
    --allow-archive) ALLOW_ARCHIVE=1; shift ;;
    --force) ALLOW_IN_USE=1; IGNORE_LOW_RAM=1; FORCE_WARN=1; shift ;; # --force: deprecated alias for both
    --help|-h)
      sed -n '1,/^set -euo pipefail$/{/^set -euo pipefail$/d;p}' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; sed -n '1,20p' "$0" >&2; exit 2 ;;
  esac
done

# Liveness: a launcher stamps a 24h cooldown mark BEFORE this background job
# runs. If we fail (any non-zero except 8 = "another run is handling it"),
# delete the mark so the NEXT launch retries instead of sleeping a day.
# Installed HERE (before any exit) with an unset-tolerant lock ref, because
# gates above the lock (containment, archive ban) must also clear the mark.
trap 'rc=$?; if [ -n "${LOCK_DIR-}" ]; then rm -rf "$LOCK_DIR" 2>/dev/null || true; fi; if [ -n "$COOLDOWN_MARK_TO_CLEAR" ] && [ "$rc" -ne 0 ] && [ "$rc" -ne 8 ]; then rm -f "$COOLDOWN_MARK_TO_CLEAR" 2>/dev/null || true; fi; exit "$rc"' EXIT
# numeric options are used in arithmetic and in `date -d` — reject junk loudly
case "$PRUNE_DAYS" in (''|*[!0-9]*) echo "❌ --prune-days must be a non-negative integer (got: $PRUNE_DAYS)" >&2; exit 2 ;; esac
case "$KEEP_BACKUPS" in (''|*[!0-9]*) echo "❌ --keep-backups must be a non-negative integer (got: $KEEP_BACKUPS)" >&2; exit 2 ;; esac
case "$TARGET_BYTES" in (''|*[!0-9]*) echo "❌ --target-bytes must be a non-negative integer (got: $TARGET_BYTES)" >&2; exit 2 ;; esac
case "$MAX_BYTES" in (''|*[!0-9]*) echo "❌ --max-bytes must be a non-negative integer (got: $MAX_BYTES)" >&2; exit 2 ;; esac
if [ "$TARGET_BYTES" -gt 0 ] && [ "${EXPLICIT_PRUNE:-0}" = 1 ]; then
  echo "❌ --target-bytes and --prune-days are exclusive — pick the fixed window or the solver." >&2
  exit 2
fi
if [ "$KEEP_BACKUPS" -lt 1 ]; then
  echo "❌ --keep-backups must be >= 1 (0 would rotate away every backup)" >&2
  exit 2
fi
case "$EVENT_RETENTION" in
  all|off) ;;
  *) echo "❌ --event-retention must be all|off (got: $EVENT_RETENTION)" >&2; exit 2 ;;
esac
case "$EVENT_KEEP" in
  ''|*[!0-9]*) echo "❌ --event-keep must be a non-negative integer (got: $EVENT_KEEP)" >&2; exit 2 ;;
esac
case "$CAP_BYTES" in
  ''|*[!0-9]*) echo "❌ --cap-bytes must be a positive integer (got: $CAP_BYTES)" >&2; exit 2 ;;
esac
if [ "$CAP_BYTES" -lt 1 ]; then
  echo "❌ --cap-bytes must be >= 1 (got: $CAP_BYTES)" >&2
  exit 2
fi
MUTABLE_TABLES="message part session_message event"
PROTECTED_TABLES="session session_v2 project workspace worktree project_directory permission credential account account_state control_account migration kv instruction_blob instruction_entry instruction_state session_inbox session_pending session_share todo event_sequence"
assert_mutation_target() {
  case " $MUTABLE_TABLES " in
    *" $1 "*) return 0 ;;
    *) echo "❌ refusing mutation target '$1' — not in the allowlist ($MUTABLE_TABLES)" >&2; exit 2 ;;
  esac
}
cutoff_ms() {
  local s
  s="$(tawassul_date_epoch_days "${1:-}")" || s=""
  case "$s" in
    ''|*[!0-9]*) s=$(( $(date +%s) - ${1:-0} * 86400 )) ;;
  esac
  printf '%d' $(( s * 1000 ))
}
prune_candidates() {
  local t=0 v
  if [ "$HIST_MESSAGE" = 1 ]; then
    v="$(timeout 300 $RO "$(RO_DB)" "
      SELECT count(*) FROM message
       WHERE time_updated < ${1}
         AND session_id NOT IN (SELECT session_id FROM message WHERE time_updated >= ${1});" 2>/dev/null)" || v=""
    case "$v" in ''|*[!0-9]*) printf '?' ; return ;; *) t=$(( t + v )) ;; esac
  fi
  if [ "$HIST_V2" = 1 ]; then
    v="$(timeout 300 $RO "$(RO_DB)" "
      SELECT count(*) FROM session_message
       WHERE time_updated < ${1}
         AND session_id NOT IN (SELECT session_id FROM session_message WHERE time_updated >= ${1});" 2>/dev/null)" || v=""
    case "$v" in ''|*[!0-9]*) printf '?' ; return ;; *) t=$(( t + v )) ;;
    esac
  fi
  printf '%s' "$t"
}
prune_candidate_bytes() {
  local b=0 v
  if [ "$HIST_MESSAGE" = 1 ]; then
    v="$(timeout 300 $RO "$(RO_DB)" "
      SELECT CAST(total(LENGTH(data)) AS INTEGER) FROM message
       WHERE time_updated < ${1}
         AND session_id NOT IN (SELECT session_id FROM message WHERE time_updated >= ${1});" 2>/dev/null)" || v=""
    case "$v" in ''|*[!0-9]*) printf '' ; return ;; *) b=$(( b + v )) ;; esac
    v="$(timeout 300 $RO "$(RO_DB)" "
      SELECT count(*) FROM part
       WHERE message_id IN (SELECT id FROM message
         WHERE time_updated < ${1}
           AND session_id NOT IN (SELECT session_id FROM message WHERE time_updated >= ${1}));" 2>/dev/null)" || v=""
    case "$v" in ''|*[!0-9]*) printf '' ; return ;; *) b=$(( b + v * 400 )) ;; esac
  fi
  if [ "$HIST_V2" = 1 ]; then
    v="$(timeout 300 $RO "$(RO_DB)" "
      SELECT CAST(total(LENGTH(data)) AS INTEGER) FROM session_message
       WHERE time_updated < ${1}
         AND session_id NOT IN (SELECT session_id FROM session_message WHERE time_updated >= ${1});" 2>/dev/null)" || v=""
    case "$v" in ''|*[!0-9]*) printf '' ; return ;; *) b=$(( b + v )) ;;
    esac
  fi
  printf '%s' "$b"
}
batched_prune() {
  local tbl="$1" out del=0 total=0
  assert_mutation_target "$tbl"
  while : ; do
    out="$(timeout 60 sqlite3 -cmd ".timeout 2500" "$DB_PATH" "
      PRAGMA foreign_keys = ON;
      DELETE FROM ${tbl} WHERE id IN (
        SELECT id FROM ${tbl}
         WHERE time_updated < ${CUTOFF}
           AND session_id NOT IN (SELECT session_id FROM ${tbl} WHERE time_updated >= ${CUTOFF})
         LIMIT ${PRUNE_BATCH}
      );
      SELECT changes();
    " 2>>"$LOG_FILE")" || { echo "❌ prune of ${tbl} failed (see ${LOG_FILE}; retry offline or with --allow-in-use)." >&2; exit 5; }
    case "$out" in
      ''|*[!0-9]*) echo "❌ prune batch of ${tbl} returned no count — refusing to continue blind." >&2; exit 5 ;;
    esac
    del="$out"
    total=$(( total + del ))
    [ "$del" -eq 0 ] && break
    PRUNE_ITER=$(( PRUNE_ITER + 1 ))
    if [ "$PRUNE_ITER" -ge "$PRUNE_MAX_ITER" ]; then
      echo "→ prune paused: batch cap (${PRUNE_MAX_ITER}) reached after ${total} rows from ${tbl} — resumes next cycle."
      return 6
    fi
    sleep 0.3
  done
  printf '%s' "$total"
}
db_total_bytes() { # $1=db → main + WAL bytes, non-zero exit when unreadable
  local total=0 f n
  for f in "$1" "$1-wal"; do
    [ -e "$f" ] || continue
    n="$(tawassul_file_bytes "$f" 2>/dev/null || true)"
    case "$n" in
      ''|*[!0-9]*) return 1 ;;
    esac
    total=$((total + n))
  done
  printf '%s' "$total"
}
if [ "$MODE" = "plan" ]; then
  echo "cap-bytes: $CAP_BYTES"
  echo "mutation-targets: $MUTABLE_TABLES"
  echo "protected-tables: $PROTECTED_TABLES"
  exit 0
fi
if [ "$FORCE_WARN" = 1 ]; then
  echo "⚠️  --force is deprecated (== --allow-in-use --ignore-low-ram) and never authorizes a live VACUUM." >&2
fi

# ── resolve target DB ─────────────────────────────────────────────────────────
# Fail closed: an OPENCODE_DB that points nowhere never falls through to
# another database (that silent fallthrough once targeted the 23GB archive).
if [ -z "$DB_PATH" ]; then
  if [ -n "${OPENCODE_DB:-}" ]; then
    if [ -e "$OPENCODE_DB" ]; then
      DB_PATH="$OPENCODE_DB"
    else
      echo "❌ OPENCODE_DB is set but missing: $OPENCODE_DB — refusing to pick another DB." >&2
      exit 2
    fi
  else
    echo "❌ no target DB: pass --db PATH or set OPENCODE_DB (implicit selection is disabled — D-01)." >&2
    exit 2
  fi
fi
if [ ! -f "$DB_PATH" ]; then
  echo "❌ target DB not found: $DB_PATH" >&2
  exit 1
fi
# Structural archive ban: the 23GB legacy DB needs --allow-archive + CONFIRM.
# (Canonical-path version lives in the containment gate below; this literal
# pre-check only gives the early, specific error for the classic spelling.)
DB_DIR="$(dirname "$DB_PATH")"
# ── containment gate (P0): canonicalize, refuse symlinks, separate DB/backups.
# A literal-string archive ban is a spelling, not a guard (proven: an
# archive-named file outside the literal path pruned without refusal).
if [ -L "$DB_PATH" ]; then
  echo "❌ refusing: $DB_PATH is a symlink — pass the real path." >&2
  exit 2
fi
DB_PATH="$(cd "$DB_DIR" && pwd -P)/$(basename "$DB_PATH")"
DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$BACKUP_DIR" 2>/dev/null || true
BACKUP_CANON="$(cd "$BACKUP_DIR" && pwd -P)"
case "$DB_PATH" in
  */.local/share/opencode/opencode.db|*/.local/share/opencode-backups/*)
    archive_generation_probe() {
      timeout 60 sqlite3 -readonly -noheader "$DB_PATH" \
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='session_v2';" 2>/dev/null
    }
    if [ "$ALLOW_ARCHIVE" != 1 ]; then
      PROBE="$(archive_generation_probe)" || PROBE=""
      case "$PROBE" in
        [1-9]*) echo "→ archive path check: v2 content present — not a legacy archive, continuing." ;;
        0) echo "❌ refusing: $DB_PATH looks like a legacy archive — pass --allow-archive to touch it deliberately." >&2; exit 2 ;;
        *) echo "❌ cannot probe the archive path (fail-closed) — pass --allow-archive to override deliberately." >&2; exit 2 ;;
      esac
    elif [ ! -t 0 ]; then
      echo "❌ archive target needs an interactive CONFIRM (no tty) — aborting." >&2
      exit 2
    else
      printf 'Archive target %s — type YES to continue: ' "$DB_PATH" >&2
      read -r REPLY 2>/dev/null || REPLY=""
      if [ "$REPLY" != "YES" ]; then echo "❌ archive CONFIRM not given — aborting." >&2; exit 2; fi
    fi
    ;;
esac
if [ "$BACKUP_CANON" = "$DB_DIR" ]; then
  echo "❌ refusing: --backup-dir is the DB's own directory (rotation would target the live DB)." >&2
  exit 2
fi
case "$DB_PATH" in
  "$BACKUP_CANON"/*)
    echo "❌ refusing: target DB lives inside --backup-dir (rotation would target it)." >&2
    exit 2
    ;;
esac
DB_SIZE_BEFORE="$(tawassul_file_bytes "$DB_PATH")" || {
  echo "❌ cannot measure DB size — refusing (fail-closed)." >&2
  exit 3
}
DB_TOTAL_BEFORE="$(db_total_bytes "$DB_PATH")" || {
  echo "❌ cannot measure DB+WAL size — refusing (fail-closed)." >&2
  exit 3
}
echo "→ target: $DB_PATH  ($(numfmt --to=iec "$DB_SIZE_BEFORE" 2>/dev/null || echo "$DB_SIZE_BEFORE bytes"); db+wal $(numfmt --to=iec "$DB_TOTAL_BEFORE" 2>/dev/null || echo "$DB_TOTAL_BEFORE bytes"))"
if [ "$DB_TOTAL_BEFORE" -ge "$CAP_BYTES" ]; then
  echo "⛔ target reached the cap (${CAP_BYTES} bytes, db+wal) — full maintenance is the repair path; launchers refuse to start above it." >&2
elif [ "$DB_TOTAL_BEFORE" -ge $((CAP_BYTES * 3 / 4)) ]; then
  echo "⚠️  target exceeds 75% of the cap (${CAP_BYTES} bytes, db+wal) — schedule maintenance." >&2
fi
# Error log for the mutating steps (never silenced to /dev/null unlogged):
# falls back to stderr when the directory is not writable.
LOG_FILE="${DB_DIR}/opencode-db-maintenance.log"
if ! : >>"$LOG_FILE" 2>/dev/null; then LOG_FILE="/dev/stderr"; fi

# ── single-run lock: two concurrent runs would race on backup rotation and on
# VACUUM. mkdir is atomic everywhere (no flock dependency). A lock whose every
# recorded owner is dead (SIGKILL can skip the EXIT trap) is reclaimed — this
# is what lets a timer run and a launcher-triggered run coexist: the loser
# exits 8, a corpse never blocks forever. ───────────────────
LOCK_DIR="${DB_DIR}/.opencode-db-maintenance.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  STALE_LOCK=1
  for PF in "$LOCK_DIR"/pid.* ; do
    [ -e "$PF" ] || continue
    PID="$(cat "$PF" 2>/dev/null || echo "?")"
    case "$PID" in
      ''|*[!0-9]*) STALE_LOCK=0 ;;
      *) if kill -0 "$PID" 2>/dev/null; then STALE_LOCK=0; fi ;;
    esac
  done
  if [ "$STALE_LOCK" = 1 ]; then
    echo "⚠️  reclaiming stale lock $LOCK_DIR (all recorded owners dead)." >&2
    rm -rf "$LOCK_DIR" 2>/dev/null || true
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
      echo "❌ lock $LOCK_DIR contested after reclaim — backing off." >&2
      exit 8
    fi
  else
    echo "❌ another maintenance run holds $LOCK_DIR — wait for it or clear it if stale." >&2
    exit 8
  fi
fi
LOCK_OWNER="$LOCK_DIR/pid.$$"
# EXIT trap lives at the top (before option parsing): it cleans the lock AND
# clears a launcher cooldown mark on failure. Do NOT add a second EXIT trap
# here — it would overwrite the early one and silently drop mark-clearing.
echo "$BASHPID" > "$LOCK_OWNER" 2>/dev/null || true

# ── safety: process holding the DB / low RAM ──────────────────────────────────
# --check is immutable-read-only, so the in-use refusal does not apply to it;
# the RAM floor still does (its count queries are heavy on big DBs).
# fuser's own protocol: rc=1 + empty output MEANS "no holders" (verified:
# empty on quiescent, rc=0 + PIDs when held). So rc alone cannot prove
# failure — but ANY stderr noise (unreadable /proc, hardening profiles) or
# rc>=2 means the answer is unreliable. rc: 0 = answered (output decides),
# 1 = unreliable → caller must fail closed, never "no holders".
fuser_holders() { # $1=db → 0 no holders | 3 holders exist | 1 unreliable
  local _db="$1" _rc=0
  command -v fuser >/dev/null 2>&1 || return 1
  [ -e "$_db" ] || return 1
  fuser -s "$_db" 2>/dev/null || _rc=$?
  case "$_rc" in
    0) return 3 ;;
    1) return 0 ;;
    *) return 1 ;;
  esac
}
if [ "$MODE" != "check" ] && [ "$ALLOW_IN_USE" = 0 ]; then
  # A missing `fuser` must never read as "nobody holds the DB" (fail-closed).
  if ! command -v fuser >/dev/null 2>&1; then
    echo "❌ fuser not found (util-linux) — cannot verify that no process holds the DB." >&2
    echo "   Install util-linux, or re-run with --allow-in-use if you are certain it is offline." >&2
    exit 3
  fi
  H_RC=0
  fuser_holders "$DB_PATH" || H_RC=$?
  case "$H_RC" in
    1) echo "❌ fuser unreliable — cannot prove the DB is quiescent (fail-closed)." >&2; exit 3 ;;
    3) echo "❌ DB is in use by another process — close the Desktop app first (or use --allow-in-use for backup+prune; VACUUM stays offline-only)." >&2; exit 3 ;;
  esac
fi
if [ "$IGNORE_LOW_RAM" = 0 ]; then
  # RULES.md: never run heavy ops below 1.5GB free RAM. An unreadable or
  # unparsable reading refuses too (fail-closed) — it must never read as "plenty".
  MEM_AVAIL="$(tawassul_free_ram_mb)" || MEM_AVAIL=""
  case "$MEM_AVAIL" in
    ''|*[!0-9]*)
      echo "❌ cannot determine free RAM — refusing heavy ops (or use --ignore-low-ram)." >&2
      exit 3
      ;;
  esac
  if [ "$MEM_AVAIL" -lt 1500 ]; then
    echo "❌ free RAM ${MEM_AVAIL}MB < 1500MB (RULES.md) — refusing heavy ops." >&2
    echo "   Free memory first (or use --ignore-low-ram)." >&2
    exit 3
  fi
fi

# ── read-only facts + would-be delta (mode=check never mutates) ───────────────
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "❌ sqlite3 CLI not found (install sqlite3)." >&2
  exit 1
fi

# --check reads through immutable URIs: no -shm/-wal sidecars, no locks taken.
# (If this sqlite3 lacks URI filenames the reads fail loud with INCOMPLETE, never silent.)
RO="sqlite3 -readonly"
RO_URI() { printf 'file:%s?immutable=1' "$1"; }
RO_DB() { RO_URI "$DB_PATH"; }
size_report() { # $1=label $2=page_count $3=page_size $4=freelist
  local label="$1" pages="$2" psz="$3" free="$4" bytes
  bytes=$(( pages * psz ))
  echo "$label: $(numfmt --to=iec "$bytes" 2>/dev/null || echo "$bytes bytes")  (pages=${pages} freelist=${free})"
}

# PRAGMA reads must never masquerade as a real measurement: a failed/empty read
# is disclosed on stderr instead of silently becoming "0 pages".
pragma_read() { # $1=pragma $2=timeout_s $3=fallback
  local out="" rc=0
  out="$(timeout "$2" $RO "$(RO_DB)" "PRAGMA $1;" 2>/dev/null)" || rc=$?
  case "$out" in
    ''|*[!0-9]*)
      echo "⚠️  PRAGMA $1 unavailable (rc=$rc) — size figures below are INCOMPLETE, not zero." >&2
      out="$3"
      ;;
  esac
  printf '%s' "$out"
}

table_count() { # $1=target $2=table → count, 0 when absent, "?" when unreadable
  local target="$1" table="$2" has="" n=""
  has="$(timeout 60 sqlite3 -readonly "$target" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$table';" 2>>"$LOG_FILE")" || { printf '?'; return 0; }
  if [ "$has" != "1" ]; then printf '0'; return 0; fi
  n="$(timeout 300 sqlite3 -readonly "$target" "SELECT count(*) FROM \"$table\";" 2>>"$LOG_FILE")" || { printf '?'; return 0; }
  case "$n" in
    ''|*[!0-9]*) printf '?' ;;
    *) printf '%s' "$n" ;;
  esac
}

table_exists() { # $1=target $2=table → 1|0|?
  local has=""
  has="$(timeout 60 sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$2';" 2>>"$LOG_FILE")" || { printf '?'; return 0; }
  case "$has" in
    0|1) printf '%s' "$has" ;;
    *) printf '?' ;;
  esac
}

protected_fingerprint() {
  local t n out=""
  for t in $PROTECTED_TABLES; do
    n="$(table_count "$DB_PATH" "$t")"
    [ "$n" = "?" ] && return 1
    out="${out}${t}=${n};"
  done
  printf '%s' "$out"
}

event_count() { # $1=target → event rows, 0 when absent, "?" when unreadable
  table_count "$1" event
}

event_present() { # $1=target → 1|0|?
  local has=""
  has="$(timeout 60 sqlite3 -readonly "$1" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='event';" 2>>"$LOG_FILE")" || { printf '?'; return 0; }
  case "$has" in
    0|1) printf '%s' "$has" ;;
    *) printf '?' ;;
  esac
}

event_delete() { # $1=db path
  assert_mutation_target event
  timeout 1800 sqlite3 -cmd ".timeout 60000" "$1" "DELETE FROM event;" 2>>"$LOG_FILE"
}
event_surplus() { # $1=db path $2=keep-N → rows beyond the newest N per aggregate
  case "$2" in
    ''|*[!0-9]*) printf '?' ; return ;;
  esac
  timeout 300 $RO "$(RO_URI "$1")" "
    SELECT count(*) FROM event WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY aggregate_id ORDER BY seq DESC, id DESC) AS rn FROM event
      ) WHERE rn > ${2}
    );" 2>/dev/null
}
event_execute() { # $1=0 dry-run | 1 delete — bounded per P2.9: newest EVENT_KEEP rows per aggregate
  EV_BEFORE="$(event_count "$DB_PATH")"
  case "$EV_BEFORE" in
    "?"|"")
      echo "→ event retention: count unavailable — skipped (fail-closed." >&2
      return 0
      ;;
    0)
      echo "→ event retention: 0 rows."
      return 0
      ;;
  esac
  EV_SURPLUS="$(event_surplus "$DB_PATH" "$EVENT_KEEP")"
  case "$EV_SURPLUS" in
    "?"|"")
      echo "→ event retention: bounded count unavailable — skipped (fail-closed)." >&2
      return 0
      ;;
    0)
      echo "→ event retention: ${EV_BEFORE} rows, all within the newest ${EVENT_KEEP} per aggregate — nothing to delete."
      return 0
      ;;
  esac
  if [ "$1" != 1 ]; then
    echo "→ event retention: would delete ${EV_SURPLUS} of ${EV_BEFORE} rows (keeps the newest ${EVENT_KEEP} per aggregate, P2.9) — dry run only, pass --event-delete to apply."
    return 0
  fi
  if ! timeout 1800 sqlite3 -cmd ".timeout 2500" "$DB_PATH" "
    DELETE FROM event WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY aggregate_id ORDER BY seq DESC, id DESC) AS rn FROM event
      ) WHERE rn > ${EVENT_KEEP}
    );
  " 2>>"$LOG_FILE"; then
    echo "❌ event retention failed (see $LOG_FILE)." >&2
    return 1
  fi
  echo "→ event retention: deleted ${EV_SURPLUS} rows (history stays in message/part)."
  return 0
}

cap_status() {
  local total=""
  total="$(db_total_bytes "$DB_PATH")" || { echo "❌ cannot measure DB+WAL size — refusing (fail-closed)." >&2; return 3; }
  if [ "$total" -ge "$CAP_BYTES" ]; then
    echo "❌ cap remains: ${total} bytes (db+wal) >= ${CAP_BYTES} bytes." >&2
    return 9
  fi
  echo "→ cap: ${total} bytes (db+wal) < ${CAP_BYTES}."
  return 0
}

_GEN_GUARD="$(cd "$(dirname "$0")" && pwd -P)/guard-db-generation.sh"
require_v2_generation() { # rc: 0 proven v2 · 2 refused/missing guard
  local g_rc=0 out=""
  if [ ! -x "$_GEN_GUARD" ]; then
    echo "❌ generation guard missing at $_GEN_GUARD — refusing mutations." >&2
    return 2
  fi
  out="$("$_GEN_GUARD" --db "$DB_PATH" --expect v2 --path-rule warn 2>&1)" || g_rc=$?
  if [ "$g_rc" -ne 0 ]; then
    echo "⛔ mutations skipped: generation guard refused (rc=$g_rc) — $DB_PATH" >&2
    echo "   Prune/event-delete/VACUUM were NOT run: this DB is not proven V2." >&2
    [ -n "$out" ] && printf '%s\n' "$out" >&2
    return 2
  fi
  echo "→ generation guard: ok (V2) — mutations allowed"
  return 0
}

PAGES="$(pragma_read page_count 120 0)"
PAGESIZE="$(pragma_read page_size 30 4096)"
FREELIST="$(pragma_read freelist_count 30 0)"
size_report "before" "$PAGES" "$PAGESIZE" "$FREELIST"

if [ "$MODE" = "check" ]; then
  echo "→ cap: db+wal ${DB_TOTAL_BEFORE} / ${CAP_BYTES} bytes"
  if [ "$PRUNE_DAYS" -gt 0 ]; then
    CUTOFF="$(cutoff_ms "$PRUNE_DAYS")"
    CHK_MESSAGE="$(table_exists "$DB_PATH" message)"
    CHK_V2="$(table_exists "$DB_PATH" session_message)"
    CAND=""
    if [ "$CHK_MESSAGE" = 1 ]; then
      C1="$(timeout 300 $RO "$(RO_DB)" "
        SELECT (SELECT count(*) FROM message
                 WHERE time_updated < $CUTOFF
                   AND session_id NOT IN (SELECT session_id FROM message
                                           WHERE time_updated >= $CUTOFF))
             || ' messages + ' ||
             (SELECT count(*) FROM part
               WHERE message_id IN (SELECT id FROM message
                                    WHERE time_updated < $CUTOFF
                                      AND session_id NOT IN (SELECT session_id FROM message
                                                              WHERE time_updated >= $CUTOFF)))
               || ' parts';" 2>/dev/null || echo "UNKNOWN")"
      CAND="legacy ${C1}"
    fi
    if [ "$CHK_V2" = 1 ]; then
      C2="$(timeout 300 $RO "$(RO_DB)" "
        SELECT count(*) FROM session_message
         WHERE time_updated < $CUTOFF
           AND session_id NOT IN (SELECT session_id FROM session_message
                                   WHERE time_updated >= $CUTOFF);" 2>/dev/null || echo "UNKNOWN")"
      CAND="${CAND}${CAND:+; }v2 ${C2} messages"
    fi
    case "$CHK_MESSAGE$CHK_V2" in
      *\?*) CAND="UNKNOWN (schema probe failed — see stderr)" ;;
    esac
    [ -n "$CAND" ] || CAND="UNKNOWN (no message or session_message table)"
    echo "→ ${PRUNE_DAYS} days cutoff (epoch-ms ${CUTOFF}); dry-run only, nothing modified."
    echo "→ would prune now: ${CAND} (VACUUM reclaims the pages they free)"
  else
    echo "→ pruning disabled (--prune-days 0); dry-run only, nothing modified."
  fi
  EV_ROWS="$(event_count "$(RO_DB)")"
  case "$EV_ROWS" in
    0) echo "→ event retention: 0 rows (no event table or empty)." ;;
    \?) echo "⚠️  event retention: count unavailable — run cannot prove retention (see stderr)." >&2 ;;
    *) echo "→ event retention: ${EV_ROWS} rows; a quiescent run deletes all of them (--event-retention off keeps them)." ;;
  esac
  exit 0
fi

# ── event-only mode: launcher path at the DB cap ─────────────────────────────
# Deletes the previous run's host events and exits — no backup, prune, or VACUUM.
# Requires a proven-quiescent DB (every row predates this run).
if [ "$MODE" = "event" ]; then
  if [ "$EVENT_RETENTION" = "off" ]; then
    echo "→ event retention disabled (--event-retention off) — no events deleted."
    cap_status
    exit 0
  fi
  require_v2_generation || exit 2
  EV_PRESENT="$(event_present "$DB_PATH")"
  case "$EV_PRESENT" in
    0) echo "→ no event table — nothing to delete."; cap_status; exit 0 ;;
    \?) echo "❌ cannot probe the event table (fail-closed) — refusing." >&2; exit 3 ;;
  esac
  if ! command -v fuser >/dev/null 2>&1; then
    echo "❌ fuser not found (util-linux) — cannot prove the DB is quiescent." >&2
    exit 3
  fi
  EV_RC=0
  fuser_holders "$DB_PATH" || EV_RC=$?
  case "$EV_RC" in
    1) echo "❌ fuser unreliable — cannot prove the DB is quiescent (fail-closed)." >&2; exit 3 ;;
    3) echo "❌ DB is in use by another process — event retention only runs pre-launch (close the app first)." >&2; exit 3 ;;
  esac
  EV_BEFORE="$(event_count "$DB_PATH")"
  case "$EV_BEFORE" in
    \?) echo "❌ cannot count event rows (fail-closed) — refusing." >&2; exit 3 ;;
    0) echo "→ event retention: 0 rows."; cap_status; exit 0 ;;
  esac
  if ! event_execute "$EVENT_DELETE_EXPLICIT"; then
    exit 5
  fi
  cap_status
  exit 0
fi

HIST_MESSAGE="?"
HIST_V2="?"
if [ "$PRUNE_DAYS" -gt 0 ] || [ "$TARGET_BYTES" -gt 0 ]; then
  HIST_MESSAGE="$(table_exists "$DB_PATH" message)"
  HIST_V2="$(table_exists "$DB_PATH" session_message)"
  case "$HIST_MESSAGE" in \?) echo "❌ cannot probe the legacy message table (fail-closed)." >&2; exit 3 ;; esac
  case "$HIST_V2" in \?) echo "❌ cannot probe the v2 session_message table (fail-closed)." >&2; exit 3 ;; esac
  if [ "$HIST_MESSAGE" != 1 ] && [ "$HIST_V2" != 1 ]; then
    echo "❌ no known history table (message or session_message) — refusing an unprovable prune." >&2
    exit 3
  fi
  echo "→ history schema: message=$HIST_MESSAGE session_message=$HIST_V2"
fi
PROTECTED_BEFORE=""
if [ "$ALLOW_IN_USE" = 0 ]; then
  PROTECTED_BEFORE="$(protected_fingerprint)" || {
    echo "❌ cannot read protected-table counts — refusing mutations (fail-closed)." >&2
    exit 3
  }
fi

require_v2_generation || exit 2

if [ "$MAX_BYTES" -gt 0 ] && [ "$DB_TOTAL_BEFORE" -lt "$MAX_BYTES" ]; then
  echo "→ db+wal ${DB_TOTAL_BEFORE} below the nothing-to-do gate (--max-bytes ${MAX_BYTES}) — no copy, no rotation (P2.7)."
  size_report "after" "$PAGES" "$PAGESIZE" "$FREELIST"
  exit 0
fi
PRUNE_EFF="$PRUNE_DAYS"
if [ "$TARGET_BYTES" -gt 0 ]; then
  PRUNE_EFF=0
fi
PRUNE_CANDS=0
PRUNE_PROBE_OK=1
if [ "$PRUNE_EFF" -gt 0 ]; then
  PC="$(prune_candidates "$(cutoff_ms "$PRUNE_EFF")")"
  case "$PC" in
    ''|*[!0-9]*) PRUNE_PROBE_OK=0 ;;
    *) PRUNE_CANDS="$PC" ;;
  esac
fi
EV_WORK=0
if [ "$EVENT_RETENTION" = "all" ]; then
  EV_PRESENT="$(event_present "$DB_PATH")"
  case "$EV_PRESENT" in
    1) EV_COUNT="$(event_count "$DB_PATH")"; case "$EV_COUNT" in ''|*[!0-9]*) EV_COUNT=0 ;; esac; [ "$EV_COUNT" -gt 0 ] && EV_WORK=1 ;;
  esac
fi
if [ "$PRUNE_PROBE_OK" = 1 ] && [ "$PRUNE_CANDS" -eq 0 ] && [ "$EV_WORK" = 0 ] && [ "$TARGET_BYTES" -eq 0 ]; then
  echo "→ nothing to do: 0 prune candidates beyond ${PRUNE_EFF}d and no event work — no copy, no rotation (P2.7)."
  exit 0
fi
if [ "$TARGET_BYTES" -gt 0 ] && [ "$PRUNE_DAYS" -eq 0 ]; then
  P3="$(prune_candidates "$(cutoff_ms 3)")"
  case "$P3" in
    ''|*[!0-9]*) echo "❌ floor-window candidate count unavailable — refusing an unprovable solver run." >&2; exit 3 ;;
  esac
  if [ "$P3" -eq 0 ] && [ "$EV_WORK" = 0 ]; then
    echo "→ nothing to do: 0 prune candidates even at the 3d floor and no event work — no copy, no rotation (P2.7)."
    exit 0
  fi
fi

# ── backup (online backup API — consistent even if WAL present) ───────────────
BACKUP_NAME="opencode-$(date +%Y%m%d-%H%M%S).db"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/$BACKUP_NAME"
echo "→ backup → $BACKUP_FILE"
if ! timeout 1800 sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'" 2>>"$LOG_FILE"; then
  echo "❌ backup failed — aborting before any modification (see $LOG_FILE)." >&2
  exit 4
fi
chmod 600 "$BACKUP_FILE"
# The backup is the only safety net: it must verify before anything mutates.
if [ "$(timeout 600 sqlite3 -readonly "$BACKUP_FILE" "PRAGMA quick_check;" 2>>"$LOG_FILE")" != "ok" ]; then
  echo "❌ backup quick_check failed — aborting before any modification (see $LOG_FILE)." >&2
  exit 4
fi
# Source MUST be read WAL-inclusive (plain -readonly): the .backup API copies
# through the WAL, so comparing against an immutable=1 (WAL-blind) source
# count aborts every run on a live DB (proven: source=1 backup=2 → exit 4).
# The backup file itself is static — immutable stays correct there.
# Both session tables are probed: migrated v2 DBs carry session (legacy rows)
# next to session_v2, and a pure-v2 DB has session_v2 only.
SRC_V2="$(table_count "$DB_PATH" session_v2)"
SRC_V1="$(table_count "$DB_PATH" session)"
SRC_SM="$(table_count "$DB_PATH" session_message)"
BKP_V2="$(table_count "$(RO_URI "$BACKUP_FILE")" session_v2)"
BKP_V1="$(table_count "$(RO_URI "$BACKUP_FILE")" session)"
BKP_SM="$(table_count "$(RO_URI "$BACKUP_FILE")" session_message)"
if [ "$SRC_V2" != "$BKP_V2" ] || [ "$SRC_V1" != "$BKP_V1" ] || [ "$SRC_SM" != "$BKP_SM" ] || [ "$SRC_V2" = "?" ] || [ "$SRC_V1" = "?" ] || [ "$SRC_SM" = "?" ]; then
  echo "❌ backup probe mismatch (source session_v2=$SRC_V2 session=$SRC_V1 session_message=$SRC_SM / backup session_v2=$BKP_V2 session=$BKP_V1 session_message=$BKP_SM) — aborting (see $LOG_FILE)." >&2
  exit 4
fi
echo "→ backup verified (quick_check=ok, session_v2=$BKP_V2, session=$BKP_V1, session_message=$BKP_SM)"
if [ "$EXPLICIT_KEEP" = 0 ]; then
  if [ "$DB_TOTAL_BEFORE" -gt 1073741824 ]; then
    KEEP_BACKUPS=2
  else
    KEEP_BACKUPS=5
  fi
  echo "→ keep-backups: ${KEEP_BACKUPS} (size-aware, db+wal ${DB_TOTAL_BEFORE})"
fi
ls -1t "$BACKUP_DIR"/opencode-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f --

# ── prune old messages+parts (sessions untouched) ─────────────────────────────
# foreign_keys=ON is required: the sqlite3 CLI defaults it OFF and part rows
# would survive as orphans (proven). The session join is intentionally absent:
# v2 sessions live in session_v2 and a session-table join skips migrated rows.
# P2.4 shape: bounded batches (3000 rows), busy timeout 2500 ms, short pause —
# every write finishes well under the host's 5000 ms lock waiting time.
if [ "$PRUNE_EFF" -gt 0 ] || [ "$TARGET_BYTES" -gt 0 ]; then
  if [ "$TARGET_BYTES" -eq 0 ]; then
    PICK="$PRUNE_DAYS"
  else
    NEED=$(( DB_TOTAL_BEFORE - TARGET_BYTES ))
    if [ "$NEED" -le 0 ]; then
      echo "→ db+wal ${DB_TOTAL_BEFORE} already at or below the ${TARGET_BYTES}-byte target — nothing to prune."
      size_report "after" "$(pragma_read page_count 120 0)" "$PAGESIZE" "$(pragma_read freelist_count 30 0)"
      exit 0
    fi
    PICK=""
    EST=0
    for W in 90 45 21 7 3; do
      EST="$(prune_candidate_bytes "$(cutoff_ms "$W")")"
      case "$EST" in
        ''|*[!0-9]*) echo "❌ window estimate unavailable at ${W}d — refusing an unprovable solver run." >&2; exit 3 ;;
      esac
      if [ "$EST" -ge "$NEED" ]; then PICK="$W"; break; fi
    done
    if [ -n "$PICK" ]; then
      echo "→ window ladder picked ${PICK}d: candidates hold ~${EST} bytes of the ${NEED} needed to reach the target"
    else
      PICK=3
      SHORT=$(( NEED - EST ))
      echo "→ window ladder could not reach the target: the 3d floor holds ~${EST} bytes against ${NEED} — short by ${SHORT} (in-session rung is a later plan step)"
    fi
  fi
  CUTOFF="$(cutoff_ms "$PICK")"
  echo "→ prune: messages/parts older than ${PICK} days (cutoff epoch-ms $CUTOFF), batches of ${PRUNE_BATCH} rows, busy_timeout 2500ms"
  ROWS_TOTAL=0
  if [ "$HIST_MESSAGE" = 1 ]; then
    PRUNE_OUT="$(batched_prune message)" || PRUNE_RC=$?
    case "${PRUNE_RC:-0}" in
      6) printf '%s\n' "$PRUNE_OUT"; size_report "after" "$(pragma_read page_count 120 0)" "$PAGESIZE" "$(pragma_read freelist_count 30 0)"; exit 6 ;;
      *) ROWS_TOTAL=$(( ROWS_TOTAL + PRUNE_OUT )) ;;
    esac
    PRUNE_RC=0
  fi
  if [ "$HIST_V2" = 1 ]; then
    PRUNE_OUT="$(batched_prune session_message)" || PRUNE_RC=$?
    case "${PRUNE_RC:-0}" in
      6) printf '%s\n' "$PRUNE_OUT"; size_report "after" "$(pragma_read page_count 120 0)" "$PAGESIZE" "$(pragma_read freelist_count 30 0)"; exit 6 ;;
      *) ROWS_TOTAL=$(( ROWS_TOTAL + PRUNE_OUT )) ;;
    esac
    PRUNE_RC=0
  fi
  echo "→ prune: deleted ${ROWS_TOTAL} rows total (1.47 ms/row measured — F29), history tables only, sessions untouched"
fi

# ── host event retention (S-040) ──────────────────────────────────────────────
# Only when the DB is proven quiescent: every event row belongs to a previous
# run, while session history stays in message/part. A live run skips this (the
# launcher lane prunes before exec); deleting mid-run can starve the host.
if [ "$EVENT_RETENTION" = "all" ]; then
  EV_PRESENT="$(event_present "$DB_PATH")"
  case "$EV_PRESENT" in
    0) echo "→ event retention: no event table — skipped." ;;
    \?) echo "→ event retention: table probe unavailable — skipped (fail-closed)." >&2 ;;
    1)
      EV_BEFORE="$(event_count "$DB_PATH")"
      case "$EV_BEFORE" in
        \?)
          echo "→ event retention: count unavailable — skipped (fail-closed)." >&2
          ;;
        0)
          echo "→ event retention: 0 rows."
          ;;
        *)
          EV_LIVE=1
          EV_RC=0
          if command -v fuser >/dev/null 2>&1; then
            fuser_holders "$DB_PATH" || EV_RC=$?
            [ "$EV_RC" = 0 ] && EV_LIVE=0
          fi
          if [ "$EV_LIVE" = 0 ]; then
            if event_execute "$EVENT_DELETE_EXPLICIT"; then
              :
            else
              echo "❌ event retention failed (see $LOG_FILE)." >&2
              exit 5
            fi
          else
            echo "→ event retention: skipped — DB is in use or quiescence is unprovable (the launcher prunes pre-exec)." >&2
          fi
          ;;
      esac
      ;;
  esac
fi

if [ "$ALLOW_IN_USE" = 0 ]; then
  PROTECTED_AFTER="$(protected_fingerprint)" || {
    echo "❌ cannot re-read protected-table counts after mutation — restoring is required (fail-closed)." >&2
    echo "   Verified backup: $BACKUP_FILE" >&2
    exit 9
  }
  if [ "$PROTECTED_AFTER" != "$PROTECTED_BEFORE" ]; then
    echo "❌ protected tables changed during maintenance — aborting before VACUUM." >&2
    echo "   before: $PROTECTED_BEFORE" >&2
    echo "   after:  $PROTECTED_AFTER" >&2
    echo "   Verified backup: $BACKUP_FILE" >&2
    exit 9
  fi
  echo "→ protected tables unchanged"
fi

# ── vacuum: reclaim every freed page ──────────────────────────────────────────
# P2.5/P2 item 5 shape, corrected: wal_checkpoint(TRUNCATE) FIRST (the swap and
# any in-place VACUUM then see a zeroed WAL), the F27 space gate (free space
# ≥ db+wal + 1 GiB headroom, TAWASSUL_VACUUM_MIN_FREE overridable for trials),
# and where sqlite3 offers VACUUM INTO (3.27+) the reclaim writes a rebuilt
# file and swap-renames it atomically instead of rewriting in place. Failure
# of the swap lane falls back to the in-place VACUUM; the prune never shares
# a step with the reclaim (separate statements above).
sqlite_version_ge() { # sqlite3 ≥ $1 → 0
  local v
  v="$(sqlite3 --version 2>/dev/null | awk 'NR==1 {print $1}')"
  case "$v" in ''|*[!0-9.]*) return 1 ;; esac
  printf '%s' "$v" | awk -F. -v want="$1" 'BEGIN{split(want,w,".")}
    {for(i=1;i<=3;i++){a=$i+0;b=w[i]+0;if(a>b)exit 0;if(a<b)exit 1};exit 0}'
}
VACUUM_SKIPPED=0
if command -v fuser >/dev/null 2>&1; then
  VH_RC=0
  fuser_holders "$DB_PATH" || VH_RC=$?
  case "$VH_RC" in
    1) echo "→ VACUUM skipped: fuser unreliable — cannot prove quiescence (fail-closed)." >&2; VACUUM_SKIPPED=1 ;;
    3) echo "→ VACUUM skipped: DB is in use (needs an exclusive lock) — backup+prune done, rerun offline for the shrink." >&2; VACUUM_SKIPPED=1 ;;
  esac
else
  echo "→ VACUUM skipped: fuser missing, cannot prove the DB is quiescent — rerun with util-linux installed." >&2
  VACUUM_SKIPPED=1
fi
if [ "$VACUUM_SKIPPED" = 0 ]; then
  VACUUM_HEADROOM="${TAWASSUL_VACUUM_MIN_FREE:-1073741824}"
  AVAIL_BYTES="$(tawassul_avail_bytes "$DB_DIR")" || AVAIL_BYTES=""
  case "$AVAIL_BYTES" in
    ''|*[!0-9]*)
      echo "❌ cannot determine free space in $DB_DIR — refusing VACUUM." >&2
      exit 7
      ;;
  esac
  VACUUM_NEED=$(( DB_TOTAL_BEFORE + VACUUM_HEADROOM ))
  if [ "$AVAIL_BYTES" -lt "$VACUUM_NEED" ]; then
    echo "❌ free space in $DB_DIR (${AVAIL_BYTES} bytes) < db+wal+1GiB gate (${VACUUM_NEED} bytes)." >&2
    echo "   VACUUM needs room for a second copy (F27) — free space first (or skip it)." >&2
    exit 7
  fi
  CKT="$(timeout 60 sqlite3 -cmd '.timeout 2500' "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" 2>>"$LOG_FILE" || true)"
  case "$CKT" in
    -1*|1*) echo "→ wal_checkpoint(TRUNCATE) busy (${CKT}) — PASSIVE fallback" ;;
    *) echo "→ wal_checkpoint TRUNCATE ok (${CKT:-0|0|0})" ;;
  esac
  if sqlite_version_ge "3.27.0"; then
    TMP="${DB_PATH}.vacuum-swap.$$"
    SRC_MODE="$(sqlite3 -readonly "$DB_PATH" "PRAGMA journal_mode;" 2>/dev/null)"
    if timeout 3600 sqlite3 -cmd '.timeout 2500' "$DB_PATH" "VACUUM INTO '$TMP';" 2>>"$LOG_FILE" \
      && [ "$(sqlite3 -readonly "$TMP" "PRAGMA quick_check;" 2>>"$LOG_FILE")" = "ok" ]; then
      [ "$SRC_MODE" = "wal" ] && sqlite3 "$TMP" "PRAGMA journal_mode=wal;" >/dev/null 2>>"$LOG_FILE" || true
      chmod "$(tawassul_file_mode "$DB_PATH" 2>/dev/null || printf 644)" "$TMP" 2>/dev/null || true
      if mv -f "$TMP" "$DB_PATH" 2>>"$LOG_FILE"; then
        rm -f "${DB_PATH}-wal" "${DB_PATH}-shm" 2>/dev/null || true
        echo "→ vacuum into-swap: rebuilt file verified (quick_check=ok) and swapped atomically; stale -wal/-shm cleared"
        VACUUM_DONE=1
      else
        echo "⚠️  vacuum swap rename failed — original untouched; retrying in place" >&2
        rm -f "$TMP" 2>/dev/null || true
      fi
    else
      echo "⚠️  vacuum into-swap failed (see $LOG_FILE) — falling back to in-place VACUUM" >&2
      rm -f "$TMP" 2>/dev/null || true
    fi
  else
    echo "→ sqlite3 is older than 3.27.0 — VACUUM INTO unavailable, in-place VACUUM"
  fi
  if [ "${VACUUM_DONE:-0}" != 1 ]; then
    echo "→ vacuum (this is the actual shrink step — can take a while)…"
    timeout 3600 sqlite3 -cmd ".timeout 60000" "$DB_PATH" "VACUUM;" 2>>"$LOG_FILE" || {
      echo "❌ VACUUM failed — DB unchanged beyond the prune; safe to rerun (see $LOG_FILE)." >&2
      exit 6
    }
  fi
fi

# ── report ────────────────────────────────────────────────────────────────────
PAGES_A="$(pragma_read page_count 120 0)"
PAGESIZE_A="$(pragma_read page_size 30 4096)"
FREELIST_A="$(pragma_read freelist_count 30 0)"
DB_SIZE_AFTER="$(tawassul_file_bytes "$DB_PATH")" || {
  echo "❌ cannot measure DB size after maintenance — verify manually." >&2
  exit 9
}
DB_TOTAL_AFTER="$(db_total_bytes "$DB_PATH")" || {
  echo "❌ cannot measure DB+WAL after maintenance — verify manually." >&2
  exit 9
}
size_report "after " "$PAGES_A" "$PAGESIZE_A" "$FREELIST_A"
echo "→ Δ file: before $(numfmt --to=iec "$DB_SIZE_BEFORE" 2>/dev/null || echo "$DB_SIZE_BEFORE") → after $(numfmt --to=iec "$DB_SIZE_AFTER" 2>/dev/null || echo "$DB_SIZE_AFTER")"
echo "→ Δ total: before $(numfmt --to=iec "$DB_TOTAL_BEFORE" 2>/dev/null || echo "$DB_TOTAL_BEFORE") → after $(numfmt --to=iec "$DB_TOTAL_AFTER" 2>/dev/null || echo "$DB_TOTAL_AFTER")"
EV_AFTER="$(event_count "$DB_PATH")"
case "$EV_AFTER" in
  \?) echo "→ event rows after: unavailable" ;;
  *) echo "→ event rows after: $EV_AFTER" ;;
esac
echo "✓ done. Backup: $BACKUP_FILE"
if [ "${VACUUM_SKIPPED:-0}" = 1 ]; then
  echo "→ note: VACUUM was skipped (DB in use or unverifiable) — file not shrunk; rerun offline."
fi
if [ "$DB_TOTAL_AFTER" -ge "$CAP_BYTES" ]; then
  echo "⛔ cap remains after maintenance: ${DB_TOTAL_AFTER} >= ${CAP_BYTES} bytes (db+wal)." >&2
  exit 9
fi