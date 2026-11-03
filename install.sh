#!/bin/sh
# install.sh - install a Tawassul release into a project or a global config root.
# POSIX shell; needs tar, gzip, and either curl or wget when it is not given --from.
set -eu

INSTALLER_VERSION="0.1.0-experimental"
REPO_SLUG="HtoZ27/tawassul-v2"
RELEASE="$INSTALLER_VERSION"
BASE_URL="${TAWASSUL_RELEASE_BASE_URL:-https://github.com/$REPO_SLUG/releases/download/v$RELEASE}"

SCOPE=""
PROJECT=""
PREFIX=""
FROM=""
DRY_RUN=0
UNINSTALL=0
FORCE=0

usage() {
  cat <<'EOF'
usage: install.sh --project <dir> [--from <dir>] [--dry-run] [--uninstall]
       install.sh --global [--prefix <dir>] [--from <dir>] [--dry-run] [--uninstall]

  --project <dir>   install into <dir>/.opencode
  --global          install into the OpenCode global config root
  --prefix <dir>    treat <dir> as HOME for a scratch global install
  --from <dir>      read the release artifacts from a local directory
  --release <v>     install this version instead of the embedded one
  --dry-run         print the plan; write nothing
  --uninstall       remove the entry and runtime this installer wrote
  --force           allow an uninstall without a Tawassul marker
  --version         print the installer version
  --help, -h        print this message

The installer never edits opencode.json or opencode.jsonc.
EOF
}

say() { printf '%s\n' "install: $*"; }
fail() { printf '%s\n' "install: $*" >&2; exit 2; }
usage_fail() { usage >&2; printf '%s\n' "install: $*" >&2; exit 64; }

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      [ $# -ge 2 ] || usage_fail "--project needs a directory"
      [ -z "$SCOPE" ] || usage_fail "choose exactly one of --project and --global"
      SCOPE="project"; PROJECT="$2"; shift 2 ;;
    --global)
      [ -z "$SCOPE" ] || usage_fail "choose exactly one of --project and --global"
      SCOPE="global"; shift ;;
    --prefix)
      [ $# -ge 2 ] || usage_fail "--prefix needs a directory"
      PREFIX="$2"; shift 2 ;;
    --from)
      [ $# -ge 2 ] || usage_fail "--from needs a directory"
      FROM="$2"; shift 2 ;;
    --release)
      [ $# -ge 2 ] || usage_fail "--release needs a version"
      RELEASE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --force) FORCE=1; shift ;;
    --version) printf 'install.sh %s\n' "$INSTALLER_VERSION"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) usage_fail "unknown argument: $1" ;;
  esac
done

[ -n "$SCOPE" ] || usage_fail "choose --project <dir> or --global"
[ -n "$PROJECT" ] || [ "$SCOPE" = "global" ] || usage_fail "--project needs a directory"
[ -z "$PREFIX" ] || [ "$SCOPE" = "global" ] || usage_fail "--prefix applies to --global only"

printf '%s' "$RELEASE" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' \
  || fail "--release expects a semantic version, got: $RELEASE"
BASE_URL="${TAWASSUL_RELEASE_BASE_URL:-https://github.com/$REPO_SLUG/releases/download/v$RELEASE}"

case "$(uname -s)" in
  Linux) : ;;
  Darwin) : ;;
  MINGW*|MSYS*|CYGWIN*) say "native Windows is experimental; this lane needs Git for Windows" ;;
  *) fail "unsupported platform: $(uname -s)" ;;
esac

if [ "$SCOPE" = "project" ]; then
  ROOT="$PROJECT"
  ENTRY="$PROJECT/.opencode/plugin/tawassul.js"
  RUNTIME="$PROJECT/.opencode/tawassul-runtime"
  CONFIG_ROOT="$PROJECT/.opencode"
else
  if [ -n "$PREFIX" ]; then
    CONFIG_BASE="$PREFIX/.config"
  elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
    CONFIG_BASE="$XDG_CONFIG_HOME"
  else
    CONFIG_BASE="$HOME/.config"
  fi
  ROOT="$CONFIG_BASE/opencode"
  ENTRY="$ROOT/plugins/tawassul.js"
  RUNTIME="$ROOT/tawassul-runtime"
  CONFIG_ROOT="$ROOT"
fi
MARKER="$RUNTIME/VERSION"

marker_owned() {
  [ -f "$MARKER" ] || return 1
  grep -q '"package"[[:space:]]*:[[:space:]]*"tawassul-v2"' "$MARKER"
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    fail "no sha256sum or shasum on PATH"
  fi
}

sum_for() {
  awk -v name="$1" '$2 == name { print $1; exit }' "$2"
}

fetch() {
  url="$1"
  out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 --connect-timeout 20 -o "$out" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$out" "$url"
  else
    fail "no curl or wget on PATH; use --from <dir> with the release artifacts"
  fi
}

if [ -e "$(dirname "$ENTRY")/tawassul" ] && [ -f "$(dirname "$ENTRY")/tawassul/index.js" ]; then
  fail "a directory-layout install already occupies $(dirname "$ENTRY")/tawassul; remove it first"
fi

if [ "$UNINSTALL" = "1" ]; then
  if [ ! -e "$ENTRY" ] && [ ! -d "$RUNTIME" ]; then
    say "nothing installed at $ENTRY"
    exit 0
  fi
  if ! marker_owned && [ "$FORCE" != "1" ]; then
    fail "no Tawassul marker at $MARKER; pass --force to remove $ENTRY anyway"
  fi
  if [ "$DRY_RUN" = "1" ]; then
    say "dry run - would remove $ENTRY"
    say "dry run - would remove the wasm and marker under $RUNTIME"
    exit 0
  fi
  rm -f "$ENTRY"
  if [ -d "$RUNTIME" ]; then
    for id in web-tree-sitter tree-sitter-javascript tree-sitter-typescript; do
      rm -f "$RUNTIME/wasm/$id/"*.wasm 2>/dev/null || true
      rmdir "$RUNTIME/wasm/$id" 2>/dev/null || true
    done
    rm -f "$MARKER"
    rmdir "$RUNTIME/wasm" 2>/dev/null || true
    rmdir "$RUNTIME" 2>/dev/null || true
  fi
  say "removed $ENTRY"
  say "kept every file this installer did not write"
  exit 0
fi

BUNDLE_NAME="tawassul-$RELEASE.global.js"
ARCHIVE_NAME="tawassul-runtime-$RELEASE.tar.gz"

if [ "$DRY_RUN" = "1" ]; then
  say "dry run - would install Tawassul $RELEASE"
  say "  entry:   $ENTRY"
  say "  runtime: $RUNTIME"
  if [ -n "$FROM" ]; then
    say "  source:  $FROM"
  else
    say "  source:  $BASE_URL"
  fi
  say "  no opencode.json or opencode.jsonc is written"
  exit 0
fi

if [ -e "$RUNTIME" ] && ! marker_owned && [ "$FORCE" != "1" ]; then
  fail "$RUNTIME exists without a Tawassul marker; pass --force to replace it"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/tawassul-install.XXXXXX")"
trap 'rm -r "$TMP" 2>/dev/null || true' EXIT INT TERM

if [ -n "$FROM" ]; then
  [ -d "$FROM" ] || fail "--from directory does not exist: $FROM"
  [ -f "$FROM/SHA256SUMS" ] || fail "no SHA256SUMS in $FROM"
  [ -f "$FROM/$BUNDLE_NAME" ] || fail "no $BUNDLE_NAME in $FROM"
  [ -f "$FROM/$ARCHIVE_NAME" ] || fail "no $ARCHIVE_NAME in $FROM"
  SUMS="$FROM/SHA256SUMS"
  BUNDLE="$FROM/$BUNDLE_NAME"
  ARCHIVE="$FROM/$ARCHIVE_NAME"
else
  SUMS="$TMP/SHA256SUMS"
  BUNDLE="$TMP/$BUNDLE_NAME"
  ARCHIVE="$TMP/$ARCHIVE_NAME"
  fetch "$BASE_URL/SHA256SUMS" "$SUMS" || fail "cannot download $BASE_URL/SHA256SUMS"
  fetch "$BASE_URL/$BUNDLE_NAME" "$BUNDLE" || fail "cannot download $BASE_URL/$BUNDLE_NAME"
  fetch "$BASE_URL/$ARCHIVE_NAME" "$ARCHIVE" || fail "cannot download $BASE_URL/$ARCHIVE_NAME"
fi

for pair in "$BUNDLE_NAME:$BUNDLE" "$ARCHIVE_NAME:$ARCHIVE"; do
  name="${pair%%:*}"
  file="${pair#*:}"
  expected="$(sum_for "$name" "$SUMS")"
  [ -n "$expected" ] || fail "SHA256SUMS has no entry for $name; refusing an unverified artifact"
  actual="$(hash_file "$file")"
  [ "$actual" = "$expected" ] || fail "checksum mismatch for $name: $actual vs $expected"
done

LIST="$TMP/archive.list"
tar -tzf "$ARCHIVE" > "$LIST" || fail "cannot read $ARCHIVE"
if grep -v -E '^tawassul-runtime(/|$)' "$LIST" | grep -q .; then
  fail "$ARCHIVE contains a path outside tawassul-runtime/"
fi
if grep -q '\.\.' "$LIST"; then
  fail "$ARCHIVE contains a parent traversal"
fi
for rel in \
  web-tree-sitter/web-tree-sitter.wasm \
  tree-sitter-javascript/tree-sitter-javascript.wasm \
  tree-sitter-typescript/tree-sitter-typescript.wasm \
  tree-sitter-typescript/tree-sitter-tsx.wasm
do
  grep -qx "tawassul-runtime/wasm/$rel" "$LIST" || fail "$ARCHIVE is missing wasm/$rel"
done
[ "$(grep -c '\.wasm$' "$LIST")" -eq 4 ] || fail "$ARCHIVE must carry exactly four wasm files"

mkdir -p "$(dirname "$ENTRY")" "$CONFIG_ROOT"
cp "$BUNDLE" "$ENTRY.tmp.$$"
chmod 644 "$ENTRY.tmp.$$"
mv "$ENTRY.tmp.$$" "$ENTRY"
tar -xzf "$ARCHIVE" -C "$CONFIG_ROOT"

BUNDLE_SHA="$(hash_file "$ENTRY")"
BUNDLE_BYTES="$(wc -c < "$ENTRY" | tr -d ' ')"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

{
  printf '{\n'
  printf '  "package": "tawassul-v2",\n'
  printf '  "lane": "install.sh",\n'
  printf '  "version": "%s",\n' "$RELEASE"
  printf '  "bundle": { "sha256": "%s", "bytes": %s },\n' "$BUNDLE_SHA" "$BUNDLE_BYTES"
  printf '  "wasm": {\n'
  first=1
  for rel in \
    web-tree-sitter/web-tree-sitter.wasm \
    tree-sitter-javascript/tree-sitter-javascript.wasm \
    tree-sitter-typescript/tree-sitter-typescript.wasm \
    tree-sitter-typescript/tree-sitter-tsx.wasm
  do
    id="$(basename "$rel" .wasm)"
    file="$RUNTIME/wasm/$rel"
    [ -f "$file" ] || fail "extraction did not produce $file"
    [ "$first" = "1" ] || printf ',\n'
    first=0
    printf '    "%s": { "sha256": "%s", "bytes": %s }' "$id" "$(hash_file "$file")" "$(wc -c < "$file" | tr -d ' ')"
  done
  printf '\n  },\n'
  printf '  "installedAt": "%s"\n' "$STAMP"
  printf '}\n'
} > "$MARKER"

say "installed Tawassul $RELEASE"
say "  entry:   $ENTRY ($(printf '%s' "$BUNDLE_SHA" | cut -c1-12))"
say "  runtime: $RUNTIME/wasm (4 grammars)"
say "  no opencode.json or opencode.jsonc was written; restart the host to load it"
