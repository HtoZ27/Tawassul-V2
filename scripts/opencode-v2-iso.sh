#!/usr/bin/env bash
# opencode-v2-iso.sh — generation-scoped launcher for Tawassul V2 (4a).
#
# V2 must NEVER open a shared/legacy/V1 database (the import migrates on open
# and strands V1). This wrapper pins V2 to its own XDG quad + its own DB file,
# runs the bidirectional generation guard, resolves the file-watcher policy,
# and only then execs the pinned host.
#
# Usage: from the V2 repo: scripts/opencode-v2-iso.sh [opencode args...]
# Env:   TAWASSUL_OPENCODE_BIN — explicit host CLI to exec (wins).
#        OPENCODE — host CLI, used only when it resolves to a command. The
#        host exports OPENCODE=1 into tool shells, so a non-command value is
#        ignored; the default is "$HOME/.opencode/bin/opencode".
#        TAWASSUL_WATCHER=on|off|auto (env > pinned.env > auto)
#        TW_DISABLE_FILEWATCHER=1 (legacy; honored in auto mode only)

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

# One key from the pinned machine state without sourcing it.
launcher_pinned_get() { # $1=key
  local key="$1" file="$XDG_CONFIG_HOME/pinned.env" line=""
  [ -n "$key" ] || return 0
  [ -f "$file" ] || return 0
  line="$(grep -m1 "^${key}=" "$file" 2>/dev/null || true)"
  [ -n "$line" ] || return 0
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

# Resolve the watcher flag the pinned build actually consumes.
# 2.1.4 reads OPENCODE_DISABLE_FILEWATCHER; older builds used the
# OPENCODE_EXPERIMENTAL_ prefix. The verdict is cached by size+mtime so a
# binary update re-probes and a rename is loud, never a silent no-op.
launcher_watcher_flag() { # $1=binary → flag on stdout; rc!=0 when unsupported
  local bin="$1" meta="" cache="" line="" flag=""
  [ -n "$bin" ] || return 1
  case "$bin" in
    */*) ;;
    *) bin="$(command -v "$bin" 2>/dev/null || printf '%s' "$bin")" ;;
  esac
  [ -f "$bin" ] || return 1
  meta="$(stat -c '%s %Y' "$bin" 2>/dev/null || stat -f '%z %m' "$bin" 2>/dev/null || true)"
  meta="$(printf '%s' "$meta" | tr -d ' \t\n')"
  [ -n "$meta" ] || return 1
  cache="$XDG_CACHE_HOME/watcher-flag.cache"
  line="$(head -n 1 "$cache" 2>/dev/null || true)"
  case "$line" in
    "$bin|$meta|OPENCODE_DISABLE_FILEWATCHER") printf 'OPENCODE_DISABLE_FILEWATCHER'; return 0 ;;
    "$bin|$meta|OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER") printf 'OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER'; return 0 ;;
    "$bin|$meta|absent") return 1 ;;
  esac
  for flag in OPENCODE_DISABLE_FILEWATCHER OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER; do
    if command -v grep >/dev/null 2>&1 && grep -qa -m1 "$flag" "$bin" 2>/dev/null; then
      mkdir -p "$(dirname "$cache")" 2>/dev/null || true
      printf '%s|%s|%s\n' "$bin" "$meta" "$flag" >"$cache" 2>/dev/null || true
      printf '%s' "$flag"
      return 0
    fi
  done
  mkdir -p "$(dirname "$cache")" 2>/dev/null || true
  printf '%s|%s|absent\n' "$bin" "$meta" >"$cache" 2>/dev/null || true
  return 1
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
# prune the previous run's host events before exec, then trigger a background
# backup+prune and launch AT ONCE.
TAWASSUL_DB_CAP_BYTES="${TAWASSUL_DB_CAP_BYTES:-4294967296}"
case "$TAWASSUL_DB_CAP_BYTES" in ''|*[!0-9]*) TAWASSUL_DB_CAP_BYTES=4294967296 ;; esac
# V2 owns its maintenance lane: the V1 script is never a fallback (S-041).
V2_MAINT="$V2_REPO/scripts/opencode-db-maintenance.sh"
if [ ! -x "$V2_MAINT" ]; then
  echo "opencode-v2-iso: V2 maintenance script missing at $V2_MAINT — refusing to launch unmaintained." >&2
  exit 2
fi
if [ "${TAWASSUL_AUTO_MAINTAIN:-1}" != "0" ] && [ -f "$V2_DB" ]; then
  V2_BYTES="$(file_bytes "$V2_DB")" || { echo "opencode-v2-iso: cannot read size of $V2_DB — skipping cap automation (fail-closed, launching anyway)." >&2; V2_BYTES=0; }
  if [ "$V2_BYTES" -ge "$TAWASSUL_DB_CAP_BYTES" ]; then
  COOLDOWN_MARK="${V2_DB}.auto-maint-cooldown"
  if [ ! -e "$COOLDOWN_MARK" ] || [ -n "$(find "$COOLDOWN_MARK" -mmin +1440 2>/dev/null)" ]; then
    : > "$COOLDOWN_MARK" 2>/dev/null || true
    "$V2_MAINT" --db "$V2_DB" --event-only >>"${V2_DB}.auto-maint.log" 2>&1 || \
      echo "⚠️  opencode-v2-iso: event prune failed (S-040) — launching anyway." >&2
    nohup "$V2_MAINT" --db "$V2_DB" --allow-in-use --cooldown-mark "$COOLDOWN_MARK" --backup-dir "$V2_BACKUP_DIR" >>"${V2_DB}.auto-maint.log" 2>&1 </dev/null &
    disown 2>/dev/null || true
    echo "⚠️  $V2_DB reached the 4GiB cap — events pruned, background maintenance triggered, launching now." >&2
  fi
  fi
fi

# Pin the host binary version: a v1/mismatched CLI must not open a v2 DB.
OPENCODE_VERSION_PIN="${TAWASSUL_OPENCODE_VERSION:-2.1.4}"
if [ -n "${TAWASSUL_OPENCODE_BIN:-}" ]; then
  OPENCODE_BIN="$TAWASSUL_OPENCODE_BIN"
elif [ -n "${OPENCODE:-}" ] && command -v "$OPENCODE" >/dev/null 2>&1; then
  OPENCODE_BIN="$OPENCODE"
else
  OPENCODE_BIN="$HOME/.opencode/bin/opencode"
fi
if ! command -v "$OPENCODE_BIN" >/dev/null 2>&1; then
  echo "opencode-v2-iso: host binary not found: $OPENCODE_BIN (set OPENCODE or install it)." >&2
  exit 2
fi
_OPENCODE_ACTUAL="$("$OPENCODE_BIN" --version 2>/dev/null | awk '{print $2}' | sed 's/^v//')"
if [ "$_OPENCODE_ACTUAL" != "$OPENCODE_VERSION_PIN" ]; then
  echo "opencode-v2-iso: refusing binary ${_OPENCODE_ACTUAL:-unknown} at $OPENCODE_BIN — pinned v$OPENCODE_VERSION_PIN (override: TAWASSUL_OPENCODE_VERSION)." >&2
  exit 2
fi

# ── file-watcher policy (D1/D7) ─────────────────────────────────────────────
# Precedence: TAWASSUL_WATCHER env > pinned.env > auto. In auto mode a
# rotational disk holding the project, the launch directory, or $HOME disables
# the watcher; the legacy TW_DISABLE_FILEWATCHER=1 is honored in auto mode only
# (an explicit on/off wins). The flag is exported only when the pinned build
# advertises it — a rename is loud, never a silent no-op.
_WATCH_MODE="${TAWASSUL_WATCHER:-}"
[ -n "$_WATCH_MODE" ] || _WATCH_MODE="$(launcher_pinned_get TAWASSUL_WATCHER)"
case "$_WATCH_MODE" in
  on|off|auto) ;;
  "") _WATCH_MODE=auto ;;
  *) echo "opencode-v2-iso: invalid TAWASSUL_WATCHER '$_WATCH_MODE' — using auto." >&2; _WATCH_MODE=auto ;;
esac

_D7_REASON=""
if command -v findmnt >/dev/null 2>&1 && command -v lsblk >/dev/null 2>&1; then
  for _tree in "${TAWASSUL_PROJECT_DIR:-}" "${PWD:-}" "${HOME:-}"; do
    [ -n "$_tree" ] || continue
    _src="$(findmnt -no SOURCE -T "$_tree" 2>/dev/null || true)"
    [ -n "$_src" ] || continue
    _rota="$(lsblk -ndo ROTA "$_src" 2>/dev/null | tr -d ' \t\n' || true)"
    if [ "$_rota" = "1" ]; then _D7_REASON="rotational-disk"; break; fi
  done
fi

_WATCH_OFF=0
_WATCH_REASON=""
case "$_WATCH_MODE" in
  on) _WATCH_REASON="TAWASSUL_WATCHER=on" ;;
  off) _WATCH_OFF=1; _WATCH_REASON="TAWASSUL_WATCHER=off" ;;
  *)
    if [ "${TW_DISABLE_FILEWATCHER:-}" = "1" ]; then
      _WATCH_OFF=1; _WATCH_REASON="auto: legacy TW_DISABLE_FILEWATCHER=1"
    elif [ -n "$_D7_REASON" ]; then
      _WATCH_OFF=1; _WATCH_REASON="auto: $_D7_REASON"
    else
      _WATCH_REASON="auto: no-signal"
    fi
    ;;
esac

_WATCH_FINAL=on
if [ "$_WATCH_OFF" = 1 ]; then
  _WATCH_FLAG="$(launcher_watcher_flag "$OPENCODE_BIN" || true)"
  if [ -n "$_WATCH_FLAG" ]; then
    export "${_WATCH_FLAG}=true"
    _WATCH_FINAL=off
    echo "opencode-v2-iso: file watcher disabled ($_WATCH_REASON; ${_WATCH_FLAG}=true)." >&2
  else
    _WATCH_REASON="disable-requested-unsupported: $_WATCH_REASON"
    echo "opencode-v2-iso: watcher disable requested ($_WATCH_REASON) but the pinned build does not advertise a watcher flag — leaving the watcher on." >&2
  fi
fi
mkdir -p "$XDG_DATA_HOME/tawassul" 2>/dev/null || true
printf '%s [launcher] watcher mode=%s d7=%s decision=%s reason=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf 'unknown')" \
  "$_WATCH_MODE" "${_D7_REASON:-none}" "$_WATCH_FINAL" "${_WATCH_REASON:-none}" \
  >>"$XDG_DATA_HOME/tawassul/tawassul.log" 2>/dev/null || true

# V2 runs from its own repo; default to it unless the caller is elsewhere.
if [ "${PWD:-$V2_REPO}" = "$HOME" ]; then cd "$V2_REPO"; fi
exec "$OPENCODE_BIN" "$@"
