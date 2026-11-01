import { resolve } from "node:path";

export type InstallLane = "windows" | "macos" | "linux";

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
