import { win32 } from "node:path";

export type HostProbe = { command: string; args: string[]; shell: boolean };

const PROBE_ARG = "--version";
const POWERSHELL_ARGS = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"];

function powershellExecutable(env: Record<string, string | undefined>): string {
  const systemRoot = env.SystemRoot?.trim() || "C:\\Windows";
  return win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function hostProbeCommand(
  bin: string,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {},
): HostProbe {
  const plain = { command: bin, args: [PROBE_ARG], shell: false };
  if (platform !== "win32") return plain;
  if (/\.ps1$/i.test(bin)) {
    return {
      command: powershellExecutable(env),
      args: [...POWERSHELL_ARGS, bin, PROBE_ARG],
      shell: false,
    };
  }
  if (/\.(cmd|bat)$/i.test(bin)) {
    return { command: bin, args: [PROBE_ARG], shell: true };
  }
  return plain;
}
