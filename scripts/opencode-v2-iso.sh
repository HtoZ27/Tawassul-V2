#!/usr/bin/env bash
# opencode-v2-iso.sh — generation-scoped launcher for Tawassul V2 (4a).
#
# V2 must NEVER open a shared/legacy/V1 database (the import migrates on open
# and strands V1). This wrapper pins V2 to its own XDG quad + its own DB file
# and runs the bidirectional generation guard before exec.
#
# Usage: from the V2 repo: scripts/opencode-v2-iso.sh [opencode args...]
# Env:   OPENCODE (default "opencode") — the real CLI binary to exec.

set -euo pipefail

# Portable byte size (GNU stat -c, BSD stat -f, universal wc -c).
# Fails LOUD when unreadable — callers refuse explicitly (fail-closed).
file_bytes() { # $1=path → bytes on stdout; rc!=0 when unreadable
  local p="$1" n=""
  n="$(stat -c %s "$p" 2>/dev/null || stat -f %z "$p" 2>/dev/null || wc -c <"$p" 2>/dev/null)" || return 1
  n="$(printf '%s' "$n" | tr -d ' \t\n')" || return 1
  case "$n" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$n"
}

V2_REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
# Local guard copy: V2 must launch even if the V1 repo moved or vanished.
GUARD="$V2_REPO/scripts/guard-db-generation.sh"

export XDG_DATA_HOME="$HOME/.local/share/tawassul-v2"
export XDG_CONFIG_HOME="$HOME/.config/tawassul-v2"
export XDG_STATE_HOME="$HOME/.local/state/tawassul-v2"
export XDG_CACHE_HOME="$HOME/.cache/tawassul-v2"
export OPENCODE_DISABLE_AUTOUPDATE=1

V2_DB="$XDG_DATA_HOME/opencode-v2.db"
# V2 backups stay inside the V2 profile — never in a V1 data dir.
V2_BACKUP_DIR="$XDG_DATA_HOME/backups"
mkdir -p "$(dirname "$V2_DB")"
export OPENCODE_DB="$V2_DB"

if [ -x "$GUARD" ]; then
  _grc=0
  "$GUARD" --db "$V2_DB" --expect v2 || _grc=$?
  case "$_grc" in
    0) ;;
    2) echo "opencode-v2-iso: generation guard refused the target DB (rc=2)." >&2; exit 2 ;;
    3) echo "opencode-v2-iso: generation probe failed (rc=3) — refusing to launch unguarded." >&2; exit 3 ;;
    *) echo "opencode-v2-iso: generation guard failed unexpectedly (rc=$_grc)." >&2; exit "$_grc" ;;
  esac
else
  echo "opencode-v2-iso: guard missing at $GUARD — refusing to launch unguarded." >&2
  exit 2
fi

# Auto-maintenance (same no-block policy as the V1 lane): at/over the cap,
# trigger a background backup+prune and launch AT ONCE.
TAWASSUL_DB_CAP_BYTES="${TAWASSUL_DB_CAP_BYTES:-4294967296}"
case "$TAWASSUL_DB_CAP_BYTES" in ''|*[!0-9]*) TAWASSUL_DB_CAP_BYTES=4294967296 ;; esac
# Maintenance still lives in the V1 repo until V2 vendors its own copy
# (recorded gap — see tawassyl docs/ATOMIC-EVAL §13). Prefer a V2-local copy
# when it appears; if NEITHER exists, automation is skipped (launch proceeds).
V2_MAINT="$V2_REPO/scripts/opencode-db-maintenance.sh"
[ -x "$V2_MAINT" ] || V2_MAINT="/home/htoz/Desktop/tawassyl/scripts/opencode-db-maintenance.sh"
if [ "${TAWASSUL_AUTO_MAINTAIN:-1}" != "0" ] && [ -f "$V2_DB" ]; then
  V2_BYTES="$(file_bytes "$V2_DB")" || { echo "opencode-v2-iso: cannot read size of $V2_DB — skipping cap automation (fail-closed, launching anyway)." >&2; V2_BYTES=0; }
  if [ "$V2_BYTES" -ge "$TAWASSUL_DB_CAP_BYTES" ]; then
  COOLDOWN_MARK="${V2_DB}.auto-maint-cooldown"
  if [ ! -e "$COOLDOWN_MARK" ] || [ -n "$(find "$COOLDOWN_MARK" -mmin +1440 2>/dev/null)" ]; then
    : > "$COOLDOWN_MARK" 2>/dev/null || true
    MAINT="$V2_MAINT"
    if [ -x "$MAINT" ]; then
      nohup "$MAINT" --db "$V2_DB" --allow-in-use --cooldown-mark "$COOLDOWN_MARK" --backup-dir "$V2_BACKUP_DIR" >>"${V2_DB}.auto-maint.log" 2>&1 </dev/null &
      disown 2>/dev/null || true
      echo "⚠️  $V2_DB reached the 4GiB cap — background maintenance triggered, launching now." >&2
    else
      echo "⚠️  $V2_DB reached the 4GiB cap but no maintenance script exists — launching anyway (vendor one into V2 scripts/)." >&2
    fi
  fi
  fi
fi

# V2 runs from its own repo; default to it unless the caller is elsewhere.
if [ "${PWD:-$V2_REPO}" = "$HOME" ]; then cd "$V2_REPO"; fi
export OPENCODE="${OPENCODE:-opencode}"
exec "$OPENCODE" "$@"
