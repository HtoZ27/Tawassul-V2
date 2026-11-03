

import { resolve, relative, isAbsolute, sep, join, dirname } from "node:path";
import { homedir, userInfo, tmpdir } from "node:os";
import { existsSync, readFileSync, statSync } from "node:fs";

export type InstallScope = "global" | "project";


export const TAWASSUL_ROSTER_FILE = "tawassul.jsonc";
export const TAWASSUL_ROSTER_FILE_LEGACY = "tawassul.json";


export const NATIVE_GLOBAL_AGENTS_DIR = "agent";


export class HomedirUnavailableError extends Error {
  constructor() {
    super(
      "Cannot determine the user's home directory: $HOME is unset and no passwd entry is available " +
        "(possible isolated container without a bound home mount).",
    );
    this.name = "HomedirUnavailableError";
  }
}

export function safeHomedir(): string {
  
  
  
  
  const h = homedir();
  if (h) return h;
  const fromEnv = process.env.HOME?.trim();
  if (fromEnv) return fromEnv;
  try {
    const info = userInfo();
    if (info?.homedir) return info.homedir;
  } catch {

  }
  throw new HomedirUnavailableError();
}


export function globalConfigBaseDir(): string {
  const override = process.env.TAWASSUL_GLOBAL_DIR?.trim();
  if (override) return resolve(override, "..");
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return resolve(xdg);
  return resolve(safeHomedir(), ".config");
}


export function globalCacheBaseDir(): string {
  if (evaluateIsolationSync().isolated) {
    return join(tmpdir(), "tawassul-isolated-cache");
  }
  const override = process.env.TAWASSUL_CACHE_DIR?.trim();
  if (override) return resolve(override);
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  if (xdg) return resolve(xdg);
  return resolve(safeHomedir(), ".cache");
}


export function globalConfigDir(): string {
  const override = process.env.TAWASSUL_GLOBAL_DIR?.trim();
  if (override) return resolve(override);
  return resolve(globalConfigBaseDir(), "opencode");
}


export function globalAgentsDir(): string {
  return resolve(globalConfigDir(), NATIVE_GLOBAL_AGENTS_DIR);
}


export function openCodeConfigDirOverride(): string | undefined {
  const dir = process.env.OPENCODE_CONFIG_DIR?.trim();
  return dir ? resolve(dir) : undefined;
}


export function globalNpmPackagesDir(): string {
  return resolve(globalCacheBaseDir(), "opencode", "packages");
}


export function homeOpenCodeDir(): string {
  if (evaluateIsolationSync().isolated) {
    return join(tmpdir(), "tawassul-isolated-opencode");
  }
  return resolve(safeHomedir(), ".opencode");
}


export function isTawassulGlobalSpace(rosterPath?: string): boolean {
  const g = globalConfigDir();
  if (existsSync(resolve(g, "agent", "tawa.md"))) return true;
  if (rosterPath && existsSync(rosterPath)) return true;
  return false;
}


export function projectConfigDir(stateDir: string): string {
  return resolve(stateDir, ".opencode");
}


export function resolveTawassulConfigPath(stateDir: string, scope?: InstallScope): string {
  if (scope === "global") {
    const g = globalConfigDir();
    const jsonc = resolve(g, TAWASSUL_ROSTER_FILE);
    if (existsSync(jsonc)) return jsonc;
    const legacy = resolve(g, TAWASSUL_ROSTER_FILE_LEGACY);
    if (existsSync(legacy)) return legacy;
    return jsonc;
  }
  const dir = projectConfigDir(stateDir);
  const jsonc = resolve(dir, "tawassul.jsonc");
  if (existsSync(jsonc)) return jsonc;
  return resolve(dir, "tawassul.json");
}


export function resolveActiveConfigPath(stateDir: string, scope?: InstallScope): string {
  if (scope === "global") return resolveTawassulConfigPath(stateDir, scope);
  const jsonc = resolve(stateDir, "opencode.jsonc");
  if (existsSync(jsonc)) return jsonc;
  return resolve(stateDir, "opencode.json");
}


export function resolveDeletedAgentsPath(stateDir: string, scope?: InstallScope): string {
  if (scope === "global") return resolveTawassulConfigPath(stateDir, scope);
  return resolve(projectConfigDir(stateDir), "deleted-agents.json");
}


export function resolvePinsPath(stateDir: string, scope?: InstallScope): string {
  if (scope === "global") {
    return resolve(dirname(resolveTawassulConfigPath(stateDir, scope)), "tawassul-pins.json");
  }
  return resolve(projectConfigDir(stateDir), "tawassul-pins.json");
}


export function resolveAgentsDir(stateDir: string, scope?: InstallScope): string {
  if (scope === "global") return globalAgentsDir();
  return resolve(projectConfigDir(stateDir), "agents");
}


export function resolveNativeAgentMdPath(agentName: string, stateDir: string, scope?: InstallScope): string {
  return resolve(resolveAgentsDir(stateDir, scope), agentName);
}


function isInsideDir(root: string, target: string): boolean {
  
  
  
  
  const a = process.platform === "win32" ? root.toLowerCase() : root;
  const b = process.platform === "win32" ? target.toLowerCase() : target;
  const rel = relative(a, b);
  
  
  
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}


export function isInsideGlobalConfigDir(target: string): boolean {
  if (isInsideDir(globalConfigDir(), target)) return true;
  const override = openCodeConfigDirOverride();
  if (override && isInsideDir(override, target)) return true;
  if (isInsideDir(homeOpenCodeDir(), target)) return true;
  return isInsideDir(globalNpmPackagesDir(), target);
}



export type IsolationSignal =
  | { isolated: true; signal: "env" | "verify-fail" | "suspicion"; reason: string }
  | { isolated: false; signal: "none" | "weak" | "foreign-key"; reason?: string };

export interface IsolationCheckOptions {
  
  stateDir?: string;
  
  stateFile?: string;
  
  verifySigned?: (signedData: string) => string | null;
  
  hasLocalKey?: () => boolean;
  
  isSigned?: (signedData: string) => boolean;
}


export function evaluateIsolationSync(opts?: IsolationCheckOptions): IsolationSignal {
  const flag = process.env.TAWASSUL_ISOLATED?.trim()?.toLowerCase();
  if (flag === "1" || flag === "true") {
    return { isolated: true, signal: "env", reason: "TAWASSUL_ISOLATED is set" };
  }

  let home: string;
  try {
    home = safeHomedir();
  } catch (e) {
    return {
      isolated: true,
      signal: "suspicion",
      reason: (e as Error)?.message ?? "home directory is undeterminable",
    };
  }

  if (!opts?.stateDir) return { isolated: false, signal: "none" };

  const weak: string[] = [];
  try {
    const stateDev = statSync(opts.stateDir).dev;
    const homeDev = statSync(home).dev;
    if (stateDev !== homeDev) weak.push("stateDir is on a different device than the home dir");
  } catch {
    weak.push("stateDir or home dir cannot be stat()ed");
  }
  const stateRoot = resolve(opts.stateDir).split(sep)[0] || sep;
  const homeRoot = resolve(home).split(sep)[0] || sep;
  if (stateRoot !== homeRoot) weak.push("stateDir and home dir are on different roots");

  if (weak.length > 0) {
    return { isolated: false, signal: "weak", reason: weak.join("; ") };
  }
  return { isolated: false, signal: "none" };
}


export async function isIsolatedSession(opts?: IsolationCheckOptions): Promise<IsolationSignal> {
  const sync = evaluateIsolationSync(opts);
  if (sync.isolated) return sync;

  if (opts?.stateFile && existsSync(opts.stateFile)) {
    const signedData = readFileSync(opts.stateFile, "utf-8");
    const hasKey = opts?.hasLocalKey?.() ?? false;
    const looksSigned = opts?.isSigned ? opts.isSigned(signedData) : signedData.includes(":");
    if (looksSigned) {
      const verified = opts?.verifySigned ? opts.verifySigned(signedData) : null;
      if (verified === null) {
        return hasKey
          ? {
              isolated: true,
              signal: "verify-fail",
              reason: "existing signed state file failed HMAC verification (tamper or partial key) — read-only",
            }
          : {
              isolated: false,
              signal: "foreign-key",
              reason:
                "state file was signed by an unknown key and no local host key exists — warning only, no silent lock",
            };
      }
    }
  }
  return sync;
}
