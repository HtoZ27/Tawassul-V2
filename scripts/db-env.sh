#!/usr/bin/env bash
[ -n "${_DB_ENV_SH:-}" ] && return 0
_DB_ENV_SH=1

xdg_data_home() {
  if [ -n "${XDG_DATA_HOME:-}" ]; then
    printf '%s' "${XDG_DATA_HOME}"
  else
    printf '%s' "${HOME:-$(getent passwd "$UID" 2>/dev/null | cut -d: -f6)}/.local/share"
  fi
}

xdg_config_home() {
  if [ -n "${XDG_CONFIG_HOME:-}" ]; then
    printf '%s' "${XDG_CONFIG_HOME}"
  else
    printf '%s' "${HOME:-$(getent passwd "$UID" 2>/dev/null | cut -d: -f6)}/.config"
  fi
}

tawassul_file_bytes() {
  [ "$#" -eq 1 ] || return 1
  [ -e "$1" ] || return 1
  if stat -c %s "$1" >/dev/null 2>&1; then
    _b="$(stat -c %s "$1")"
    case "$_b" in
      ''|*[!0-9]*) return 1 ;;
      *) printf '%s' "$_b"; return 0 ;;
    esac
  fi
  _b="$(stat -f %z "$1" 2>/dev/null)"
  case "$_b" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s' "$_b"; return 0 ;;
  esac
}

tawassul_avail_bytes() {
  [ "$#" -eq 1 ] || return 1
  [ -d "$1" ] || return 1
  _a="$(df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}')"
  case "$_a" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s' $(( _a * 1024 )); return 0 ;;
  esac
}

tawassul_cap_bytes() {
  case "${TAWASSUL_CAP_BYTES:-}" in
    ''|*[!0-9]) printf '%s' 4294967296 ;;
    *) printf '%s' "${TAWASSUL_CAP_BYTES}" ;;
  esac
}

tawassul_backup_dir() {
  if [ -n "${TAWASSUL_BACKUP_DIR:-}" ]; then
    printf '%s' "${TAWASSUL_BACKUP_DIR}"
  else
    printf '%s/%s' "$(xdg_data_home)/tawassul-v2" "backups"
  fi
}

db_resolve_path() {
  RESOLVED_DB=""
  DB_RESOLVE_SOURCE=""
  WANT_PROBE=0
  for _a in "$@"; do
    [ "$_a" = "--probe" ] && WANT_PROBE=1
  done
  if [ -n "${OPENCODE_DB:-}" ]; then
    RESOLVED_DB="${OPENCODE_DB}"
    DB_RESOLVE_SOURCE="opencode-db"
    [ -e "$RESOLVED_DB" ] && return 0
    return 2
  fi
  RESOLVED_DB="$(printf '%s/opencode/opencode.db' "$(xdg_data_home)")"
  DB_RESOLVE_SOURCE="host-default"
  if [ "$WANT_PROBE" = 1 ] && command -v opencode >/dev/null 2>&1; then
    _l="$(timeout 15 opencode debug paths 2>/dev/null | awk '/^[[:space:]]*db[[:space:]]*:/ {sub(/^.*db[[:space:]]*:[[:space:]]*/,""); print; exit}')"
    case "$_l" in
      [~/]*) RESOLVED_DB="$_l"; DB_RESOLVE_SOURCE="debug-paths"; return 0 ;;
    esac
  fi
  return 0
}
