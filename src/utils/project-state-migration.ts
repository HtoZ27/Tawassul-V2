import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ProjectIdentity } from "./project-identity.ts";

export const IDENTITY_FILE = "identity.json";
export const MIGRATION_INDEX_FILE = "migration.json";
export const MIGRATION_JOURNAL_FILE = "migration.jsonl";
export const BACKUP_DIR = "backup";
export const CONFLICT_DIR = "conflicts";
export const STATE_NAMESPACE = ".opencode";
export const STATE_ENTRY_PREFIX = "state:";
export const STATE_BACKUP_DIR = "state";

const TOP_LEVEL_STATE_ENTRIES = [
  "checkpoints.json",
  "goals",
  "handoff-ledger.jsonl",
  "metrics.json",
  "mission-board",
  "sagas",
  "timeline",
] as const;

const EXCLUDED_ENTRIES = new Set([
  ".git",
  ".gitignore",
  "agents",
  "bun.lock",
  "bun.lockb",
  "bunfig.toml",
  "commands",
  "deleted-agents.json",
  "node_modules",
  "opencode.json",
  "opencode.jsonc",
  "package-lock.json",
  "package.json",
  "plugin",
  "plugins",
  "skills",
  "tawa-prefs.json",
  "tawassul-pins.json",
  "tawassul.json",
  "tawassul.jsonc",
]);

type MigrationFileEntry = {
  sha256: string;
  bytes: number;
  copiedAt: string;
};

type SyncEntry = {
  key: string;
  source: string;
  destination: string;
  backup: string;
};

export type MigrationIndex = {
  version: 1;
  updatedAt: string;
  files: Record<string, MigrationFileEntry>;
};

export type MigrationBackupManifest = {
  version: 1;
  createdAt: string;
  source: string;
  digest: string;
  files: Array<{ path: string; bytes: number; mode: number; sha256: string }>;
};

export type MigrationReport = {
  root: string;
  migrated: string[];
  refreshed: string[];
  conflicts: string[];
  skipped: number;
  backupDir?: string;
};

export type PrepareProjectStateInput = {
  workspaceDir: string;
  root: string;
  identity: ProjectIdentity;
};

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256File(filePath: string): string {
  return sha256Buffer(readFileSync(filePath));
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath));
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, filePath);
}

function copyAtomic(source: string, destination: string): void {
  ensureDir(dirname(destination));
  const tmp = `${destination}.${process.pid}.tmp`;
  copyFileSync(source, tmp);
  chmodSync(tmp, statSync(source).mode & 0o777);
  renameSync(tmp, destination);
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const TRANSIENT_ARTIFACT = /\.bak\.\d+\.[0-9a-f]{12}$|\.bak\.orphan-\d+$|\.\d+(-[0-9a-f]{12})?\.tmp$/;

function isTransientArtifact(rel: string): boolean {
  const name = rel.split("/").pop() ?? rel;
  return TRANSIENT_ARTIFACT.test(name);
}

function listFiles(base: string, prefix = "", excludeAtRoot = true): string[] {
  const current = join(base, prefix);
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries.sort()) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (!prefix && excludeAtRoot && EXCLUDED_ENTRIES.has(entry)) continue;
    let stats;
    try {
      stats = statSync(join(base, rel));
    } catch {
      continue;
    }
    if (stats.isDirectory()) out.push(...listFiles(base, rel, excludeAtRoot));
    else if (stats.isFile() && !isTransientArtifact(rel)) out.push(rel);
  }
  return out;
}

function collectEntries(workspaceDir: string, root: string): SyncEntry[] {
  const entries: SyncEntry[] = [];
  const legacyRoot = join(workspaceDir, STATE_NAMESPACE);
  for (const rel of listFiles(legacyRoot)) {
    entries.push({
      key: rel,
      source: join(legacyRoot, rel),
      destination: join(root, STATE_NAMESPACE, rel),
      backup: join(STATE_NAMESPACE, rel),
    });
  }
  for (const name of TOP_LEVEL_STATE_ENTRIES) {
    const base = join(workspaceDir, name);
    let stats;
    try {
      stats = statSync(base);
    } catch {
      continue;
    }
    const relatives = stats.isDirectory() ? listFiles(base, "", false) : stats.isFile() ? [""] : [];
    for (const rel of relatives) {
      const suffix = rel ? `${name}/${rel}` : name;
      entries.push({
        key: `${STATE_ENTRY_PREFIX}${suffix}`,
        source: join(workspaceDir, suffix),
        destination: join(root, suffix),
        backup: join(STATE_BACKUP_DIR, suffix),
      });
    }
  }
  return entries;
}

export function readMigrationIndex(root: string): MigrationIndex | undefined {
  const file = join(root, MIGRATION_INDEX_FILE);
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as MigrationIndex;
    if (parsed?.version !== 1 || typeof parsed.files !== "object" || parsed.files === null) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function emptyIndex(): MigrationIndex {
  return { version: 1, updatedAt: new Date().toISOString(), files: {} };
}

function appendJournal(root: string, entry: Record<string, unknown>): void {
  ensureDir(root);
  appendFileSync(join(root, MIGRATION_JOURNAL_FILE), `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
}

function writeBackup(root: string, sourceLabel: string, items: SyncEntry[], label: string): MigrationBackupManifest {
  const target = join(root, BACKUP_DIR, label);
  if (existsSync(target)) throw new Error(`migration backup already exists: ${target}`);
  const manifest: MigrationBackupManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    source: sourceLabel,
    digest: "",
    files: [],
  };
  for (const item of items) {
    const destination = join(target, item.backup);
    copyAtomic(item.source, destination);
    const bytes = statSync(item.source).size;
    const mode = statSync(item.source).mode & 0o777;
    const digest = sha256File(item.source);
    if (sha256File(destination) !== digest) throw new Error(`migration backup digest mismatch: ${item.key}`);
    manifest.files.push({ path: item.key, bytes, mode, sha256: digest });
  }
  manifest.digest = sha256Buffer(
    Buffer.from(manifest.files.map((file) => `${file.path}:${file.sha256}`).join("\n"), "utf8"),
  );
  writeJsonAtomic(join(target, "manifest.json"), manifest);
  return manifest;
}

function writeIdentity(root: string, identity: ProjectIdentity): void {
  const file = join(root, IDENTITY_FILE);
  const next = {
    version: 1,
    key: identity.key,
    source: identity.source,
    projectID: identity.projectID,
    directory: identity.directory,
    canonical: identity.canonical,
    updatedAt: new Date().toISOString(),
  };
  if (existsSync(file)) {
    try {
      const current = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      if (
        current.key === next.key &&
        current.source === next.source &&
        current.projectID === next.projectID &&
        current.canonical === next.canonical
      ) {
        return;
      }
    } catch {}
  }
  writeJsonAtomic(file, next);
}

export function prepareProjectState(input: PrepareProjectStateInput): MigrationReport {
  const workspaceDir = resolve(input.workspaceDir);
  const root = resolve(input.root);
  if (workspaceDir === root) {
    return { root, migrated: [], refreshed: [], conflicts: [], skipped: 0 };
  }
  ensureDir(root);
  writeIdentity(root, input.identity);
  const report: MigrationReport = { root, migrated: [], refreshed: [], conflicts: [], skipped: 0 };
  const entries = collectEntries(workspaceDir, root);
  if (entries.length === 0) return report;
  const index = readMigrationIndex(root) ?? emptyIndex();
  const pendingBackup = entries.filter((entry) => !index.files[entry.key] && !existsSync(entry.destination));
  if (pendingBackup.length > 0) {
    const backupDir = join(root, BACKUP_DIR, stamp());
    const manifest = writeBackup(root, workspaceDir, pendingBackup, relative(join(root, BACKUP_DIR), backupDir));
    report.backupDir = backupDir;
    appendJournal(root, {
      at: manifest.createdAt,
      action: "backup",
      path: relative(root, backupDir),
      digest: manifest.digest,
      files: manifest.files.map((file) => file.path),
    });
  }
  for (const entry of entries) {
    const { key, source, destination } = entry;
    const legacyDigest = sha256File(source);
    const recorded = index.files[key];
    if (!existsSync(destination)) {
      copyAtomic(source, destination);
      index.files[key] = { sha256: legacyDigest, bytes: statSync(source).size, copiedAt: new Date().toISOString() };
      report.migrated.push(key);
      appendJournal(root, { at: new Date().toISOString(), action: "migrate", path: key, sha256: legacyDigest });
      continue;
    }
    if (!recorded) {
      const target = join(root, BACKUP_DIR, CONFLICT_DIR, stamp(), entry.backup);
      copyAtomic(source, target);
      index.files[key] = { sha256: legacyDigest, bytes: statSync(source).size, copiedAt: new Date().toISOString() };
      report.conflicts.push(key);
      appendJournal(root, {
        at: new Date().toISOString(),
        action: "conflict",
        path: key,
        winner: "project",
        legacyCopy: relative(root, target),
      });
      continue;
    }
    if (recorded.sha256 === legacyDigest) {
      report.skipped += 1;
      continue;
    }
    const destinationDigest = sha256File(destination);
    if (destinationDigest === recorded.sha256) {
      copyAtomic(source, destination);
      index.files[key] = { sha256: legacyDigest, bytes: statSync(source).size, copiedAt: new Date().toISOString() };
      report.refreshed.push(key);
      appendJournal(root, { at: new Date().toISOString(), action: "refresh", path: key, sha256: legacyDigest });
      continue;
    }
    const target = join(root, BACKUP_DIR, CONFLICT_DIR, stamp(), entry.backup);
    copyAtomic(source, target);
    index.files[key] = { sha256: legacyDigest, bytes: statSync(source).size, copiedAt: new Date().toISOString() };
    report.conflicts.push(key);
    appendJournal(root, {
      at: new Date().toISOString(),
      action: "conflict",
      path: key,
      winner: "project",
      legacyCopy: relative(root, target),
    });
  }
  index.updatedAt = new Date().toISOString();
  if (report.migrated.length + report.refreshed.length + report.conflicts.length > 0) {
    writeJsonAtomic(join(root, MIGRATION_INDEX_FILE), index);
  }
  return report;
}
