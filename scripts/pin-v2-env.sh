#!/usr/bin/env bash
set -euo pipefail

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config/tawassul-v2}"
KEY="${1:-TAWASSUL_WATCHER}"
VALUE="${2:-auto}"

case "$KEY" in
  TAWASSUL_WATCHER|TAWASSUL_OPENCODE_VERSION) ;;
  *) echo "pin-v2-env: unsupported key: $KEY" >&2; exit 2 ;;
esac
case "$KEY:$VALUE" in
  TAWASSUL_WATCHER:on|TAWASSUL_WATCHER:off|TAWASSUL_WATCHER:auto) ;;
  TAWASSUL_OPENCODE_VERSION:[0-9]*) ;;
  *) echo "pin-v2-env: unsupported value for $KEY: $VALUE" >&2; exit 2 ;;
esac

mkdir -p "$CONFIG_HOME"
FILE="$CONFIG_HOME/pinned.env"
TMP="$FILE.tmp.$$"
touch "$FILE"
grep -v "^${KEY}=" "$FILE" >"$TMP" 2>/dev/null || true
printf '%s=%s\n' "$KEY" "$VALUE" >>"$TMP"
mv "$TMP" "$FILE"
echo "pin-v2-env: $KEY=$VALUE in $FILE"
