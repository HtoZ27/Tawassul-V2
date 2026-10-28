import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const GLOBAL_BUNDLE = join(REPO, "dist", "global.js");
const PROJECT_BUNDLE = join(REPO, ".opencode", "plugin", "tawassul.js");
const HOME = process.env.HOME?.trim() || homedir();
const HOST_MIN = "2.2.0";
const HOST_AUDITED = "2.2.0";
const HOST_MAJOR = 2;
const HOST_OVERRIDE = process.env.TAWASSUL_OPENCODE_VERSION?.trim();
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
  sourceSha?: string;
  bundle?: AssetRecord;
  wasm?: Record<string, AssetRecord>;
  db?: Record<string, AssetRecord>;
  preflight?: Record<string, string>;
  trigger?: string;
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

function gitHead(): string | undefined {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf-8", timeout: 10_000 });
  if (result.status !== 0) return undefined;
  const sha = (result.stdout ?? "").trim();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : undefined;
}

function readSourceSha(text: string): string | undefined {
  const match = text.match(/TAWASSUL_SOURCE_SHA=([0-9a-f]{7,40})/);
  return match?.[1];
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
const DB_DIR = join(RUNTIME, "db");
const MARKER_FILE = join(RUNTIME, MARKER_NAME);

const DB_SHIP: Array<{ id: string; file: string }> = [
  { id: "maintenance", file: "opencode-db-maintenance.sh" },
  { id: "guard", file: "guard-db-generation.sh" },
  { id: "scheduled", file: "opencode-db-scheduled.sh" },
  { id: "db-env", file: "db-env.sh" },
  { id: "doctor", file: "doctor-v2.sh" },
];
function dbShipSource(item: { file: string }): string {
  return join(REPO, "scripts", item.file);
}

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

function versionParts(version: string): [number, number, number] | undefined {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareHostVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return left.localeCompare(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

function isSupportedHost(version: string): boolean {
  const parts = versionParts(version);
  if (!parts) return false;
  if (parts[0] !== HOST_MAJOR) return false;
  if (compareHostVersions(version, HOST_MIN) < 0) return false;
  return HOST_OVERRIDE ? version === HOST_OVERRIDE : true;
}

function overrideRangeError(): string | undefined {
  if (!HOST_OVERRIDE) return undefined;
  const parts = versionParts(HOST_OVERRIDE);
  if (!parts) {
    return `TAWASSUL_OPENCODE_VERSION=v${HOST_OVERRIDE} is not a semantic version`;
  }
  if (parts[0] !== HOST_MAJOR || compareHostVersions(HOST_OVERRIDE, HOST_MIN) < 0) {
    return `TAWASSUL_OPENCODE_VERSION=v${HOST_OVERRIDE} is outside the supported range >=${HOST_MIN} <${HOST_MAJOR + 1}.0.0`;
  }
  return undefined;
}

function hostRange(): string {
  return HOST_OVERRIDE
    ? `the pinned v${HOST_OVERRIDE}`
    : `a supported host v>=${HOST_MIN} <${HOST_MAJOR + 1}.0.0`;
}

function hostWarning(version: string): string | undefined {
  if (HOST_OVERRIDE || !isSupportedHost(version)) return undefined;
  if (compareHostVersions(version, HOST_AUDITED) > 0) {
    return `host v${version} is newer than the audited v${HOST_AUDITED}; run npm run check:upstream`;
  }
  return undefined;
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

function checkHosts(): Host {
  const overrideError = overrideRangeError();
  if (overrideError) fail(overrideError);
  const all = hosts();
  const found = all.filter((host) => isSupportedHost(host.version));
  for (const host of all) {
    if (isSupportedHost(host.version)) continue;
    console.warn(`install-global: ignoring ${host.bin} (v${host.version}); expected ${hostRange()}`);
  }
  if (found.length === 0) {
    if (all.length > 0) {
      fail(`no supported OpenCode host found; expected ${hostRange()}`);
    }
    const fallback = HOST_OVERRIDE ?? HOST_AUDITED;
    console.warn(`install-global: no OpenCode host found; installing for v${fallback}`);
    return { bin: "", version: fallback };
  }
  found.sort((left, right) => compareHostVersions(right.version, left.version));
  const selected = found[0]!;
  const warning = hostWarning(selected.version);
  if (warning) console.warn(`install-global: ${warning}`);
  return selected;
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

function projectDuplicatePath(): string {
  return resolve(process.cwd(), ".opencode", "plugins", "tawassul.js");
}

function refuseProjectDuplicate(): void {
  const duplicate = projectDuplicatePath();
  if (!existsSync(duplicate)) return;
  fail(
    `a project copy of this plugin exists at ${duplicate} while the global target is ${TARGET} — ` +
      "the plugin would be loaded twice. Remove the project copy, or run this installer from another directory.",
  );
}

function readMarker(): Marker | undefined {
  const marker = readJson<Marker>(MARKER_FILE);
  return marker;
}

function requireBundle(): { bytes: Buffer; sha: string; sourceSha: string | undefined } {
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
  return { bytes, sha: hash(bytes), sourceSha: readSourceSha(text) };
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

function writeAtomic(file: string, data: string | Buffer, mode = 0o600): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode });
  renameSync(tmp, file);
}

function dbRecords(): Record<string, AssetRecord> {
  const records: Record<string, AssetRecord> = {};
  for (const item of DB_SHIP) {
    const bytes = readFileSync(dbShipSource(item));
    records[item.id] = {
      path: markerPath(join(DB_DIR, item.file)),
      sha256: hash(bytes),
      bytes: bytes.length,
    };
  }
  return records;
}

function depPresent(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function preflightMarks(): Record<string, string> {
  const deps: Array<[string, boolean]> = [
    ["sqlite3", true],
    ["timeout", false],
    ["python3", false],
    ["free", true],
    ["fuser", false],
  ];
  const marks: Record<string, string> = {};
  for (const [bin] of deps) {
    marks[bin] = depPresent(bin) ? "present" : "missing";
  }
  return marks;
}

function preflightLaptop(): void {
  const marks = preflightMarks();
  const platform = process.platform;
  if (platform === "darwin") {
    console.log("install-global: macOS preflight — manual lane, no automation claim (P4 pending)");
    for (const [bin, state] of Object.entries(marks)) {
      console.log(`  ${bin}: ${state}`);
    }
    return;
  }
  const bounded = marks.timeout === "present" || marks.python3 === "present";
  const hardGaps: string[] = [];
  if (marks.sqlite3 !== "present") hardGaps.push("sqlite3 (sqlite3 package — every probe and mutation refuses without it)");
  if (!bounded) hardGaps.push("timeout or python3 (the guard refuses unbounded queries without one)");
  if (marks.free !== "present") hardGaps.push("free (procps — the space gate refuses without it)");
  for (const gap of hardGaps) {
    fail(`install-global: missing hard dependency: ${gap}`);
  }
  if (marks.fuser !== "present") {
    console.warn("install-global: fuser (psmisc) is missing — the default run and --event-only refuse without it; only the VACUUM-skip degrade is_soft.");
  }
  for (const [bin, state] of Object.entries(marks)) {
    console.log(`  dep ${bin}: ${state}`);
  }
}

function dbSmoke(): void {
  const maint = join(DB_DIR, "opencode-db-maintenance.sh");
  let resolved = "";
  try {
    resolved = execFileSync(
      "bash",
      ["-c", `. '${join(DB_DIR, "db-env.sh")}'; db_resolve_path >/dev/null 2>&1; printf '%s' "$RESOLVED_DB"`],
      { stdio: "pipe" },
    )
      .toString()
      .trim();
  } catch {
    fail("install-global: db-env resolution failed — the lane cannot find the DB (see P1.7 smoke)");
  }
  if (!resolved || !existsSync(resolved)) {
    console.log(`install-global: smoke skipped — no DB yet at ${resolved || "(unresolved)"}`);
    return;
  }
  try {
    execFileSync("bash", [maint, "--db", resolved, "--check"], { stdio: "pipe", timeout: 240000 });
    console.log(`install-global: smoke ok (--check against ${resolved})`);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    fail(
      `install-global: smoke --check failed against ${resolved}: ${String(err.stdout ?? "")}${String(err.stderr ?? "")}`,
    );
  }
}

const TRIGGER_TAG = "tawassul-db-maintenance";
const TRIGGER_UNITS = {
  service: "tawassul-db-maintenance.service",
  timer: "tawassul-db-maintenance.timer",
};

function triggerMode(): string {
  const value = process.env.TAWASSUL_REGISTER_TRIGGERS?.trim().toLowerCase();
  if (value === "off" || value === "systemd" || value === "cron" || value === "manual") return value;
  return "auto";
}

function systemdUnitDir(): string {
  return join(configBase(), "systemd", "user");
}

function systemdUnitPath(name: string): string {
  return join(systemdUnitDir(), name);
}

function scheduledPath(): string {
  return join(DB_DIR, "opencode-db-scheduled.sh");
}

function unitContentSafe(script: string): boolean {
  return !/[`'"%$\\]/.test(script);
}

function runTriggerCommand(cmd: string, args: string[], input?: string): number {
  const result = spawnSync(cmd, args, { encoding: "utf-8", timeout: 15_000, ...(input === undefined ? {} : { input }) });
  return result.status ?? -1;
}

function removeUnitFiles(): void {
  rmSync(systemdUnitPath(TRIGGER_UNITS.service), { force: true });
  rmSync(systemdUnitPath(TRIGGER_UNITS.timer), { force: true });
  console.log(`install-global: removed ${TRIGGER_UNITS.service} and ${TRIGGER_UNITS.timer} under ${systemdUnitDir()}`);
}

function writeUnitFiles(script: string): void {
  mkdirSync(systemdUnitDir(), { recursive: true, mode: 0o755 });
  writeAtomic(
    systemdUnitPath(TRIGGER_UNITS.service),
    [
      "[Unit]",
      "Description=Tawassul v2 DB maintenance lane",
      "",
      "[Service]",
      "Type=oneshot",
      `ExecStart=/usr/bin/env bash ${script} --run`,
      "",
    ].join("\n"),
    0o644,
  );
  writeAtomic(
    systemdUnitPath(TRIGGER_UNITS.timer),
    [
      "[Unit]",
      "Description=Tawassul v2 DB maintenance schedule",
      "",
      "[Timer]",
      "OnCalendar=*-*-* 04:17:00",
      "RandomizedDelaySec=600",
      "Persistent=true",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
    0o644,
  );
}

function trySystemd(script: string): string | undefined {
  if (!unitContentSafe(script)) return undefined;
  writeUnitFiles(script);
  if (runTriggerCommand("systemctl", ["--user", "daemon-reload"]) !== 0) {
    removeUnitFiles();
    return undefined;
  }
  if (runTriggerCommand("systemctl", ["--user", "enable", "--now", "tawassul-db-maintenance.timer"]) !== 0) {
    removeUnitFiles();
    return undefined;
  }
  return "systemd";
}

function cronLine(script: string): string {
  return `17 4 * * * /usr/bin/env bash ${script} --run # ${TRIGGER_TAG}`;
}

function readCrontab(): { ok: boolean; lines: Array<string> } {
  const result = spawnSync("crontab", ["-l"], { encoding: "utf-8", timeout: 15_000 });
  if ((result.status ?? -1) !== 0) return { ok: false, lines: [] };
  return { ok: true, lines: (result.stdout ?? "").split("\n") };
}

function writeCrontab(lines: Array<string>): boolean {
  return runTriggerCommand("crontab", ["-"], lines.join("\n")) === 0;
}

function tryCron(script: string): string | undefined {
  if (!unitContentSafe(script)) return undefined;
  const listing = readCrontab();
  if (!listing.ok) return undefined;
  if (listing.lines.some((line) => line.includes(TRIGGER_TAG))) return "cron";
  const kept = listing.lines.filter((line) => line.trim() !== "");
  if (!writeCrontab([...kept, cronLine(script)])) return undefined;
  return "cron";
}

function registerTriggers(): string {
  const mode = triggerMode();
  if (mode === "off") {
    console.log("install-global: trigger registration skipped (TAWASSUL_REGISTER_TRIGGERS=off)");
    return "manual";
  }
  if (mode === "manual") {
    console.log("install-global: trigger registration skipped (TAWASSUL_REGISTER_TRIGGERS=manual)");
    return "manual";
  }
  if (!existsSync(scheduledPath())) {
    console.log("install-global: trigger registration skipped — scheduled script missing");
    return "manual";
  }
  const script = scheduledPath();
  if (mode === "systemd") {
    const systemd = trySystemd(script);
    if (systemd) {
      console.log("install-global: registered systemd user timer tawassul-db-maintenance.timer");
      return systemd;
    }
    console.log("install-global: systemd registration failed (TAWASSUL_REGISTER_TRIGGERS=systemd) — trigger is manual");
    return "manual";
  }
  if (mode === "cron") {
    const cron = tryCron(script);
    if (cron) {
      console.log("install-global: registered cron line (tagged) for the daily run");
      return cron;
    }
    console.log("install-global: cron registration failed (TAWASSUL_REGISTER_TRIGGERS=cron) — trigger is manual");
    return "manual";
  }
  const systemd = trySystemd(script);
  if (systemd) {
    console.log("install-global: registered systemd user timer tawassul-db-maintenance.timer");
    return systemd;
  }
  const cron = tryCron(script);
  if (cron) {
    console.log("install-global: systemd unavailable — registered cron line (tagged) for the daily run");
    return cron;
  }
  console.log("install-global: no systemd or cron available — trigger is manual (the plugin still triggers at boot)");
  return "manual";
}

function unitIsOwned(): boolean {
  try {
    const service = readFileSync(systemdUnitPath(TRIGGER_UNITS.service), "utf-8");
    return service.includes("opencode-db-scheduled.sh");
  } catch {
    return false;
  }
}

function uninstallTriggers(): void {
  if (flags.has("--dry-run")) {
    if (unitIsOwned()) console.log(`install-global: dry run — would remove the ${TRIGGER_TAG} systemd timer`);
    if (readCrontab().lines.some((line) => line.includes(TRIGGER_TAG))) {
      console.log(`install-global: dry run — would remove the tagged ${TRIGGER_TAG} cron line`);
    }
    return;
  }
  if (unitIsOwned()) {
    runTriggerCommand("systemctl", ["--user", "disable", "--now", "tawassul-db-maintenance.timer"]);
    removeUnitFiles();
    runTriggerCommand("systemctl", ["--user", "daemon-reload"]);
  } else if (existsSync(systemdUnitPath(TRIGGER_UNITS.service))) {
    console.log(`install-global: ${TRIGGER_UNITS.service} exists but is not owned by this install — left untouched`);
  }
  const listing = readCrontab();
  const owned = listing.lines.filter((line) => line.includes(TRIGGER_TAG));
  if (owned.length > 0) {
    const kept = listing.lines.filter((line) => !line.includes(TRIGGER_TAG) && line.trim() !== "");
    if (writeCrontab(kept)) console.log(`install-global: removed ${owned.length} tagged cron line(s)`);
    else console.log("install-global: could not rewrite the crontab — the tagged cron line remains");
  }
}

function writeMarker(
  bundleSha: string,
  wasm: Record<string, AssetRecord>,
  db: Record<string, AssetRecord>,
  sourceSha: string | undefined,
  host: string,
  trigger: string,
): void {
  const bundleBytes = readFileSync(TARGET);
  const marker: Marker = {
    package: PLUGIN_ID,
    version: REPO_PACKAGE.version ?? "0.0.0",
    host,
    sourceSha,
    bundle: {
      path: markerPath(TARGET),
      sha256: bundleSha,
      bytes: bundleBytes.length,
    },
    wasm,
    db,
    preflight: preflightMarks(),
    trigger,
    installedAt: new Date().toISOString(),
  };
  writeAtomic(MARKER_FILE, `${JSON.stringify(marker, null, 2)}\n`);
}

function upToDate(
  marker: Marker | undefined,
  bundleSha: string,
  wasm: Record<string, AssetRecord>,
  sourceSha: string | undefined,
  db: Record<string, AssetRecord>,
): boolean {
  if (!marker || marker.package !== PLUGIN_ID) return false;
  if (marker.version !== (REPO_PACKAGE.version ?? "0.0.0")) return false;
  if (!marker.host || !isSupportedHost(marker.host)) return false;
  if (marker.bundle?.sha256 !== bundleSha) return false;
  if (!existsSync(TARGET)) return false;
  if (hash(readFileSync(TARGET)) !== bundleSha) return false;
  const head = gitHead();
  if (head && marker.sourceSha !== head) return false;
  if (sourceSha && marker.sourceSha !== sourceSha) return false;
  for (const asset of ASSETS) {
    const record = marker.wasm?.[asset.id];
    const want = wasm[asset.id];
    if (!record || !want || record.sha256 !== want.sha256 || record.path !== want.path) return false;
    const installed = fromMarker(record.path);
    if (!existsSync(installed) || hash(readFileSync(installed)) !== record.sha256) return false;
  }
  for (const item of DB_SHIP) {
    const record = marker.db?.[item.id];
    const want = db[item.id];
    if (!record || !want || record.sha256 !== want.sha256 || record.path !== want.path) return false;
    const installed = fromMarker(record.path);
    if (!existsSync(installed) || hash(readFileSync(installed)) !== record.sha256) return false;
  }
  return true;
}

function install(): void {
  const host = checkHosts();
  const artifacts = v1Artifacts();
  if (artifacts.length > 0) {
    fail(`v1 artifacts must be removed before a global install:\n  ${artifacts.join("\n  ")}`);
  }
  refuseLegacyPackage();
  refuseProjectDuplicate();
  const bundle = requireBundle();
  const assets = resolveAssets(!flags.has("--dry-run"));
  const wasm = assetRecords(assets);
  const db = dbRecords();
  const existing = readMarker();
  if (existsSync(TARGET) && !existing && !flags.has("--force")) {
    fail(`target exists without a Tawassul marker: ${TARGET} (use --force to replace)`);
  }
  if (existing && existing.package !== PLUGIN_ID && !flags.has("--force")) {
    fail(`target belongs to another plugin: ${TARGET}`);
  }
  const head = gitHead();
  if (head && bundle.sourceSha && bundle.sourceSha !== head && !flags.has("--force")) {
    fail(
      `bundle source SHA ${bundle.sourceSha} does not match HEAD ${head}; ` +
        "run npm run build before installing",
    );
  }
  if (upToDate(existing, bundle.sha, wasm, bundle.sourceSha, db)) {
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
    console.log(`install-global: dry run — would write ${DB_SHIP.length} db scripts under ${DB_DIR}`);
    return;
  }
  try {
    mkdirSync(PLUGIN_DIR, { recursive: true, mode: 0o700 });
    mkdirSync(RUNTIME, { recursive: true, mode: 0o700 });
    mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code ?? "unknown";
    fail(
      `cannot create the runtime layout under ${RUNTIME} (${code}) — refusing to write ${TARGET}. ` +
        "A plain file may occupy that path, or it may be read-only; remove it or point TAWASSUL_GLOBAL_DIR elsewhere.",
    );
  }
  writeAtomic(TARGET, bundle.bytes);
  for (const asset of assets) {
    mkdirSync(dirname(asset.dest), { recursive: true, mode: 0o700 });
    writeAtomic(asset.dest, readFileSync(asset.source));
  }
  for (const item of DB_SHIP) {
    writeAtomic(join(DB_DIR, item.file), readFileSync(dbShipSource(item)), 0o700);
  }
  preflightLaptop();
  const trigger = registerTriggers();
  writeMarker(bundle.sha, wasm, db, bundle.sourceSha, host.version, trigger);
  dbSmoke();
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
    uninstallTriggers();
    return;
  }
  uninstallTriggers();
  if (targetExists) rmSync(TARGET, { force: true });
  if (runtimeExists) rmSync(RUNTIME, { recursive: true, force: true });
  console.log(`install-global: removed ${TARGET}`);
  console.log(`install-global: removed ${RUNTIME}`);
  if (flags.has("--purge")) purge();
  else console.log("install-global: kept global roster and state; pass --purge to remove them");
}

async function verify(): Promise<void> {
  const overrideError = overrideRangeError();
  if (overrideError) fail(overrideError);
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
  if (!marker.host || !isSupportedHost(marker.host)) {
    fail(`marker host is v${marker.host ?? "unknown"}; expected ${hostRange()}`);
  }
  if (marker.version !== (REPO_PACKAGE.version ?? "0.0.0")) {
    fail(`marker version is ${marker.version ?? "unknown"}; repo is ${REPO_PACKAGE.version ?? "0.0.0"}`);
  }
  if (marker.sourceSha) {
    const installedSourceSha = readSourceSha(installed.toString("utf8"));
    if (installedSourceSha && installedSourceSha !== marker.sourceSha) {
      fail(`bundle source SHA mismatch: installed ${installedSourceSha} vs marker ${marker.sourceSha}`);
    }
    const head = gitHead();
    if (head && marker.sourceSha !== head) {
      fail(`installed bundle is stale: marker ${marker.sourceSha} vs HEAD ${head}`);
    }
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
  if (!marker.db || Object.keys(marker.db).length !== DB_SHIP.length) {
    fail(`marker has no db payload — reinstall (npm run install:global) to stage tawassul-runtime/db`);
  }
  for (const item of DB_SHIP) {
    const record = marker.db?.[item.id];
    if (!record) fail(`marker has no db record for ${item.id}`);
    const file = fromMarker(record.path);
    if (!existsSync(file)) fail(`missing db script: ${file}`);
    const bytes = readFileSync(file);
    if (bytes.length !== record.bytes) {
      fail(`db size mismatch for ${item.id}: ${bytes.length} vs ${record.bytes}`);
    }
    if (hash(bytes) !== record.sha256) {
      fail(`db hash mismatch for ${item.id}: run npm run install:global`);
    }
    if (!(statSync(file).mode & 0o100)) {
      fail(`db script lost its exec bit: ${file} — run npm run install:global`);
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
