import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const GLOBAL_BUNDLE = join(REPO, "dist", "global.js");
const PROJECT_BUNDLE = join(REPO, ".opencode", "plugin", "tawassul.js");
const HOME = process.env.HOME?.trim() || homedir();
const HOST_PIN = process.env.TAWASSUL_OPENCODE_VERSION?.trim() || "2.1.4";
const PLUGIN_ID = "tawassul-v2";
const MARKER_NAME = "VERSION";
const REPO_PACKAGE = JSON.parse(readFileSync(join(REPO, "package.json"), "utf-8")) as {
  version?: string;
};

type AssetSpec = { id: string; relative: string };
type ResolvedAsset = AssetSpec & { source: string; dest: string };
type AssetRecord = { path: string; sha256: string; bytes: number };
type Marker = {
  package?: string;
  version?: string;
  host?: string;
  bundle?: AssetRecord;
  wasm?: Record<string, AssetRecord>;
  installedAt?: string;
};
type Host = { bin: string; version: string };

const ASSETS: AssetSpec[] = [
  { id: "web-tree-sitter", relative: join("web-tree-sitter", "web-tree-sitter.wasm") },
  { id: "tree-sitter-javascript", relative: join("tree-sitter-javascript", "tree-sitter-javascript.wasm") },
  { id: "tree-sitter-typescript", relative: join("tree-sitter-typescript", "tree-sitter-typescript.wasm") },
  { id: "tree-sitter-tsx", relative: join("tree-sitter-typescript", "tree-sitter-tsx.wasm") },
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const KNOWN_FLAGS = new Set([
  "--install",
  "--uninstall",
  "--verify",
  "--purge",
  "--force",
  "--dry-run",
  "--help",
  "-h",
]);

function fail(message: string): never {
  console.error(`install-global: ${message}`);
  process.exit(2);
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as T;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function configBase(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  return xdg ? resolve(xdg) : resolve(HOME, ".config");
}

function globalConfigDir(): string {
  const override = process.env.TAWASSUL_GLOBAL_DIR?.trim();
  return override ? resolve(override) : resolve(configBase(), "opencode");
}

const GLOBAL_DIR = globalConfigDir();
const PLUGIN_DIR = join(GLOBAL_DIR, "plugins");
const TARGET = join(PLUGIN_DIR, "tawassul.js");
const LEGACY_PACKAGE = join(PLUGIN_DIR, "tawassul");
const RUNTIME = join(GLOBAL_DIR, "tawassul-runtime");
const WASM_DIR = join(RUNTIME, "wasm");
const MARKER_FILE = join(RUNTIME, MARKER_NAME);

function markerPath(path: string): string {
  return relative(GLOBAL_DIR, path).split(sep).join("/");
}

function fromMarker(path: string): string {
  return resolve(GLOBAL_DIR, path);
}

function parseVersion(text: string): string | undefined {
  const match = text.match(/(\d+\.\d+\.\d+)/);
  return match?.[1];
}

function readHost(bin: string): Host | undefined {
  if (!existsSync(bin)) return undefined;
  const result = spawnSync(bin, ["--version"], { encoding: "utf-8", timeout: 10_000 });
  if (result.status !== 0) return undefined;
  const version = parseVersion(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  return version ? { bin, version } : undefined;
}

function hostCandidates(): string[] {
  const out: string[] = [];
  const explicit = process.env.OPENCODE_BIN?.trim();
  if (explicit) out.push(resolve(explicit));
  const desktop = join(HOME, ".config", "ai.opencode.desktop", "cli");
  if (existsSync(desktop)) {
    for (const entry of readdirSync(desktop).sort()) {
      out.push(join(desktop, entry, "opencode-cli"));
    }
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir) out.push(join(dir, "opencode"));
  }
  return [...new Set(out)];
}

function hosts(): Host[] {
  const found: Host[] = [];
  for (const candidate of hostCandidates()) {
    const host = readHost(candidate);
    if (host) found.push(host);
  }
  return found;
}

function checkHosts(): void {
  const found = hosts();
  if (found.length === 0) {
    console.warn(`install-global: no OpenCode host found; installing for the pinned v${HOST_PIN}`);
    return;
  }
  for (const host of found) {
    if (host.version !== HOST_PIN) {
      console.warn(`install-global: ignoring ${host.bin} (v${host.version}); the pinned host is v${HOST_PIN}`);
    }
  }
  if (!found.some((host) => host.version === HOST_PIN)) {
    fail(`no v${HOST_PIN} OpenCode host found; set TAWASSUL_OPENCODE_VERSION deliberately`);
  }
}

function v1Artifacts(): string[] {
  const out: string[] = [];
  const terminal = join(HOME, ".opencode");
  if (existsSync(terminal)) out.push(`${terminal} (v1 terminal install)`);
  const bunPackage = join(HOME, ".bun", "install", "global", "node_modules", "opencode-ai");
  if (existsSync(bunPackage)) out.push(`${bunPackage} (v1 Bun package)`);
  const bunBinary = join(HOME, ".bun", "bin", "opencode");
  if (existsSync(bunBinary)) out.push(`${bunBinary} (v1 binary on PATH)`);
  const globalPackage = join(GLOBAL_DIR, "package.json");
  if (existsSync(globalPackage)) {
    const raw = readFileSync(globalPackage, "utf-8");
    if (raw.includes("@opencode-ai/plugin")) {
      out.push(`${globalPackage} (v1 plugin SDK pin)`);
    }
  }
  return out;
}

function refuseLegacyPackage(): void {
  if (existsSync(LEGACY_PACKAGE)) {
    fail(
      `legacy package-directory install present: ${LEGACY_PACKAGE} ` +
        "(remove it before installing the flat self-contained file)",
    );
  }
}

function readMarker(): Marker | undefined {
  const marker = readJson<Marker>(MARKER_FILE);
  return marker;
}

function requireBundle(): { bytes: Buffer; sha: string } {
  if (!existsSync(GLOBAL_BUNDLE)) {
    fail(`missing ${GLOBAL_BUNDLE}; run npm run build first`);
  }
  const bytes = readFileSync(GLOBAL_BUNDLE);
  const text = bytes.toString("utf8");
  const bare = text.match(
    /(?:from|import\()\s*["'](?:@opencode|zod|web-tree-sitter|effect)(?:\/[^"']*)?["']/,
  );
  if (bare) {
    fail(`dist/global.js is not self-contained: ${bare[0]}`);
  }
  return { bytes, sha: hash(bytes) };
}

function locateAssets(): { resolved: ResolvedAsset[]; missing: AssetSpec[] } {
  const roots = [join(REPO, "node_modules"), join(REPO, ".opencode", "node_modules")];
  const resolved: ResolvedAsset[] = [];
  const missing: AssetSpec[] = [];
  for (const asset of ASSETS) {
    let source: string | undefined;
    for (const root of roots) {
      const candidate = join(root, asset.relative);
      if (existsSync(candidate)) {
        source = candidate;
        break;
      }
    }
    if (source) {
      resolved.push({ ...asset, source, dest: join(WASM_DIR, asset.relative) });
    } else {
      missing.push(asset);
    }
  }
  return { resolved, missing };
}

function runNpmInstall(): void {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["install", "--no-audit", "--no-fund"], {
    cwd: REPO,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`npm install failed in ${REPO}; install the tree-sitter wasm packages manually`);
  }
}

function resolveAssets(allowInstall: boolean): ResolvedAsset[] {
  let scan = locateAssets();
  if (scan.missing.length > 0 && allowInstall) {
    console.log(
      `install-global: missing wasm assets (${scan.missing.map((asset) => asset.id).join(", ")}); running npm install`,
    );
    runNpmInstall();
    scan = locateAssets();
  }
  if (scan.missing.length > 0) {
    fail(
      `missing wasm assets: ${scan.missing.map((asset) => asset.id).join(", ")}; ` +
        `run npm install in ${REPO}`,
    );
  }
  return scan.resolved;
}

function assetRecords(assets: ResolvedAsset[]): Record<string, AssetRecord> {
  const records: Record<string, AssetRecord> = {};
  for (const asset of assets) {
    const bytes = readFileSync(asset.source);
    records[asset.id] = {
      path: markerPath(asset.dest),
      sha256: hash(bytes),
      bytes: bytes.length,
    };
  }
  return records;
}

function writeAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, file);
}

function writeMarker(bundleSha: string, wasm: Record<string, AssetRecord>): void {
  const bundleBytes = readFileSync(TARGET);
  const marker: Marker = {
    package: PLUGIN_ID,
    version: REPO_PACKAGE.version ?? "0.0.0",
    host: HOST_PIN,
    bundle: {
      path: markerPath(TARGET),
      sha256: bundleSha,
      bytes: bundleBytes.length,
    },
    wasm,
    installedAt: new Date().toISOString(),
  };
  writeAtomic(MARKER_FILE, `${JSON.stringify(marker, null, 2)}\n`);
}

function upToDate(
  marker: Marker | undefined,
  bundleSha: string,
  wasm: Record<string, AssetRecord>,
): boolean {
  if (!marker || marker.package !== PLUGIN_ID) return false;
  if (marker.version !== (REPO_PACKAGE.version ?? "0.0.0")) return false;
  if (marker.host !== HOST_PIN) return false;
  if (marker.bundle?.sha256 !== bundleSha) return false;
  if (!existsSync(TARGET)) return false;
  if (hash(readFileSync(TARGET)) !== bundleSha) return false;
  for (const asset of ASSETS) {
    const record = marker.wasm?.[asset.id];
    const want = wasm[asset.id];
    if (!record || !want || record.sha256 !== want.sha256 || record.path !== want.path) return false;
    const installed = fromMarker(record.path);
    if (!existsSync(installed) || hash(readFileSync(installed)) !== record.sha256) return false;
  }
  return true;
}

function install(): void {
  checkHosts();
  const artifacts = v1Artifacts();
  if (artifacts.length > 0) {
    fail(`v1 artifacts must be removed before a global install:\n  ${artifacts.join("\n  ")}`);
  }
  refuseLegacyPackage();
  const bundle = requireBundle();
  const assets = resolveAssets(!flags.has("--dry-run"));
  const wasm = assetRecords(assets);
  const existing = readMarker();
  if (existsSync(TARGET) && !existing && !flags.has("--force")) {
    fail(`target exists without a Tawassul marker: ${TARGET} (use --force to replace)`);
  }
  if (existing && existing.package !== PLUGIN_ID && !flags.has("--force")) {
    fail(`target belongs to another plugin: ${TARGET}`);
  }
  if (upToDate(existing, bundle.sha, wasm)) {
    console.log(
      `install-global: already installed at ${TARGET} ` +
        `(v${existing?.version ?? "unknown"}, ${bundle.sha.slice(0, 12)})`,
    );
    return;
  }
  if (flags.has("--dry-run")) {
    console.log(
      `install-global: dry run — would write ${TARGET} (${bundle.bytes.length} bytes, ${bundle.sha.slice(0, 12)})`,
    );
    console.log(`install-global: dry run — would write ${assets.length} wasm assets under ${WASM_DIR}`);
    return;
  }
  mkdirSync(PLUGIN_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(RUNTIME, { recursive: true, mode: 0o700 });
  writeAtomic(TARGET, bundle.bytes);
  for (const asset of assets) {
    mkdirSync(dirname(asset.dest), { recursive: true, mode: 0o700 });
    writeAtomic(asset.dest, readFileSync(asset.source));
  }
  writeMarker(bundle.sha, wasm);
  console.log(
    `install-global: installed ${TARGET} (v${REPO_PACKAGE.version ?? "0.0.0"}, ${bundle.sha.slice(0, 12)})`,
  );
  console.log(`install-global: installed ${assets.length} wasm assets under ${WASM_DIR}`);
  console.log("install-global: no opencode.json edit is needed; the host discovers this file");
}

function purge(): void {
  const paths = [
    join(configBase(), "tawassul-v2"),
    join(GLOBAL_DIR, "tawassul-v2-state"),
    join(GLOBAL_DIR, "tawassul.jsonc"),
    join(GLOBAL_DIR, "tawassul.json"),
    join(GLOBAL_DIR, "tawassul-pins.json"),
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    if (flags.has("--dry-run")) {
      console.log(`install-global: dry run — would purge ${path}`);
      continue;
    }
    rmSync(path, { recursive: true, force: true });
    console.log(`install-global: purged ${path}`);
  }
  const agents = join(GLOBAL_DIR, "agent");
  if (existsSync(agents)) {
    const count = readdirSync(agents).filter((name) => name.endsWith(".md")).length;
    console.log(
      `install-global: kept ${count} agent file(s) in ${agents} (remove them manually if unwanted)`,
    );
  }
}

function uninstall(): void {
  const targetExists = existsSync(TARGET);
  const runtimeExists = existsSync(RUNTIME);
  if (!targetExists && !runtimeExists) {
    console.log(`install-global: nothing installed at ${TARGET}`);
    return;
  }
  const marker = readMarker();
  if ((!marker || marker.package !== PLUGIN_ID) && !flags.has("--force")) {
    fail(`refusing to remove ${TARGET}: no Tawassul marker (use --force)`);
  }
  if (flags.has("--dry-run")) {
    console.log(`install-global: dry run — would remove ${TARGET} and ${RUNTIME}`);
    return;
  }
  if (targetExists) rmSync(TARGET, { force: true });
  if (runtimeExists) rmSync(RUNTIME, { recursive: true, force: true });
  console.log(`install-global: removed ${TARGET}`);
  console.log(`install-global: removed ${RUNTIME}`);
  if (flags.has("--purge")) purge();
  else console.log("install-global: kept global roster and state; pass --purge to remove them");
}

async function verify(): Promise<void> {
  if (!existsSync(TARGET)) fail(`not installed: ${TARGET}`);
  const marker = readMarker();
  if (!marker || marker.package !== PLUGIN_ID) {
    fail(`missing Tawassul marker: ${MARKER_FILE}`);
  }
  if (!marker.bundle?.sha256) fail(`marker has no bundle hash: ${MARKER_FILE}`);
  const installed = readFileSync(TARGET);
  const installedSha = hash(installed);
  if (installedSha !== marker.bundle.sha256) {
    fail(`bundle hash mismatch: installed ${installedSha} vs marker ${marker.bundle.sha256}`);
  }
  if (marker.bundle.bytes !== installed.length) {
    fail(`bundle size mismatch: installed ${installed.length} vs marker ${marker.bundle.bytes}`);
  }
  if (marker.host !== HOST_PIN) {
    fail(`marker host pin is v${marker.host ?? "unknown"}; expected v${HOST_PIN}`);
  }
  if (marker.version !== (REPO_PACKAGE.version ?? "0.0.0")) {
    fail(`marker version is ${marker.version ?? "unknown"}; repo is ${REPO_PACKAGE.version ?? "0.0.0"}`);
  }
  if (existsSync(GLOBAL_BUNDLE)) {
    const distSha = hash(readFileSync(GLOBAL_BUNDLE));
    if (distSha !== installedSha) {
      fail(
        `installed bundle differs from dist/global.js (${installedSha} vs ${distSha}); ` +
          "run npm run install:global",
      );
    }
  } else {
    console.warn("install-global: dist/global.js is absent; skipping the source comparison");
  }
  for (const asset of ASSETS) {
    const record = marker.wasm?.[asset.id];
    if (!record) fail(`marker has no record for ${asset.id}`);
    const file = fromMarker(record.path);
    if (!existsSync(file)) fail(`missing wasm asset: ${file}`);
    const bytes = readFileSync(file);
    if (bytes.length !== record.bytes) {
      fail(`wasm size mismatch for ${asset.id}: ${bytes.length} vs ${record.bytes}`);
    }
    if (hash(bytes) !== record.sha256) {
      fail(`wasm hash mismatch for ${asset.id}: run npm run install:global`);
    }
  }
  refuseLegacyPackage();
  const { detectInstallScope } = await import("../src/core/install-scope.ts");
  const scope = detectInstallScope(pathToFileURL(TARGET).href);
  if (scope !== "global") fail(`scope detection returned ${scope} for ${TARGET}`);
  if (existsSync(PROJECT_BUNDLE)) {
    const projectScope = detectInstallScope(pathToFileURL(PROJECT_BUNDLE).href);
    if (projectScope !== "project") {
      fail(`scope detection returned ${projectScope} for the project bundle`);
    }
  }
  console.log(
    `install-global: verified ${TARGET} (v${marker.version ?? "unknown"}, ` +
      `${installedSha.slice(0, 12)}, global scope, ${ASSETS.length} wasm assets)`,
  );
}

function usage(): void {
  console.log("install-global: manage the opt-in OpenCode global plugin install");
  console.log("  bun scripts/install-global.ts [--dry-run] [--force]");
  console.log("  bun scripts/install-global.ts --verify");
  console.log("  bun scripts/install-global.ts --uninstall [--purge] [--dry-run]");
  console.log(`  plugin:  ${TARGET}`);
  console.log(`  runtime: ${RUNTIME}`);
  console.log("  the installer never edits the global opencode.json(c)");
}

async function main(): Promise<void> {
  for (const arg of args) {
    if (!KNOWN_FLAGS.has(arg)) fail(`unknown argument: ${arg}`);
  }
  if (flags.has("--help") || flags.has("-h")) {
    usage();
    return;
  }
  if (flags.has("--verify")) {
    await verify();
    return;
  }
  if (flags.has("--uninstall")) {
    uninstall();
    return;
  }
  install();
}

await main();
