#!/usr/bin/env bash
# guard-db-generation.sh — bidirectional V1/V2 generation guard (D11, A1).
#
# Refuses to open a database that belongs to the other generation:
#   --expect v1  refuses when the DB carries POSITIVE V2 evidence:
#                  - a session_v2 table, or
#                  - a kv table holding the migration.v1-v2 row, or
#                  - a path under a tawassul-v2 profile dir.
#                session_message is a V1 table (v1.18.33 schema + 1.17.14 disk):
#                a non-empty one is WARN-ONLY, never a refusal.
#   --expect v2  refuses unless the DB lives under a tawassul-v2 profile dir
#                (V2 must never touch a shared/legacy/V1 path, not even once —
#                the import migrates on open).
#
# A missing DB file is FRESH and always allowed. Read-only checks only.
# Probe failures are NEVER read as "no markers": exit 3 (D3 rotates on 2 only).
#
# Sidecars: direct read-only probing is tried first (fast path). When it fails
# and a -wal companion exists, the DB + companions are copied to a temp dir and
# probed there (WAL-inclusive, no live-file locks). Orphaned -wal/-shm combos
# are flagged on stderr.
#
# Usage: guard-db-generation.sh --db PATH --expect v1|v2 [--json] [--reason]
# Exit: 0 ok · 2 generation refusal · 3 probe failure (never fail-open)
# --json prints one machine line on stdout:
#   {"db":…,"expect":…,"generation":…,"verdict":…,"reason":…,"warnings":[…]}
set -euo pipefail

DB_PATH=""
EXPECT=""
JSON=0
REASON_ONLY=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --db) DB_PATH="${2:?--db needs a path}"; shift 2 ;;
    --expect) EXPECT="${2:?--expect needs v1|v2}"; shift 2 ;;
    --json) JSON=1; shift ;;
    --reason) REASON_ONLY=1; shift ;;
    --help|-h) sed -n '1,29p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -n "$DB_PATH" ] || { echo "❌ --db required" >&2; exit 2; }
case "$EXPECT" in v1|v2) ;; *) echo "❌ --expect must be v1|v2" >&2; exit 2 ;; esac
command -v sqlite3 >/dev/null 2>&1 || { echo "❌ sqlite3 CLI not found" >&2; exit 3; }
# Bounded probe: timeout(1) when present AND working, else python3 killer, else refuse.
# A failed probe must never read as "no markers" (fail-open).
_RUN_TMO=""
if command -v timeout >/dev/null 2>&1 && timeout 0 true >/dev/null 2>&1; then _RUN_TMO="timeout 30";
elif command -v python3 >/dev/null 2>&1; then _RUN_TMO="__PY__";
else echo "❌ timeout(1) not found/working and no python3 fallback — cannot bound guard queries (fail-closed)" >&2; exit 3; fi

_WARNINGS=()
warn() {
  _WARNINGS+=("$1")
  echo "⚠️  generation guard: $1" >&2
}

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
emit_json() { # $1=generation $2=verdict $3=reason
  [ "$JSON" = 1 ] || return 0
  local w="" IFS=',' _w
  for _w in "${_WARNINGS[@]+"${_WARNINGS[@]}"}"; do
    w="${w:+$w,}\"$(json_escape "$_w")\""
  done
  printf '{"db":"%s","expect":"%s","generation":"%s","verdict":"%s","reason":"%s","warnings":[%s]}\n' \
    "$(json_escape "$DB_PATH")" "$EXPECT" "$1" "$2" "$(json_escape "$3")" "$w"
}

refuse() { # $1=reason-code $2=human message (stderr) → exit 2
  echo "❌ generation guard: $2" >&2
  emit_json "$GEN" "refused" "$1"
  exit 2
}
fail_probe() { # $1=detail → exit 3 (never fail-open)
  echo "❌ generation guard: probe failure — $1 (fail-closed): $DB_PATH" >&2
  emit_json "unknown" "probe-failed" "probe-failure"
  exit 3
}

# Path rule FIRST (even a fresh file in the wrong generation dir is refused).
GEN="unknown"
case "$DB_PATH" in
  *tawassul-v2*)
    if [ "$EXPECT" = "v1" ]; then
      GEN="v2"
      refuse "tawassul-v2-path" "V1 lane refuses a tawassul-v2 profile path: $DB_PATH"
    fi
    GEN="v2"
    ;;
  *)
    if [ "$EXPECT" = "v2" ]; then
      GEN="v1"
      refuse "non-v2-path" "V2 lane refuses a non-v2 path (would migrate it on open): $DB_PATH"
    fi
    ;;
esac

# Fresh file: nothing to contaminate.
if [ ! -e "$DB_PATH" ]; then
  GEN="fresh"
  emit_json "$GEN" "ok" "fresh"
  exit 0
fi

# Sidecar diagnostics + one-shot WAL-inclusive snapshot copy (used only when a
# direct probe fails). Copying a multi-GB DB is never the fast path.
if [ -e "$DB_PATH-wal" ] && [ ! -e "$DB_PATH-shm" ]; then
  warn "orphaned -wal sidecar (no -shm) — direct reads may fail; a snapshot copy will be used if needed"
fi
_PROBE_TMPDIR=""
_COPY_DB=""
cleanup() { [ -n "$_PROBE_TMPDIR" ] && rm -rf -- "$_PROBE_TMPDIR" 2>/dev/null || true; }
trap cleanup EXIT
ensure_snapshot_copy() {
  [ -n "$_COPY_DB" ] && { printf '%s' "$_COPY_DB"; return 0; }
  local d=""
  d="$(mktemp -d "${TMPDIR:-/tmp}/tawassul-guard.XXXXXX" 2>/dev/null)" || return 1
  if ! cp -- "$DB_PATH" "$d/db" 2>/dev/null; then rm -rf -- "$d"; return 1; fi
  [ -e "$DB_PATH-wal" ] && cp -- "$DB_PATH-wal" "$d/db-wal" 2>/dev/null || true
  [ -e "$DB_PATH-shm" ] && cp -- "$DB_PATH-shm" "$d/db-shm" 2>/dev/null || true
  _PROBE_TMPDIR="$d"
  _COPY_DB="$d/db"
  printf '%s' "$_COPY_DB"
}

probe_sql() { # $1=db $2=sql → numeric result, or PROBE-FAILED(...) (caller refuses)
  # A failed probe (locked, corrupt, truncated, timeout) must NEVER read as
  # "no markers". Transient locks are retried (1s ×4); every other failure
  # (corrupt header, timeout) breaks immediately.
  local _db="$1" _sql="$2" out="" rc=0 _try=1 _max=5
  while [ "$_try" -le "$_max" ]; do
    rc=0
    if [ "$_RUN_TMO" = "__PY__" ]; then
      out="$(python3 -c '
import sys, subprocess
db, sql = sys.argv[1], sys.argv[2]
try:
  r = subprocess.run(["sqlite3", "-readonly", "--", db, sql], capture_output=True, text=True, timeout=30)
  sys.stdout.write((r.stdout or "").strip())
  if r.returncode != 0:
    sys.stderr.write(r.stderr or "")
  sys.exit(r.returncode)
except subprocess.TimeoutExpired:
  sys.stderr.write("probe timeout")
  sys.exit(124)
except Exception as e:
  sys.stderr.write(str(e))
  sys.exit(1)
' "$_db" "$_sql" 2>&1)" || rc=$?
    else
      out="$(timeout 30 sqlite3 -readonly -- "$_db" "$_sql" 2>&1)" || rc=$?
    fi
    case "$out" in
      ''|*[!0-9]*) : ;;
      *) printf '%s' "$out"; return 0 ;;
    esac
    case "$out" in
      *locked*|*busy*)
        if [ "$_try" -lt "$_max" ]; then sleep 1; _try=$((_try + 1)); continue; fi
        ;;
    esac
    break
  done
  printf 'PROBE-FAILED(rc=%s)' "$rc"
}

probe_any() { # $1=sql → numeric or PROBE-FAILED(...)
  local r=""
  r="$(probe_sql "$DB_PATH" "$1")"
  case "$r" in
    PROBE-FAILED*)
      if [ -e "$DB_PATH-wal" ]; then
        local copy=""
        if copy="$(ensure_snapshot_copy)" && [ -n "$copy" ]; then
          echo "⚠️  generation guard: direct probe failed ($r) — retried on a WAL-inclusive snapshot copy" >&2
          r="$(probe_sql "$copy" "$1")"
        fi
      fi
      ;;
  esac
  printf '%s' "$r"
}

# ── positive V2 markers ──────────────────────────────────────────────────────
MARK="$(probe_any "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='session_v2';")"
case "$MARK" in
  1)
    GEN="v2"
    if [ "$EXPECT" = "v1" ]; then
      refuse "marker-session_v2" "V1 lane refuses a DB with V2 markers (session_v2): $DB_PATH"
    fi
    ;;
  0)
    if [ "$EXPECT" = "v1" ]; then
      KV="$(probe_any "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='kv';")"
      case "$KV" in
        0) : ;;
        1)
          KVM="$(probe_any "SELECT count(*) FROM kv WHERE key='migration.v1-v2';")"
          case "$KVM" in
            1) GEN="v2"; refuse "marker-kv-migration" "V1 lane refuses a DB with V2 markers (kv migration.v1-v2): $DB_PATH" ;;
            0) : ;;
            *) fail_probe "kv marker probe $KVM" ;;
          esac
          ;;
        *) fail_probe "kv table probe $KV" ;;
      esac
      SESS="$(probe_any "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='session';")"
      case "$SESS" in
        1)
          SMT="$(probe_any "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='session_message';")"
          case "$SMT" in
            1)
              SM="$(probe_any "SELECT EXISTS(SELECT 1 FROM session_message);")"
              case "$SM" in
                1) warn "session_message is non-empty (a V1 table — warn-only, not a refusal)" ;;
                0) : ;;
                *) fail_probe "session_message probe $SM" ;;
              esac
              ;;
            0) : ;;
            *) fail_probe "session_message table probe $SMT" ;;
          esac
          V1M="$(probe_any "SELECT (SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('data_migration','session_context_epoch','session_input'));")"
          case "$V1M" in
            0) warn "no V1-positive markers (data_migration/session_context_epoch/session_input) — older or unrecognized V1 schema; proceeding on positive-evidence-only policy" ;;
            ''|*[!0-9]*) fail_probe "V1-positive marker probe $V1M" ;;
            *) : ;;
          esac
          ;;
        0) : ;;
        *) fail_probe "session table probe $SESS" ;;
      esac
      GEN="v1"
    else
      GEN="v1"
      TABLES="$(probe_any "SELECT count(*) FROM sqlite_master WHERE type='table';")"
      case "$TABLES" in
        0) GEN="empty" ;;
        '') fail_probe "table census returned no value" ;;
        *[!0-9]*) fail_probe "table census $TABLES" ;;
        *) refuse "marker-v1-content" "V2 lane refuses a DB with V1 content (no session_v2 marker): $DB_PATH" ;;
      esac
    fi
    ;;
  *)
    fail_probe "session_v2 table probe $MARK"
    ;;
esac

if [ "$REASON_ONLY" = 1 ]; then
  printf '%s\n' "$GEN"
fi
emit_json "$GEN" "ok" "ok"
exit 0
