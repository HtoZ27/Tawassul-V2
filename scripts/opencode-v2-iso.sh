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
#        ignored.
#        Resolution order: explicit env → ~/.opencode/bin/opencode → the
#        Desktop-bundled CLI (the same pinned engine) → error. Removing the
#        terminal copy does not break this launcher.
#        Interactive/run/mini commands default to --standalone so a dev run
#        never attaches to the live Desktop service; explicit --server,
#        --url, or --standalone wins.
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

db_total_bytes() { # $1=db → main + WAL bytes; rc!=0 when unreadable
  local total=0 f n
  for f in "$1" "$1-wal"; do
    [ -e "$f" ] || continue
    n="$(file_bytes "$f")" || return 1
    total=$((total + n))
  done
  printf '%s' "$total"
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
# 2.2.0 reads OPENCODE_DISABLE_FILEWATCHER; older builds used the
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
  V2_BYTES="$(db_total_bytes "$V2_DB")" || {
    echo "❌ opencode-v2-iso: cannot measure $V2_DB (db+wal) — refusing to launch unguarded." >&2
    exit 2
  }
  if [ "$V2_BYTES" -ge "$TAWASSUL_DB_CAP_BYTES" ]; then
    COOLDOWN_MARK="${V2_DB}.auto-maint-cooldown"
    if [ ! -e "$COOLDOWN_MARK" ] || [ -n "$(find "$COOLDOWN_MARK" -mmin +1440 2>/dev/null)" ]; then
      : > "$COOLDOWN_MARK" 2>/dev/null || true
      EV_RC=0
      "$V2_MAINT" --db "$V2_DB" --event-only --event-delete --cap-bytes "$TAWASSUL_DB_CAP_BYTES" >>"${V2_DB}.auto-maint.log" 2>&1 || EV_RC=$?
      case "$EV_RC" in
        0|9) ;;
        *) echo "⚠️  opencode-v2-iso: event retention failed (rc=$EV_RC) — the cap guard still applies." >&2 ;;
      esac
      V2_AFTER="$(db_total_bytes "$V2_DB")" || {
        echo "❌ opencode-v2-iso: cannot re-measure $V2_DB after event retention — refusing to launch unguarded." >&2
        exit 2
      }
      V2_BYTES="$V2_AFTER"
      if [ "$V2_AFTER" -lt "$TAWASSUL_DB_CAP_BYTES" ]; then
        nohup "$V2_MAINT" --db "$V2_DB" --allow-in-use --cooldown-mark "$COOLDOWN_MARK" --backup-dir "$V2_BACKUP_DIR" >>"${V2_DB}.auto-maint.log" 2>&1 </dev/null &
        disown 2>/dev/null || true
        echo "⚠️  $V2_DB reached the cap — events pruned, background maintenance triggered, launching now." >&2
      fi
    fi
  fi
  if [ "$V2_BYTES" -ge "$TAWASSUL_DB_CAP_BYTES" ]; then
    if [ "${TAWASSUL_ALLOW_OVER_CAP:-0}" = "1" ]; then
      echo "⚠️  opencode-v2-iso: $V2_DB is at/over the cap ($V2_BYTES >= $TAWASSUL_DB_CAP_BYTES bytes, db+wal) — launching under TAWASSUL_ALLOW_OVER_CAP=1." >&2
    else
      echo "❌ opencode-v2-iso: $V2_DB is at/over the cap ($V2_BYTES >= $TAWASSUL_DB_CAP_BYTES bytes, db+wal)." >&2
      echo "   Close OpenCode, then run: bash \"$V2_MAINT\" --db \"$V2_DB\" --prune-days 90 --backup-dir \"$V2_BACKUP_DIR\"" >&2
      echo "   Override (not recommended): TAWASSUL_ALLOW_OVER_CAP=1" >&2
      exit 2
    fi
  fi
fi

# Resolve the host CLI: explicit env, terminal install, then the Desktop CLI.
# The Desktop ships the same pinned engine under cli/<version>-<arch>/, so the
# launcher keeps working after the terminal copy is removed.
launcher_host_bin() {
  local candidate="" dir="" best="" version=""
  if [ -n "${TAWASSUL_OPENCODE_BIN:-}" ]; then
    printf '%s' "$TAWASSUL_OPENCODE_BIN"
    return 0
  fi
  if [ -n "${OPENCODE:-}" ] && command -v "$OPENCODE" >/dev/null 2>&1; then
    printf '%s' "$OPENCODE"
    return 0
  fi
  candidate="$HOME/.opencode/bin/opencode"
  if [ -x "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi
  for dir in "$HOME/.config/ai.opencode.desktop/cli/"*/; do
    [ -d "$dir" ] || continue
    [ -x "$dir/opencode-cli" ] || continue
    version="$(basename "$dir")"
    if [ -z "$best" ] || [ "$(printf '%s\n%s\n' "$best" "$version" | sort -V | tail -n1)" = "$version" ]; then
      best="$version"
    fi
  done
  if [ -n "$best" ]; then
    printf '%s' "$HOME/.config/ai.opencode.desktop/cli/$best/opencode-cli"
    return 0
  fi
  return 1
}

# Pin the host binary version: a v1/mismatched CLI must not open a v2 DB.
OPENCODE_VERSION_MIN="2.2.0"
OPENCODE_VERSION_AUDITED="2.2.1"
OPENCODE_VERSION_MAJOR="2"
OPENCODE_VERSION_PIN="${TAWASSUL_OPENCODE_VERSION:-}"
OPENCODE_BIN="$(launcher_host_bin)" || OPENCODE_BIN=""
if [ -z "$OPENCODE_BIN" ]; then
  echo "opencode-v2-iso: host binary not found (set TAWASSUL_OPENCODE_BIN or install OpenCode)." >&2
  exit 2
fi
if ! command -v "$OPENCODE_BIN" >/dev/null 2>&1; then
  echo "opencode-v2-iso: host binary not found: $OPENCODE_BIN (set OPENCODE or install it)." >&2
  exit 2
fi
version_at_least() {
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}
_OPENCODE_ACTUAL="$("$OPENCODE_BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
if [ -n "$OPENCODE_VERSION_PIN" ]; then
  if [ "${OPENCODE_VERSION_PIN%%.*}" != "$OPENCODE_VERSION_MAJOR" ] || ! version_at_least "$OPENCODE_VERSION_PIN" "$OPENCODE_VERSION_MIN"; then
    echo "opencode-v2-iso: pin v$OPENCODE_VERSION_PIN is outside the supported range v>=$OPENCODE_VERSION_MIN <$((OPENCODE_VERSION_MAJOR + 1)).0.0." >&2
    exit 2
  fi
  if [ "$_OPENCODE_ACTUAL" != "$OPENCODE_VERSION_PIN" ]; then
    echo "opencode-v2-iso: refusing binary ${_OPENCODE_ACTUAL:-unknown} at $OPENCODE_BIN — pinned v$OPENCODE_VERSION_PIN (override: TAWASSUL_OPENCODE_VERSION)." >&2
    exit 2
  fi
elif [ -z "$_OPENCODE_ACTUAL" ] || [ "${_OPENCODE_ACTUAL%%.*}" != "$OPENCODE_VERSION_MAJOR" ] || ! version_at_least "$_OPENCODE_ACTUAL" "$OPENCODE_VERSION_MIN"; then
  echo "opencode-v2-iso: refusing binary ${_OPENCODE_ACTUAL:-unknown} at $OPENCODE_BIN — supported v>=$OPENCODE_VERSION_MIN <$((OPENCODE_VERSION_MAJOR + 1)).0.0 (override: TAWASSUL_OPENCODE_VERSION)." >&2
  exit 2
elif [ "$_OPENCODE_ACTUAL" != "$OPENCODE_VERSION_AUDITED" ]; then
  echo "opencode-v2-iso: host v$_OPENCODE_ACTUAL is newer than the audited v$OPENCODE_VERSION_AUDITED; run npm run check:upstream." >&2
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

# Isolation default: TUI, run, and mini get a private server, so a dev run
# never attaches to the live Desktop service (whose DB and state would win)
# and never leaves a detached background host behind. An explicit --server,
# --url, or --standalone disables the injection.
_ISOLATE=1
case "${1:-}" in
  ""|run|mini) ;;
  *) _ISOLATE=0 ;;
esac
if [ "$_ISOLATE" = 1 ]; then
  for _arg in "$@"; do
    case "$_arg" in
      --standalone|--server|--server=*|--url|--url=*) _ISOLATE=0 ;;
    esac
  done
fi
if [ "$_ISOLATE" = 1 ]; then
  case "${1:-}" in
    "") set -- --standalone ;;
    run|mini) _sub="$1"; shift; set -- "$_sub" --standalone "$@" ;;
  esac
  echo "opencode-v2-iso: isolated client mode (--standalone) — the live Desktop service is not used." >&2
fi

exec "$OPENCODE_BIN" "$@"
