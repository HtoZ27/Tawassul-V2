#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${TAWASSUL_REFRESH_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
MODE="reload"
DRY_RUN=0
CLI=""
MARKER="Background init completed successfully"

usage() {
  printf '%s\n' \
    "usage: host-refresh.sh [--reload|--verify-only|--restart] [--dry-run]" \
    "" \
    "  --reload       reload the live host and wait for a fresh plugin init (default)" \
    "  --verify-only  check that the live plugin init is newer than the plugin entry" \
    "  --restart      schedule a detached host restart and verification (systemd-run)" \
    "  --dry-run      print the planned action without running it" \
    "" \
    "env: TAWASSUL_HOST_CLI TAWASSUL_SERVICE_JSON TAWASSUL_PLUGIN_LOG" \
    "     TAWASSUL_ENTRY_FILE TAWASSUL_SOURCE_DIGEST TAWASSUL_REFRESH_TIMEOUT" \
    "     TAWASSUL_REFRESH_INTERVAL TAWASSUL_RELOAD_TIMEOUT TAWASSUL_RESTART_DELAY" \
    "     TAWASSUL_REFRESH_REPORT"
}

fail() {
  printf 'host-refresh: FAIL %s\n' "$1" >&2
  exit 1
}

positive_int() {
  local value="$1"
  local fallback="$2"
  case "$value" in
    ''|*[!0-9]*|0) printf '%s\n' "$fallback" ;;
    *) printf '%s\n' "$value" ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --reload) MODE="reload" ;;
    --verify-only) MODE="verify" ;;
    --restart) MODE="restart" ;;
    --restart-now) MODE="restart-now" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; printf 'host-refresh: FAIL unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

HOME_DIR="${HOME:-}"
DATA_HOME="${XDG_DATA_HOME:-$HOME_DIR/.local/share}"
STATE_HOME="${XDG_STATE_HOME:-$HOME_DIR/.local/state}"
LOG="${TAWASSUL_PLUGIN_LOG:-$DATA_HOME/tawassul-v2/tawassul/tawassul.log}"
SERVICE_JSON="${TAWASSUL_SERVICE_JSON:-$STATE_HOME/opencode/service.json}"
ENTRY="${TAWASSUL_ENTRY_FILE:-$ROOT/.opencode/plugins/tawassul.js}"
REPORT="${TAWASSUL_REFRESH_REPORT:-$STATE_HOME/tawassul-v2/host-refresh.json}"
TIMEOUT="$(positive_int "${TAWASSUL_REFRESH_TIMEOUT:-}" 90)"
INTERVAL="$(positive_int "${TAWASSUL_REFRESH_INTERVAL:-}" 2)"
RELOAD_TIMEOUT="$(positive_int "${TAWASSUL_RELOAD_TIMEOUT:-}" 60)"
RESTART_DELAY="$(positive_int "${TAWASSUL_RESTART_DELAY:-}" 2)"

resolve_cli() {
  if [ -n "${TAWASSUL_HOST_CLI:-}" ]; then
    [ -x "$TAWASSUL_HOST_CLI" ] || fail "TAWASSUL_HOST_CLI is not executable: $TAWASSUL_HOST_CLI"
    printf '%s\n' "$TAWASSUL_HOST_CLI"
    return
  fi
  local candidate=""
  local desktop="$HOME_DIR/.config/ai.opencode.desktop/cli"
  if [ -d "$desktop" ]; then
    candidate="$(find "$desktop" -mindepth 2 -maxdepth 2 -type f -name opencode-cli -perm -u+x 2>/dev/null | sort -V | tail -n 1)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(command -v opencode-cli 2>/dev/null || true)"
  fi
  if [ -z "$candidate" ]; then
    candidate="$(command -v opencode 2>/dev/null || true)"
  fi
  [ -n "$candidate" ] || fail "no host CLI found; set TAWASSUL_HOST_CLI"
  printf '%s\n' "$candidate"
}

last_init_line() {
  [ -f "$LOG" ] || return 1
  grep -aF "$MARKER" "$LOG" 2>/dev/null | tail -n 1
}

last_init_epoch() {
  local line=""
  local ts=""
  local epoch=""
  line="$(last_init_line)" || return 1
  [ -n "$line" ] || return 1
  ts="${line%% *}"
  epoch="$(date -d "$ts" +%s 2>/dev/null)" || return 1
  printf '%s\n' "$epoch"
}

entry_epoch() {
  stat -c %Y "$ENTRY" 2>/dev/null || fail "cannot stat plugin entry: $ENTRY"
}

entry_digest() {
  local value=""
  value="$(grep -oE 'TAWASSUL_CONTENT_SHA=[0-9a-f]{64}' "$ENTRY" 2>/dev/null | tail -n 1 | cut -d= -f2)" || true
  [ -n "$value" ] || fail "plugin entry has no TAWASSUL_CONTENT_SHA marker: $ENTRY"
  printf '%s\n' "$value"
}

entry_sha() {
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required to fingerprint the plugin entry"
  sha256sum "$ENTRY" 2>/dev/null | cut -d' ' -f1
}

live_fingerprint_line() {
  [ -f "$LOG" ] || return 1
  grep -aF "v2 bundle sha256=" "$LOG" 2>/dev/null | grep -aF "entry=$ENTRY" | tail -n 1
}

line_epoch() {
  local ts="${1%% *}"
  [ -n "$ts" ] || return 1
  date -d "$ts" +%s 2>/dev/null
}

live_sha() {
  local line=""
  local sha=""
  line="$(live_fingerprint_line)" || return 1
  sha="$(printf '%s\n' "$line" | sed -n 's/.*v2 bundle sha256=\([0-9a-f]\{64\}\).*/\1/p')"
  [ -n "$sha" ] || return 1
  printf '%s\n' "$sha"
}

live_entry() {
  local line=""
  line="$(live_fingerprint_line)" || return 1
  printf '%s\n' "${line#*entry=}"
}

check_live_bundle() {
  local expected="$1"
  local live=""
  local path=""
  if ! live="$(live_sha)"; then
    printf 'host-refresh: WARN the log has no v2 bundle fingerprint; falling back to the entry mtime\n' >&2
    return 1
  fi
  path="$(live_entry || true)"
  if [ "$live" != "$expected" ]; then
    printf 'host-refresh: FAIL live bundle sha256=%s differs from the entry sha256=%s at %s\n' "${live:0:12}" "${expected:0:12}" "${path:-unknown}" >&2
    return 2
  fi
  printf 'host-refresh: live_bundle=%s entry_logged=%s\n' "${live:0:12}" "${path:-unknown}"
  return 0
}

current_digest() {
  local value=""
  if [ -n "${TAWASSUL_SOURCE_DIGEST:-}" ]; then
    value="$TAWASSUL_SOURCE_DIGEST"
  else
    command -v bun >/dev/null 2>&1 || fail "bun is required to compute the source digest; set TAWASSUL_SOURCE_DIGEST to skip"
    if ! value="$(cd "$ROOT" && bun -e 'import { sourceDigest } from "./scripts/source-digest.ts"; console.log(sourceDigest())' 2>/dev/null | tail -n 1)"; then
      fail "could not compute the source digest"
    fi
  fi
  case "$value" in
    ''|*[!0-9a-f]*) fail "invalid source digest: $value" ;;
  esac
  [ "${#value}" -eq 64 ] || fail "invalid source digest length: ${#value}"
  printf '%s\n' "$value"
}

preflight_entry() {
  [ -f "$ENTRY" ] || fail "plugin entry not found: $ENTRY"
  local embedded=""
  local current=""
  embedded="$(entry_digest)"
  current="$(current_digest)"
  if [ "$embedded" != "$current" ]; then
    fail "plugin entry is stale (embedded ${embedded:0:12}, source ${current:0:12}); run npm run build"
  fi
  printf 'host-refresh: entry=%s digest=%s\n' "$ENTRY" "${current:0:12}"
}

preflight_log() {
  [ -f "$LOG" ] || fail "plugin log not found: $LOG"
  [ -r "$LOG" ] || fail "plugin log is not readable: $LOG"
}

service_pid() {
  [ -f "$SERVICE_JSON" ] || return 1
  local pid=""
  pid="$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$SERVICE_JSON" 2>/dev/null | head -n 1)"
  [ -n "$pid" ] || return 1
  printf '%s\n' "$pid"
}

now_iso() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

iso_from_epoch() {
  date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ
}

write_report() {
  local status="$1"
  local init="$2"
  local pid="$3"
  local unit="$4"
  local tmp=""
  mkdir -p "$(dirname "$REPORT")"
  tmp="$REPORT.tmp.$$"
  {
    printf '{\n'
    printf '  "status": "%s",\n' "$status"
    printf '  "at": "%s",\n' "$(now_iso)"
    printf '  "init": "%s",\n' "$init"
    printf '  "entry": "%s",\n' "$ENTRY"
    printf '  "pid": %s,\n' "${pid:-0}"
    printf '  "unit": "%s"\n' "$unit"
    printf '}\n'
  } > "$tmp"
  mv "$tmp" "$REPORT"
}

wait_for_init() {
  local start="$1"
  local deadline=0
  local epoch=""
  local fp_line=""
  local fp_epoch=""
  deadline=$(( $(date +%s) + TIMEOUT ))
  while :; do
    fp_line="$(live_fingerprint_line || true)"
    fp_epoch=""
    if [ -n "$fp_line" ]; then
      fp_epoch="$(line_epoch "$fp_line" || true)"
    fi
    if [ -n "$fp_epoch" ] && [ "$fp_epoch" -ge "$start" ]; then
      epoch="$(last_init_epoch || true)"
      if [ -n "$epoch" ] && [ "$epoch" -ge "$fp_epoch" ]; then
        printf '%s\n' "$epoch"
        return 0
      fi
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      return 1
    fi
    sleep "$INTERVAL"
  done
}

run_reload() {
  preflight_entry
  preflight_log
  CLI="$(resolve_cli)"
  local start=0
  local init_epoch=""
  local init_ts=""
  local pid=""
  local output=""
  local bundle_sha=""
  local bundle_state=0
  local entry=0
  bundle_sha="$(entry_sha)"
  entry="$(entry_epoch)"
  printf 'host-refresh: mode=reload cli=%s cwd=%s\n' "$CLI" "$ROOT"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'host-refresh: DRY RUN would run: cd %q && timeout %ss %q reload\n' "$ROOT" "$RELOAD_TIMEOUT" "$CLI"
    return 0
  fi
  start="$(date +%s)"
  if ! output="$(cd "$ROOT" && timeout "${RELOAD_TIMEOUT}s" "$CLI" reload 2>&1)"; then
    printf '%s\n' "$output" | sed 's/^/host-refresh: /' >&2
    fail "reload command failed"
  fi
  printf '%s\n' "$output" | sed 's/^/host-refresh: /'
  if ! init_epoch="$(wait_for_init "$start")"; then
    fail "no fresh plugin init within ${TIMEOUT}s; run npm run host:refresh -- --restart"
  fi
  check_live_bundle "$bundle_sha" || bundle_state=$?
  if [ "$bundle_state" -eq 2 ]; then
    fail "live bundle differs from the plugin entry; run npm run host:refresh"
  fi
  if [ "$bundle_state" -eq 1 ] && [ "$((init_epoch + 1))" -lt "$entry" ]; then
    fail "host init is older than the plugin entry (init=$(iso_from_epoch "$init_epoch") entry=$(iso_from_epoch "$entry")); run npm run host:refresh"
  fi
  init_ts="$(last_init_line)"
  init_ts="${init_ts%% *}"
  pid="$(service_pid || true)"
  printf 'host-refresh: OK mode=reload init=%s pid=%s\n' "$init_ts" "${pid:-unknown}"
}

run_verify() {
  preflight_entry
  preflight_log
  local entry=0
  local init_epoch=""
  local init_ts=""
  local pid=""
  local bundle_sha=""
  local bundle_state=0
  entry="$(entry_epoch)"
  bundle_sha="$(entry_sha)"
  if ! init_epoch="$(last_init_epoch)"; then
    fail "no plugin init line in $LOG"
  fi
  check_live_bundle "$bundle_sha" || bundle_state=$?
  if [ "$bundle_state" -eq 2 ]; then
    fail "live bundle differs from the plugin entry; run npm run host:refresh"
  fi
  if [ "$bundle_state" -eq 1 ] && [ "$((init_epoch + 1))" -lt "$entry" ]; then
    fail "host init is older than the plugin entry (init=$(iso_from_epoch "$init_epoch") entry=$(iso_from_epoch "$entry")); run npm run host:refresh"
  fi
  init_ts="$(last_init_line)"
  init_ts="${init_ts%% *}"
  pid="$(service_pid || true)"
  printf 'host-refresh: OK mode=verify init=%s entry=%s pid=%s\n' "$init_ts" "$(iso_from_epoch "$entry")" "${pid:-unknown}"
}

schedule_restart() {
  preflight_entry
  preflight_log
  command -v systemd-run >/dev/null 2>&1 || fail "systemd-run is required for --restart; use the default reload"
  local unit=""
  local args=()
  local name=""
  local value=""
  local digest=""
  local restart_env=(TAWASSUL_HOST_CLI XDG_DATA_HOME XDG_STATE_HOME TAWASSUL_SERVICE_JSON TAWASSUL_PLUGIN_LOG TAWASSUL_ENTRY_FILE TAWASSUL_REFRESH_TIMEOUT TAWASSUL_REFRESH_INTERVAL TAWASSUL_REFRESH_REPORT)
  digest="$(current_digest)"
  unit="tawassul-host-refresh-$(date +%s)-$$"
  args=(systemd-run --user --collect --unit="$unit" --on-active="${RESTART_DELAY}s")
  for name in "${restart_env[@]}"; do
    value="${!name:-}"
    if [ -n "$value" ]; then
      args+=(--setenv="$name=$value")
    fi
  done
  args+=(--setenv="TAWASSUL_SOURCE_DIGEST=$digest")
  args+=(--setenv="TAWASSUL_REFRESH_UNIT=$unit")
  args+=(bash "$SCRIPT_DIR/host-refresh.sh" --restart-now)
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'host-refresh: DRY RUN would run:'
    printf ' %q' "${args[@]}"
    printf '\n'
    return 0
  fi
  if ! "${args[@]}" >/dev/null 2>&1; then
    fail "systemd-run could not schedule the restart"
  fi
  printf 'host-refresh: scheduled unit=%s delay=%ss report=%s\n' "$unit" "$RESTART_DELAY" "$REPORT"
  printf 'host-refresh: the detached job restarts the host and writes the result\n'
}

restart_now() {
  preflight_entry
  CLI="$(resolve_cli)"
  local start=0
  local init_epoch=""
  local init_ts=""
  local pid=""
  local unit="${TAWASSUL_REFRESH_UNIT:-manual}"
  local output=""
  local bundle_sha=""
  local bundle_state=0
  local entry=0
  bundle_sha="$(entry_sha)"
  entry="$(entry_epoch)"
  start="$(date +%s)"
  printf 'host-refresh: mode=restart-now cli=%s unit=%s\n' "$CLI" "$unit"
  if ! output="$("$CLI" service restart 2>&1)"; then
    write_report "failed" "" "" "$unit"
    printf '%s\n' "$output" | sed 's/^/host-refresh: /' >&2
    fail "service restart failed"
  fi
  if ! init_epoch="$(wait_for_init "$start")"; then
    pid="$(service_pid || true)"
    write_report "stale" "" "${pid:-0}" "$unit"
    fail "no fresh plugin init after restart within ${TIMEOUT}s"
  fi
  check_live_bundle "$bundle_sha" || bundle_state=$?
  if [ "$bundle_state" -eq 2 ] || { [ "$bundle_state" -eq 1 ] && [ "$((init_epoch + 1))" -lt "$entry" ]; }; then
    pid="$(service_pid || true)"
    write_report "stale" "" "${pid:-0}" "$unit"
    fail "the restarted host is not running the current plugin entry"
  fi
  init_ts="$(last_init_line)"
  init_ts="${init_ts%% *}"
  pid="$(service_pid || true)"
  write_report "fresh" "$init_ts" "${pid:-0}" "$unit"
  printf 'host-refresh: OK mode=restart-now init=%s pid=%s\n' "$init_ts" "${pid:-unknown}"
}

printf 'host-refresh: plugin_log=%s\n' "$LOG"
printf 'host-refresh: service=%s\n' "$SERVICE_JSON"

case "$MODE" in
  reload) run_reload ;;
  verify) run_verify ;;
  restart) schedule_restart ;;
  restart-now) restart_now ;;
  *) fail "unknown mode: $MODE" ;;
esac
