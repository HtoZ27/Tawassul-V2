import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { v2DataRoot } from "./state-paths.ts";

export const PROJECT_STATE_ROOT_ENV = "TAWASSUL_STATE_ROOT";
export const PROJECTS_SUBDIR = "projects";

export type HostProjectRef = {
  id?: unknown;
  directory?: unknown;
  canonical?: unknown;
};

export type HostLocation = {
  directory?: unknown;
  workspaceID?: unknown;
  project?: HostProjectRef;
};

export type ProjectIdentitySource = "project-id" | "canonical" | "directory" | "cwd";

export type ProjectIdentity = {
  key: string;
  source: ProjectIdentitySource;
  projectID?: string;
  directory: string;
  canonical: string;
};

export type StateRootMode = "auto" | "legacy" | "project";

const MAX_PROJECT_ID_CHARS = 256;
const MAX_KEY_CHARS = 64;
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*$/;
const GLOBAL_PROJECT_ID = "global";

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function realOrResolve(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return resolve(value);
  }
}

export function usableProjectID(value: unknown): string | undefined {
  const id = readText(value);
  if (!id) return undefined;
  if (id.toLowerCase() === GLOBAL_PROJECT_ID) return undefined;
  if (id.length > MAX_PROJECT_ID_CHARS) return undefined;
  return id;
}

export function sanitizeProjectKey(value: string): string {
  const lowered = value.trim().toLowerCase();
  if (lowered.length > 0 && lowered.length <= MAX_KEY_CHARS && SAFE_KEY.test(lowered)) return lowered;
  return `h-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

export function canonicalPathKey(canonical: string): string {
  return `path-${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

export function resolveProjectIdentity(location?: HostLocation, cwd?: string): ProjectIdentity {
  const fallbackDir = readText(cwd) ?? process.cwd();
  const directory = realOrResolve(readText(location?.directory) ?? fallbackDir);
  const projectDirectory = readText(location?.project?.directory);
  const projectCanonical = readText(location?.project?.canonical);
  const canonical = realOrResolve(projectCanonical ?? projectDirectory ?? directory);
  const projectID = usableProjectID(location?.project?.id);
  if (projectID) {
    return { key: sanitizeProjectKey(projectID), source: "project-id", projectID, directory, canonical };
  }
  if (projectCanonical) {
    return { key: canonicalPathKey(canonical), source: "canonical", directory, canonical };
  }
  if (projectDirectory) {
    return { key: canonicalPathKey(canonical), source: "directory", directory, canonical };
  }
  return { key: canonicalPathKey(canonical), source: "cwd", directory, canonical };
}

export function stateRootMode(): StateRootMode {
  const raw = process.env[PROJECT_STATE_ROOT_ENV]?.trim().toLowerCase();
  if (raw === "legacy") return "legacy";
  if (raw === "project") return "project";
  return "auto";
}

export function projectRootFor(identity: ProjectIdentity, dataRoot?: string): string | undefined {
  const base = dataRoot ?? v2DataRoot();
  if (!base) return undefined;
  return resolve(base, PROJECTS_SUBDIR, identity.key);
}

export function explicitStateDirOverride(): string | undefined {
  return readText(process.env.TAWASSUL_STATE_DIR);
}

export function resolveProjectRoot(location?: HostLocation, directory?: string): string | undefined {
  if (explicitStateDirOverride()) return undefined;
  if (stateRootMode() === "legacy") return undefined;
  const identity = resolveProjectIdentity(location, directory);
  return projectRootFor(identity);
}
