#!/usr/bin/env bash
# opencode-db-maintenance.sh — V2 LOCAL COPY (vendored from tawassyl
# scripts/opencode-db-maintenance.sh @ 29a4f809; V2 defaults point at the
# tawassul-v2 profile so V2 never touches a V1 path by default).
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
#   3. PRUNE old messages+parts (FK-cascade deletes parts; sessions are NEVER
#      deleted — other tables reference them). Offset is wall-clock, messages
#      touching fresh sessions are kept, so active work is never emptied.
#   4. VACUUM — rebuilds the file, reclaims every freed page (the actual shrink).
#      Runs ONLY when no process holds the DB (re-checked here); otherwise it is
#      skipped with a notice — live VACUUM is forbidden under every flag.
#   5. REPORT before/after sizes. Exit non-zero on any safety refusal.
#
# The legacy archive ~/.local/share/opencode/opencode.db is NEVER an implicit
# target: selecting it requires --allow-archive plus an interactive CONFIRM.
#
# Usage:
#   opencode-db-maintenance.sh [--db PATH] [--prune-days N] [--backup-dir DIR]
#                              [--keep-backups N] [--check] [--force]
#                              [--allow-in-use] [--ignore-low-ram]
#                              [--allow-archive]
#
# Defaults:
#   --db          WINCOMING order: OPENCODE_DB env → ~/.local/share/tawassul-v2/
#                 opencode-v2.db (the isolated V2 working DB). You can also pass --db.
#                 (OPENCODE_DB set-but-missing fails closed; archive needs
#                 --allow-archive + CONFIRM.)
#   --prune-days  90 (0 disables pruning entirely — backup+VACUUM only)
#   --backup-dir  ~/.local/share/tawassul-v2/backups
#   --keep-backups 5 (minimum 1 — 0 would rotate away every backup)
#   --check       read-only: report sizes (+ prune/vacuum would-be deltas) and
#                 exit 0 — never touches the DB (immutable reads; the in-use
#                 refusal does not apply, the RAM floor still does).
#   --force       DEPRECATED: equals --allow-in-use --ignore-low-ram.
#                 Still never authorizes a live VACUUM (always skipped).

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
COOLDOWN_MARK_TO_CLEAR=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --db) DB_PATH="${2:?--db needs a path}"; shift 2 ;;
    --cooldown-mark) COOLDOWN_MARK_TO_CLEAR="${2:?--cooldown-mark needs a path}"; shift 2 ;;
    --prune-days) PRUNE_DAYS="${2:?--prune-days needs a number}"; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:?--backup-dir needs a path}"; shift 2 ;;
    --keep-backups) KEEP_BACKUPS="${2:?--keep-backups needs a number}"; shift 2 ;;
    --check) MODE="check"; shift ;;
    --allow-in-use) ALLOW_IN_USE=1; shift ;;
    --ignore-low-ram) IGNORE_LOW_RAM=1; shift ;;
    --allow-archive) ALLOW_ARCHIVE=1; shift ;;
    --force) ALLOW_IN_USE=1; IGNORE_LOW_RAM=1; FORCE_WARN=1; shift ;; # --force: deprecated alias for both
    --help|-h)
      sed -n '1,45p' "$0"; exit 0 ;;
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
  elif [ -f "${HOME}/.local/share/tawassul-v2/opencode-v2.db" ]; then
    DB_PATH="${HOME}/.local/share/tawassul-v2/opencode-v2.db"
  else
    DB_PATH="${HOME}/.local/share/tawassul-v2/opencode-v2.db"
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
echo "→ target: $DB_PATH  ($(numfmt --to=iec "$DB_SIZE_BEFORE" 2>/dev/null || echo "$DB_SIZE_BEFORE bytes"))"
# Growth alarm (alarm only — enforcement lives in the launchers, which refuse
# to start on a DB at/over the 4GiB stop-for-maintenance cap):
# 3GiB warning, 4GiB cap-reached notice.
if [ "$DB_SIZE_BEFORE" -ge 4294967296 ]; then
  echo "⛔ target reached the 4GiB cap — launchers trigger background maintenance and keep launching (rerun offline for the shrink)." >&2
elif [ "$DB_SIZE_BEFORE" -ge 3221225472 ]; then
  echo "⚠️  target exceeds 3GiB — approaching the 4GiB stop-for-maintenance cap." >&2
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

PAGES="$(pragma_read page_count 120 0)"
PAGESIZE="$(pragma_read page_size 30 4096)"
FREELIST="$(pragma_read freelist_count 30 0)"
size_report "before" "$PAGES" "$PAGESIZE" "$FREELIST"

if [ "$MODE" = "check" ]; then
  if [ "$PRUNE_DAYS" -gt 0 ]; then
    CUTOFF="$(date -d "now -${PRUNE_DAYS} days" +%s)"
    # Would-be delta, MEASURED (the header promises it): messages whose whole
    # session is older than the cutoff, plus the part rows riding on them.
    CAND="$(timeout 300 $RO "$(RO_DB)" "
      SELECT (SELECT count(*) FROM message
               WHERE time_updated < $CUTOFF
                 AND session_id IN (SELECT id FROM session
                                     WHERE id NOT IN (SELECT session_id FROM message
                                                       WHERE time_updated >= $CUTOFF)))
           || ' messages + ' ||
           (SELECT count(*) FROM part
             WHERE message_id IN (SELECT id FROM message
                                  WHERE time_updated < $CUTOFF
                                    AND session_id IN (SELECT id FROM session
                                                        WHERE id NOT IN (SELECT session_id FROM message
                                                                          WHERE time_updated >= $CUTOFF))))
             || ' parts';" 2>/dev/null || echo "UNKNOWN (count query failed — see stderr)")"
    echo "→ ${PRUNE_DAYS} days cutoff (epoch ${CUTOFF}); dry-run only, nothing modified."
    echo "→ would prune now: ${CAND} (VACUUM reclaims the pages they free)"
  else
    echo "→ pruning disabled (--prune-days 0); dry-run only, nothing modified."
  fi
  exit 0
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
SRC_SESSIONS="$(timeout 300 sqlite3 -readonly "$DB_PATH" "SELECT count(*) FROM session;" 2>>"$LOG_FILE" || echo "?")"
BKP_SESSIONS="$(timeout 300 sqlite3 -readonly "$(RO_URI "$BACKUP_FILE")" "SELECT count(*) FROM session;" 2>>"$LOG_FILE" || echo "?")"
if [ "$SRC_SESSIONS" != "$BKP_SESSIONS" ]; then
  echo "❌ backup session probe mismatch (source=$SRC_SESSIONS backup=$BKP_SESSIONS) — aborting (see $LOG_FILE)." >&2
  exit 4
fi
echo "→ backup verified (quick_check=ok, sessions=$BKP_SESSIONS)"
ls -1t "$BACKUP_DIR"/opencode-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f --

_GEN_GUARD="$(cd "$(dirname "$0")" && pwd -P)/guard-db-generation.sh"
if [ ! -x "$_GEN_GUARD" ]; then
  echo "❌ generation guard missing at $_GEN_GUARD — refusing mutations (backup is complete)." >&2
  exit 2
fi
_grc=0; _gout=""
_gout="$("$_GEN_GUARD" --db "$DB_PATH" --expect v2 2>&1)" || _grc=$?
if [ "$_grc" -ne 0 ]; then
  echo "⛔ mutations skipped: generation guard refused (rc=$_grc) — $DB_PATH" >&2
  echo "   The verified backup above is kept. Prune/VACUUM were NOT run: this DB is not proven V2." >&2
  exit 2
fi
echo "→ generation guard: ok (V2) — mutations allowed"

# ── prune old messages+parts (sessions untouched) ─────────────────────────────
if [ "$PRUNE_DAYS" -gt 0 ]; then
  CUTOFF="$(date -d "now -${PRUNE_DAYS} days" +%s)"
  echo "→ prune: messages/parts older than ${PRUNE_DAYS} days (cutoff $CUTOFF)"
  # foreign_keys=ON is REQUIRED: the sqlite3 CLI defaults it OFF, and without it
  # the part rows that ON DELETE CASCADE should remove survive as orphans
  # (proven: 4 parts survived a 2-message prune until this pragma was added).
  timeout 1800 sqlite3 "$DB_PATH" "
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 60000;
    DELETE FROM message
     WHERE time_updated < $CUTOFF
       AND session_id IN (
         SELECT id FROM session WHERE id NOT IN (
           SELECT session_id FROM message WHERE time_updated >= $CUTOFF
         )
       );
  " 2>>"$LOG_FILE" || { echo "❌ prune failed (see $LOG_FILE; retry offline or with --allow-in-use)." >&2; exit 5; }
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
  timeout 3600 sqlite3 "$DB_PATH" "PRAGMA busy_timeout = 60000; VACUUM;" 2>>"$LOG_FILE" || {
    echo "❌ VACUUM failed — DB unchanged beyond the prune; safe to rerun (see $LOG_FILE)." >&2
    exit 6
  }
fi

# ── report ────────────────────────────────────────────────────────────────────
PAGES_A="$(pragma_read page_count 120 0)"
PAGESIZE_A="$(pragma_read page_size 30 4096)"
FREELIST_A="$(pragma_read freelist_count 30 0)"
DB_SIZE_AFTER="$(stat -c %s "$DB_PATH")"
size_report "after " "$PAGES_A" "$PAGESIZE_A" "$FREELIST_A"
echo "→ Δ file: before $(numfmt --to=iec "$DB_SIZE_BEFORE" 2>/dev/null || echo "$DB_SIZE_BEFORE") → after $(numfmt --to=iec "$DB_SIZE_AFTER" 2>/dev/null || echo "$DB_SIZE_AFTER")"
echo "✓ done. Backup: $BACKUP_FILE"
if [ "${VACUUM_SKIPPED:-0}" = 1 ]; then
  echo "→ note: VACUUM was skipped (DB in use or unverifiable) — file not shrunk; rerun offline."
fi