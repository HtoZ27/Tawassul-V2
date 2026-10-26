#!/usr/bin/env bash
# release-smoke.sh — pin the host, boot a scratch workspace, and call two direct tools.
#
# Exit: 0 pass · 2 version drift or missing host · 3 boot/plugin failure · 4 tool failure · 5 model reply required but missing · 64 usage.
set -u

usage() {
  echo "usage: release-smoke.sh [--model provider/model] [--timeout seconds] [--resolve-only]" >&2
}

MODEL="${TAWASSUL_SMOKE_MODEL:-opencode/big-pickle}"
BOOT_TIMEOUT="${TAWASSUL_SMOKE_TIMEOUT:-60}"
REQUIRE_MODEL_REPLY="${TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY:-1}"
RESOLVE_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --model)   [ $# -ge 2 ] || { usage; exit 64; }; MODEL="$2"; shift 2 ;;
    --timeout) [ $# -ge 2 ] || { usage; exit 64; }; BOOT_TIMEOUT="$2"; shift 2 ;;
    --resolve-only) RESOLVE_ONLY=1; shift ;;
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
  best=""
  for dir in "$HOME/.config/ai.opencode.desktop/cli/"*/; do
    [ -d "$dir" ] || continue
    [ -x "$dir/opencode-cli" ] || continue
    version="$(basename "$dir")"
    if [ -z "$best" ] || [ "$(printf '%s\n%s\n' "$best" "$version" | sort -V | tail -n1)" = "$version" ]; then
      best="$version"
    fi
  done
  if [ -n "$best" ]; then printf '%s' "$HOME/.config/ai.opencode.desktop/cli/$best/opencode-cli"; return; fi
  command -v opencode 2>/dev/null || true
}

BIN="$(resolve_bin)"
[ -n "$BIN" ] || { echo "release-smoke: host binary not found (set TAWASSUL_OPENCODE_BIN)." >&2; exit 2; }
[ -x "$BIN" ] || { echo "release-smoke: host binary not executable: $BIN" >&2; exit 2; }
if [ "$RESOLVE_ONLY" = "1" ]; then printf '%s\n' "$BIN"; exit 0; fi

ACTUAL="$("$BIN" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[ -n "$ACTUAL" ] || { echo "release-smoke: cannot read host version from $BIN." >&2; exit 2; }
if [ "$ACTUAL" != "$PIN" ]; then
  echo "release-smoke: refusing host v$ACTUAL — pinned v$PIN (override: TAWASSUL_OPENCODE_VERSION)." >&2
  exit 2
fi
echo "release-smoke: host v$ACTUAL matches the pin"

if [ "${TAWASSUL_SMOKE_SKIP_BUILD:-0}" != "1" ]; then
  (cd "$REPO" && npm run build >/dev/null 2>&1) || { echo "release-smoke: build failed." >&2; exit 3; }
fi
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

mkdir -p "$WORK/home/.config" "$WORK/home/.local/share" "$WORK/home/.local/state" "$WORK/home/.cache"
AUTH_SRC="${TAWASSUL_SMOKE_AUTH_SRC:-$HOME/.local/share/opencode/auth.json}"
export XDG_CONFIG_HOME="$WORK/home/.config"
export XDG_DATA_HOME="$WORK/home/.local/share"
export XDG_STATE_HOME="$WORK/home/.local/state"
export XDG_CACHE_HOME="$WORK/home/.cache"
if [ -f "$AUTH_SRC" ]; then
  mkdir -p "$XDG_DATA_HOME/opencode"
  ln -s "$AUTH_SRC" "$XDG_DATA_HOME/opencode/auth.json"
else
  echo "release-smoke: no auth source at $AUTH_SRC — the scratch boot runs on the anonymous free endpoint, so a provider quota refusal is expected (set TAWASSUL_SMOKE_AUTH_SRC to a real auth.json)" >&2
fi

export TAWASSUL_HMAC_KEY_DIR="$WORK/hmac"
export TAWASSUL_V2_STATE_DIR="$WORK/state"
export TAWASSUL_LOG_FILE="$WORK/tawassul.log"
export TAWASSUL_N2_LOG="$WORK/n2.jsonl"
export OPENCODE_DB="$WORK/opencode.db"

cd "$WORK" || { KEEP=1; exit 3; }
timeout "$BOOT_TIMEOUT" "$BIN" run --standalone --auto --format json --model "$MODEL" "Reply with exactly: SMOKE" >"$WORK/run.out" 2>"$WORK/run.err"
BOOT_RC=$?
PLUGIN_BOOT=0
MODEL_REPLY=0
DEGRADED=""
if grep -q 'initPlugin=' "$WORK/tawassul.log" 2>/dev/null && grep -q 'v2 registered 42 tools' "$WORK/tawassul.log" 2>/dev/null; then
  PLUGIN_BOOT=1
fi
if [ "$BOOT_RC" -ne 0 ]; then
  PROVIDER_REFUSAL=0
  if [ "$PLUGIN_BOOT" = "1" ] && grep -qE 'provider\.[a-z-]+|FreeUsageLimitError|"status": *429|Free usage limit' "$WORK/run.out" "$WORK/run.err" 2>/dev/null; then
    PROVIDER_REFUSAL=1
  fi
  if [ "$PLUGIN_BOOT" = "1" ] && [ "$PROVIDER_REFUSAL" = "1" ]; then
    DEGRADED="provider refused the model call"
    echo "release-smoke: no model reply (provider refused — quota or auth); the plugin boot is verified" >&2
  elif [ "$PLUGIN_BOOT" = "1" ] && [ "$REQUIRE_MODEL_REPLY" = "0" ]; then
    DEGRADED="no reply required (TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=0)"
    echo "release-smoke: no model reply (tolerance enabled by TAWASSUL_SMOKE_REQUIRE_MODEL_REPLY=0)" >&2
  else
    echo "release-smoke: scratch boot failed (rc=$BOOT_RC): the plugin booted but gave no model reply and no provider refusal code." >&2
    tail -5 "$WORK/run.err" >&2
    KEEP=1
    exit 3
  fi
fi
if [ "$PLUGIN_BOOT" != "1" ]; then
  echo "release-smoke: plugin boot markers missing (initPlugin or 42 tools)." >&2
  KEEP=1
  exit 3
fi
if [ "$BOOT_RC" -eq 0 ]; then
  grep -q '"text":"SMOKE"' "$WORK/run.out" || { echo "release-smoke: boot reply missing SMOKE." >&2; KEEP=1; exit 3; }
  MODEL_REPLY=1
  echo "release-smoke: scratch boot loaded the plugin and replied"
else
  echo "release-smoke: scratch boot loaded the plugin (model reply unavailable)"
fi

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

if [ "$MODEL_REPLY" = "1" ]; then
  echo "SMOKE PASS: host v$ACTUAL, scratch boot, 42 tools, model reply, health + help"
else
  echo "SMOKE PASS (no model reply — $DEGRADED): host v$ACTUAL, scratch boot, 42 tools, health + help"
fi
