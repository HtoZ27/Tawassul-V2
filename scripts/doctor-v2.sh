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
LEGACY_ROUTER="$HOME_DIR/.config/tawassul/state/predictive-router.json"
KEY_DIR="${TAWASSUL_HMAC_KEY_DIR:-$HOME_DIR/.config/tawassul}"
KEY_FILE="$KEY_DIR/.tawassul-hmac-key"
DATA_HOME="${XDG_DATA_HOME:-$HOME_DIR/.local/share}"
SHARED_DB="$DATA_HOME/opencode/opencode.db"
LAUNCHER_DB="$DATA_HOME/tawassul-v2/opencode-v2.db"
SIDECAR_DB="$DATA_HOME/opencode/tawassul-v2/opencode.db"
CAP_BYTES="${TAWASSUL_DB_CAP_BYTES:-4294967296}"
case "$CAP_BYTES" in ''|*[!0-9]*) CAP_BYTES=4294967296 ;; esac
SERVICE_DESC="${XDG_STATE_HOME:-$HOME_DIR/.local/state}/opencode/service.json"
db_canonical=""
db_secondary=""
db_unknown=""
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

db_contract() {
  section "db maintenance contract"
  SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || printf '.')"
  TAG="tawassul-db-maintenance"
  TAB="$(printf '\t')"
  . "$SELF_DIR/db-env.sh" 2>/dev/null || true
  MARKER_DB="$CONFIG_BASE/opencode/tawassul-runtime/VERSION"
  if [ -f "$MARKER_DB" ]; then
    if command -v python3 >/dev/null 2>&1; then
      while IFS="$TAB" read -r kind a b c; do
        case "$kind" in
          meta)
            info "installed marker: version=$a host=$b trigger=$c"
            ;;
          asset)
            want="$c"
            case "$b" in ''|/*) abs="$b" ;; *) abs="$CONFIG_BASE/opencode/$b" ;; esac
            if [ ! -f "$abs" ]; then
              warn "staged artifact missing: $a ($abs)"
            elif ! command -v sha256sum >/dev/null 2>&1; then
              info "$a: present ($abs) — no sha256sum tool to verify"
            else
              got="$(sha256sum "$abs" 2>/dev/null | cut -d' ' -f1)"
              if [ "$got" = "$want" ]; then
                info "$a: hash ok (${want:0:12})"
              else
                warn "$a: hash mismatch ($abs) — run npm run install:global"
              fi
            fi
            ;;
        esac
      done < <(python3 - "$MARKER_DB" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(f"meta\t{m.get('version','?')}\t{m.get('host','?')}\t{m.get('trigger','(absent)')}")
b = m.get("bundle") or {}
print(f"asset\tbundle\t{b.get('path','')}\t{b.get('sha256','')}")
for name, rec in sorted((m.get("db") or {}).items()):
    print(f"asset\tdb:{name}\t{rec.get('path','')}\t{rec.get('sha256','')}")
PY
)
    else
      info "python3 missing — the marker hash check is skipped ($MARKER_DB)"
    fi
  else
    info "no global runtime marker at $MARKER_DB (project install or not installed)"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    trigger_state="$(systemctl --user is-enabled "$TAG.timer" 2>/dev/null || printf 'not-found')"
    info "systemd trigger: tawassul-db-maintenance.timer is $trigger_state"
  else
    info "systemd trigger: systemctl missing"
  fi
  if command -v crontab >/dev/null 2>&1; then
    if crontab -l 2>/dev/null | grep -Fq "$TAG"; then
      info "cron trigger: found (tagged line)"
    else
      info "cron trigger: absent"
    fi
  else
    info "cron trigger: crontab missing"
  fi
  MAINT_STAMP="$DATA_HOME/tawassul-v2/db-maintenance/last-run.stamp"
  MAINT_FAILURE="$DATA_HOME/tawassul-v2/db-maintenance/last-failure.stamp"
  if [ -f "$MAINT_STAMP" ]; then
    stamp_rc="$(sed -n 's/^rc=//p' "$MAINT_STAMP" | head -n1)"
    stamp_at="$(sed -n 's/^at=//p' "$MAINT_STAMP" | head -n1)"
    stamp_mt="$(tawassul_mtime_epoch "$MAINT_STAMP" 2>/dev/null || printf 0)"
    stamp_age="stale"
    if [ "$stamp_mt" -gt 0 ] && [ "$(( $(date +%s) - stamp_mt ))" -lt 86400 ]; then stamp_age="fresh"; fi
    info "last scheduled run: rc=$stamp_rc at=$stamp_at ($stamp_age): $MAINT_STAMP"
  else
    info "last scheduled run: no stamp yet ($MAINT_STAMP)"
  fi
  if [ -f "$MAINT_FAILURE" ]; then
    failure_rc="$(sed -n 's/^rc=//p' "$MAINT_FAILURE" | head -n1)"
    failure_at="$(sed -n 's/^at=//p' "$MAINT_FAILURE" | head -n1)"
    warn "last scheduled failure: rc=$failure_rc at=$failure_at: $MAINT_FAILURE"
  else
    info "last scheduled failure: none recorded"
  fi
  db_resolve_path
  contract_resolved="$RESOLVED_DB"
  contract_source="$DB_RESOLVE_SOURCE"
  db_resolve_path --probe
  contract_probe="$RESOLVED_DB"
  info "resolved DB: $contract_resolved (source: $contract_source)"
  if [ "$contract_source" = "host-default" ] && [ -n "$contract_probe" ] && [ "$contract_probe" != "$contract_resolved" ] && [ -e "$contract_probe" ]; then
    warn "DB path drift: the live DB is $contract_probe, the default path is $contract_resolved"
  else
    info "DB path drift: none"
  fi
  if [ -f "$contract_resolved" ]; then
    db_bytes="$(tawassul_file_bytes "$contract_resolved" 2>/dev/null || printf 0)"
    wal_bytes="$(tawassul_file_bytes "$contract_resolved-wal" 2>/dev/null || printf 0)"
    info "contract DB size: $db_bytes bytes (wal $wal_bytes bytes)"
    if command -v sqlite3 >/dev/null 2>&1; then
      info "contract quick_check: $(sqlite3 -readonly "$contract_resolved" 'PRAGMA quick_check;' 2>/dev/null || printf 'error')"
    fi
  fi
  contract_other=""
  for contract_root in "$HOME_DIR/.local/share/opencode" "$HOME_DIR/.local/share/tawassul-v2" "$HOME_DIR/.local/share/opencode-projects"; do
    [ -d "$contract_root" ] || continue
    while IFS= read -r contract_hit; do
      [ -n "$contract_hit" ] || continue
      [ "$contract_hit" = "$contract_resolved" ] && continue
      case " ${contract_other} " in
        *" $contract_hit "*) continue ;;
      esac
      contract_other="${contract_other}${contract_other:+, }$contract_hit"
    done < <(find "$contract_root" -maxdepth 4 -name '*.db' -type f 2>/dev/null)
  done
  if [ -n "$contract_other" ]; then
    info "other DB files seen: $contract_other"
  else
    info "other DB files seen: none"
  fi
}

desktop_scan() {
  section "desktop plugin-entry scan"
  scan_root="${1:-${TAWASSUL_DESKTOP_SCAN_ROOT:-$HOME_DIR/Desktop}}"
  if [ ! -d "$scan_root" ]; then
    info "scan root missing: $scan_root (nothing to scan)"
    return 0
  fi
  workspaces=0
  active_total=0
  v2_total=0
  v1_total=0
  dual_total=0
  unknown_total=0
  retired_total=0
  while IFS= read -r ws; do
    [ -n "$ws" ] || continue
    plugin_dirs=""
    for candidate in "$ws/.opencode/plugin" "$ws/.opencode/plugins"; do
      [ -d "$candidate" ] || continue
      plugin_dirs="${plugin_dirs}${plugin_dirs:+
}$candidate"
    done
    [ -n "$plugin_dirs" ] || continue
    workspaces=$((workspaces + 1))
    entries=0
    v2=0
    v1=0
    dual=0
    unknown=0
    retired=0
    while IFS= read -r entry; do
      [ -f "$entry" ] || continue
      base="${entry##*/}"
      case "$base" in
        *retired*|*.disabled)
          retired=$((retired + 1))
          info "retired plugin entry: $entry"
          continue
          ;;
      esac
      entries=$((entries + 1))
      if grep -Eq 'Plugin\.define[[:space:]]*\(' "$entry" 2>/dev/null; then
        v2=$((v2 + 1))
      elif grep -Eq 'server[[:space:]]*:' "$entry" 2>/dev/null &&
        grep -Eq "id[[:space:]]*:[[:space:]]*['\"]tawassul(-v2)?['\"]" "$entry" 2>/dev/null; then
        if grep -Eq 'setup[[:space:]]*[:(]|effect[[:space:]]*:' "$entry" 2>/dev/null; then
          dual=$((dual + 1))
          fail "dual v1/v2 plugin entry: $entry"
        else
          v1=$((v1 + 1))
          fail "v1-only plugin entry: $entry"
        fi
      else
        unknown=$((unknown + 1))
        warn "unclassified plugin entry: $entry"
      fi
    done < <(
      printf '%s\n' "$plugin_dirs" | while IFS= read -r dir; do
        [ -n "$dir" ] || continue
        find "$dir" -maxdepth 1 -type f \( -name '*.js' -o -name '*.ts' -o -name '*.mjs' -o -name '*.cjs' \) -print 2>/dev/null
        find "$dir" -mindepth 2 -maxdepth 2 -type f \( -name 'index.js' -o -name 'index.ts' -o -name 'index.mjs' -o -name 'index.cjs' \) -print 2>/dev/null
        find "$dir" -maxdepth 2 -type f \( -name '*retired*' -o -name '*.disabled' \) -print 2>/dev/null
      done | sort -u
    )
    info "workspace $ws: entries=$entries v2=$v2 v1=$v1 dual=$dual unknown=$unknown retired=$retired"
    active_total=$((active_total + entries))
    v2_total=$((v2_total + v2))
    v1_total=$((v1_total + v1))
    dual_total=$((dual_total + dual))
    unknown_total=$((unknown_total + unknown))
    retired_total=$((retired_total + retired))
  done < <({ printf '%s\n' "$scan_root"; find "$scan_root" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null; } | sort -u)
  info "scan: root=$scan_root workspaces=$workspaces active=$active_total v2=$v2_total v1=$v1_total dual=$dual_total unknown=$unknown_total retired=$retired_total"
  if [ "$active_total" -eq 0 ] && [ "$retired_total" -eq 0 ]; then
    info "scan: no plugin entries found under $scan_root"
  fi
}

if [ "${1:-}" = "--db-contract" ]; then
  db_contract
  printf '\n== summary ==\n'
  printf 'checks: %d failure(s), %d warning(s)\n' "$fails" "$warns"
  exit 0
fi

if [ "${1:-}" = "--scan-desktop" ]; then
  desktop_scan "${2:-}"
  printf '\n== summary ==\n'
  printf 'checks: %d failure(s), %d warning(s)\n' "$fails" "$warns"
  if [ "$fails" -gt 0 ]; then exit 1; fi
  exit 0
fi

section "project"
info "root: $ROOT"
if [ -L "$ENTRY" ]; then
  target="$(realpath "$ENTRY" 2>/dev/null || printf '?')"
  fail "plugin entry is a symlink -> $target (copy the real bundle instead)"
elif [ -f "$ENTRY" ]; then
  pass "plugin entry is a real file"
elif [ -f "$CONFIG_BASE/opencode/tawassul-runtime/VERSION" ]; then
  pass "no project entry — the global install owns this host lane (project lane not present)"
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
live_db=""
if [ -f "$SERVICE_DESC" ]; then
  live_pid="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$SERVICE_DESC" 2>/dev/null | head -n1)"
  if [ -n "$live_pid" ] && kill -0 "$live_pid" 2>/dev/null; then
    live_db="$(tr '\0' '\n' < "/proc/$live_pid/environ" 2>/dev/null | sed -n 's/^OPENCODE_DB=//p' | head -n1)"
  fi
fi
if [ -n "$live_db" ]; then
  info "live host DB: $live_db"
  if [ -z "$db" ]; then
    warn "this shell has no OPENCODE_DB — a CLI run would open $SHARED_DB while the live host writes $live_db"
  elif [ "$db" != "$live_db" ]; then
    fail "this shell's OPENCODE_DB ($db) differs from the live host DB ($live_db)"
  else
    pass "this shell's OPENCODE_DB matches the live host DB"
  fi
else
  info "live host DB: unavailable (no running service descriptor)"
fi
if [ -n "$live_db" ]; then
  CANONICAL_DB="$live_db"
elif [ -n "$db" ]; then
  CANONICAL_DB="$db"
else
  CANONICAL_DB="$SIDECAR_DB"
fi
info "canonical DB (single write path): $CANONICAL_DB"

section "database census"
census_cap="${TAWASSUL_DOCTOR_DB_CAP:-32}"
case "$census_cap" in ''|*[!0-9]*|0) census_cap=32 ;; esac
allow_legacy_growth="${TAWASSUL_ALLOW_LEGACY_GROWTH:-0}"
shared_baseline=14
launcher_baseline=14
census_total=0
census_overflow=0
census_scan_error=0
declare -A census_seen=()
census_paths=()
census_dir="$(mktemp -d "$TMPROOT/tawassul-doctor.XXXXXX" 2>/dev/null || true)"
if [ -n "$census_dir" ] && [ -d "$census_dir" ]; then
  cleanup() { rm -rf "$census_dir"; }
  trap cleanup EXIT
else
  census_dir=""
fi
census_add() {
  path="$1"
  if [ -n "${census_seen[$path]:-}" ]; then return 0; fi
  census_seen[$path]=1
  census_paths+=("$path")
}
census_scan() {
  root="$1"
  depth="$2"
  [ "$census_overflow" -eq 0 ] || return 0
  [ -d "$root" ] || return 0
  errfile="${census_dir:+$census_dir/find.err}"
  while IFS= read -r -d '' hit; do
    census_total=$((census_total + 1))
    if [ "$census_total" -gt "$census_cap" ]; then
      census_overflow=1
      break
    fi
    census_add "$hit"
  done < <(find -P "$root" -maxdepth "$depth" -type f -name 'opencode.db' -print0 2>>"${errfile:-/dev/null}")
  if [ -n "$errfile" ] && [ -s "$errfile" ]; then
    census_scan_error=1
    warn "census could not read part of $root: $(head -n1 "$errfile")"
    : > "$errfile"
  fi
}
census_scan "$HOME_DIR/.local/share/opencode" 4
census_scan "$HOME_DIR/.local/share/tawassul-v2" 3
census_scan "$HOME_DIR/.local/share/opencode-projects" 3
if [ -n "$CANONICAL_DB" ] && [ -f "$CANONICAL_DB" ]; then
  census_add "$CANONICAL_DB"
fi
if [ -n "$LAUNCHER_DB" ] && [ -f "$LAUNCHER_DB" ]; then
  census_add "$LAUNCHER_DB"
fi
if [ "$census_overflow" -eq 1 ]; then
  fail "database census hit the ${census_cap}-file cap — refusing to certify DB roles; raise TAWASSUL_DOCTOR_DB_CAP only after checking the tree (D-05)"
fi
if [ "$census_scan_error" -eq 1 ]; then
  fail "database census could not read every root — refusing to certify DB roles (D-05)"
fi
if [ "${#census_paths[@]}" -eq 0 ]; then
  info "census found no opencode.db files under the three data roots"
else
  pass "bounded census found ${#census_paths[@]} database file(s) within the ${census_cap}-file cap"
fi

section "database sizes"
for candidate in "${census_paths[@]}"; do
  [ -f "$candidate" ] || continue
  total=0
  for part in "$candidate" "$candidate-wal"; do
    [ -e "$part" ] || continue
    bytes="$(stat -c %s "$part" 2>/dev/null || stat -f %z "$part" 2>/dev/null || true)"
    case "$bytes" in ''|*[!0-9]*) continue ;; esac
    total=$((total + bytes))
  done
  info "$candidate: $total bytes (db+wal)"
  if [ "$total" -ge "$CAP_BYTES" ]; then
    fail "database at/over the ${CAP_BYTES}-byte cap: $candidate ($total bytes, db+wal)"
  fi
done

section "sessions"
census_unreadable=0
db_cli=""
db_role() {
  case "$1" in
    "$CANONICAL_DB") printf 'canonical' ;;
    "$SHARED_DB") printf 'shared' ;;
    "$LAUNCHER_DB") printf 'launcher' ;;
    "$SIDECAR_DB") printf 'sidecar' ;;
    "$expected") printf 'hmac-isolated' ;;
    "$HOME_DIR/.local/share/opencode/tawassul-v2/projects/"*/opencode.db) printf 'cli-test' ;;
    *) printf 'undeclared' ;;
  esac
}
db_label() {
  case "$1" in
    canonical) printf 'canonical' ;;
    shared) printf 'shared' ;;
    launcher) printf 'launcher' ;;
    sidecar) printf 'sidecar' ;;
    hmac-isolated) printf 'hmac-isolated' ;;
    cli-test) printf 'v2-cli-test' ;;
    *) printf 'undeclared:%s' "$(basename "$(dirname "$2")")" ;;
  esac
}
check_growth() {
  kind="$1"
  path="$2"
  count="$3"
  baseline="$4"
  if [ "$count" -gt "$baseline" ]; then
    if [ "$allow_legacy_growth" = "1" ]; then
      warn "$kind copy grew to $count session(s) over the $baseline baseline (allowed by TAWASSUL_ALLOW_LEGACY_GROWTH=1): $path"
    else
      fail "$kind copy grew to $count session(s) over the $baseline baseline — a process still writes a read-only/test copy (D-05): $path"
    fi
  elif [ "$count" -lt "$baseline" ]; then
    warn "$kind copy holds $count session(s), below the $baseline baseline (sessions deleted?): $path"
  fi
}
if ! command -v sqlite3 >/dev/null 2>&1; then
  warn "sqlite3 is missing — skipping session counts"
elif [ -z "$census_dir" ] || [ ! -d "$census_dir" ]; then
  warn "cannot create a temporary snapshot directory; skipping session counts"
else
  count_db() {
    src="$1"
    if [ ! -f "$src" ]; then
      return 0
    fi
    role="$(db_role "$src")"
    label="$(db_label "$role" "$src")"
    snapshots=$((snapshots + 1))
    dest="$census_dir/db$snapshots"
    mkdir -p "$dest" 2>/dev/null || { warn "$label: cannot prepare snapshot dir"; census_unreadable=1; return 0; }
    if ! cp "$src" "$dest/opencode.db" 2>/dev/null; then
      warn "$label: cannot snapshot $src"
      census_unreadable=1
      return 0
    fi
    if [ -f "$src-wal" ]; then cp "$src-wal" "$dest/opencode.db-wal" 2>/dev/null || true; fi
    if [ -f "$src-shm" ]; then cp "$src-shm" "$dest/opencode.db-shm" 2>/dev/null || true; fi
    copy="$dest/opencode.db"
    has_v2="$(sqlite3 "$copy" "SELECT name FROM sqlite_master WHERE type='table' AND name='session_v2';" 2>/dev/null || true)"
    has_legacy="$(sqlite3 "$copy" "SELECT name FROM sqlite_master WHERE type='table' AND name='session';" 2>/dev/null || true)"
    if [ "$has_v2" != "session_v2" ] && [ "$has_legacy" != "session" ]; then
      warn "$label: no session tables in $src (not an OpenCode database)"
      rm -rf "$dest"
      return 0
    fi
    v2_total=""
    legacy_total=""
    if [ "$has_v2" = "session_v2" ]; then
      v2_total="$(sqlite3 "$copy" "SELECT COUNT(*) FROM session_v2;" 2>/dev/null || true)"
      case "$v2_total" in ''|*[!0-9]*) v2_total="" ;; esac
    fi
    if [ "$has_legacy" = "session" ]; then
      legacy_total="$(sqlite3 "$copy" "SELECT COUNT(*) FROM session;" 2>/dev/null || true)"
      case "$legacy_total" in ''|*[!0-9]*) legacy_total="" ;; esac
    fi
    if [ -z "$v2_total" ] && [ -z "$legacy_total" ]; then
      warn "$label: cannot read session counts from $src"
      census_unreadable=1
      rm -rf "$dest"
      return 0
    fi
    if [ -n "$v2_total" ]; then total="$v2_total"; else total="$legacy_total"; fi
    legacy="${legacy_total:-0}"
    any=$((total + legacy))
    has_project="$(sqlite3 "$copy" "SELECT name FROM sqlite_master WHERE type='table' AND name='project';" 2>/dev/null || true)"
    root_sql="$(printf '%s' "$ROOT" | sed "s/'/''/g")"
    mine=""
    if [ -n "$v2_total" ]; then
      if [ "$has_project" = "project" ]; then
        mine="$(sqlite3 "$copy" "SELECT COUNT(*) FROM session_v2 WHERE directory = '$root_sql' OR project_id IN (SELECT id FROM project WHERE worktree = '$root_sql');" 2>/dev/null || printf '?')"
      else
        mine="$(sqlite3 "$copy" "SELECT COUNT(*) FROM session_v2 WHERE directory = '$root_sql';" 2>/dev/null || printf '?')"
      fi
    fi
    info "$label: ${mine:-0} project session(s) of $total — $src"
    case "$role" in
      canonical)
        db_canonical="${db_canonical}${db_canonical:+; }${label} ${mine:-0}/${total}"
        ;;
      shared)
        db_secondary="${db_secondary}${db_secondary:+; }${label}(legacy-read-only) ${mine:-0}/${total}"
        check_growth "shared" "$src" "$total" "$shared_baseline"
        ;;
      launcher)
        db_secondary="${db_secondary}${db_secondary:+; }${label}(test-only) ${mine:-0}/${total}"
        check_growth "launcher" "$src" "$total" "$launcher_baseline"
        ;;
      sidecar)
        db_secondary="${db_secondary}${db_secondary:+; }${label}(canonical-path) ${mine:-0}/${total}"
        ;;
      cli-test)
        if [ "$any" -gt 0 ]; then
          db_cli="${db_cli}${db_cli:+; }${label} ${mine:-0}/${total}"
        fi
        ;;
      undeclared)
        if [ "$any" -gt 0 ]; then
          db_unknown="${db_unknown}${db_unknown:+; }${label} ${mine:-0}/${total}"
        else
          info "$label: undeclared path holds no sessions (ignored): $src"
        fi
        ;;
    esac
    rm -rf "$dest"
  }

  for candidate in "${census_paths[@]}"; do
    count_db "$candidate"
  done
  if [ "$census_unreadable" -eq 1 ]; then
    fail "one or more databases could not be snapshotted or read — refusing to certify DB roles (D-05)"
  fi
  if [ -n "$db_cli" ]; then
    fail "the v2 CLI project namespace holds sessions ($db_cli) — that lane is test-only; export OPENCODE_DB explicitly instead of opening a second live DB (D-05)"
  fi
  if [ -n "$db_unknown" ]; then
    fail "an undeclared database contains sessions ($db_unknown) — only the canonical DB, the legacy shared copy, the launcher test copy, and the v1 HMAC path are allowed (D-01/D-05)"
  elif [ -z "$db_canonical" ] && [ -n "$db_secondary" ]; then
    fail "the canonical DB has no sessions while a legacy/test copy does ($db_secondary) — those sessions are invisible; import required (D-02)"
  elif [ -n "$db_canonical" ]; then
    pass "one canonical session DB: $db_canonical"
    if [ -n "$db_secondary" ]; then
      warn "non-canonical session copies are retained read-only; the D-02 import is complete: $db_secondary"
    fi
  else
    info "no sessions found in the probed databases"
  fi
fi

section "external v1 trees"
for tree in "$HOME_DIR/Desktop/gtttt" "$HOME_DIR/Desktop/paassss"; do
  [ -d "$tree" ] || continue
  if compgen -G "$tree/.opencode/plugins/*/index.ts" >/dev/null; then
    for v1_entry in "$tree"/.opencode/plugins/*/index.ts; do
      [ -f "$v1_entry" ] || continue
      warn "external v1 tree still exposes $v1_entry (user refused removal) — it can fail to load on boot; not modified"
    done
  else
    pass "external tree has no live v1 entry: $tree"
  fi
done

section "hosts"
if [ -f "$SERVICE_DESC" ]; then
  svc_url="$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$SERVICE_DESC" 2>/dev/null)"
  svc_pid="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$SERVICE_DESC" 2>/dev/null)"
  if [ -n "$svc_pid" ] && kill -0 "$svc_pid" 2>/dev/null; then
    pass "active service: ${svc_url:-unknown URL} (pid $svc_pid)"
  else
    warn "service descriptor points at pid ${svc_pid:-unknown}, which is not running: $SERVICE_DESC"
  fi
else
  info "no service descriptor at $SERVICE_DESC (no background host)"
fi

resolved="$(command -v opencode 2>/dev/null || true)"
case "$resolved" in
  "") info "no 'opencode' on PATH" ;;
  "$HOME_DIR/.opencode/bin/opencode") warn "terminal CLI copy on PATH: $resolved (the Desktop does not need it)" ;;
  *) info "opencode on PATH: $resolved" ;;
esac
if [ -x "$HOME_DIR/.opencode/bin/opencode" ]; then
  warn "terminal CLI install present at $HOME_DIR/.opencode (about 240 MB); the launcher falls back to the Desktop CLI when it is gone"
fi
if grep -qs "\.opencode/bin" "$HOME_DIR/.bashrc" 2>/dev/null; then
  warn "$HOME_DIR/.bashrc exports ~/.opencode/bin into PATH"
fi
if [ -n "$resolved" ] && [ -x "$resolved" ]; then
  cli_version="$("$resolved" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  if [ -n "${TAWASSUL_OPENCODE_VERSION:-}" ]; then
    if [ -n "$cli_version" ] && [ "$cli_version" != "$TAWASSUL_OPENCODE_VERSION" ]; then
      warn "opencode on PATH is v$cli_version; the pinned host is v$TAWASSUL_OPENCODE_VERSION (v1 hosts must not run)"
    fi
  elif [ -n "$cli_version" ]; then
    if [ "${cli_version%%.*}" != "2" ] || [ "$(printf '%s\n%s\n' "2.2.0" "$cli_version" | sort -V | head -n1)" != "2.2.0" ]; then
      warn "opencode on PATH is v$cli_version; supported hosts are v>=2.2.0 <3.0.0 (v1 hosts must not run)"
    elif [ "$cli_version" != "2.2.0" ]; then
      warn "opencode on PATH is v$cli_version, newer than the audited v2.2.1; run npm run check:upstream"
    fi
  fi
fi
BUN_GLOBAL="$HOME_DIR/.bun/install/global/node_modules/opencode-ai"
if [ -d "$BUN_GLOBAL" ]; then
  bun_version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$BUN_GLOBAL/package.json" 2>/dev/null | head -n1)"
  warn "v1 Bun global package present: $BUN_GLOBAL (version ${bun_version:-unknown}); remove with bun remove -g opencode-ai"
fi
if [ -e "$HOME_DIR/.bun/bin/opencode" ] || [ -L "$HOME_DIR/.bun/bin/opencode" ]; then
  warn "Bun exposes opencode on PATH: $HOME_DIR/.bun/bin/opencode"
fi
GLOBAL_PKG="$HOME_DIR/.config/opencode/package.json"
if [ -f "$GLOBAL_PKG" ] && grep -qs '@opencode-ai/plugin' "$GLOBAL_PKG"; then
  warn "global config pins the v1 plugin SDK: $GLOBAL_PKG (H-06)"
fi
for candidate in "$HOME_DIR/.config/ai.opencode.desktop/cli/"*/opencode-cli; do
  [ -x "$candidate" ] || continue
  info "desktop-bundled CLI: $candidate ($("$candidate" --version 2>/dev/null | head -n1 || printf 'version unavailable'))"
done

section "global install"
GLOBAL_PLUGIN_DIR="$CONFIG_BASE/opencode/plugins/tawassul"
GLOBAL_PLUGIN_FLAT="$CONFIG_BASE/opencode/plugins/tawassul.js"
GLOBAL_RUNTIME="$CONFIG_BASE/opencode/tawassul-runtime"
GLOBAL_MARKER="$GLOBAL_RUNTIME/VERSION"
GLOBAL_WASM="$GLOBAL_RUNTIME/wasm"
if [ -d "$GLOBAL_PLUGIN_DIR" ]; then
  warn "legacy global package directory present: $GLOBAL_PLUGIN_DIR (remove it; the global install is a flat file)"
fi
if [ -f "$GLOBAL_PLUGIN_FLAT" ]; then
  if [ -f "$GLOBAL_MARKER" ]; then
    global_version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$GLOBAL_MARKER" | head -n1)"
    global_hash="$(sed -n 's/.*"sha256": *"\([^"]*\)".*/\1/p' "$GLOBAL_MARKER" | head -n1)"
    installed_hash="$(sha256sum "$GLOBAL_PLUGIN_FLAT" 2>/dev/null | cut -d' ' -f1)"
    info "global plugin install: $GLOBAL_PLUGIN_FLAT (version ${global_version:-unknown})"
    if [ -f "$ROOT/dist/global.js" ] && [ -n "$global_hash" ] && [ "$installed_hash" != "$(sha256sum "$ROOT/dist/global.js" | cut -d' ' -f1)" ]; then
      warn "global plugin differs from dist/global.js — run npm run install:global"
    fi
    missing_wasm=0
    for wasm in web-tree-sitter/web-tree-sitter.wasm tree-sitter-javascript/tree-sitter-javascript.wasm tree-sitter-typescript/tree-sitter-typescript.wasm tree-sitter-typescript/tree-sitter-tsx.wasm; do
      [ -f "$GLOBAL_WASM/$wasm" ] || missing_wasm=$((missing_wasm + 1))
    done
    if [ "$missing_wasm" -gt 0 ]; then
      warn "global runtime is missing $missing_wasm wasm asset(s) under $GLOBAL_WASM — run npm run install:global"
    fi
  else
    warn "global plugin file has no runtime marker: $GLOBAL_PLUGIN_FLAT (reinstall or remove it)"
  fi
else
  info "no global plugin install (project install only)"
fi

db_contract

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
      *".opencode/bin/opencode serve"*) fail "pid $pid: terminal host is running (cwd $cwd) — stop it; the Desktop already runs its own service" ;;
      *"ai.opencode.desktop/cli/"*"serve"*) info "pid $pid: desktop-bundled CLI host (cwd $cwd)" ;;
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
