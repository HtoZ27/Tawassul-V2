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

# ── option parsing ────────────────────────────────────────────────────────────
DB_PATH=""
PRUNE_DAYS=90
BACKUP_DIR="${HOME}/.local/share/tawassul-v2/backups"
KEEP_BACKUPS=5
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
    --prune-days) PRUNE_DAYS="${2:?--prune-days needs a number}"; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:?--backup-dir needs a path}"; shift 2 ;;
    --keep-backups) KEEP_BACKUPS="${2:?--keep-backups needs a number}"; shift 2 ;;
    --check) MODE="check"; shift ;;
    --event-only) MODE="event"; shift ;;
    --cap-bytes) CAP_BYTES="${2:?--cap-bytes needs a number}"; shift 2 ;;
    --plan) MODE="plan"; shift ;;
    --event-retention) EVENT_RETENTION="${2:?--event-retention needs all|off}"; shift 2 ;;
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
if [ "$KEEP_BACKUPS" -lt 1 ]; then
  echo "❌ --keep-backups must be >= 1 (0 would rotate away every backup)" >&2
  exit 2
fi
case "$EVENT_RETENTION" in
  all|off) ;;
  *) echo "❌ --event-retention must be all|off (got: $EVENT_RETENTION)" >&2; exit 2 ;;
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
db_total_bytes() { # $1=db → main + WAL bytes, non-zero exit when unreadable
  local total=0 f n
  for f in "$1" "$1-wal"; do
    [ -e "$f" ] || continue
    n="$(stat -c %s "$f" 2>/dev/null || stat -f %z "$f" 2>/dev/null || true)"
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
    if [ "$ALLOW_ARCHIVE" != 1 ]; then
      echo "❌ refusing: $DB_PATH looks like a legacy archive — pass --allow-archive to touch it deliberately." >&2
      exit 2
    fi
    if [ -t 0 ]; then
      printf 'Archive target %s — type YES to continue: ' "$DB_PATH" >&2
      read -r REPLY 2>/dev/null || REPLY=""
      if [ "$REPLY" != "YES" ]; then echo "❌ archive CONFIRM not given — aborting." >&2; exit 2; fi
    else
      echo "❌ archive target needs an interactive CONFIRM (no tty) — aborting." >&2
      exit 2
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
DB_SIZE_BEFORE="$(stat -c %s "$DB_PATH")"
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
fuser_holders() { # $1=db → holders on stdout
  local _db="$1" _err="" _out="" _rc=0
  _err="$(mktemp 2>/dev/null)" || return 1
  _out="$(fuser "$_db" 2>"$_err")" || _rc=$?
  if [ -s "$_err" ] || [ "$_rc" -ge 2 ]; then _rc=1; else _rc=0; fi
  rm -f "$_err" 2>/dev/null || true
  printf '%s' "$_out"
  return "$_rc"
}
if [ "$MODE" != "check" ] && [ "$ALLOW_IN_USE" = 0 ]; then
  # A missing `fuser` must never read as "nobody holds the DB" (fail-closed).
  if ! command -v fuser >/dev/null 2>&1; then
    echo "❌ fuser not found (util-linux) — cannot verify that no process holds the DB." >&2
    echo "   Install util-linux, or re-run with --allow-in-use if you are certain it is offline." >&2
    exit 3
  fi
  HOLDERS=""
  if ! HOLDERS="$(fuser_holders "$DB_PATH")"; then
    echo "❌ fuser unreliable — cannot prove the DB is quiescent (fail-closed)." >&2
    exit 3
  fi
  if [ -n "$HOLDERS" ]; then
    echo "❌ DB is in use by process(es): $(printf '%s' "$HOLDERS" | tail -c 60)" >&2
    echo "   Close the Desktop app first (or use --allow-in-use for backup+prune; VACUUM stays offline-only)." >&2
    exit 3
  fi
fi
if [ "$IGNORE_LOW_RAM" = 0 ]; then
  # RULES.md: never run heavy ops below 1.5GB free RAM. An unreadable or
  # unparsable reading refuses too (fail-closed) — it must never read as "plenty".
  MEM_AVAIL="$(free -m 2>/dev/null | awk '/^Mem:/ {print $7}')" || MEM_AVAIL=""
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
  out="$("$_GEN_GUARD" --db "$DB_PATH" --expect v2 2>&1)" || g_rc=$?
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
    CUTOFF="$(date -d "now -${PRUNE_DAYS} days" +%s)"
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
    echo "→ ${PRUNE_DAYS} days cutoff (epoch ${CUTOFF}); dry-run only, nothing modified."
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
  EV_PRESENT="$(event_present "$DB_PATH")"
  case "$EV_PRESENT" in
    0) echo "→ no event table — nothing to delete."; cap_status; exit 0 ;;
    \?) echo "❌ cannot probe the event table (fail-closed) — refusing." >&2; exit 3 ;;
  esac
  if ! command -v fuser >/dev/null 2>&1; then
    echo "❌ fuser not found (util-linux) — cannot prove the DB is quiescent." >&2
    exit 3
  fi
  EV_HOLDERS=""
  if ! EV_HOLDERS="$(fuser_holders "$DB_PATH")"; then
    echo "❌ fuser unreliable — cannot prove the DB is quiescent (fail-closed)." >&2
    exit 3
  fi
  if [ -n "$EV_HOLDERS" ]; then
    echo "❌ DB is in use by process(es): $(printf '%s' "$EV_HOLDERS" | tail -c 60)" >&2
    echo "   Event retention only runs pre-launch (close the app first)." >&2
    exit 3
  fi
  require_v2_generation || exit 2
  EV_BEFORE="$(event_count "$DB_PATH")"
  case "$EV_BEFORE" in
    \?) echo "❌ cannot count event rows (fail-closed) — refusing." >&2; exit 3 ;;
    0) echo "→ event retention: 0 rows."; cap_status; exit 0 ;;
  esac
  if ! event_delete "$DB_PATH"; then
    echo "❌ event retention failed (see $LOG_FILE)." >&2
    exit 5
  fi
  echo "→ event retention: deleted ${EV_BEFORE} rows (history stays in message/part)."
  cap_status
  exit 0
fi

HIST_MESSAGE="?"
HIST_V2="?"
if [ "$PRUNE_DAYS" -gt 0 ]; then
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
ls -1t "$BACKUP_DIR"/opencode-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f --

# ── prune old messages+parts (sessions untouched) ─────────────────────────────
if [ "$PRUNE_DAYS" -gt 0 ]; then
  CUTOFF="$(date -d "now -${PRUNE_DAYS} days" +%s)"
  echo "→ prune: messages/parts older than ${PRUNE_DAYS} days (cutoff $CUTOFF)"
  # foreign_keys=ON is REQUIRED: the sqlite3 CLI defaults it OFF, and without it
  # the part rows that ON DELETE CASCADE should remove survive as orphans
  # (proven: 4 parts survived a 2-message prune until this pragma was added).
  # The session join is intentionally absent: v2 sessions live in session_v2,
  # and a session table join skipped every migrated message.
  if [ "$HIST_MESSAGE" = 1 ]; then
    assert_mutation_target message
    timeout 1800 sqlite3 -cmd ".timeout 60000" "$DB_PATH" "
      PRAGMA foreign_keys = ON;
      DELETE FROM message
       WHERE time_updated < $CUTOFF
         AND session_id NOT IN (
           SELECT session_id FROM message WHERE time_updated >= $CUTOFF
         );
    " 2>>"$LOG_FILE" || { echo "❌ legacy message prune failed (see $LOG_FILE; retry offline or with --allow-in-use)." >&2; exit 5; }
  fi
  if [ "$HIST_V2" = 1 ]; then
    assert_mutation_target session_message
    timeout 1800 sqlite3 -cmd ".timeout 60000" "$DB_PATH" "
      PRAGMA foreign_keys = ON;
      DELETE FROM session_message
       WHERE time_updated < $CUTOFF
         AND session_id NOT IN (
           SELECT session_id FROM session_message WHERE time_updated >= $CUTOFF
         );
    " 2>>"$LOG_FILE" || { echo "❌ v2 session_message prune failed (see $LOG_FILE; retry offline or with --allow-in-use)." >&2; exit 5; }
  fi
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
          if command -v fuser >/dev/null 2>&1 && EV_HOLDERS="$(fuser_holders "$DB_PATH")"; then
            [ -z "$EV_HOLDERS" ] && EV_LIVE=0
          fi
          if [ "$EV_LIVE" = 0 ]; then
            if event_delete "$DB_PATH"; then
              echo "→ event retention: deleted ${EV_BEFORE} rows (history stays in message/part)."
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
# VACUUM needs room for a full copy of the DB while it runs; refuse rather than
# fill the disk and abort halfway. An unreadable df refuses too (fail-closed).
# df -B1 reports exact bytes (df -P's "512B blocks" is 2x wrong on BSD/macOS).
AVAIL_BYTES="$(df -B1 --output=avail "$DB_DIR" 2>/dev/null | awk 'NR==2 {print $1}')"
case "$AVAIL_BYTES" in
  ''|*[!0-9]*)
    echo "❌ cannot determine free space in $DB_DIR — refusing VACUUM." >&2
    exit 7
    ;;
esac
if [ "$AVAIL_BYTES" -lt "$DB_SIZE_BEFORE" ]; then
  echo "❌ free space in $DB_DIR (${AVAIL_BYTES} bytes) < DB size (${DB_SIZE_BEFORE} bytes)." >&2
  echo "   VACUUM needs room for a second copy — free space first (or skip it)." >&2
  exit 7
fi
# Live VACUUM is forbidden under every flag: re-check holders HERE, because the
# earlier gate may have been bypassed with --allow-in-use for backup+prune.
VACUUM_SKIPPED=0
if command -v fuser >/dev/null 2>&1; then
  VHOLDERS=""
  if ! VHOLDERS="$(fuser_holders "$DB_PATH")"; then
    echo "→ VACUUM skipped: fuser unreliable — cannot prove quiescence (fail-closed)." >&2
    VACUUM_SKIPPED=1
  elif [ -n "$VHOLDERS" ]; then
    echo "→ VACUUM skipped: DB is in use (needs an exclusive lock) — backup+prune done, rerun offline for the shrink." >&2
    VACUUM_SKIPPED=1
  fi
else
  echo "→ VACUUM skipped: fuser missing, cannot prove the DB is quiescent — rerun with util-linux installed." >&2
  VACUUM_SKIPPED=1
fi
if [ "$VACUUM_SKIPPED" = 0 ]; then
  echo "→ vacuum (this is the actual shrink step — can take a while)…"
  timeout 3600 sqlite3 -cmd ".timeout 60000" "$DB_PATH" "VACUUM;" 2>>"$LOG_FILE" || {
    echo "❌ VACUUM failed — DB unchanged beyond the prune; safe to rerun (see $LOG_FILE)." >&2
    exit 6
  }
fi

# ── report ────────────────────────────────────────────────────────────────────
PAGES_A="$(pragma_read page_count 120 0)"
PAGESIZE_A="$(pragma_read page_size 30 4096)"
FREELIST_A="$(pragma_read freelist_count 30 0)"
DB_SIZE_AFTER="$(stat -c %s "$DB_PATH")"
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