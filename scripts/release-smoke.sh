#!/usr/bin/env bash
# release-smoke.sh — pin the host, boot a scratch workspace, and call two direct tools.
#
# Exit: 0 pass · 2 version drift or missing host · 3 boot/plugin failure · 4 tool failure · 64 usage.
set -u

usage() {
  echo "usage: release-smoke.sh [--model provider/model] [--timeout seconds]" >&2
}

MODEL="${TAWASSUL_SMOKE_MODEL:-opencode/big-pickle}"
BOOT_TIMEOUT="${TAWASSUL_SMOKE_TIMEOUT:-120}"
while [ $# -gt 0 ]; do
  case "$1" in
    --model)   [ $# -ge 2 ] || { usage; exit 64; }; MODEL="$2"; shift 2 ;;
    --timeout) [ $# -ge 2 ] || { usage; exit 64; }; BOOT_TIMEOUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 64 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PIN="${TAWASSUL_OPENCODE_VERSION:-2.1.4}"

resolve_bin() {
  if [ -n "${TAWASSUL_OPENCODE_BIN:-}" ]; then printf '%s' "$TAWASSUL_OPENCODE_BIN"; return; fi
  if [ -n "${OPENCODE:-}" ] && command -v "$OPENCODE" >/dev/null 2>&1; then printf '%s' "$OPENCODE"; return; fi
  if [ -x "$HOME/.opencode/bin/opencode" ]; then printf '%s' "$HOME/.opencode/bin/opencode"; return; fi
  command -v opencode 2>/dev/null || true
}

BIN="$(resolve_bin)"
[ -n "$BIN" ] || { echo "release-smoke: host binary not found (set TAWASSUL_OPENCODE_BIN)." >&2; exit 2; }
[ -x "$BIN" ] || { echo "release-smoke: host binary not executable: $BIN" >&2; exit 2; }

ACTUAL="$("$BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[ -n "$ACTUAL" ] || { echo "release-smoke: cannot read host version from $BIN." >&2; exit 2; }
if [ "$ACTUAL" != "$PIN" ]; then
  echo "release-smoke: refusing host v$ACTUAL — pinned v$PIN (override: TAWASSUL_OPENCODE_VERSION)." >&2
  exit 2
fi
echo "release-smoke: host v$ACTUAL matches the pin"

(cd "$REPO" && npm run build >/dev/null 2>&1) || { echo "release-smoke: build failed." >&2; exit 3; }
ENTRY="$REPO/.opencode/plugin/tawassul.js"
[ -f "$ENTRY" ] || { echo "release-smoke: built entry missing at $ENTRY." >&2; exit 3; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tawassul-release-smoke-XXXXXX")"
KEEP=0
cleanup() { if [ "$KEEP" = "1" ]; then echo "release-smoke: logs kept at $WORK" >&2; else rm -rf "$WORK"; fi; }
trap cleanup EXIT

mkdir -p "$WORK/.opencode/plugin" "$WORK/dist"
cp "$ENTRY" "$WORK/.opencode/plugin/tawassul.js"
cp "$REPO/dist/index.js" "$WORK/dist/index.js"
ln -s "$REPO/.opencode/node_modules" "$WORK/.opencode/node_modules"

export TAWASSUL_V2_STATE_DIR="$WORK/state"
export TAWASSUL_LOG_FILE="$WORK/tawassul.log"
export TAWASSUL_N2_LOG="$WORK/n2.jsonl"
export OPENCODE_DB="$WORK/opencode.db"

cd "$WORK" || { KEEP=1; exit 3; }
timeout "$BOOT_TIMEOUT" "$BIN" run --standalone --auto --format json --model "$MODEL" "Reply with exactly: SMOKE" >"$WORK/run.out" 2>"$WORK/run.err"
BOOT_RC=$?
if [ "$BOOT_RC" -ne 0 ]; then
  echo "release-smoke: scratch boot failed (rc=$BOOT_RC)." >&2
  tail -5 "$WORK/run.err" >&2
  KEEP=1
  exit 3
fi
grep -q '"text":"SMOKE"' "$WORK/run.out" || { echo "release-smoke: boot reply missing SMOKE." >&2; KEEP=1; exit 3; }
grep -q 'initPlugin=' "$WORK/tawassul.log" || { echo "release-smoke: plugin init line missing." >&2; KEEP=1; exit 3; }
grep -q 'v2 registered 42 tools' "$WORK/tawassul.log" || { echo "release-smoke: 42-tool registration missing." >&2; KEEP=1; exit 3; }
echo "release-smoke: scratch boot loaded the plugin and replied"

HOST_LOG="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/log/opencode.log"
if [ -f "$HOST_LOG" ] && ! grep -qF "loading plugin" "$HOST_LOG"; then
  echo "release-smoke: warning — host log has no plugin-load line at $HOST_LOG" >&2
fi

SMOKE_ENTRY="$WORK/.opencode/plugin/tawassul.js" SMOKE_DIR="$WORK" bun -e '
const entry = process.env.SMOKE_ENTRY;
const dir = process.env.SMOKE_DIR;
const mod = await import(entry);
const hooks = await mod.tawassul.server({ client: {}, directory: dir, worktree: dir });
const names = Object.keys(hooks.tool ?? {});
if (names.length !== 42) {
  console.error(`release-smoke: expected 42 tools, found ${names.length}`);
  process.exit(4);
}
const health = await hooks.tool.health.execute({}, {});
const healthOut = String(health && typeof health === "object" && "output" in health ? health.output : health);
if (!healthOut.includes("Event-loop lag") || !healthOut.includes("RSS")) {
  console.error("release-smoke: health tool output is not the expected snapshot");
  process.exit(4);
}
const help = await hooks.tool.help.execute({}, {});
const helpOut = String(help && typeof help === "object" && "output" in help ? help.output : help);
if (!helpOut.includes("Available tools")) {
  console.error("release-smoke: help tool output is not the expected catalog");
  process.exit(4);
}
console.log("release-smoke: direct tools OK (42 registered, health + help executed)");
' || { KEEP=1; exit 4; }

echo "SMOKE PASS: host v$ACTUAL, scratch boot, 42 tools, health + help"
