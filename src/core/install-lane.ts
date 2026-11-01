export type InstallLane = "windows" | "macos" | "linux";

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
