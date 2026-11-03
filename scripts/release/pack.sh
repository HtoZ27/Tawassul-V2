#!/usr/bin/env bash
# pack.sh - build the release artifacts from a completed dist/.
# Usage: bash scripts/release/pack.sh [--out <dir>]
set -eu

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$REPO/dist"
OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --out) [ $# -ge 2 ] || { echo "pack: --out needs a directory" >&2; exit 64; }; OUT="$2"; shift 2 ;;
    -h|--help) echo "usage: pack.sh [--out <dir>]"; exit 0 ;;
    *) echo "pack: unknown argument: $1" >&2; exit 64 ;;
  esac
done

OUT="${OUT:-$DIST/release}"
VERSION="$(node -p "require('$REPO/package.json').version")"
NAME="tawassul-$VERSION"
RUNTIME_NAME="tawassul-runtime-$VERSION"

fail() { echo "pack: $*" >&2; exit 2; }

[ -f "$DIST/index.js" ] || fail "dist/index.js is missing; run npm run build first"
[ -f "$DIST/global.js" ] || fail "dist/global.js is missing; run npm run build first"
grep -q "TAWASSUL_CONTENT_SHA=" "$DIST/global.js" || fail "dist/global.js carries no content marker; rebuild"
grep -q "TAWASSUL_CONTENT_SHA=" "$DIST/index.js" || fail "dist/index.js carries no content marker; rebuild"
command -v bun >/dev/null 2>&1 || fail "bun is required to generate the SBOM"

WASM_FILES="
web-tree-sitter/web-tree-sitter.wasm
tree-sitter-javascript/tree-sitter-javascript.wasm
tree-sitter-typescript/tree-sitter-typescript.wasm
tree-sitter-typescript/tree-sitter-tsx.wasm
"
wasm_source() {
  case "$1" in
    web-tree-sitter/*) printf '%s' "$REPO/node_modules/web-tree-sitter/web-tree-sitter.wasm" ;;
    tree-sitter-javascript/*) printf '%s' "$REPO/node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm" ;;
    tree-sitter-typescript/tree-sitter-typescript.wasm) printf '%s' "$REPO/node_modules/tree-sitter-typescript/tree-sitter-typescript.wasm" ;;
    tree-sitter-typescript/tree-sitter-tsx.wasm) printf '%s' "$REPO/node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm" ;;
    *) printf '' ;;
  esac
}

for rel in $WASM_FILES; do
  [ -f "$(wasm_source "$rel")" ] || fail "missing wasm source for $rel; run npm ci"
done

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/tawassul-pack.XXXXXX")"
trap 'rm -r "$STAGE" 2>/dev/null || true' EXIT INT TERM
umask 022

mkdir -p "$OUT"
MOUNT_EPOCH="${SOURCE_DATE_EPOCH:-}"
if [ -z "$MOUNT_EPOCH" ]; then
  MOUNT_EPOCH="$(git -C "$REPO" log -1 --format=%ct 2>/dev/null || printf '0')"
fi
[ -n "$MOUNT_EPOCH" ] || MOUNT_EPOCH=0

GNU_TAR=0
if tar --version 2>/dev/null | grep -q "GNU tar"; then GNU_TAR=1; fi
if [ "$GNU_TAR" != "1" ]; then
  echo "pack: this tar is not GNU tar; the archives will not be byte-reproducible" >&2
fi

tar_create() {
  archive="$1"
  root="$2"
  shift 2
  if [ "$GNU_TAR" = "1" ]; then
    tar --sort=name --mtime="@$MOUNT_EPOCH" --owner=0 --group=0 --numeric-owner \
      -C "$root" -cf - "$@" | gzip -n > "$archive"
  else
    tar -C "$root" -cf - "$@" | gzip -n > "$archive"
  fi
}

PKG="$STAGE/package"
mkdir -p "$PKG/dist" "$PKG/tawassul-runtime/wasm"
cp "$DIST/index.js" "$PKG/dist/index.js"
cp "$DIST/global.js" "$PKG/dist/global.js"
cp "$REPO/README.md" "$REPO/LICENSE" "$REPO/CHANGELOG.md" "$REPO/NOTICE.md" "$PKG/"

for rel in $WASM_FILES; do
  mkdir -p "$PKG/tawassul-runtime/wasm/$(dirname "$rel")"
  cp "$(wasm_source "$rel")" "$PKG/tawassul-runtime/wasm/$rel"
done

VERSION="$VERSION" node -e '
const fs = require("node:fs");
const manifest = {
  name: "tawassul-v2",
  version: process.env.VERSION,
  description: "Tawassul plugin for OpenCode v2 (Plugin API v2)",
  license: "MIT",
  type: "module",
  main: "dist/index.js",
  exports: {
    ".": "./dist/index.js",
    "./global.js": "./dist/global.js",
  },
  files: ["dist", "tawassul-runtime", "README.md", "LICENSE", "CHANGELOG.md", "NOTICE.md"],
  engines: { node: ">=26.13.0" },
};
fs.writeFileSync(process.argv[1], JSON.stringify(manifest, null, 2) + "\n");
' "$PKG/package.json"

tar_create "$OUT/$NAME.tgz" "$STAGE" package

mkdir -p "$STAGE/runtime/tawassul-runtime/wasm"
for rel in $WASM_FILES; do
  mkdir -p "$STAGE/runtime/tawassul-runtime/wasm/$(dirname "$rel")"
  cp "$(wasm_source "$rel")" "$STAGE/runtime/tawassul-runtime/wasm/$rel"
done
tar_create "$OUT/$RUNTIME_NAME.tar.gz" "$STAGE/runtime" tawassul-runtime

cp "$DIST/global.js" "$OUT/$NAME.global.js"
cp "$DIST/index.js" "$OUT/$NAME.index.js"
cp "$REPO/NOTICE.md" "$OUT/NOTICE.md"
printf '%s\n' "$VERSION" > "$OUT/VERSION"

SOURCE_DATE_EPOCH="$MOUNT_EPOCH" bun "$REPO/scripts/gen-sbom.ts" --out "$OUT/$NAME.cdx.json" >/dev/null

(
  cd "$OUT"
  rm -f SHA256SUMS
  sha256sum "$NAME.tgz" "$RUNTIME_NAME.tar.gz" "$NAME.global.js" "$NAME.index.js" \
    "$NAME.cdx.json" "VERSION" "NOTICE.md" | LC_ALL=C sort -k2 > SHA256SUMS
)

echo "pack: wrote $OUT ($NAME)"
echo "pack:   $NAME.tgz"
echo "pack:   $RUNTIME_NAME.tar.gz"
echo "pack:   $NAME.global.js"
echo "pack:   $NAME.index.js"
echo "pack:   $NAME.cdx.json"
echo "pack:   VERSION, NOTICE.md, SHA256SUMS"
echo "pack: run bun scripts/release/verify-artifact.ts to check the set"
