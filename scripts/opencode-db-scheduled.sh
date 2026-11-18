#!/usr/bin/env bash
set -euo pipefail
# scheduled lane (P2) — one invocation escalates through the rungs:
#   wal rung: WAL above 64 MiB -> wal_checkpoint(TRUNCATE), PASSIVE fallback
#   in-use rung: db+wal at/above the soft limit -> bounded backup+prune while held
#   quiescent rung: db+wal at/above the cap AND fuser-quiet -> full maintenance
# --check prints the ladder decision and exits 0; --run is the default action.
H="$(cd "$(dirname "$0")" && pwd -P)"
. "$H/db-env.sh"

MODE="run"
case "${1:-run}" in
  --check) MODE="check" ;;
  --run) MODE="run" ;;
  --help|-h)
    sed -n '2,8p' "$0"
    exit 0
    ;;
  *) echo "unknown option: $1 (use --check or --run)" >&2; exit 2 ;;
esac

SKIPPED=0
LOCK_OWNED=0
GAP_SECONDS="${TAWASSUL_DB_GAP_SECONDS:-}"
if [ -n "$GAP_SECONDS" ]; then
  case "$GAP_SECONDS" in
    *[!0-9]*) echo "TAWASSUL_DB_GAP_SECONDS is not a non-negative integer; using the marker value" >&2; GAP_SECONDS="" ;;
  esac
fi
if [ -z "$GAP_SECONDS" ]; then
  GAP_SECONDS="$(sed -n 's/.*"gapSeconds"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$H/MAINTENANCE" 2>/dev/null | head -n 1 || true)"
fi
GAP_SECONDS="${GAP_SECONDS:-86400}"
case "$GAP_SECONDS" in
  ''|*[!0-9]*) GAP_SECONDS=86400 ;;
esac

LOG_DIR="$(tawassul_backup_dir)"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG="$LOG_DIR/opencode-db-scheduled.log"
if [ -e "$LOG" ] && [ "$(tawassul_file_bytes "$LOG")" -gt 5242880 ]; then
  mv -f "$LOG.2" "$LOG.3" 2>/dev/null || true
  mv -f "$LOG.1" "$LOG.2" 2>/dev/null || true
  mv -f "$LOG" "$LOG.1" 2>/dev/null || true
fi

log() {
  printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"
  if [ "$MODE" = "check" ]; then
    printf '%s %s\n' "$(date '+%F %T')" "$*"
  fi
}

STAMP_DIR="$(printf '%s/tawassul-v2/db-maintenance' "$(xdg_data_home)")"
STAMP_FILE="$STAMP_DIR/last-run.stamp"

lock_pid_alive() {
  pid_file="$1/pid"
  [ -f "$pid_file" ] || return 2
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  case "$pid" in
    ''|*[!0-9]*) return 2 ;;
  esac
  [ "$pid" -gt 0 ] || return 2
  if kill -0 "$pid" 2>/dev/null; then return 0; fi
  return 1
}

reclaim_stale() {
  mutex="$1"
  pid="$(cat "$mutex/pid" 2>/dev/null || true)"
  at="$(cat "$mutex/at" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*) pid="" ;; esac
  case "$at" in ''|*[!0-9]*) at="" ;; esac
  now="$(date +%s)"
  if [ -n "$pid" ]; then
    if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
    if [ -n "$at" ] && [ $(( now - at )) -gt 120 ]; then return 0; fi
    return 1
  fi
  if [ -n "$at" ] && [ $(( now - at )) -gt 120 ]; then return 0; fi
  mtime="$(tawassul_mtime_epoch "$mutex" 2>/dev/null || printf '0')"
  [ $(( now - mtime )) -gt 10800 ]
}

sweep_stale_tombstones() {
  parent="$1"
  now="$(date +%s)"
  for tomb in "$parent"/trigger.lock.stale.*; do
    [ -e "$tomb" ] || continue
    mtime="$(tawassul_mtime_epoch "$tomb" 2>/dev/null || printf '0')"
    if [ $(( now - mtime )) -gt 10800 ]; then
      rm -rf "$tomb" 2>/dev/null || true
    fi
  done
}

acquire_trigger_lock() {
  lock="$1"
  self="$2"
  parent="$(dirname "$lock")"
  mkdir -p "$parent" 2>/dev/null || true
  sweep_stale_tombstones "$parent"
  if mkdir "$lock" 2>/dev/null; then
    printf '%s\n' "$self" > "$lock/pid" 2>/dev/null || true
    return 0
  fi
  lock_pid_alive "$lock"
  alive=$?
  if [ "$alive" = "0" ]; then return 1; fi
  if [ "$alive" = "2" ]; then
    mtime="$(tawassul_mtime_epoch "$lock" 2>/dev/null || printf '0')"
    if [ $(( $(date +%s) - mtime )) -lt 10800 ]; then return 1; fi
  fi
  reclaim="$lock.reclaim"
  if ! mkdir "$reclaim" 2>/dev/null; then
    if reclaim_stale "$reclaim"; then
      rm -rf "$reclaim" 2>/dev/null || true
      mkdir "$reclaim" 2>/dev/null || return 1
    else
      return 1
    fi
  fi
  printf '%s\n' "$self" > "$reclaim/pid" 2>/dev/null || true
  printf '%s\n' "$(date +%s)" > "$reclaim/at" 2>/dev/null || true
  lock_pid_alive "$lock"
  alive=$?
  if [ "$alive" = "0" ]; then
    rm -rf "$reclaim" 2>/dev/null || true
    return 1
  fi
  if [ "$alive" = "2" ]; then
    mtime="$(tawassul_mtime_epoch "$lock" 2>/dev/null || printf '0')"
    if [ $(( $(date +%s) - mtime )) -lt 10800 ]; then
      rm -rf "$reclaim" 2>/dev/null || true
      return 1
    fi
  fi
  tombstone="$lock.stale.$$"
  if ! mv "$lock" "$tombstone" 2>/dev/null; then
    rm -rf "$reclaim" 2>/dev/null || true
    return 1
  fi
  rm -rf "$tombstone" 2>/dev/null || true
  if mkdir "$lock" 2>/dev/null; then
    printf '%s\n' "$self" > "$lock/pid" 2>/dev/null || true
    rm -rf "$reclaim" 2>/dev/null || true
    return 0
  fi
  rm -rf "$reclaim" 2>/dev/null || true
  return 1
}

cleanup_trigger() {
  [ "$LOCK_OWNED" = "1" ] || return 0
  [ -n "${TAWASSUL_TRIGGER_LOCK:-}" ] || return 0
  lock="$TAWASSUL_TRIGGER_LOCK"
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  [ "$pid" = "$$" ] || return 0
  reclaim="$lock.reclaim"
  if ! mkdir "$reclaim" 2>/dev/null; then
    if reclaim_stale "$reclaim"; then
      rm -rf "$reclaim" 2>/dev/null || true
      mkdir "$reclaim" 2>/dev/null || return 0
    else
      return 0
    fi
  fi
  rm -rf "$lock" 2>/dev/null || true
  rm -rf "$reclaim" 2>/dev/null || true
}

stamp_last_run() {
  if [ "$MODE" = "check" ] || [ "$SKIPPED" = "1" ]; then return 0; fi
  local rc="${1:-1}" stamp_dir stamp failure
  stamp_dir="$(printf '%s/tawassul-v2/db-maintenance' "$(xdg_data_home)")"
  mkdir -p "$stamp_dir" 2>/dev/null || true
  stamp="$stamp_dir/last-run.stamp"
  failure="$stamp_dir/last-failure.stamp"
  case "$rc" in ''|*[!0-9]*) rc=1 ;; esac
  if [ "$rc" -eq 0 ]; then
    if printf 'rc=0\nat=%s\n' "$(date '+%F %T')" > "$stamp" 2>/dev/null; then
      log "stamp written: $stamp"
    fi
    rm -f "$failure" 2>/dev/null || true
    return 0
  fi
  if printf 'rc=%s\nat=%s\n' "$rc" "$(date '+%F %T')" > "$failure" 2>/dev/null; then
    log "failure recorded: $failure (rc=$rc); the last-run stamp is left untouched"
  fi
  return 0
}
trap 'rc=$?; stamp_last_run "$rc"; cleanup_trigger; exit "$rc"' EXIT

if [ "$MODE" = "run" ]; then
  if [ -f "$STAMP_FILE" ] && [ "$GAP_SECONDS" -gt 0 ]; then
    STAMP_AT="$(tawassul_mtime_epoch "$STAMP_FILE" 2>/dev/null || printf '0')"
    NOW="$(date +%s)"
    if [ $(( NOW - STAMP_AT )) -lt "$GAP_SECONDS" ]; then
      SKIPPED=1
      log "skipping: the last successful run is inside the ${GAP_SECONDS}s gap"
      exit 0
    fi
  fi
  if [ -z "${TAWASSUL_TRIGGER_LOCK:-}" ]; then
    LOCK_DIR="$STAMP_DIR/trigger.lock"
    mkdir -p "$STAMP_DIR" 2>/dev/null || true
    if acquire_trigger_lock "$LOCK_DIR" "$$"; then
      TAWASSUL_TRIGGER_LOCK="$LOCK_DIR"
      LOCK_OWNED=1
    else
      SKIPPED=1
      log "skipping: another maintenance run holds the lock at $LOCK_DIR"
      exit 0
    fi
  fi
fi

log "scheduled run: mode=$MODE"
db_resolve_path || {
  log "OPENCODE_DB is set but missing: $RESOLVED_DB — refusing to pick another DB."
  [ "$MODE" = "check" ] || exit 2
  exit 2
}
DB="$RESOLVED_DB"
log "db: $DB (resolved via $DB_RESOLVE_SOURCE)"
[ -f "$DB" ] || { log "target DB not found: $DB"; exit 1; }

MAIN_BYTES=0
WAL_BYTES=0
_b="$(tawassul_file_bytes "$DB")" || { log "cannot stat the DB — refusing (fail-closed)."; exit 3; }
MAIN_BYTES="$_b"
_b="$(tawassul_file_bytes "$DB-wal")" || _b=0
WAL_BYTES="$_b"
TOTAL=$(( MAIN_BYTES + WAL_BYTES ))
SOFT=$(( ${TAWASSUL_SOFT_BYTES:-2147483648} ))
TARGET=$(( ${TAWASSUL_TARGET_BYTES:-1610612736} ))
WAL_TRIGGER=67108864
CAP="$(tawassul_cap_bytes)"
MAINT="$H/opencode-db-maintenance.sh"
BACKUPS="$(tawassul_backup_dir)"
run_maint() {
  log "maintenance: $* (db+wal ${TOTAL})"
  timeout 7200 bash "$MAINT" --db "$DB" --backup-dir "$BACKUPS" "$@" >> "$LOG" 2>&1
}

if [ "$MODE" = "check" ]; then
  log "ladder: total=${TOTAL} soft=${SOFT} cap=${CAP} wal=${WAL_BYTES} trigger=${WAL_TRIGGER}"
  exit 0
fi

if [ "$WAL_BYTES" -gt "$WAL_TRIGGER" ]; then
  log "wal rung: ${WAL_BYTES} bytes above ${WAL_TRIGGER} — attempting wal_checkpoint(TRUNCATE)"
  CKT="$(timeout 60 sqlite3 -cmd ".timeout 2500" "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" 2>>"$LOG" || true)"
  case "$CKT" in
    -1*|1*) log "wal rung: TRUNCATE returned $CKT (busy) — falling back to PASSIVE"; CKP="$(timeout 60 sqlite3 "$DB" "PRAGMA wal_checkpoint(PASSIVE);" 2>>"$LOG" || true)"; log "wal rung: PASSIVE result $CKP — retry next cycle" ;;
    *) log "wal rung: TRUNCATE done ($CKT)" ;;
  esac
  _b="$(tawassul_file_bytes "$DB-wal")" || _b=0
  log "wal rung: wal now ${_b} bytes"
fi

if [ "$TOTAL" -ge "$SOFT" ]; then
  log "in-use rung: total ${TOTAL} at/above ${SOFT} — bounded backup+prune while held"
  if ! run_maint --allow-in-use --ignore-low-ram --target-bytes "$TARGET" --event-delete; then
    log "in-use rung: maintenance exited non-zero — resuming next cycle (fail-closed, no VACUUM was required)"
  fi
  _b="$(tawassul_file_bytes "$DB")"; MAIN_BYTES="$_b"
  _b="$(tawassul_file_bytes "$DB-wal")" || _b=0
  TOTAL=$(( MAIN_BYTES + _b ))
fi

if [ "$TOTAL" -ge "$CAP" ]; then
  HELD=0
  if command -v fuser >/dev/null 2>&1; then
    fuser -s "$DB" "$DB-wal" 2>/dev/null && HELD=1
  else
    log "fuser not found — cannot prove quiescence; the quiescent rung stays off (fail-closed)"
    HELD=1
  fi
  if [ "$HELD" = 0 ]; then
    log "quiescent rung: total ${TOTAL} at/above ${CAP} and DB is quiet — full maintenance (backup, prune, checkpoint, VACUUM)"
    if ! run_maint; then
      log "quiescent rung: maintenance exited non-zero — resuming next cycle"
    fi
  else
    log "quiescent rung: held or unprovable quiet — skipped (the in-use rung is the bound)"
  fi
fi

if [ "$TOTAL" -lt "$SOFT" ] && [ "$WAL_BYTES" -le "$WAL_TRIGGER" ]; then
  log "nothing to do: total ${TOTAL} below soft ${SOFT}, wal ${WAL_BYTES} within ${WAL_TRIGGER}"
fi
log "scheduled run complete"
exit 0
