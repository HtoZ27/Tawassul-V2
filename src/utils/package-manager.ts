import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { isInsideDir } from "./path-resolver.ts";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export type Runner =
  | { kind: "path"; manager: PackageManager; exe: string }
  | { kind: "host-bun"; exe: string };

export type RunnerSource = "override" | "packageManager" | "lockfile" | "bun" | "npm";

export type RunnerResolution =
  | { kind: "runner"; runner: Runner; source: RunnerSource; skipped: PackageManager[] }
  | { kind: "override-unavailable"; manager: PackageManager }
  | { kind: "override-invalid"; value: string }
  | { kind: "pnp-unavailable"; skipped: PackageManager[] }
  | { kind: "none"; skipped: PackageManager[] };

export interface SpawnContext {
  platform: NodeJS.Platform;
  pathEnv: string;
  pathExt: string;
  comSpec?: string;
  projectRoot?: string;
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  projectRoot?: string;
  probeHostBun?: (exe: string) => Promise<boolean> | boolean;
}

export interface SpawnPlan {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
  windowsHide: boolean;
}

const MANAGERS: PackageManager[] = ["bun", "pnpm", "yarn", "npm"];

const DEFAULT_PATH_EXT = ".COM;.EXE;.BAT;.CMD";

const LOCKFILE_ORDER: Record<PackageManager, number> = { pnpm: 0, yarn: 1, bun: 2, npm: 3 };

const LOCKFILES: Array<{ manager: PackageManager; files: string[] }> = [
  { manager: "bun", files: ["bun.lock", "bun.lockb"] },
  { manager: "pnpm", files: ["pnpm-lock.yaml"] },
  { manager: "yarn", files: ["yarn.lock"] },
  { manager: "npm", files: ["package-lock.json", "npm-shrinkwrap.json"] },
];

function isManager(value: string): value is PackageManager {
  return (MANAGERS as string[]).includes(value);
}

export function splitPathEntries(value: string, platform: NodeJS.Platform): string[] {
  if (platform !== "win32") {
    return value.split(":").filter((entry) => entry.length > 0);
  }
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      entries.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  entries.push(current);
  return entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function isExecutableFile(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = statSync(candidate);
    if (!stat.isFile()) return false;
    if (platform === "win32") return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function windowsCandidates(name: string, pathExt: string): string[] {
  if (path.extname(name)) return [name];
  const extensions = pathExt
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
  const unique = extensions.length > 0 ? extensions : DEFAULT_PATH_EXT.split(";");
  return unique.map((extension) => `${name}${extension}`);
}

function resolveWindowsCommand(name: string, context: SpawnContext): string | undefined {
  const candidates = windowsCandidates(name, context.pathExt);
  for (const dir of splitPathEntries(context.pathEnv, "win32")) {
    if (!path.isAbsolute(dir)) continue;
    if (context.projectRoot && isInsideDir(context.projectRoot, dir, "win32")) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const byLowerName = new Map(entries.map((entry) => [entry.toLowerCase(), entry]));
    for (const candidate of candidates) {
      const actual = byLowerName.get(candidate.toLowerCase());
      if (!actual) continue;
      const full = path.join(dir, actual);
      if (isExecutableFile(full, "win32")) return full;
    }
  }
  return undefined;
}

export function findExecutable(name: string, context: SpawnContext): string | undefined {
  if (context.platform === "win32") return resolveWindowsCommand(name, context);
  for (const dir of splitPathEntries(context.pathEnv, context.platform)) {
    if (!path.isAbsolute(dir)) continue;
    if (context.projectRoot && isInsideDir(context.projectRoot, dir, context.platform)) continue;
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate, context.platform)) return candidate;
  }
  return undefined;
}

export function defaultSpawnContext(projectRoot?: string): SpawnContext {
  return {
    platform: process.platform,
    pathEnv: process.env.PATH ?? "",
    pathExt: process.env.PATHEXT ?? DEFAULT_PATH_EXT,
    comSpec: process.env.ComSpec,
    projectRoot,
  };
}

export function readPackageScripts(dir: string): Record<string, string> | undefined {
  try {
    const raw = readFileSync(path.join(dir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) {
      return undefined;
    }
    const scripts: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.scripts as Record<string, unknown>)) {
      if (typeof value === "string") scripts[name] = value;
    }
    return scripts;
  } catch {
    return undefined;
  }
}

export function hasScript(dir: string, name: string): boolean {
  const scripts = readPackageScripts(dir);
  return scripts !== undefined && typeof scripts[name] === "string";
}

function readPackageManagerField(dir: string): PackageManager | undefined {
  try {
    const raw = readFileSync(path.join(dir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { packageManager?: unknown };
    if (typeof parsed.packageManager !== "string") return undefined;
    const name = parsed.packageManager.split("@")[0] ?? "";
    return isManager(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

interface LockfileDetection {
  managers: PackageManager[];
  pnp: boolean;
}

function detectLockfiles(dir: string): LockfileDetection {
  if (existsSync(path.join(dir, ".pnp.cjs"))) return { managers: ["yarn"], pnp: true };
  const found: Array<{ manager: PackageManager; mtime: number }> = [];
  for (const entry of LOCKFILES) {
    let mtime = -1;
    for (const file of entry.files) {
      try {
        const stat = statSync(path.join(dir, file));
        if (stat.isFile()) mtime = Math.max(mtime, stat.mtimeMs);
      } catch {
        continue;
      }
    }
    if (mtime >= 0) found.push({ manager: entry.manager, mtime });
  }
  found.sort((a, b) => b.mtime - a.mtime || LOCKFILE_ORDER[a.manager] - LOCKFILE_ORDER[b.manager]);
  return { managers: found.map((entry) => entry.manager), pnp: false };
}

function pushSkipped(skipped: PackageManager[], manager: PackageManager): void {
  if (!skipped.includes(manager)) skipped.push(manager);
}

export async function resolveProjectRunner(
  dir: string,
  options: ResolveOptions = {},
): Promise<RunnerResolution> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const context: SpawnContext = {
    platform,
    pathEnv: env.PATH ?? "",
    pathExt: env.PATHEXT ?? DEFAULT_PATH_EXT,
    comSpec: env.ComSpec,
    projectRoot: options.projectRoot ?? dir,
  };
  const skipped: PackageManager[] = [];
  const override = env.TAWASSUL_PACKAGE_MANAGER?.trim();
  if (override) {
    if (!isManager(override)) return { kind: "override-invalid", value: override };
    const exe = findExecutable(override, context);
    if (!exe) return { kind: "override-unavailable", manager: override };
    return { kind: "runner", runner: { kind: "path", manager: override, exe }, source: "override", skipped };
  }
  const declared = readPackageManagerField(dir);
  if (declared) {
    const exe = findExecutable(declared, context);
    if (exe) {
      return { kind: "runner", runner: { kind: "path", manager: declared, exe }, source: "packageManager", skipped };
    }
    pushSkipped(skipped, declared);
  }
  const lockfiles = detectLockfiles(dir);
  for (const manager of lockfiles.managers) {
    const exe = findExecutable(manager, context);
    if (exe) {
      return { kind: "runner", runner: { kind: "path", manager, exe }, source: "lockfile", skipped };
    }
    pushSkipped(skipped, manager);
  }
  if (lockfiles.pnp) return { kind: "pnp-unavailable", skipped };
  const bunExe = findExecutable("bun", context);
  if (bunExe) {
    return { kind: "runner", runner: { kind: "path", manager: "bun", exe: bunExe }, source: "bun", skipped };
  }
  if (options.probeHostBun) {
    const hostExe = process.execPath;
    const trustable = !context.projectRoot || !isInsideDir(context.projectRoot, hostExe, platform);
    if (trustable && (await options.probeHostBun(hostExe))) {
      return { kind: "runner", runner: { kind: "host-bun", exe: hostExe }, source: "bun", skipped };
    }
  }
  const npmExe = findExecutable("npm", context);
  if (npmExe) {
    return { kind: "runner", runner: { kind: "path", manager: "npm", exe: npmExe }, source: "npm", skipped };
  }
  return { kind: "none", skipped };
}

export function isCmdUnsafeArgument(arg: string): boolean {
  return arg.includes("%") || arg.includes("\"") || arg.includes("\r") || arg.includes("\n");
}

function quoteForCmd(arg: string): string {
  return `"${arg}"`;
}

export function buildWindowsCommandLine(exe: string, args: string[]): string {
  const line = [exe, ...args].map(quoteForCmd).join(" ");
  return `"${line}"`;
}

export function resolveSpawnPlan(exe: string, args: string[], context: SpawnContext): SpawnPlan {
  const extension = path.extname(exe).toLowerCase();
  const needsShell = context.platform === "win32" && (extension === ".cmd" || extension === ".bat");
  if (!needsShell) {
    return { command: exe, args: [...args], windowsVerbatimArguments: false, windowsHide: true };
  }
  if (isCmdUnsafeArgument(exe)) throw new Error("the command path cannot be carried safely by cmd.exe");
  const unsafe = args.find(isCmdUnsafeArgument);
  if (unsafe !== undefined) throw new Error(`cmd.exe cannot carry the argument safely: ${unsafe}`);
  const api = context.platform === "win32" ? path.win32 : path.posix;
  const comSpec = context.comSpec && api.isAbsolute(context.comSpec) ? context.comSpec : "cmd.exe";
  return {
    command: comSpec,
    args: ["/d", "/s", "/c", buildWindowsCommandLine(exe, args)],
    windowsVerbatimArguments: true,
    windowsHide: true,
  };
}
