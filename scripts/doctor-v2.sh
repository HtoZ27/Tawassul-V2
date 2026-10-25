#!/usr/bin/env bash
set -u

ROOT="${TAWASSUL_DOCTOR_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ROOT="$(realpath "$ROOT" 2>/dev/null || printf '%s' "$ROOT")"
HOME_DIR="${HOME:-}"
ENTRY="$ROOT/.opencode/plugin/tawassul.js"
STATE_FILE="$ROOT/.opencode/tawassul-state.json"
PROJECT_ROUTER="$ROOT/.opencode/predictive-router.json"
CONFIG_BASE="${XDG_CONFIG_HOME:-$HOME_DIR/.config}"
GLOBAL_ROUTER="$CONFIG_BASE/tawassul-v2/state/predictive-router.json"
LEGACY_ROUTER="$HOME_DIR/.config/tawassyl/state/predictive-router.json"
KEY_DIR="${TAWASSUL_HMAC_KEY_DIR:-$HOME_DIR/.config/tawassul}"
KEY_FILE="$KEY_DIR/.tawassul-hmac-key"
SHARED_DB="$HOME_DIR/.local/share/opencode/opencode.db"
LAUNCHER_DB="$HOME_DIR/.local/share/tawassul-v2/opencode-v2.db"
TMPROOT="${TMPDIR:-/tmp/opencode}"
mkdir -p "$TMPROOT" 2>/dev/null || TMPROOT="/tmp"

fails=0
warns=0
snapshots=0

pass() { printf 'PASS  %s\n' "$1"; }
info() { printf 'INFO  %s\n' "$1"; }
warn() { warns=$((warns + 1)); printf 'WARN  %s\n' "$1"; }
fail() { fails=$((fails + 1)); printf 'FAIL  %s\n' "$1"; }
section() { printf '\n== %s ==\n' "$1"; }

section "project"
info "root: $ROOT"
if [ -L "$ENTRY" ]; then
  target="$(realpath "$ENTRY" 2>/dev/null || printf '?')"
  fail "plugin entry is a symlink -> $target (copy the real bundle instead)"
elif [ -f "$ENTRY" ]; then
  pass "plugin entry is a real file"
else
  fail "plugin entry missing: $ENTRY (run npm run build)"
fi

section "scope"
scope="project"
scope_source="default"
if [ -n "${TAWASSUL_SCOPE:-}" ]; then
  case "$(printf '%s' "$TAWASSUL_SCOPE" | tr '[:upper:]' '[:lower:]')" in
    global) scope="global"; scope_source="TAWASSUL_SCOPE" ;;
    project) scope="project"; scope_source="TAWASSUL_SCOPE" ;;
    *) fail "TAWASSUL_SCOPE must be global or project (got $TAWASSUL_SCOPE)" ;;
  esac
fi
if [ "$scope_source" = "default" ] && [ -f "$ENTRY" ]; then
  resolved="$(realpath "$ENTRY" 2>/dev/null || printf '%s' "$ENTRY")"
  case "$resolved" in
    "$CONFIG_BASE/opencode/"*) scope="global"; scope_source="entry resolves inside the global config dir" ;;
  esac
fi
if [ "$scope" = "project" ]; then
  pass "scope: project ($scope_source)"
else
  warn "scope: global ($scope_source) — per-project state is disabled"
fi

section "state"
if [ -f "$STATE_FILE" ]; then
  pass "state file: $STATE_FILE"
else
  info "state file not created yet: $STATE_FILE"
fi
if [ -f "$PROJECT_ROUTER" ]; then
  pass "project router: $PROJECT_ROUTER"
else
  info "project router not created yet: $PROJECT_ROUTER"
fi

section "database"
expected=""
if [ -f "$KEY_FILE" ]; then
  if command -v xxd >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1; then
    keyhex="$(xxd -p -c 256 "$KEY_FILE" 2>/dev/null | tr -d '\n')"
    if [ "${#keyhex}" -eq 64 ]; then
      hash="$(printf '%s' "$ROOT" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$keyhex" -r 2>/dev/null | awk '{print $1}' | cut -c1-16)"
      expected="$HOME_DIR/.local/share/opencode-projects/$hash/opencode.db"
      pass "HMAC key present at $KEY_FILE"
      info "expected isolated DB: $expected"
    else
      fail "HMAC key has an unexpected length at $KEY_FILE"
    fi
  else
    warn "xxd or openssl is missing — cannot compute the expected isolated DB path"
  fi
else
  warn "HMAC key missing at $KEY_FILE — per-project DB isolation unavailable"
fi

db="${OPENCODE_DB:-}"
if [ -z "$db" ]; then
  warn "OPENCODE_DB is unset — the host falls back to the shared database $SHARED_DB"
elif [ -n "$expected" ] && [ "$db" = "$expected" ]; then
  pass "OPENCODE_DB matches the expected isolated database"
elif [ "$db" = "$SHARED_DB" ]; then
  fail "OPENCODE_DB points at the shared database (SQLITE_BUSY risk across projects)"
else
  case "$db" in
    "$HOME_DIR/.local/share/opencode/tawassul-v2/"*) pass "OPENCODE_DB is a desktop per-project sidecar" ;;
    *) warn "OPENCODE_DB is a custom path, not the HMAC-isolated database" ;;
  esac
fi
info "OPENCODE_DB: ${db:-(unset)}"

section "sessions"
snapshot_dir="$(mktemp -d "$TMPROOT/tawassul-doctor.XXXXXX" 2>/dev/null || true)"
if [ -n "$snapshot_dir" ] && [ -d "$snapshot_dir" ]; then
  cleanup() { rm -rf "$snapshot_dir"; }
  trap cleanup EXIT
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  warn "sqlite3 is missing — skipping session counts"
elif [ -z "$snapshot_dir" ] || [ ! -d "$snapshot_dir" ]; then
  warn "cannot create a temporary snapshot directory; skipping session counts"
else
  count_db() {
    src="$1"
    label="$2"
    if [ ! -f "$src" ]; then
      return 0
    fi
    snapshots=$((snapshots + 1))
    dest="$snapshot_dir/db$snapshots"
    mkdir -p "$dest" 2>/dev/null || { warn "$label: cannot prepare snapshot dir"; return 0; }
    if ! cp "$src" "$dest/opencode.db" 2>/dev/null; then
      warn "$label: cannot snapshot $src"
      return 0
    fi
    if [ -f "$src-wal" ]; then cp "$src-wal" "$dest/opencode.db-wal" 2>/dev/null || true; fi
    if [ -f "$src-shm" ]; then cp "$src-shm" "$dest/opencode.db-shm" 2>/dev/null || true; fi
    copy="$dest/opencode.db"
    has_session="$(sqlite3 "$copy" "SELECT name FROM sqlite_master WHERE type='table' AND name='session_v2';" 2>/dev/null || true)"
    if [ "$has_session" != "session_v2" ]; then
      warn "$label: no session_v2 table in $src"
      return 0
    fi
    has_project="$(sqlite3 "$copy" "SELECT name FROM sqlite_master WHERE type='table' AND name='project';" 2>/dev/null || true)"
    root_sql="$(printf '%s' "$ROOT" | sed "s/'/''/g")"
    total="$(sqlite3 "$copy" "SELECT COUNT(*) FROM session_v2;" 2>/dev/null || printf '?')"
    if [ "$has_project" = "project" ]; then
      mine="$(sqlite3 "$copy" "SELECT COUNT(*) FROM session_v2 WHERE directory = '$root_sql' OR project_id IN (SELECT id FROM project WHERE worktree = '$root_sql');" 2>/dev/null || printf '?')"
    else
      mine="$(sqlite3 "$copy" "SELECT COUNT(*) FROM session_v2 WHERE directory = '$root_sql';" 2>/dev/null || printf '?')"
    fi
    info "$label: $mine project session(s) of $total — $src"
  }

  if [ -n "$db" ]; then count_db "$db" "OPENCODE_DB"; fi
  if [ "$db" != "$SHARED_DB" ]; then count_db "$SHARED_DB" "shared"; fi
  if [ "$db" != "$LAUNCHER_DB" ]; then count_db "$LAUNCHER_DB" "launcher"; fi
  if [ -n "$expected" ] && [ "$db" != "$expected" ]; then count_db "$expected" "hmac-isolated"; fi
fi

section "processes"
pids="$(pgrep -f 'opencode(-cli)? (serve|run)' 2>/dev/null || true)"
if [ -z "$pids" ]; then
  info "no opencode serve/run processes"
else
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || printf '?')"
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || printf '?')"
    case "$cmd" in
      *"opencode-cli serve --service"*) info "pid $pid: desktop service (cwd $cwd)" ;;
      *)
        if [ "$cwd" = "$ROOT" ]; then
          info "pid $pid: serve for this project (cwd $cwd)"
        else
          warn "pid $pid: orphan candidate (cwd $cwd, cmd $cmd)"
        fi
        ;;
    esac
  done <<< "$pids"
fi

section "router"
for f in "$PROJECT_ROUTER" "$GLOBAL_ROUTER" "$LEGACY_ROUTER"; do
  if [ -f "$f" ]; then
    info "$f ($(stat -c '%s bytes, modified %y' "$f" 2>/dev/null || printf 'metadata unavailable'))"
  else
    info "$f (missing)"
  fi
done
if [ -f "$PROJECT_ROUTER" ] && [ -f "$GLOBAL_ROUTER" ] && [ "$GLOBAL_ROUTER" -nt "$PROJECT_ROUTER" ]; then
  warn "global router is newer than the project router — a global-scope instance still writes $GLOBAL_ROUTER"
fi

section "summary"
printf 'checks: %d failure(s), %d warning(s)\n' "$fails" "$warns"
if [ "$fails" -gt 0 ]; then
  exit 1
fi
exit 0
