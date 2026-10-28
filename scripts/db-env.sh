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
    ''|*[!0-9]*) : ;;
    *) printf '%s' "$_b"; return 0 ;;
  esac
  _b="$(python3 -c 'import os,sys; print(os.path.getsize(sys.argv[1]))' "$1" 2>/dev/null)"
  case "$_b" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s' "$_b"; return 0 ;;
  esac
}

tawassul_mtime_epoch() {
  [ "$#" -eq 1 ] || return 1
  [ -e "$1" ] || return 1
  _m="$(stat -c %Y "$1" 2>/dev/null)"
  case "$_m" in
    ''|*[!0-9]*) _m="$(stat -f %m "$1" 2>/dev/null)" ;;
  esac
  case "$_m" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s' "$_m"; return 0 ;;
  esac
}

tawassul_file_mode() {
  [ "$#" -eq 1 ] || return 1
  [ -e "$1" ] || return 1
  _m="$(stat -c '%a' "$1" 2>/dev/null)"
  case "$_m" in
    ''|*[!0-9]*) _m="$(stat -f '%Lp' "$1" 2>/dev/null)" ;;
  esac
  case "$_m" in
    ''|*[!0-9]*) printf '644' ;;
    *) printf '%s' "$_m" ;;
  esac
}

tawassul_date_epoch_days() {
  [ "$#" -eq 1 ] || return 1
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  _s="$(date -d "now -${1} days" +%s 2>/dev/null)"
  case "$_s" in
    ''|*[!0-9]*) _s="$(date -v-"${1}"d +%s 2>/dev/null)" ;;
  esac
  case "$_s" in
    ''|*[!0-9]*) _s="$(python3 -c 'import sys,time; print(int(time.time() - int(sys.argv[1]) * 86400))' "$1" 2>/dev/null)" ;;
  esac
  case "$_s" in
    ''|*[!0-9]*) return 1 ;;
    *) printf '%s' "$_s"; return 0 ;;
  esac
}

tawassul_free_ram_mb() {
  _r="$(free -m 2>/dev/null | awk '/^Mem:/ {print $7}')"
  case "$_r" in
    ''|*[!0-9]*) ;;
    *) [ "$_r" -ge 1 ] && { printf '%s' "$_r"; return 0; } ;;
  esac
  _r="$(vm_stat 2>/dev/null | awk '
    /page size of/ {gsub(/[^0-9]/,"",$0); ps=$1+0}
    /Pages free/ {f=$NF+0}
    /Pages inactive/ {i=$NF+0}
    /Pages speculative/ {sp=$NF+0}
    END {ps=(ps>0)?ps:4096; printf "%d", (f+i+sp)*ps/1048576}')"
  case "$_r" in
    ''|*[!0-9]*|0) ;;
    *) printf '%s' "$_r"; return 0 ;;
  esac
  _r="$(python3 -c 'print(int(open("/proc/meminfo").read().split("MemAvailable:")[1].split("\n")[0].split()[0]) // 1024)' 2>/dev/null)"
  case "$_r" in
    ''|*[!0-9]*|0) return 1 ;;
    *) printf '%s' "$_r"; return 0 ;;
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
