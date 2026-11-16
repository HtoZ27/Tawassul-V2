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
} from "node:fs";
import { homedir } from "node:os";
import { dirname, delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sourceDigest } from "./source-digest.ts";
import {
  HMAC_KEY_FILE,
  dependencyProbeCommand,
  installLane,
  operatorKeyProblem,
  usesPosixDatabaseLane,
  windowsAclPath,
  windowsKeyAclArgv,
  windowsKeyDirectory,
} from "../src/core/install-lane.ts";
import { hostProbeCommand } from "../src/core/install-host.ts";
import { durableWriteFile } from "../src/core/install-write.ts";
import {
  HOST_AUDITED as HOST_AUDITED_VERSION,
  HOST_FLOOR,
  compareHostVersions,
  parseHostVersion,
} from "../src/core/host-floor.ts";
import { v2DataRoot } from "../src/utils/state-paths.ts";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const GLOBAL_BUNDLE = join(REPO, "dist", "global.js");
const PROJECT_BUNDLE = join(REPO, ".opencode", "plugins", "tawassul.js");
const HOME = process.env.HOME?.trim() || homedir();
const HOST_MIN = HOST_FLOOR;
const HOST_AUDITED = HOST_AUDITED_VERSION;
const HOST_AUDITED_MAJOR = 2;
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
  contentSha?: string;
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
  "--takeover",
  "--yes",
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

function readSourceSha(text: string): string | undefined {
  const match = text.match(/TAWASSUL_SOURCE_SHA=([0-9a-f]{7,40})/);
  return match?.[1];
}

function readContentSha(text: string): string | undefined {
  const match = text.match(/TAWASSUL_CONTENT_SHA=([0-9a-f]{64})/);
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

function isSupportedHost(version: string): boolean {
  const parts = parseHostVersion(version);
  if (!parts) return false;
  if (compareHostVersions(version, HOST_MIN) < 0) return false;
  return HOST_OVERRIDE ? version === HOST_OVERRIDE : true;
}

function overrideRangeError(): string | undefined {
  if (!HOST_OVERRIDE) return undefined;
  const parts = parseHostVersion(HOST_OVERRIDE);
  if (!parts) {
    return `TAWASSUL_OPENCODE_VERSION=v${HOST_OVERRIDE} is not a semantic version`;
  }
  if (compareHostVersions(HOST_OVERRIDE, HOST_MIN) < 0) {
    return `TAWASSUL_OPENCODE_VERSION=v${HOST_OVERRIDE} is outside the supported range >=${HOST_MIN}`;
  }
  return undefined;
}

function hostRange(): string {
  return HOST_OVERRIDE
    ? `the pinned v${HOST_OVERRIDE}`
    : `a supported host v>=${HOST_MIN} (audited v${HOST_AUDITED}; newer majors run untested)`;
}

function hostWarning(version: string): string | undefined {
  if (HOST_OVERRIDE || !isSupportedHost(version)) return undefined;
  if (compareHostVersions(version, HOST_AUDITED) > 0) {
    const major = parseHostVersion(version)?.[0] ?? HOST_AUDITED_MAJOR;
    if (major > HOST_AUDITED_MAJOR) {
      return `host v${version} is a newer major than the audited v${HOST_AUDITED}; installing in untested mode — the plugin probes host capabilities at init and reports any missing domain`;
    }
    return `host v${version} is newer than the audited v${HOST_AUDITED}; run npm run check:upstream`;
  }
  return undefined;
}

function readHost(bin: string): Host | undefined {
  if (!existsSync(bin)) return undefined;
  const probe = hostProbeCommand(bin, process.platform, process.env);
  const result = spawnSync(probe.command, probe.args, {
    encoding: "utf-8",
    timeout: 5_000,
    shell: probe.shell,
  });
  if (result.status !== 0) return undefined;
  const version = parseVersion(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  return version ? { bin, version } : undefined;
}

export function hostCandidates(): string[] {
  const out: string[] = [];
  const explicit = process.env.OPENCODE_BIN?.trim();
  if (explicit) out.push(resolve(explicit));
  const desktopRoots = [
    join(HOME, ".config", "ai.opencode.desktop", "cli"),
    join(HOME, "Library", "Application Support", "ai.opencode.desktop", "cli"),
  ];
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) desktopRoots.push(join(localAppData, "ai.opencode.desktop", "cli"));
  for (const desktop of desktopRoots) {
    if (!existsSync(desktop)) continue;
    for (const entry of readdirSync(desktop).sort()) {
      out.push(join(desktop, entry, "opencode-cli"));
      out.push(join(desktop, entry, "opencode-cli.exe"));
    }
  }
  const desktopResources: string[] = [];
  if (localAppData) {
    desktopResources.push(
      join(localAppData, "Programs", "ai.opencode.desktop", "resources", "opencode-cli.exe"),
    );
  }
  const programFiles = process.env.ProgramFiles?.trim();
  if (programFiles) {
    desktopResources.push(join(programFiles, "ai.opencode.desktop", "resources", "opencode-cli.exe"));
  }
  for (const candidate of desktopResources) out.push(candidate);
  const names = ["opencode", "opencode.cmd", "opencode.exe"];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const name of names) out.push(join(dir, name));
  }
  return [...new Set(out)];
}

export function hosts(): Host[] {
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

function refuseLegacyPackage(): void {
  if (existsSync(LEGACY_PACKAGE)) {
    fail(
      `legacy package-directory install present: ${LEGACY_PACKAGE} ` +
        "(remove it before installing the flat self-contained file)",
    );
  }
}

function projectDuplicatePaths(): string[] {
  const dirs = [
    resolve(process.cwd(), ".opencode", "plugin"),
    resolve(process.cwd(), ".opencode", "plugins"),
  ];
  const ownEntry = resolve(REPO, ".opencode", "plugins", "tawassul.js");
  const fromRepoRoot = resolve(process.cwd()) === resolve(REPO);
  const found: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!/\.(?:ts|js|mjs|cjs)$/.test(name)) continue;
      const candidate = join(dir, name);
      if (fromRepoRoot && resolve(candidate) === ownEntry) continue;
      let entry;
      try {
        entry = statSync(candidate);
      } catch {
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      let text = "";
      try {
        text = readFileSync(candidate, "utf-8");
      } catch {
        continue;
      }
      if (text.includes(PLUGIN_ID) || /^tawassul(?:-v2)?\.(?:ts|js|mjs|cjs)$/u.test(name)) {
        found.push(candidate);
      }
    }
  }
  return found;
}

function refuseProjectDuplicate(): void {
  const duplicates = projectDuplicatePaths();
  if (duplicates.length === 0) return;
  fail(
    `a project copy of this plugin exists at ${duplicates.join(", ")} while the global target is ${TARGET} — ` +
      "the plugin would be loaded twice. Remove the project copy, or run this installer from another directory.",
  );
}

function noteRepoOwnEntry(): void {
  const ownEntry = resolve(REPO, ".opencode", "plugins", "tawassul.js");
  const fromRepoRoot = resolve(process.cwd()) === resolve(REPO);
  if (!fromRepoRoot || !existsSync(ownEntry)) return;
  console.log(
    "install-global: this tree keeps its own project entry at .opencode/plugins/tawassul.js; " +
      "the project copy supersedes the global copy when this repository is opened",
  );
}

const OWNER_FILE = join(GLOBAL_DIR, "tawassul-install-owner");

function readOwner(): string | undefined {
  if (!existsSync(OWNER_FILE)) return undefined;
  const value = readFileSync(OWNER_FILE, "utf-8").trim();
  return value.length > 0 ? value : undefined;
}

function claimOwnership(): void {
  const owner = readOwner();
  if (owner === REPO) return;
  if (owner !== undefined && existsSync(owner) && !flags.has("--takeover")) {
    fail(
      `another Tawassul v2 tree owns the global install: ${owner}. ` +
        "Pass --takeover to transfer ownership here, or run that tree's installer.",
    );
  }
  if (owner !== undefined) {
    console.log(
      existsSync(owner)
        ? `install-global: taking over the global install from ${owner}`
        : `install-global: the recorded owner ${owner} is gone — transferring ownership here`,
    );
  }
  writeAtomic(OWNER_FILE, `${REPO}\n`);
}

function refuseForeignOwner(): void {
  const owner = readOwner();
  if (owner === undefined || owner === REPO) return;
  if (existsSync(owner) && !flags.has("--takeover")) {
    fail(
      `another Tawassul v2 tree owns the global install: ${owner}. ` +
        "Pass --takeover to transfer ownership here, or run that tree's installer.",
    );
  }
}

function releaseOwnership(): void {
  const owner = readOwner();
  if (owner === undefined) return;
  if (owner !== REPO) {
    console.log(`install-global: the owner record points at ${owner} — left untouched`);
    return;
  }
  rmSync(OWNER_FILE, { force: true });
}

function readMarker(): Marker | undefined {
  const marker = readJson<Marker>(MARKER_FILE);
  return marker;
}

function requireBundle(): {
  bytes: Buffer;
  sha: string;
  sourceSha: string | undefined;
  contentSha: string | undefined;
} {
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
  return {
    bytes,
    sha: hash(bytes),
    sourceSha: readSourceSha(text),
    contentSha: readContentSha(text),
  };
}

function assertBundleMatchesSource(contentSha: string | undefined): void {
  if (!contentSha) {
    fail("dist/global.js has no content digest; run npm run build to refresh it");
  }
  const live = sourceDigest();
  if (contentSha !== live) {
    fail(
      `dist/global.js was built from different sources (bundle ${contentSha.slice(0, 12)} vs tree ${live.slice(0, 12)}); ` +
        "run npm run build before installing",
    );
  }
}

function assetRoots(): string[] {
  const override = process.env.TAWASSUL_ASSET_ROOTS?.trim();
  if (override) {
    const roots = override
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => resolve(entry));
    if (roots.length > 0) return roots;
  }
  return [join(REPO, "node_modules"), join(REPO, ".opencode", "node_modules")];
}

function locateAssets(): { resolved: ResolvedAsset[]; missing: AssetSpec[] } {
  const roots = assetRoots();
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

function resolveAssets(): ResolvedAsset[] {
  const scan = locateAssets();
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
  durableWriteFile(file, data, mode);
}

function dbRecords(): Record<string, AssetRecord> {
  const records: Record<string, AssetRecord> = {};
  if (!usesPosixDatabaseLane(installLane(process.platform))) return records;
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
    execFileSync(dependencyProbeCommand(process.platform), [bin], { stdio: "pipe", timeout: 10_000 });
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
  const lane = installLane(process.platform);
  if (lane === "windows") {
    console.log("install-global: Windows preflight — native lane, database maintenance and triggers unavailable");
    console.log("install-global: the key directory ACL is restricted with icacls; no POSIX mode is claimed");
    return;
  }
  const marks = preflightMarks();
  if (lane === "macos") {
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

function resolveDbPath(): string {
  try {
    return execFileSync(
      "bash",
      ["-c", `. '${join(DB_DIR, "db-env.sh")}'; db_resolve_path >/dev/null 2>&1; printf '%s' "$RESOLVED_DB"`],
      { stdio: "pipe" },
    )
      .toString()
      .trim();
  } catch {
    fail("install-global: db-env resolution failed — the lane cannot find the DB (see P1.7 smoke)");
  }
}

function dbSmoke(resolved: string): void {
  const maint = join(DB_DIR, "opencode-db-maintenance.sh");
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
  return !/["%\n\r]/.test(script);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function triggerPrefix(dbPath: string): string[] {
  return dbPath.length > 0 ? [`OPENCODE_DB=${dbPath}`] : [];
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

function writeUnitFiles(script: string, dbPath: string): void {
  mkdirSync(systemdUnitDir(), { recursive: true, mode: 0o755 });
  const environment = dbPath.length > 0 ? [`Environment=${systemdQuote(`OPENCODE_DB=${dbPath}`)}`] : [];
  writeAtomic(
    systemdUnitPath(TRIGGER_UNITS.service),
    [
      "[Unit]",
      "Description=Tawassul v2 DB maintenance lane",
      "",
      "[Service]",
      "Type=oneshot",
      ...environment,
      `ExecStart=/usr/bin/env bash ${systemdQuote(script)} --run`,
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

function trySystemd(script: string, dbPath: string): string | undefined {
  if (!unitContentSafe(script)) return undefined;
  writeUnitFiles(script, dbPath);
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

function cronLine(script: string, dbPath: string): string {
  const prefix = triggerPrefix(dbPath)
    .map((entry) => `${entry.split("=")[0]}=${shellQuote(entry.slice(entry.indexOf("=") + 1))}`)
    .join(" ");
  const env = prefix.length > 0 ? `${prefix} ` : "";
  return `17 4 * * * ${env}/usr/bin/env bash ${shellQuote(script)} --run # ${TRIGGER_TAG}`;
}

function readCrontab(): { ok: boolean; lines: Array<string> } {
  const result = spawnSync("crontab", ["-l"], { encoding: "utf-8", timeout: 15_000 });
  if ((result.status ?? -1) === 0) return { ok: true, lines: (result.stdout ?? "").split("\n") };
  if (result.error === undefined && /no crontab for/i.test(`${result.stderr ?? ""}`)) {
    return { ok: true, lines: [] };
  }
  return { ok: false, lines: [] };
}

function writeCrontab(lines: Array<string>): boolean {
  return runTriggerCommand("crontab", ["-"], lines.join("\n")) === 0;
}

function tryCron(script: string, dbPath: string): string | undefined {
  if (!unitContentSafe(script)) return undefined;
  const listing = readCrontab();
  if (!listing.ok) return undefined;
  if (listing.lines.some((line) => line.includes(TRIGGER_TAG))) return "cron";
  const kept = listing.lines.filter((line) => line.trim() !== "");
  if (!writeCrontab([...kept, cronLine(script, dbPath)])) return undefined;
  return "cron";
}

function registerTriggers(dbPath: string): string {
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
    const systemd = trySystemd(script, dbPath);
    if (systemd) {
      console.log("install-global: registered systemd user timer tawassul-db-maintenance.timer");
      return systemd;
    }
    console.log("install-global: systemd registration failed (TAWASSUL_REGISTER_TRIGGERS=systemd) — trigger is manual");
    return "manual";
  }
  if (mode === "cron") {
    const cron = tryCron(script, dbPath);
    if (cron) {
      console.log("install-global: registered cron line (tagged) for the daily run");
      return cron;
    }
    console.log("install-global: cron registration failed (TAWASSUL_REGISTER_TRIGGERS=cron) — trigger is manual");
    return "manual";
  }
  const systemd = trySystemd(script, dbPath);
  if (systemd) {
    console.log("install-global: registered systemd user timer tawassul-db-maintenance.timer");
    return systemd;
  }
  const cron = tryCron(script, dbPath);
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
  contentSha: string | undefined,
  host: string,
  trigger: string,
): void {
  const bundleBytes = readFileSync(TARGET);
  const marker: Marker = {
    package: PLUGIN_ID,
    version: REPO_PACKAGE.version ?? "0.0.0",
    host,
    sourceSha,
    contentSha,
    bundle: {
      path: markerPath(TARGET),
      sha256: bundleSha,
      bytes: bundleBytes.length,
    },
    wasm,
    db,
    preflight: usesPosixDatabaseLane(installLane(process.platform)) ? preflightMarks() : {},
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
  contentSha: string | undefined,
  db: Record<string, AssetRecord>,
): boolean {
  if (!marker || marker.package !== PLUGIN_ID) return false;
  if (marker.version !== (REPO_PACKAGE.version ?? "0.0.0")) return false;
  if (!marker.host || !isSupportedHost(marker.host)) return false;
  if (marker.bundle?.sha256 !== bundleSha) return false;
  if (!existsSync(TARGET)) return false;
  if (hash(readFileSync(TARGET)) !== bundleSha) return false;
  if (sourceSha && marker.sourceSha !== sourceSha) return false;
  if (contentSha ? marker.contentSha !== contentSha : marker.contentSha !== undefined) return false;
  for (const asset of ASSETS) {
    const record = marker.wasm?.[asset.id];
    const want = wasm[asset.id];
    if (!record || !want || record.sha256 !== want.sha256 || record.path !== want.path) return false;
    const installed = fromMarker(record.path);
    if (!existsSync(installed) || hash(readFileSync(installed)) !== record.sha256) return false;
  }
  for (const [id, want] of Object.entries(db)) {
    const record = marker.db?.[id];
    if (!record || record.sha256 !== want.sha256 || record.path !== want.path) return false;
    const installed = fromMarker(record.path);
    if (!existsSync(installed) || hash(readFileSync(installed)) !== record.sha256) return false;
    if (!(statSync(installed).mode & 0o100)) return false;
  }
  return true;
}

function currentUserIdentity(): string | undefined {
  try {
    const result = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf-8", timeout: 15_000 });
    if (result.status !== 0) return undefined;
    const match = result.stdout.match(/"([^"]+)","(S-1-[0-9-]+)"/);
    return match?.[2] ? `*${match[2]}` : undefined;
  } catch {
    return undefined;
  }
}

function secureWindowsKeyDir(): void {
  const key = windowsKeyDirectory(process.env, homedir());
  const dir = key.dir;
  if (!key.managed) {
    console.log(`install-global: TAWASSUL_HMAC_KEY_DIR selects ${dir}; the key directory is operator-managed and left untouched`);
    return;
  }
  const identity = currentUserIdentity();
  if (!identity) {
    console.warn("install-global: could not resolve the current user SID — apply the key directory ACL with icacls manually");
    return;
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn(`install-global: cannot create the key directory ${dir}: ${(e as Error)?.message ?? e}`);
    return;
  }
  const argv = windowsKeyAclArgv(windowsAclPath(dir), identity);
  const cmd = argv[0] ?? "icacls";
  const result = spawnSync(cmd, argv.slice(1), { encoding: "utf-8", timeout: 30_000 });
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim() || `exit ${result.status ?? "unknown"}`;
    console.warn(`install-global: icacls failed for ${dir}: ${detail}`);
    return;
  }
  console.log(`install-global: restricted the key directory ACL to the current user (${dir})`);
}

function assertKeyDirectoryUsable(): void {
  const dir = process.env.TAWASSUL_HMAC_KEY_DIR?.trim();
  if (!dir) return;
  const keyFile = resolve(dir, HMAC_KEY_FILE);
  const size = existsSync(keyFile) ? readFileSync(keyFile).length : null;
  const problem = operatorKeyProblem(process.env, size);
  if (problem) fail(problem);
}

function install(): void {
  assertKeyDirectoryUsable();
  const lane = installLane(process.platform);
  const posixDb = usesPosixDatabaseLane(lane);
  const host = checkHosts();
  refuseLegacyPackage();
  refuseProjectDuplicate();
  refuseForeignOwner();
  noteRepoOwnEntry();
  const bundle = requireBundle();
  const assets = resolveAssets();
  const wasm = assetRecords(assets);
  const db = dbRecords();
  const staleWasm = staleWasmFiles(wasm);
  const existing = readMarker();
  if (existsSync(TARGET) && !existing && !flags.has("--force")) {
    fail(`target exists without a Tawassul marker: ${TARGET} (use --force to replace)`);
  }
  if (existing && existing.package !== PLUGIN_ID && !flags.has("--force")) {
    fail(`target belongs to another plugin: ${TARGET}`);
  }
  if (!flags.has("--force")) assertBundleMatchesSource(bundle.contentSha);
  if (flags.has("--dry-run")) {
    console.log(
      `install-global: dry run — would write ${TARGET} (${bundle.bytes.length} bytes, ${bundle.sha.slice(0, 12)})`,
    );
    console.log(`install-global: dry run — would write ${assets.length} wasm assets under ${WASM_DIR}`);
    if (posixDb) {
      console.log(`install-global: dry run — would write ${DB_SHIP.length} db scripts under ${DB_DIR}`);
    } else {
      console.log("install-global: dry run — Windows lane stages no db scripts");
    }
    if (staleWasm.length > 0) {
      console.log(`install-global: dry run — would remove ${staleWasm.length} stale wasm file(s) under ${WASM_DIR}`);
    }
    return;
  }
  const pruned = pruneStaleWasm(wasm);
  if (pruned > 0) {
    console.log(`install-global: removed ${pruned} stale wasm file(s) under ${WASM_DIR}`);
  }
  if (upToDate(existing, bundle.sha, wasm, bundle.sourceSha, bundle.contentSha, db)) {
    claimOwnership();
    console.log(
      `install-global: already installed at ${TARGET} ` +
        `(v${existing?.version ?? "unknown"}, ${bundle.sha.slice(0, 12)})`,
    );
    return;
  }
  try {
    mkdirSync(PLUGIN_DIR, { recursive: true, mode: 0o700 });
    mkdirSync(RUNTIME, { recursive: true, mode: 0o700 });
    if (posixDb) mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code ?? "unknown";
    fail(
      `cannot create the runtime layout under ${RUNTIME} (${code}) — refusing to write ${TARGET}. ` +
        "A plain file may occupy that path, or it may be read-only; remove it or point TAWASSUL_GLOBAL_DIR elsewhere.",
    );
  }
  claimOwnership();
  if (existsSync(TARGET) && (!existing || existing.package !== PLUGIN_ID)) {
    const backup = `${TARGET}.pre-force-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    renameSync(TARGET, backup);
    console.log(`install-global: kept the previous target at ${backup}`);
  }
  writeAtomic(TARGET, bundle.bytes);
  for (const asset of assets) {
    mkdirSync(dirname(asset.dest), { recursive: true, mode: 0o700 });
    writeAtomic(asset.dest, readFileSync(asset.source));
  }
  if (posixDb) {
    for (const item of DB_SHIP) {
      writeAtomic(join(DB_DIR, item.file), readFileSync(dbShipSource(item)), 0o700);
    }
  }
  preflightLaptop();
  if (posixDb) {
    const dbPath = resolveDbPath();
    const trigger = registerTriggers(dbPath);
    writeMarker(bundle.sha, wasm, db, bundle.sourceSha, bundle.contentSha, host.version, trigger);
    dbSmoke(dbPath);
  } else {
    secureWindowsKeyDir();
    writeMarker(bundle.sha, wasm, db, bundle.sourceSha, bundle.contentSha, host.version, "none");
  }
  console.log(
    `install-global: installed ${TARGET} (v${REPO_PACKAGE.version ?? "0.0.0"}, ${bundle.sha.slice(0, 12)})`,
  );
  console.log(`install-global: installed ${assets.length} wasm assets under ${WASM_DIR}`);
  console.log("install-global: no opencode.json edit is needed; the host discovers this file");
}

function insideGlobalDir(path: string): boolean {
  const rel = relative(GLOBAL_DIR, path);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

function ownedRuntimeFiles(marker: Marker | undefined): string[] {
  const files = new Set<string>();
  files.add(MARKER_FILE);
  if (marker?.bundle?.path) files.add(fromMarker(marker.bundle.path));
  for (const record of Object.values(marker?.wasm ?? {})) files.add(fromMarker(record.path));
  for (const record of Object.values(marker?.db ?? {})) files.add(fromMarker(record.path));
  return [...files].filter(insideGlobalDir);
}

function fallbackRuntimeFiles(): string[] {
  const files: string[] = [MARKER_FILE];
  for (const item of DB_SHIP) files.push(join(DB_DIR, item.file));
  for (const asset of ASSETS) files.push(join(WASM_DIR, asset.relative));
  return files;
}

function countFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += countFiles(join(dir, entry.name));
    else total += 1;
  }
  return total;
}

function removeEmptyTree(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyTree(join(dir, entry.name));
  }
  try {
    if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  } catch {
    return;
  }
}

function staleWasmFiles(current: Record<string, AssetRecord>): string[] {
  if (!existsSync(WASM_DIR)) return [];
  const keep = new Set(Object.values(current).map((record) => resolve(fromMarker(record.path))));
  const stale: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (!keep.has(resolve(path))) stale.push(path);
    }
  };
  walk(WASM_DIR);
  return stale.sort();
}

function pruneStaleWasm(current: Record<string, AssetRecord>): number {
  const stale = staleWasmFiles(current);
  for (const file of stale) rmSync(file, { force: true });
  removeEmptyTree(WASM_DIR);
  return stale.length;
}

function purgePaths(): string[] {
  const data = v2DataRoot();
  return [
    join(configBase(), "tawassul-v2"),
    ...(data ? [data] : []),
    join(GLOBAL_DIR, "tawassul-v2-state"),
    join(GLOBAL_DIR, "tawassul.jsonc"),
    join(GLOBAL_DIR, "tawassul.json"),
    join(GLOBAL_DIR, "tawassul-pins.json"),
  ];
}

function requirePurgeConsent(): void {
  if (flags.has("--dry-run") || flags.has("--yes")) return;
  const present = purgePaths().filter((path) => existsSync(path));
  if (present.length === 0) return;
  fail(
    `purge would move ${present.length} state path(s) aside (${present.join(", ")}); ` +
      "pass --yes to confirm, or omit --purge to keep them",
  );
}

function purge(): void {
  const present = purgePaths().filter((path) => existsSync(path));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const path of present) {
    if (flags.has("--dry-run")) {
      console.log(`install-global: dry run — would archive ${path}`);
      continue;
    }
    const archive = `${path}.purged-${stamp}`;
    archiveFile(path, archive);
    console.log(`install-global: archived ${path} to ${archive}`);
  }
  const backups = existsSync(PLUGIN_DIR)
    ? readdirSync(PLUGIN_DIR).filter((name) => name.startsWith("tawassul.js.pre-force-"))
    : [];
  if (backups.length > 0) {
    if (flags.has("--dry-run")) {
      console.log(`install-global: dry run — would remove ${backups.length} pre-force target backup(s)`);
    } else {
      for (const name of backups) rmSync(join(PLUGIN_DIR, name), { force: true });
      console.log(`install-global: removed ${backups.length} pre-force target backup(s)`);
    }
  }
  const agents = join(GLOBAL_DIR, "agent");
  if (existsSync(agents)) {
    const count = readdirSync(agents).filter((name) => name.endsWith(".md")).length;
    console.log(
      `install-global: kept ${count} agent file(s) in ${agents} (remove them manually if unwanted)`,
    );
  }
}

function removeFile(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? "unknown";
    fail(
      `cannot remove ${file} (${code}) — a running OpenCode host may still hold it; stop the host and retry`,
    );
  }
}

function archiveFile(path: string, archive: string): void {
  try {
    renameSync(path, archive);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? "unknown";
    fail(
      `cannot archive ${path} (${code}) — a running OpenCode host may still hold it; stop the host and retry`,
    );
  }
}

function uninstall(): void {
  if (flags.has("--purge")) requirePurgeConsent();
  const targetExists = existsSync(TARGET);
  const runtimeExists = existsSync(RUNTIME);
  if (!targetExists && !runtimeExists) {
    console.log(`install-global: nothing installed at ${TARGET}`);
    releaseOwnership();
    if (flags.has("--purge")) purge();
    else console.log("install-global: no plugin files were present; state paths were left untouched");
    return;
  }
  const marker = readMarker();
  if ((!marker || marker.package !== PLUGIN_ID) && !flags.has("--force")) {
    fail(`refusing to remove ${TARGET}: no Tawassul marker (use --force)`);
  }
  if (flags.has("--dry-run")) {
    console.log(`install-global: dry run — would remove ${TARGET} and the files this install recorded under ${RUNTIME}`);
    uninstallTriggers();
    return;
  }
  uninstallTriggers();
  if (targetExists) removeFile(TARGET);
  const owned = marker?.package === PLUGIN_ID ? ownedRuntimeFiles(marker) : [];
  const files = [...new Set([...owned, ...fallbackRuntimeFiles()])];
  let removed = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    removeFile(file);
    removed += 1;
  }
  removeEmptyTree(RUNTIME);
  console.log(`install-global: removed ${TARGET}`);
  console.log(`install-global: removed ${removed} installed runtime file(s) under ${RUNTIME}`);
  if (existsSync(RUNTIME)) {
    console.log(
      `install-global: kept ${countFiles(RUNTIME)} file(s) under ${RUNTIME} that this install did not write`,
    );
  }
  releaseOwnership();
  if (flags.has("--purge")) purge();
  else
    console.log(
      "install-global: kept the global roster with the state and data namespaces; pass --purge with --yes to archive them",
    );
}

async function verify(): Promise<void> {
  const overrideError = overrideRangeError();
  if (overrideError) fail(overrideError);
  assertKeyDirectoryUsable();
  if (!existsSync(TARGET)) fail(`not installed: ${TARGET}`);
  const owner = readOwner();
  if (owner !== undefined && owner !== REPO) {
    console.warn(`install-global: the owner record points at ${owner}; this tree did not write the global copy`);
  }
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
  const installedText = installed.toString("utf8");
  if (marker.contentSha) {
    const installedContentSha = readContentSha(installedText);
    if (installedContentSha && installedContentSha !== marker.contentSha) {
      fail(
        `bundle content SHA mismatch: installed ${installedContentSha.slice(0, 12)} vs marker ${marker.contentSha.slice(0, 12)}`,
      );
    }
    const live = sourceDigest();
    if (live !== marker.contentSha) {
      fail(
        `installed bundle is stale: marker ${marker.contentSha.slice(0, 12)} vs source tree ${live.slice(0, 12)}; ` +
          "run npm run build && npm run install:global",
      );
    }
  } else if (marker.sourceSha) {
    console.warn("install-global: marker predates the content digest; run npm run install:global to refresh it");
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
  if (usesPosixDatabaseLane(installLane(process.platform))) {
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
  console.log("  bun scripts/install-global.ts [--dry-run] [--force] [--takeover]");
  console.log("  bun scripts/install-global.ts --verify");
  console.log("  bun scripts/install-global.ts --uninstall [--purge --yes] [--dry-run]");
  console.log(`  plugin:  ${TARGET}`);
  console.log(`  runtime: ${RUNTIME}`);
  console.log(`  owner:   ${OWNER_FILE}`);
  console.log("  --takeover treats a live owner record from another tree as transferable");
  console.log("  --force keeps a previous unmarked target as tawassul.js.pre-force-<timestamp>");
  console.log("  --purge --yes archives the state namespace, the data namespace and the roster beside their old paths");
  console.log("  the purge keeps the global agent roster (~/.config/opencode/agent)");
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

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) await main();
