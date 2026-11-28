#!/bin/sh
# install.sh - install a Tawassul release into a project or a global config root.
# POSIX shell; needs tar, gzip, and either curl or wget when it is not given --from.
set -eu

INSTALLER_VERSION="0.1.8-experimental"
REPO_SLUG="HtoZ27/tawassul-v2"
RELEASE="$INSTALLER_VERSION"
BASE_URL="${TAWASSUL_RELEASE_BASE_URL:-https://github.com/$REPO_SLUG/releases/download/v$RELEASE}"

SCOPE=""
PROJECT=""
PREFIX=""
FROM=""
DRY_RUN=0
UNINSTALL=0
FORCE=0
DB_MODE=0
DB_PATH_OPT=""
TRIGGER_TAG="tawassul-db-maintenance"
SERVICE_UNIT="tawassul-db-maintenance.service"
TIMER_UNIT="tawassul-db-maintenance.timer"
OWNER_SELF="install.sh-db-maintenance"

usage() {
  cat <<'EOF'
usage: install.sh --project <dir> [--from <dir>] [--dry-run] [--uninstall]
       install.sh --global [--prefix <dir>] [--from <dir>] [--dry-run] [--uninstall]
       install.sh --db-maintenance [--db <path>] [--from <dir>] [--dry-run] [--uninstall]

  --project <dir>   install into <dir>/.opencode
  --global          install into the OpenCode global config root
  --db-maintenance  install only the host database maintenance lane
  --db <path>       the desktop-sidecar database to maintain (derived by default)
  --prefix <dir>    treat <dir> as HOME for a scratch global install
  --from <dir>      read the release artifacts from a local directory
  --release <v>     install this version instead of the embedded one
  --dry-run         print the plan; write nothing
  --uninstall       remove the entry and runtime this installer wrote
  --force           allow an uninstall without a Tawassul marker
  --version         print the installer version
  --help, -h        print this message

The installer never edits opencode.json or opencode.jsonc.
EOF
}

say() { printf '%s\n' "install: $*"; }
fail() { printf '%s\n' "install: $*" >&2; exit 2; }
usage_fail() { usage >&2; printf '%s\n' "install: $*" >&2; exit 64; }

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      [ $# -ge 2 ] || usage_fail "--project needs a directory"
      [ -z "$SCOPE" ] || usage_fail "choose exactly one of --project and --global"
      SCOPE="project"; PROJECT="$2"; shift 2 ;;
    --global)
      [ -z "$SCOPE" ] || usage_fail "choose exactly one install scope"
      SCOPE="global"; shift ;;
    --db-maintenance)
      [ -z "$SCOPE" ] || usage_fail "choose exactly one install scope"
      SCOPE="db-maintenance"; DB_MODE=1; shift ;;
    --db)
      [ $# -ge 2 ] || usage_fail "--db needs a path"
      DB_PATH_OPT="$2"; shift 2 ;;
    --prefix)
      [ $# -ge 2 ] || usage_fail "--prefix needs a directory"
      PREFIX="$2"; shift 2 ;;
    --from)
      [ $# -ge 2 ] || usage_fail "--from needs a directory"
      FROM="$2"; shift 2 ;;
    --release)
      [ $# -ge 2 ] || usage_fail "--release needs a version"
      RELEASE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --force) FORCE=1; shift ;;
    --version) printf 'install.sh %s\n' "$INSTALLER_VERSION"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) usage_fail "unknown argument: $1" ;;
  esac
done

[ -n "$SCOPE" ] || usage_fail "choose --project <dir>, --global, or --db-maintenance"
[ -n "$PROJECT" ] || [ "$SCOPE" != "project" ] || usage_fail "--project needs a directory"
[ -z "$PREFIX" ] || [ "$SCOPE" = "global" ] || [ "$SCOPE" = "db-maintenance" ] || usage_fail "--prefix applies to --global and --db-maintenance only"
[ -z "$DB_PATH_OPT" ] || [ "$SCOPE" = "db-maintenance" ] || usage_fail "--db applies to --db-maintenance only"

printf '%s' "$RELEASE" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' \
  || fail "--release expects a semantic version, got: $RELEASE"
BASE_URL="${TAWASSUL_RELEASE_BASE_URL:-https://github.com/$REPO_SLUG/releases/download/v$RELEASE}"

case "$(uname -s)" in
  Linux) : ;;
  Darwin) : ;;
  MINGW*|MSYS*|CYGWIN*) say "native Windows is experimental; this lane needs Git for Windows" ;;
  *) fail "unsupported platform: $(uname -s)" ;;
esac

if [ "$DB_MODE" = "1" ]; then
  if [ -n "$PREFIX" ]; then
    CONFIG_BASE="$PREFIX/.config"
  elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
    CONFIG_BASE="$XDG_CONFIG_HOME"
  else
    CONFIG_BASE="$HOME/.config"
  fi
  ROOT="$CONFIG_BASE/opencode"
  RUNTIME="$ROOT/tawassul-runtime"
  DB_DIR="$RUNTIME/db"
  MARKER="$DB_DIR/MAINTENANCE"
  ENTRY=""
elif [ "$SCOPE" = "project" ]; then
  ROOT="$PROJECT"
  ENTRY="$PROJECT/.opencode/plugins/tawassul.js"
  RUNTIME="$PROJECT/.opencode/tawassul-runtime"
  CONFIG_ROOT="$PROJECT/.opencode"
else
  if [ -n "$PREFIX" ]; then
    CONFIG_BASE="$PREFIX/.config"
  elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
    CONFIG_BASE="$XDG_CONFIG_HOME"
  else
    CONFIG_BASE="$HOME/.config"
  fi
  ROOT="$CONFIG_BASE/opencode"
  ENTRY="$ROOT/plugins/tawassul.js"
  RUNTIME="$ROOT/tawassul-runtime"
  CONFIG_ROOT="$ROOT"
fi
if [ "$DB_MODE" = "0" ]; then
  MARKER="$RUNTIME/VERSION"
fi

marker_owned() {
  [ -f "$MARKER" ] || return 1
  grep -q '"package"[[:space:]]*:[[:space:]]*"tawassul-v2"' "$MARKER"
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    fail "no sha256sum or shasum on PATH"
  fi
}

sum_for() {
  awk -v name="$1" '$2 == name { print $1; exit }' "$2"
}

fetch() {
  url="$1"
  out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 --connect-timeout 20 -o "$out" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$out" "$url"
  else
    fail "no curl or wget on PATH; use --from <dir> with the release artifacts"
  fi
}

MAINT_FILES="db-env.sh doctor-v2.sh guard-db-generation.sh opencode-db-maintenance.sh opencode-db-scheduled.sh"

derive_db_path() {
  if [ -n "$PREFIX" ]; then
    DATA_BASE="$PREFIX/.local/share"
  else
    DATA_BASE="${XDG_DATA_HOME:-$HOME/.local/share}"
  fi
  if [ -n "$DB_PATH_OPT" ]; then
    DB_PATH="$DB_PATH_OPT"
  elif [ -n "$PREFIX" ]; then
    DB_PATH="$DATA_BASE/opencode/tawassul-v2/opencode.db"
  elif [ -n "${OPENCODE_DB:-}" ]; then
    DB_PATH="$OPENCODE_DB"
  else
    DB_PATH="$DATA_BASE/opencode/tawassul-v2/opencode.db"
  fi
  if [ -L "$DB_PATH" ]; then
    fail "refusing a symlinked database path: $DB_PATH — point --db at the real sidecar file"
  fi
  if [ "$(printf '%s' "$DB_PATH" | tr -d '[:cntrl:]')" != "$DB_PATH" ]; then
    fail "unsupported control character in the database path"
  fi
  DB_PARENT="$(cd "$(dirname "$DB_PATH")" 2>/dev/null && pwd -P || printf '')"
  if [ -n "$DB_PARENT" ]; then
    DB_CANON="$DB_PARENT/$(basename "$DB_PATH")"
    DATA_CANON="$(cd "$DATA_BASE" 2>/dev/null && pwd -P || printf '')"
    SIDECAR_ROOT="${DATA_CANON:-$DATA_BASE}/opencode/tawassul-v2"
    case "$DB_CANON" in
      "$SIDECAR_ROOT"/*) : ;;
      *) fail "refusing to schedule maintenance for $DB_PATH: expected a desktop-sidecar DB under $SIDECAR_ROOT" ;;
    esac
  fi
  [ -f "$DB_PATH" ] || fail "the resolved sidecar DB does not exist: $DB_PATH — start the host once before installing the lane"
  case "$DB_PATH" in
    *'"'*|*'%'*|*'$'*|*'`'*|*'\'*|*"'"*) fail "unsupported character in the database path: $DB_PATH" ;;
  esac
}

unit_stamp() {
  [ -f "$1" ] || return 0
  head -n 1 "$1" | sed -n 's/^# tawassul-owner: //p'
}

version_has_db() {
  [ -f "$RUNTIME/VERSION" ] && grep -q '"db"[[:space:]]*:' "$RUNTIME/VERSION"
}

runtime_owned() {
  marker_owned && return 0
  [ -f "$RUNTIME/db/MAINTENANCE" ] \
    && grep -q '"package"[[:space:]]*:[[:space:]]*"tawassul-v2"' "$RUNTIME/db/MAINTENANCE"
}

own_marker() {
  [ -f "$MARKER" ] \
    && grep -q '"package"[[:space:]]*:[[:space:]]*"tawassul-v2"' "$MARKER" \
    && grep -q '"lane"[[:space:]]*:[[:space:]]*"install.sh --db-maintenance"' "$MARKER"
}

marker_trigger_value() {
  [ -f "$MARKER" ] || return 0
  sed -n 's/.*"trigger"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' "$MARKER" | head -n 1
}

marker_cron() {
  own_marker || return 0
  [ "$(grep -Eo '"cron"[[:space:]]*:' "$MARKER" | wc -l)" -eq 1 ] || return 0
  sed -n 's/.*"cron"[[:space:]]*:[[:space:]]*"\(none\|owned\)".*/\1/p' "$MARKER" | head -n 1
}

write_marker_file() {
  write_marker_trigger="$1"
  write_marker_cron="$2"
  STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! {
    printf '{\n'
    printf '  "package": "tawassul-v2",\n'
    printf '  "lane": "install.sh --db-maintenance",\n'
    printf '  "version": "%s",\n' "$RELEASE"
    printf '  "db": "%s",\n' "$DB_PATH"
    printf '  "trigger": "%s",\n' "$write_marker_trigger"
    printf '  "cron": "%s",\n' "$write_marker_cron"
    printf '  "gapSeconds": %s,\n' "$GAP_SECONDS"
    printf '  "installedAt": "%s"\n' "$STAMP"
    printf '}\n'
  } > "$MARKER.tmp.$$"; then
    rm -f "$MARKER.tmp.$$"
    return 1
  fi
  if ! mv "$MARKER.tmp.$$" "$MARKER"; then
    rm -f "$MARKER.tmp.$$"
    return 1
  fi
  return 0
}

canon_path() {
  [ -n "$1" ] || return 0
  canon_tail=""
  canon_walk="$1"
  while [ -n "$canon_walk" ] && [ ! -d "$canon_walk" ]; do
    canon_tail="/$(basename "$canon_walk")$canon_tail"
    canon_next="$(dirname "$canon_walk")"
    if [ "$canon_next" = "$canon_walk" ]; then
      canon_walk=""
      break
    fi
    canon_walk="$canon_next"
  done
  [ -n "$canon_walk" ] || return 0
  canon_base="$(cd "$canon_walk" 2>/dev/null && pwd -P || printf '')"
  [ -n "$canon_base" ] || return 0
  printf '%s%s' "$canon_base" "$canon_tail"
}

legacy_adoption_ok() {
  own_marker || return 1
  version_has_db && return 1
  return 0
}

unit_shape_ours() {
  [ -f "$1" ] || return 1
  grep -q '^Description=Tawassul v2 DB maintenance' "$1" || return 1
  case "$1" in
    *"$TIMER_UNIT")
      grep -q '^\[Timer\]' "$1" && grep -q '^OnCalendar=' "$1" ;;
    *)
      grep -Fq "$DB_DIR/opencode-db-scheduled.sh" "$1" ;;
  esac
}

cron_tagged() {
  printf '%s\n' "$1" | tr -d '\r' | grep -Eq "^.*# $TRIGGER_TAG([[:space:]]+owner=[^[:space:]]*)?[[:space:]]*$"
}

cron_owner() {
  printf '%s\n' "$1" | tr -d '\r' | sed -n "s/.*# $TRIGGER_TAG owner=\([^[:space:]]*\).*/\1/p"
}

cron_shape_ours() {
  cron_tagged "$1" || return 1
  printf '%s\n' "$1" | grep -Fq "$DB_DIR/opencode-db-scheduled.sh" || return 1
  printf '%s\n' "$1" | grep -Fq -- '--run'
}

cron_ours() {
  cron_line_value="$1"
  cron_line_owner="$(cron_owner "$cron_line_value")"
  if [ "$cron_line_owner" = "$OWNER_SELF" ]; then
    printf '%s\n' "$cron_line_value" | grep -Fq "$DB_DIR/opencode-db-scheduled.sh"
    return $?
  fi
  if [ -z "$cron_line_owner" ] && legacy_adoption_ok && cron_shape_ours "$cron_line_value"; then
    return 0
  fi
  return 1
}

cron_read() {
  cron_read_out="$(LC_ALL=C crontab -l 2>/dev/null)" && {
    printf '%s' "$cron_read_out"
    return 0
  }
  cron_read_err="$(LC_ALL=C crontab -l 2>&1 >/dev/null)" || true
  if printf '%s%s' "$cron_read_out" "$cron_read_err" | grep -qi 'no crontab for'; then
    printf ''
    return 0
  fi
  return 1
}

resolve_cron_state() {
  resolve_prev="$1"
  resolve_fresh="$2"
  resolve_attempted="$3"
  if resolve_scan="$(cron_read)"; then
    resolve_field="none"
    while IFS= read -r resolve_line; do
      [ -n "$resolve_line" ] || continue
      if cron_tagged "$resolve_line"; then
        resolve_owner="$(cron_owner "$resolve_line")"
        if [ -z "$resolve_owner" ] || cron_ours "$resolve_line"; then
          resolve_field="owned"
        fi
      fi
    done <<EOF
$resolve_scan
EOF
    printf '%s\n' "$resolve_field"
    return 0
  fi
  if [ "$resolve_attempted" = "1" ]; then printf 'owned\n'; return 0; fi
  if [ "$resolve_prev" = "none" ]; then printf 'none\n'; return 0; fi
  if [ "$resolve_fresh" = "1" ]; then printf 'none\n'; return 0; fi
  printf 'owned\n'
}

print_cleanup() {
  token="$1"
  say "the maintenance schedule is owned by $token; remove it with:"
  say "  systemctl --user disable --now $TIMER_UNIT"
  say "  rm -f '$CONFIG_BASE/systemd/user/$SERVICE_UNIT' '$CONFIG_BASE/systemd/user/$TIMER_UNIT'"
  say "  systemctl --user daemon-reload"
  say "  crontab -l | grep -vF '# $TRIGGER_TAG owner=$token' | crontab -"
}

scan_foreign_schedule() {
  found_tokens=""
  for candidate in "$CONFIG_BASE/systemd/user/$SERVICE_UNIT" "$CONFIG_BASE/systemd/user/$TIMER_UNIT"; do
    token="$(unit_stamp "$candidate")"
    if [ -n "$token" ]; then
      case " $found_tokens " in *" $token "*) : ;; *) found_tokens="$found_tokens $token" ;; esac
    fi
  done
  if command -v crontab >/dev/null 2>&1; then
    CRON_NOW="$(crontab -l 2>/dev/null || true)"
    if [ -n "$CRON_NOW" ]; then
      while IFS= read -r line; do
        if cron_tagged "$line"; then
          token="$(cron_owner "$line")"
          if [ -n "$token" ]; then
            case " $found_tokens " in *" $token "*) : ;; *) found_tokens="$found_tokens $token" ;; esac
          fi
        fi
      done <<EOF
$CRON_NOW
EOF
    fi
  fi
  for token in $found_tokens; do
    print_cleanup "$token"
  done
}

uninstall_maintenance() {
  if [ ! -e "$MARKER" ] && [ ! -d "$DB_DIR" ]; then
    say "no database maintenance lane installed at $DB_DIR"
    exit 0
  fi
  if [ -f "$MARKER" ] && ! own_marker && [ "$FORCE" != 1 ]; then
    fail "no Tawassul maintenance marker at $MARKER; pass --force to remove $DB_DIR anyway"
  fi
  if version_has_db; then
    if [ "$DRY_RUN" = "1" ]; then
      say "dry run - would remove only $MARKER; $RUNTIME/VERSION records the repository database lane"
      exit 0
    fi
    rm -f "$MARKER"
    rmdir "$DB_DIR" 2>/dev/null || true
    say "removed the database maintenance marker at $MARKER"
    say "kept the five scripts and the schedule recorded by $RUNTIME/VERSION"
    scan_foreign_schedule
    exit 0
  fi
  CRON_FIELD="$(marker_cron)"
  if [ "$DRY_RUN" = "1" ]; then
    if [ "$CRON_FIELD" != "none" ]; then
      if ! command -v crontab >/dev/null 2>&1 || ! cron_read >/dev/null 2>&1; then
        say "dry run - a real uninstall would refuse: crontab could not be read"
        exit 0
      fi
    fi
    say "dry run - would remove the database scripts, marker and this lane's own schedule under $DB_DIR"
    exit 0
  fi
  CRON_OLD=""
  CRON_READ_OK=0
  if command -v crontab >/dev/null 2>&1; then
    if CRON_OLD="$(cron_read)"; then
      CRON_READ_OK=1
    fi
  fi
  if [ "$CRON_FIELD" = "none" ]; then
    if [ "$CRON_READ_OK" != "1" ]; then
      say "crontab is not readable; the marker records that this lane wrote no cron entry, so the staged files are removed"
      CRON_OLD=""
    fi
  else
    if [ "$CRON_READ_OK" != "1" ]; then
      fail "crontab could not be read; the maintenance lane was not removed"
    fi
  fi
  left_cron_owner=""
  left_cron_unproven=0
  CRON_NEW=""
  cron_dropped=0
  if [ "$CRON_READ_OK" = "1" ] && [ -n "$CRON_OLD" ]; then
    while IFS= read -r cron_line; do
      if cron_tagged "$cron_line"; then
        if cron_ours "$cron_line"; then
          cron_dropped=1
          continue
        fi
        cron_token="$(cron_owner "$cron_line")"
        if [ -n "$cron_token" ]; then
          if [ -z "$left_cron_owner" ]; then left_cron_owner="$cron_token"; fi
        else
          left_cron_unproven=1
        fi
      fi
      CRON_NEW="$CRON_NEW$cron_line
"
    done <<EOF
$CRON_OLD
EOF
  fi
  if [ "$left_cron_unproven" = 1 ]; then
    fail "a tagged cron entry has no owner stamp; the maintenance lane was not removed"
  fi
  if [ "$cron_dropped" = 1 ]; then
    if ! printf '%s' "$CRON_NEW" | crontab - 2>/dev/null; then
      fail "crontab could not remove the maintenance entry; the lane was not removed"
    fi
  fi
  UNIT_DIR="$CONFIG_BASE/systemd/user"
  SERVICE_FILE="$UNIT_DIR/$SERVICE_UNIT"
  TIMER_FILE="$UNIT_DIR/$TIMER_UNIT"
  units_owned=0
  if [ -f "$SERVICE_FILE" ] || [ -f "$TIMER_FILE" ]; then
    stamp_service="$(unit_stamp "$SERVICE_FILE")"
    stamp_timer="$(unit_stamp "$TIMER_FILE")"
    if [ "$stamp_service" = "$OWNER_SELF" ] && [ "$stamp_timer" = "$OWNER_SELF" ]; then
      units_owned=1
    elif [ -z "$stamp_service" ] && [ -z "$stamp_timer" ] && own_marker \
      && unit_shape_ours "$SERVICE_FILE" && unit_shape_ours "$TIMER_FILE"; then
      units_owned=1
    fi
  fi
  left_unit_owner=""
  if [ "$units_owned" = 1 ]; then
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user disable --now "$TIMER_UNIT" >/dev/null 2>&1 || true
    fi
    rm -f "$SERVICE_FILE" "$TIMER_FILE"
  elif [ -f "$SERVICE_FILE" ] || [ -f "$TIMER_FILE" ]; then
    left_unit_owner="$(unit_stamp "$SERVICE_FILE")"
    [ -n "$left_unit_owner" ] || left_unit_owner="$(unit_stamp "$TIMER_FILE")"
  fi
  for file in $MAINT_FILES; do
    rm -f "$DB_DIR/$file"
  done
  rm -f "$MARKER"
  rmdir "$DB_DIR" 2>/dev/null || true
  rmdir "$RUNTIME" 2>/dev/null || true
  say "removed the database maintenance lane at $DB_DIR"
  say "kept every plugin bundle and every marker this mode did not write"
  cleanup_token="$left_unit_owner"
  [ -n "$cleanup_token" ] || cleanup_token="$left_cron_owner"
  if [ -n "$cleanup_token" ]; then
    print_cleanup "$cleanup_token"
  fi
  exit 0
}

unit_safe() {
  case "$1" in
    *'"'*|*'%'*|*'$'*|*'`'*|*'\'*|*"'"*) fail "unsupported character in the maintenance value: $1" ;;
  esac
}

remove_owned_schedule() {
  CRON_OLD=""
  if command -v crontab >/dev/null 2>&1; then
    if ! CRON_OLD="$(cron_read)"; then
      printf '%s\n' "install: crontab could not be read; the maintenance lane was kept" >&2
      return 4
    fi
  fi
  UNIT_DIR="$CONFIG_BASE/systemd/user"
  SERVICE_FILE="$UNIT_DIR/$SERVICE_UNIT"
  TIMER_FILE="$UNIT_DIR/$TIMER_UNIT"
  stamp_service="$(unit_stamp "$SERVICE_FILE")"
  stamp_timer="$(unit_stamp "$TIMER_FILE")"
  units_owned=0
  if [ -f "$SERVICE_FILE" ] || [ -f "$TIMER_FILE" ]; then
    if [ "$stamp_service" = "$OWNER_SELF" ] && [ "$stamp_timer" = "$OWNER_SELF" ]; then
      units_owned=1
    elif [ -z "$stamp_service" ] && [ -z "$stamp_timer" ] && legacy_adoption_ok \
      && unit_shape_ours "$SERVICE_FILE" && unit_shape_ours "$TIMER_FILE"; then
      units_owned=1
    fi
  fi
  if [ "$units_owned" = 1 ]; then
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user disable --now "$TIMER_UNIT" >/dev/null 2>&1 || true
    fi
    rm -f "$SERVICE_FILE" "$TIMER_FILE"
  fi
  if command -v crontab >/dev/null 2>&1; then
    CRON_NEW=""
    cron_dropped=0
    if [ -n "$CRON_OLD" ]; then
      while IFS= read -r cron_line; do
        if cron_tagged "$cron_line"; then
          if cron_ours "$cron_line"; then
            cron_dropped=1
            continue
          fi
        fi
        CRON_NEW="$CRON_NEW$cron_line
"
      done <<EOF
$CRON_OLD
EOF
    fi
    if [ "$cron_dropped" = 1 ]; then
      if ! printf '%s' "$CRON_NEW" | crontab - 2>/dev/null; then
        printf '%s\n' "install: crontab could not remove the maintenance entry" >&2
        return 4
      fi
    fi
  fi
  return 0
}

register_db_timer() {
  unit_safe "$DB_DIR/opencode-db-scheduled.sh"
  OPT_OUT="$(printf '%s' "${TAWASSUL_DB_MAINTENANCE:-}" | tr '[:upper:]' '[:lower:]')"
  case "$OPT_OUT" in
    off|0|false|disabled)
      if ! remove_owned_schedule; then
        return 4
      fi
      printf 'off\n'
      return 0 ;;
  esac
  MODE_REQ="$(printf '%s' "${TAWASSUL_REGISTER_TRIGGERS:-auto}" | tr '[:upper:]' '[:lower:]')"
  case "$MODE_REQ" in
    off|systemd|cron|manual|auto) : ;;
    *) printf '%s\n' "install: TAWASSUL_REGISTER_TRIGGERS must be off, systemd, cron, manual, or auto" >&2; return 2 ;;
  esac
  if [ "$MODE_REQ" = "off" ]; then
    printf 'off\n'
    return 0
  fi
  GAP_SECONDS="${TAWASSUL_DB_GAP_SECONDS:-86400}"
  case "$GAP_SECONDS" in
    ''|*[!0-9]*) printf '%s\n' "install: TAWASSUL_DB_GAP_SECONDS must be a non-negative integer" >&2; return 2 ;;
  esac
  DATA_CAPTURE="${XDG_DATA_HOME:-}"
  if [ -n "$DATA_CAPTURE" ]; then unit_safe "$DATA_CAPTURE"; fi
  if [ -n "$PREFIX" ]; then
    PREFIX_REAL="$(canon_path "$PREFIX")"
    HOME_REAL="$(canon_path "$HOME")"
    CONFIG_REAL="$(canon_path "$CONFIG_BASE")"
    EXPECTED_CONFIG_REAL="$(canon_path "${XDG_CONFIG_HOME:-$HOME/.config}")"
    if [ -z "$PREFIX_REAL" ] || [ "$PREFIX_REAL" != "$HOME_REAL" ] \
      || [ -z "$CONFIG_REAL" ] || [ -z "$EXPECTED_CONFIG_REAL" ] \
      || [ "$CONFIG_REAL" != "$EXPECTED_CONFIG_REAL" ]; then
      if [ "$MODE_REQ" = "systemd" ] || [ "$MODE_REQ" = "cron" ]; then
        printf '%s\n' "install: a scratch --prefix cannot register $MODE_REQ; the host schedule would point into $PREFIX" >&2
        printf '%s\n' "install: set TAWASSUL_REGISTER_TRIGGERS=manual to install without a host schedule and run: bash \"$DB_DIR/opencode-db-scheduled.sh\" --run" >&2
        return 5
      fi
      printf '%s\n' "install: scratch --prefix detected; leaving the trigger manual (no host schedule)" >&2
      printf 'manual\n'
      return 0
    fi
  fi
  UNIT_DIR="$CONFIG_BASE/systemd/user"
  SERVICE_FILE="$UNIT_DIR/$SERVICE_UNIT"
  TIMER_FILE="$UNIT_DIR/$TIMER_UNIT"
  CRON_OLD=""
  cron_readable=1
  if command -v crontab >/dev/null 2>&1; then
    if ! CRON_OLD="$(cron_read)"; then
      cron_readable=0
    fi
  fi
  foreign=0
  foreign_owner=""
  legacy_units=0
  for candidate in "$SERVICE_FILE" "$TIMER_FILE"; do
    [ -f "$candidate" ] || continue
    found_owner="$(unit_stamp "$candidate")"
    if [ -n "$found_owner" ]; then
      if [ "$found_owner" != "$OWNER_SELF" ]; then
        foreign=1
        [ -n "$foreign_owner" ] || foreign_owner="$found_owner"
      fi
    elif unit_shape_ours "$candidate"; then
      legacy_units=$(( legacy_units + 1 ))
    else
      foreign=1
      [ -n "$foreign_owner" ] || foreign_owner="an unstamped unit"
    fi
  done
  cron_legacy=0
  if [ -n "$CRON_OLD" ]; then
    while IFS= read -r cron_line; do
      if cron_tagged "$cron_line"; then
        cron_token="$(cron_owner "$cron_line")"
        if [ -n "$cron_token" ]; then
          if [ "$cron_token" != "$OWNER_SELF" ]; then
            foreign=1
            [ -n "$foreign_owner" ] || foreign_owner="$cron_token"
          fi
        elif cron_shape_ours "$cron_line"; then
          cron_legacy=$(( cron_legacy + 1 ))
        else
          foreign=1
          [ -n "$foreign_owner" ] || foreign_owner="an unstamped cron line"
        fi
      fi
    done <<EOF
$CRON_OLD
EOF
  fi
  if [ "$legacy_units" -gt 0 ] || [ "$cron_legacy" -gt 0 ]; then
    if ! own_marker || version_has_db; then
      foreign=1
      [ -n "$foreign_owner" ] || foreign_owner="an unstamped legacy schedule"
    fi
  fi
  if [ "$foreign" = "1" ] && [ "$FORCE" != "1" ]; then
    if [ "$MODE_REQ" = "systemd" ] || [ "$MODE_REQ" = "cron" ]; then
      printf '%s\n' "install: a $TRIGGER_TAG schedule owned by $foreign_owner already exists; refusing to register $MODE_REQ (pass --force to take it over)" >&2
      return 3
    fi
    printf '%s\n' "install: a $TRIGGER_TAG schedule owned by $foreign_owner already exists; leaving the trigger manual" >&2
    printf 'manual\n'
    return 0
  fi
  if [ "$MODE_REQ" = "systemd" ] || [ "$MODE_REQ" = "auto" ]; then
    if command -v systemctl >/dev/null 2>&1; then
      mkdir -p "$UNIT_DIR"
      {
        printf '# tawassul-owner: %s\n' "$OWNER_SELF"
        printf '[Unit]\n'
        printf 'Description=Tawassul v2 DB maintenance lane\n'
        printf '\n'
        printf '[Service]\n'
        printf 'Type=oneshot\n'
        printf 'Environment="OPENCODE_DB=%s"\n' "$DB_PATH"
        printf 'Environment="TAWASSUL_DB_GAP_SECONDS=%s"\n' "$GAP_SECONDS"
        if [ -n "$DATA_CAPTURE" ]; then
          printf 'Environment="XDG_DATA_HOME=%s"\n' "$DATA_CAPTURE"
        fi
        printf 'ExecStart=/usr/bin/env bash "%s" --run\n' "$DB_DIR/opencode-db-scheduled.sh"
        printf '\n'
      } > "$SERVICE_FILE"
      {
        printf '# tawassul-owner: %s\n' "$OWNER_SELF"
        printf '[Unit]\n'
        printf 'Description=Tawassul v2 DB maintenance schedule\n'
        printf '\n'
        printf '[Timer]\n'
        printf 'OnCalendar=*-*-* 04:17:00\n'
        printf 'RandomizedDelaySec=600\n'
        printf 'Persistent=true\n'
        printf '\n'
        printf '[Install]\n'
        printf 'WantedBy=timers.target\n'
        printf '\n'
      } > "$TIMER_FILE"
      if systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user enable --now "$TIMER_UNIT" >/dev/null 2>&1; then
        if command -v crontab >/dev/null 2>&1 && [ "$cron_readable" = "1" ]; then
          CRON_NOW="$CRON_OLD"
          if [ -n "$CRON_NOW" ]; then
            CRON_LEFT=""
            cron_dropped=0
            while IFS= read -r cron_line; do
              if cron_tagged "$cron_line"; then
                if [ "$FORCE" = "1" ] || cron_ours "$cron_line"; then
                  cron_dropped=1
                  continue
                fi
              fi
              CRON_LEFT="$CRON_LEFT$cron_line
"
            done <<EOF
$CRON_NOW
EOF
            if [ "$cron_dropped" = 1 ]; then
              if ! printf '%s' "$CRON_LEFT" | crontab - 2>/dev/null; then
                systemctl --user disable --now "$TIMER_UNIT" >/dev/null 2>&1 || true
                rm -f "$SERVICE_FILE" "$TIMER_FILE"
                printf '%s\n' "install: crontab could not remove the previous maintenance entry" >&2
                return 4
              fi
            fi
          fi
        fi
        if [ "$cron_readable" != "1" ]; then
          printf '%s\n' "install: crontab could not be read; the previous cron entry was left in place" >&2
        fi
        printf 'systemd\n'
        return 0
      fi
      rm -f "$SERVICE_FILE" "$TIMER_FILE"
      if [ "$MODE_REQ" = "systemd" ]; then
        printf '%s\n' "install: systemctl could not register $TIMER_UNIT" >&2
        return 4
      fi
    elif [ "$MODE_REQ" = "systemd" ]; then
      printf '%s\n' "install: systemctl is unavailable; cannot register $TIMER_UNIT" >&2
      return 4
    fi
  fi
  if [ "$MODE_REQ" = "cron" ] || [ "$MODE_REQ" = "auto" ]; then
    if command -v crontab >/dev/null 2>&1; then
      if [ "$cron_readable" != "1" ]; then
        printf '%s\n' "install: crontab could not be read; refusing to rewrite an unknown schedule" >&2
        return 4
      fi
      if [ -f "$SERVICE_FILE" ] || [ -f "$TIMER_FILE" ]; then
        if command -v systemctl >/dev/null 2>&1; then
          systemctl --user disable --now "$TIMER_UNIT" >/dev/null 2>&1 || true
        fi
        rm -f "$SERVICE_FILE" "$TIMER_FILE"
      fi
      CRON_ENV="OPENCODE_DB='$DB_PATH' TAWASSUL_DB_GAP_SECONDS='$GAP_SECONDS'"
      if [ -n "$DATA_CAPTURE" ]; then
        CRON_ENV="XDG_DATA_HOME='$DATA_CAPTURE' $CRON_ENV"
      fi
      CRON_LINE="17 4 * * * $CRON_ENV /usr/bin/env bash '$DB_DIR/opencode-db-scheduled.sh' --run # $TRIGGER_TAG owner=$OWNER_SELF"
      CRON_WRITE_ATTEMPTED=1
      if printf '%s\n' "$CRON_OLD" | grep -Fxq "$CRON_LINE"; then
        printf 'cron\n'
        return 0
      fi
      CRON_KEPT=""
      if [ -n "$CRON_OLD" ]; then
        while IFS= read -r cron_line; do
          if cron_tagged "$cron_line"; then continue; fi
          CRON_KEPT="$CRON_KEPT$cron_line
"
        done <<EOF
$CRON_OLD
EOF
      fi
      if printf '%s' "$CRON_KEPT$CRON_LINE
" | crontab - 2>/dev/null; then
        printf 'cron\n'
        return 0
      fi
      if [ "$MODE_REQ" = "cron" ]; then
        printf '%s\n' "install: crontab could not register the maintenance lane" >&2
        return 4
      fi
    elif [ "$MODE_REQ" = "cron" ]; then
      printf '%s\n' "install: crontab is unavailable; cannot register the maintenance lane" >&2
      return 4
    fi
  fi
  printf 'manual\n'
}

snapshot_maintenance() {
  SNAP="$TMP/snapshot"
  mkdir -p "$SNAP/units"
  HAD_DB_DIR=0
  [ -d "$DB_DIR" ] && HAD_DB_DIR=1
  for file in $MAINT_FILES; do
    [ -f "$DB_DIR/$file" ] && cp -p "$DB_DIR/$file" "$SNAP/$file"
  done
  [ -f "$MARKER" ] && cp -p "$MARKER" "$SNAP/MAINTENANCE"
  UNIT_DIR="$CONFIG_BASE/systemd/user"
  for unit in "$SERVICE_UNIT" "$TIMER_UNIT"; do
    [ -f "$UNIT_DIR/$unit" ] && cp -p "$UNIT_DIR/$unit" "$SNAP/units/$unit"
  done
  CRON_SNAPSHOT_OK=1
  if command -v crontab >/dev/null 2>&1; then
    if CRON_SNAP="$(cron_read)"; then
      printf '%s\n' "$CRON_SNAP" > "$SNAP/cron.before"
    else
      CRON_SNAPSHOT_OK=0
    fi
  fi
  return 0
}

rollback_maintenance() {
  for file in $MAINT_FILES; do
    if [ -f "$SNAP/$file" ]; then
      cp -p "$SNAP/$file" "$DB_DIR/$file" 2>/dev/null || true
    else
      rm -f "$DB_DIR/$file"
    fi
  done
  if [ -f "$SNAP/MAINTENANCE" ]; then
    cp -p "$SNAP/MAINTENANCE" "$MARKER" 2>/dev/null || true
  else
    rm -f "$MARKER"
  fi
  UNIT_DIR="$CONFIG_BASE/systemd/user"
  for unit in "$SERVICE_UNIT" "$TIMER_UNIT"; do
    if [ -f "$SNAP/units/$unit" ]; then
      mkdir -p "$UNIT_DIR" 2>/dev/null || true
      cp -p "$SNAP/units/$unit" "$UNIT_DIR/$unit" 2>/dev/null || true
    else
      rm -f "$UNIT_DIR/$unit"
    fi
  done
  if command -v crontab >/dev/null 2>&1 && [ -f "$SNAP/cron.before" ] && [ "${CRON_SNAPSHOT_OK:-0}" = "1" ]; then
    crontab "$SNAP/cron.before" 2>/dev/null || true
  fi
  if [ "$HAD_DB_DIR" = "0" ]; then
    rmdir "$DB_DIR" 2>/dev/null || true
    rmdir "$RUNTIME" 2>/dev/null || true
  fi
  return 0
}

install_maintenance() {
  derive_db_path
  MAINT_NAME="tawassul-db-maintenance-$RELEASE.tar.gz"
  if version_has_db && [ "$FORCE" != 1 ]; then
    fail "$RUNTIME/VERSION records the repository database lane; pass --force to replace its scripts and schedule"
  fi
  if [ "$DRY_RUN" = "1" ]; then
    say "dry run - would install the database maintenance lane for $RELEASE"
    say "  db:      $DB_PATH"
    say "  runtime: $DB_DIR"
    say "  no plugin bundle, VERSION marker, or opencode.json is written"
    if [ -n "$FROM" ]; then say "  source:  $FROM"; else say "  source:  $BASE_URL"; fi
    exit 0
  fi
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/tawassul-maint.XXXXXX")"
  trap 'rm -r "$TMP" 2>/dev/null || true' EXIT INT TERM
  if [ -n "$FROM" ]; then
    [ -d "$FROM" ] || fail "--from directory does not exist: $FROM"
    [ -f "$FROM/SHA256SUMS" ] || fail "no SHA256SUMS in $FROM"
    [ -f "$FROM/$MAINT_NAME" ] || fail "no $MAINT_NAME in $FROM"
    SUMS="$FROM/SHA256SUMS"
    ARCHIVE="$FROM/$MAINT_NAME"
  else
    SUMS="$TMP/SHA256SUMS"
    ARCHIVE="$TMP/$MAINT_NAME"
    fetch "$BASE_URL/SHA256SUMS" "$SUMS" || fail "cannot download $BASE_URL/SHA256SUMS"
    fetch "$BASE_URL/$MAINT_NAME" "$ARCHIVE" || fail "cannot download $BASE_URL/$MAINT_NAME"
  fi
  WANTED="$(sum_for "$MAINT_NAME" "$SUMS")"
  [ -n "$WANTED" ] || fail "SHA256SUMS has no entry for $MAINT_NAME; refusing an unverified artifact"
  GOT="$(hash_file "$ARCHIVE")"
  [ "$GOT" = "$WANTED" ] || fail "checksum mismatch for $MAINT_NAME: $GOT vs $WANTED"
  LIST="$TMP/archive.list"
  tar -tzf "$ARCHIVE" > "$LIST" || fail "cannot read $MAINT_NAME"
  if grep -v -E '^tawassul-db-maintenance(/|$)' "$LIST" | grep -q .; then
    fail "$MAINT_NAME contains a path outside tawassul-db-maintenance/"
  fi
  if grep -q '\.\.' "$LIST"; then fail "$MAINT_NAME contains a parent traversal"; fi
  for file in $MAINT_FILES; do
    grep -qx "tawassul-db-maintenance/$file" "$LIST" || fail "$MAINT_NAME is missing $file"
  done
  [ "$(grep -c '\.sh$' "$LIST")" -eq 5 ] || fail "$MAINT_NAME must carry exactly five database scripts"
  if [ -d "$DB_DIR" ] && [ ! -f "$MARKER" ] && [ "$FORCE" != "1" ]; then
    fail "$DB_DIR exists without a Tawassul maintenance marker; pass --force to replace it"
  fi
  GAP_SECONDS="${TAWASSUL_DB_GAP_SECONDS:-86400}"
  case "$GAP_SECONDS" in
    ''|*[!0-9]*) fail "TAWASSUL_DB_GAP_SECONDS must be a non-negative integer" ;;
  esac
  FRESH_LANE=0
  if [ ! -f "$MARKER" ] && [ ! -d "$DB_DIR" ]; then FRESH_LANE=1; fi
  PREV_CRON=""
  PREV_TRIGGER="manual"
  if own_marker; then
    PREV_CRON="$(marker_cron)"
    PREV_TRIGGER="$(marker_trigger_value)"
    [ -n "$PREV_TRIGGER" ] || PREV_TRIGGER="manual"
  fi
  NORM_OPT_OUT="$(printf '%s' "${TAWASSUL_DB_MAINTENANCE:-}" | tr '[:upper:]' '[:lower:]')"
  NORM_TRIGGER_MODE="$(printf '%s' "${TAWASSUL_REGISTER_TRIGGERS:-auto}" | tr '[:upper:]' '[:lower:]')"
  MAY_WRITE_CRON=0
  case "$NORM_OPT_OUT" in
    off|0|false|disabled) : ;;
    *)
      case "$NORM_TRIGGER_MODE" in
        cron|auto) MAY_WRITE_CRON=1 ;;
      esac ;;
  esac
  snapshot_maintenance
  mkdir -p "$DB_DIR"
  if ! tar -xzf "$ARCHIVE" -C "$TMP"; then
    rollback_maintenance
    fail "cannot unpack $MAINT_NAME; the previous lane was restored"
  fi
  for file in $MAINT_FILES; do
    if ! cp "$TMP/tawassul-db-maintenance/$file" "$DB_DIR/$file.tmp.$$" \
      || ! chmod 700 "$DB_DIR/$file.tmp.$$" \
      || ! mv "$DB_DIR/$file.tmp.$$" "$DB_DIR/$file"; then
      rm -f "$DB_DIR/$file.tmp.$$"
      rollback_maintenance
      fail "cannot stage $file; the previous lane was restored"
    fi
  done
  if [ "$MAY_WRITE_CRON" = "1" ]; then
    if ! write_marker_file "$PREV_TRIGGER" owned; then
      rollback_maintenance
      fail "cannot write $MARKER; the previous lane was restored"
    fi
  fi
  CRON_WRITE_ATTEMPTED=0
  if ! register_db_timer > "$TMP/trigger.mode"; then
    rollback_maintenance
    fail "database maintenance registration failed; the previous lane was restored"
  fi
  TRIGGER_MODE="$(cat "$TMP/trigger.mode")"
  CRON_STATE="$(resolve_cron_state "$PREV_CRON" "$FRESH_LANE" "$CRON_WRITE_ATTEMPTED")"
  if ! write_marker_file "$TRIGGER_MODE" "$CRON_STATE"; then
    rollback_maintenance
    fail "cannot write $MARKER; the previous lane was restored"
  fi
  say "installed the database maintenance lane for $RELEASE"
  say "  db:      $DB_PATH"
  say "  runtime: $DB_DIR (5 scripts)"
  say "  trigger: $TRIGGER_MODE"
  if [ "$TRIGGER_MODE" = "manual" ]; then
    say "run the lane manually with: bash \"$DB_DIR/opencode-db-scheduled.sh\" --run"
  fi
  say "  no plugin bundle, VERSION marker, or opencode.json was written"
}

if [ "$DB_MODE" = "1" ]; then
  if [ "$UNINSTALL" = "1" ]; then uninstall_maintenance; fi
  install_maintenance
  exit 0
fi

if [ -e "$(dirname "$ENTRY")/tawassul" ] && [ -f "$(dirname "$ENTRY")/tawassul/index.js" ]; then
  fail "a directory-layout install already occupies $(dirname "$ENTRY")/tawassul; remove it first"
fi

if [ "$SCOPE" = "project" ] && [ "$UNINSTALL" != "1" ] && [ -f "$PROJECT/.opencode/plugin/tawassul.js" ]; then
  fail "a legacy flat entry exists at $PROJECT/.opencode/plugin/tawassul.js; remove it before installing the plural entry"
fi

if [ "$UNINSTALL" = "1" ]; then
  if [ ! -e "$ENTRY" ] && [ ! -d "$RUNTIME" ]; then
    say "nothing installed at $ENTRY"
    exit 0
  fi
  if ! marker_owned && [ "$FORCE" != "1" ]; then
    fail "no Tawassul marker at $MARKER; pass --force to remove $ENTRY anyway"
  fi
  if [ "$SCOPE" = "global" ] && version_has_db && [ "$FORCE" != "1" ]; then
    fail "$RUNTIME/VERSION records a database payload; pass --force to remove it"
  fi
  if [ "$DRY_RUN" = "1" ]; then
    say "dry run - would remove $ENTRY"
    say "dry run - would remove the wasm and marker under $RUNTIME"
    exit 0
  fi
  rm -f "$ENTRY"
  if [ -d "$RUNTIME" ]; then
    for id in web-tree-sitter tree-sitter-javascript tree-sitter-typescript; do
      rm -f "$RUNTIME/wasm/$id/"*.wasm 2>/dev/null || true
      rmdir "$RUNTIME/wasm/$id" 2>/dev/null || true
    done
    rm -f "$MARKER"
    rmdir "$RUNTIME/wasm" 2>/dev/null || true
    rmdir "$RUNTIME" 2>/dev/null || true
  fi
  say "removed $ENTRY"
  say "kept every file this installer did not write"
  if [ "$SCOPE" = "global" ]; then scan_foreign_schedule; fi
  exit 0
fi

BUNDLE_NAME="tawassul-$RELEASE.global.js"
ARCHIVE_NAME="tawassul-runtime-$RELEASE.tar.gz"

if [ "$DRY_RUN" = "1" ]; then
  say "dry run - would install Tawassul $RELEASE"
  say "  entry:   $ENTRY"
  say "  runtime: $RUNTIME"
  if [ -n "$FROM" ]; then
    say "  source:  $FROM"
  else
    say "  source:  $BASE_URL"
  fi
  say "  no opencode.json or opencode.jsonc is written"
  exit 0
fi

if [ "$SCOPE" = "global" ] && version_has_db && [ "$FORCE" != "1" ]; then
  fail "$RUNTIME/VERSION records a database payload; pass --force to overwrite it"
fi

if [ -e "$RUNTIME" ] && ! runtime_owned && [ "$FORCE" != "1" ]; then
  fail "$RUNTIME exists without a Tawassul marker; pass --force to replace it"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/tawassul-install.XXXXXX")"
trap 'rm -r "$TMP" 2>/dev/null || true' EXIT INT TERM

if [ -n "$FROM" ]; then
  [ -d "$FROM" ] || fail "--from directory does not exist: $FROM"
  [ -f "$FROM/SHA256SUMS" ] || fail "no SHA256SUMS in $FROM"
  [ -f "$FROM/$BUNDLE_NAME" ] || fail "no $BUNDLE_NAME in $FROM"
  [ -f "$FROM/$ARCHIVE_NAME" ] || fail "no $ARCHIVE_NAME in $FROM"
  SUMS="$FROM/SHA256SUMS"
  BUNDLE="$FROM/$BUNDLE_NAME"
  ARCHIVE="$FROM/$ARCHIVE_NAME"
else
  SUMS="$TMP/SHA256SUMS"
  BUNDLE="$TMP/$BUNDLE_NAME"
  ARCHIVE="$TMP/$ARCHIVE_NAME"
  fetch "$BASE_URL/SHA256SUMS" "$SUMS" || fail "cannot download $BASE_URL/SHA256SUMS"
  fetch "$BASE_URL/$BUNDLE_NAME" "$BUNDLE" || fail "cannot download $BASE_URL/$BUNDLE_NAME"
  fetch "$BASE_URL/$ARCHIVE_NAME" "$ARCHIVE" || fail "cannot download $BASE_URL/$ARCHIVE_NAME"
fi

for pair in "$BUNDLE_NAME:$BUNDLE" "$ARCHIVE_NAME:$ARCHIVE"; do
  name="${pair%%:*}"
  file="${pair#*:}"
  expected="$(sum_for "$name" "$SUMS")"
  [ -n "$expected" ] || fail "SHA256SUMS has no entry for $name; refusing an unverified artifact"
  actual="$(hash_file "$file")"
  [ "$actual" = "$expected" ] || fail "checksum mismatch for $name: $actual vs $expected"
done

LIST="$TMP/archive.list"
tar -tzf "$ARCHIVE" > "$LIST" || fail "cannot read $ARCHIVE"
if grep -v -E '^tawassul-runtime(/|$)' "$LIST" | grep -q .; then
  fail "$ARCHIVE contains a path outside tawassul-runtime/"
fi
if grep -q '\.\.' "$LIST"; then
  fail "$ARCHIVE contains a parent traversal"
fi
for rel in \
  web-tree-sitter/web-tree-sitter.wasm \
  tree-sitter-javascript/tree-sitter-javascript.wasm \
  tree-sitter-typescript/tree-sitter-typescript.wasm \
  tree-sitter-typescript/tree-sitter-tsx.wasm
do
  grep -qx "tawassul-runtime/wasm/$rel" "$LIST" || fail "$ARCHIVE is missing wasm/$rel"
done
[ "$(grep -c '\.wasm$' "$LIST")" -eq 4 ] || fail "$ARCHIVE must carry exactly four wasm files"

mkdir -p "$(dirname "$ENTRY")" "$CONFIG_ROOT"
cp "$BUNDLE" "$ENTRY.tmp.$$"
chmod 644 "$ENTRY.tmp.$$"
mv "$ENTRY.tmp.$$" "$ENTRY"
tar -xzf "$ARCHIVE" -C "$CONFIG_ROOT"

BUNDLE_SHA="$(hash_file "$ENTRY")"
BUNDLE_BYTES="$(wc -c < "$ENTRY" | tr -d ' ')"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

{
  printf '{\n'
  printf '  "package": "tawassul-v2",\n'
  printf '  "lane": "install.sh",\n'
  printf '  "version": "%s",\n' "$RELEASE"
  printf '  "bundle": { "sha256": "%s", "bytes": %s },\n' "$BUNDLE_SHA" "$BUNDLE_BYTES"
  printf '  "wasm": {\n'
  first=1
  for rel in \
    web-tree-sitter/web-tree-sitter.wasm \
    tree-sitter-javascript/tree-sitter-javascript.wasm \
    tree-sitter-typescript/tree-sitter-typescript.wasm \
    tree-sitter-typescript/tree-sitter-tsx.wasm
  do
    id="$(basename "$rel" .wasm)"
    file="$RUNTIME/wasm/$rel"
    [ -f "$file" ] || fail "extraction did not produce $file"
    [ "$first" = "1" ] || printf ',\n'
    first=0
    printf '    "%s": { "sha256": "%s", "bytes": %s }' "$id" "$(hash_file "$file")" "$(wc -c < "$file" | tr -d ' ')"
  done
  printf '\n  },\n'
  printf '  "installedAt": "%s"\n' "$STAMP"
  printf '}\n'
} > "$MARKER"

say "installed Tawassul $RELEASE"
say "  entry:   $ENTRY ($(printf '%s' "$BUNDLE_SHA" | cut -c1-12))"
say "  runtime: $RUNTIME/wasm (4 grammars)"
say "  no opencode.json or opencode.jsonc was written; restart the host to load it"
