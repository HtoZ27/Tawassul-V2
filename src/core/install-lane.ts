import { resolve } from "node:path";

export type InstallLane = "windows" | "macos" | "linux";

export const HMAC_KEY_FILE = ".tawassul-hmac-key";

export const HMAC_KEY_BYTES = 32;

export function operatorKeyProblem(
  env: Record<string, string | undefined>,
  size: number | null,
): string | undefined {
  const dir = env.TAWASSUL_HMAC_KEY_DIR?.trim();
  if (!dir) return undefined;
  const file = resolve(dir, HMAC_KEY_FILE);
  if (size === null) {
    return (
      `TAWASSUL_HMAC_KEY_DIR points at ${file}, which is absent — the runtime refuses to sign without it; ` +
      `place a ${HMAC_KEY_BYTES}-byte key there or unset the variable`
    );
  }
  if (size !== HMAC_KEY_BYTES) {
    return `the key at ${file} is ${size} bytes; expected ${HMAC_KEY_BYTES}`;
  }
  return undefined;
}

export type KeyDirectory = { dir: string; managed: boolean };

export function installLane(platform: NodeJS.Platform): InstallLane {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

export function dependencyProbeCommand(platform: NodeJS.Platform): "where" | "which" {
  return platform === "win32" ? "where" : "which";
}

export function usesPosixDatabaseLane(lane: InstallLane): boolean {
  return lane !== "windows";
}

export function windowsKeyAclArgv(directory: string, identity: string): string[] {
  return [
    "icacls",
    directory,
    "/inheritance:r",
    "/grant:r",
    `${identity}:(OI)(CI)F`,
    "/grant:r",
    "*S-1-5-18:(OI)(CI)F",
    "/grant:r",
    "*S-1-5-32-544:(OI)(CI)F",
  ];
}

export function windowsAclPath(directory: string): string {
  if (directory.startsWith("\\\\?\\")) return directory;
  if (directory.length < 260) return directory;
  if (directory.startsWith("\\\\")) return `\\\\?\\UNC\\${directory.slice(2)}`;
  return `\\\\?\\${directory}`;
}

export function windowsKeyDirectory(
  env: Record<string, string | undefined>,
  home: string,
): KeyDirectory {
  const keyEnv = env.TAWASSUL_HMAC_KEY_DIR?.trim();
  if (keyEnv) return { dir: resolve(keyEnv), managed: false };
  const globalDir = env.TAWASSUL_GLOBAL_DIR?.trim();
  if (globalDir) return { dir: resolve(globalDir, "..", "tawassul"), managed: true };
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return { dir: resolve(xdg, "tawassul"), managed: true };
  return { dir: resolve(home, ".config", "tawassul"), managed: true };
}
