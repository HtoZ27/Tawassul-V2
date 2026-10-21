import { homedir } from "node:os";
import { resolve } from "node:path";

let forcedBy: string | null = null;

export function forceQuietMode(reason: string): void {
  forcedBy = reason;
}

export function quietModeForceReason(): string | null {
  return forcedBy;
}

export function clearQuietModeForce(): void {
  forcedBy = null;
}

export function isHomeProject(directory: string): boolean {
  try {
    return resolve(directory) === resolve(homedir());
  } catch {
    return false;
  }
}

export function quietModeEnabled(): boolean {
  const raw = (process.env.TAWASSUL_QUIET ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  return forcedBy !== null;
}

export function quietValue<T>(quiet: T, normal: T): T {
  return quietModeEnabled() ? quiet : normal;
}

export const QUIET_SAVE_DEBOUNCE_MS = 10_000;

export const QUIET_LEDGER_FLUSH_MS = 25_000;

export const QUIET_AUTO_SAVE_INTERVAL_MS = 25 * 60_000;
