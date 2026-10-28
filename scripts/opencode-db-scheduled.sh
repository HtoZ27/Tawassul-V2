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

cleanup_trigger() {
  if [ -n "${TAWASSUL_TRIGGER_LOCK:-}" ]; then
    rm -rf "$TAWASSUL_TRIGGER_LOCK" 2>/dev/null || true
  fi
}
stamp_last_run() {
  if [ "$MODE" = "check" ]; then return 0; fi
  local stamp_dir stamp
  stamp_dir="$(printf '%s/tawassul-v2/db-maintenance' "$(xdg_data_home)")"
  mkdir -p "$stamp_dir" 2>/dev/null || true
  stamp="$stamp_dir/last-run.stamp"
  if printf 'rc=%s\nat=%s\n' "${1:-$?}" "$(date '+%F %T')" > "$stamp" 2>/dev/null; then
    log "stamp written: $stamp"
  fi
}
trap 'rc=$?; stamp_last_run "$rc"; cleanup_trigger; exit "$rc"' EXIT

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
