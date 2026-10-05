#!/usr/bin/env bash
# guard-db-generation.sh — V2 LOCAL COPY (mirrored from tawassyl
# scripts/guard-db-generation.sh @ 2026-10-05; re-sync on guard changes).
# Lives here so V2 never depends on the V1 repo path at launch.
#
# Refuses to open a database that belongs to the other generation:
#   --expect v1  refuses when the DB carries V2 markers (session_v2 table)
#                or lives under a tawassul-v2 profile dir.
#   --expect v2  refuses unless the DB lives under a tawassul-v2 profile dir
#                (V2 must never touch a shared/legacy/V1 path, not even once —
#                the import migrates on open).
# A missing DB file is FRESH and always allowed. Read-only checks only.
#
# Usage: guard-db-generation.sh --db PATH --expect v1|v2   (exit 0 ok, 2 refuse)

set -euo pipefail

DB_PATH=""
EXPECT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --db) DB_PATH="${2:?--db needs a path}"; shift 2 ;;
    --expect) EXPECT="${2:?--expect needs v1|v2}"; shift 2 ;;
    --help|-h) sed -n '1,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -n "$DB_PATH" ] || { echo "❌ --db required" >&2; exit 2; }
case "$EXPECT" in v1|v2) ;; *) echo "❌ --expect must be v1|v2" >&2; exit 2 ;; esac
command -v sqlite3 >/dev/null 2>&1 || { echo "❌ sqlite3 CLI not found" >&2; exit 2; }
# Without timeout the table probe is unbounded — and a failed probe would read
# as "no V2 markers" (fail-open). Refuse instead (notably: BSD/macOS lack it).
command -v timeout >/dev/null 2>&1 || { echo "❌ timeout(1) not found — cannot bound guard queries (fail-closed)" >&2; exit 2; }

# Path rule FIRST (even a fresh file in the wrong generation dir is refused).
case "$DB_PATH" in
  *tawassul-v2*)
    if [ "$EXPECT" = "v1" ]; then
      echo "❌ generation guard: V1 lane refuses a tawassul-v2 profile path: $DB_PATH" >&2
      exit 2
    fi
    ;;
  *)
    if [ "$EXPECT" = "v2" ]; then
      echo "❌ generation guard: V2 lane refuses a non-v2 path (would migrate it on open): $DB_PATH" >&2
      exit 2
    fi
    ;;
esac

# Fresh file: nothing to contaminate.
[ -e "$DB_PATH" ] || exit 0

probe_table() { # $1=table → prints 0/1, or PROBE-FAILED (caller must refuse)
  # A failed probe (locked, corrupt, truncated, timeout) must NEVER read as
  # "no markers" — that fail-open would admit the exact DB this guard exists
  # to refuse. NOTE: `exit` inside $( ) only exits the subshell, so failure
  # is signaled by output and the CALLER refuses (never trust this blindly).
  local out rc=0
  out="$(timeout 30 sqlite3 -readonly -- "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$1';" 2>/dev/null)" || rc=$?
  case "$out" in
    0|1) printf '%s' "$out" ;;
    *) printf 'PROBE-FAILED(rc=%s)' "$rc" ;;
  esac
}

MARK="$(probe_table "session_v2")"
case "$MARK" in
  0) ;; # no V2 markers — proceed
  1)
    if [ "$EXPECT" = "v1" ]; then
      echo "❌ generation guard: V1 lane refuses a DB with V2 markers (session_v2): $DB_PATH" >&2
      exit 2
    fi
    ;;
  *)
    echo "❌ generation guard: table probe $MARK — refusing (fail-closed): $DB_PATH" >&2
    exit 2
    ;;
esac

exit 0
