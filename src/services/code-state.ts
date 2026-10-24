

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { secureId } from "../utils/crypto.ts";
import { globalCacheBaseDir, safeHomedir } from "../utils/path-resolver.ts";
import { logger } from "../utils/logger.ts";

const execFileAsync = promisify(execFile);


const STAGE_BATCH = 1000;


let _gitBin: string | undefined;
function getGitBin(): string {
  if (_gitBin === undefined) {
    const isWindows = process.platform === "win32";
    try {
      const out = execFileSync(isWindows ? "where" : "which", ["git"], {
        encoding: "utf8",
        windowsHide: true,
      });
      _gitBin = out.trim().split("\n")[0] || "git";
    } catch {
      _gitBin = "git";
    }
  }
  return _gitBin;
}

export interface ChangedFile {
  status: string;
  path: string;
}

export interface CodeSnapshot {
  id: string;
  index: number;
  label: string;
  beforeTree: string | null;
  afterTree: string | null;
  timestamp: string;
  messageId?: string;
  changedFiles?: ChangedFile[];
}

export interface ICodeStateService {
  capture(label: string, messageId?: string): Promise<CodeSnapshot>;
  restoreById(id: string, force?: boolean): Promise<{ ok: boolean; snapshot?: CodeSnapshot; error?: string }>;
  diffBetween(before: string | null, after: string): Promise<string | null>;
  
  reset(): void;
}

export interface CodeStateStatus {
  snapshots: CodeSnapshot[];
  pointer: number;
  currentTree: string | null;
  hasUnsavedChanges: boolean;
}


function resolveCodeStateRoot(): string {
  return join(globalCacheBaseDir(), "tawassul-v2", "code-state");
}


function legacyCodeStateRoot(): string {
  try {
    return join(safeHomedir(), ".cache", "tawassul", "code-state");
  } catch {
    return join(tmpdir(), "tawassul", "code-state");
  }
}

function projectHash(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 16);
}

async function git(args: string[], cwd: string, gitDir: string, workTree: string, timeout = 30_000): Promise<string> {
  const { stdout } = await execFileAsync(getGitBin(), ["--git-dir", gitDir, "--work-tree", workTree, ...args], {
    cwd,
    encoding: "utf8",
    timeout,
  });
  return stdout.trim();
}

export class CodeStateService {
  private readonly projectRoot: string;
  private readonly gitDir: string;
  private readonly logPath: string;
  private snapshots: CodeSnapshot[] = [];
  private pointer = -1;
  private gcCounter = 0;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const hash = projectHash(projectRoot);
    const base = join(resolveCodeStateRoot(), hash);
    this.gitDir = join(base, "git");
    this.logPath = join(base, "log.json");
    this.migrateLegacy(hash, base);
    this.ensureGitDir();
    this.loadLog();
  }

  
  private migrateLegacy(hash: string, base: string): void {
    const legacyBase = join(legacyCodeStateRoot(), hash);
    if (legacyBase === base) return;
    try {
      const legacyGit = join(legacyBase, "git");
      const newGit = join(base, "git");
      if (existsSync(join(legacyGit, "objects")) && !existsSync(join(newGit, "objects"))) {
        mkdirSync(base, { recursive: true });
        cpSync(legacyGit, newGit, { recursive: true });
        logger.info(`[code-state] migrated git object store ${legacyGit} → ${newGit}`);
      }
      const legacyLog = join(legacyBase, "log.json");
      if (existsSync(legacyLog) && !existsSync(this.logPath)) {
        mkdirSync(base, { recursive: true });
        cpSync(legacyLog, this.logPath);
        logger.info(`[code-state] migrated snapshot log ${legacyLog} → ${this.logPath}`);
      }
    } catch (err) {
      logger.warn(`[code-state] legacy migration skipped: ${err}`);
    }
  }

  private ensureGitDir(): void {
    mkdirSync(this.gitDir, { recursive: true });
    if (!existsSync(join(this.gitDir, "config"))) {
      
      execFileSync(getGitBin(), ["init", "--bare", "-q", this.gitDir], {
        encoding: "utf8",
        cwd: this.gitInitCwd(),
      });
    }
  }

  
  private gitInitCwd(): string {
    try {
      return safeHomedir();
    } catch {
      return this.gitDir;
    }
  }

  private loadLog(): void {
    if (existsSync(this.logPath)) {
      try {
        const data = JSON.parse(readFileSync(this.logPath, "utf8")) as { snapshots: CodeSnapshot[]; pointer: number };
        this.snapshots = data.snapshots ?? [];
        this.pointer = data.pointer ?? -1;
      } catch {
        this.snapshots = [];
        this.pointer = -1;
      }
    }
  }

  private saveLog(): void {
    const dir = join(this.logPath, "..");
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.log.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`);
    writeFileSync(tmp, JSON.stringify({ snapshots: this.snapshots, pointer: this.pointer }, null, 2));
    renameSync(tmp, this.logPath);
  }

  
  private async changedPaths(): Promise<string[]> {
    const paths = new Set<string>();
    try {
      const diffOut = await git(["diff", "--name-only", "-z"], this.projectRoot, this.gitDir, this.projectRoot);
      for (const p of diffOut.split("\0")) {
        if (p && !this.isGitMeta(p)) paths.add(p);
      }
    } catch {

    }
    try {
      const statusOut = await git(["status", "--porcelain", "-z"], this.projectRoot, this.gitDir, this.projectRoot);
      const fields = statusOut.split("\0");
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i]!;
        if (f.length < 4) continue;
        const path = f.slice(3);
        if (f.slice(0, 2) !== "??" || this.isGitMeta(path)) continue;
        paths.add(path);
      }
    } catch {

    }
    return [...paths];
  }

  private isGitMeta(p: string): boolean {
    return p === ".git" || p.startsWith(".git/") || p.includes("/.git/");
  }

  
  private async writeTree(): Promise<string> {
    
    const changed = await this.changedPaths();
    for (let i = 0; i < changed.length; i += STAGE_BATCH) {
      const batch = changed.slice(i, i + STAGE_BATCH);
      await git(["add", "--all", "--", ...batch], this.projectRoot, this.gitDir, this.projectRoot);
    }
    return git(["write-tree"], this.projectRoot, this.gitDir, this.projectRoot);
  }

  private async checkoutTree(tree: string): Promise<void> {
    await git(["checkout", tree, "--", "."], this.projectRoot, this.gitDir, this.projectRoot);
  }

  
  private async changedFiles(before: string | null, after: string): Promise<ChangedFile[]> {
    if (!before) return [];
    try {
      const out = await git(
        ["diff-tree", "--no-commit-id", "--name-status", "-r", before, after],
        this.projectRoot,
        this.gitDir,
        this.projectRoot,
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("\t");
          return { status: (parts[0] ?? "").trim(), path: parts.slice(1).join("\t") };
        });
    } catch {
      return [];
    }
  }

  
  async diffBetween(before: string | null, after: string): Promise<string | null> {
    if (!before) return null;
    try {
      return await git(["diff-tree", "-p", "-r", before, after], this.projectRoot, this.gitDir, this.projectRoot);
    } catch {
      return null;
    }
  }

  
  async capture(label: string, messageId?: string): Promise<CodeSnapshot> {
    
    
    if ((await this.changedPaths()).length === 0) {
      const tree = this.pointer >= 0 ? this.snapshots[this.pointer]!.afterTree! : await this.writeTree();
      return {
        id: "noop",
        index: -1,
        label,
        beforeTree: tree,
        afterTree: tree,
        timestamp: new Date().toISOString(),
        messageId,
        changedFiles: [],
      };
    }
    const beforeTree = this.pointer >= 0 ? this.snapshots[this.pointer]!.afterTree : await this.writeTree();
    const afterTree = await this.writeTree();
    const snapshot: CodeSnapshot = {
      id: `cs-${Date.now().toString(36)}-${secureId()}`,
      index: this.snapshots.length,
      label,
      beforeTree,
      afterTree,
      timestamp: new Date().toISOString(),
      messageId,
      changedFiles: await this.changedFiles(beforeTree, afterTree),
    };
    this.snapshots.push(snapshot);
    this.pointer = this.snapshots.length - 1;
    this.saveLog();
    this.gcCounter++;
    if (this.gcCounter % 10 === 0) {
      git(["gc", "--auto"], this.projectRoot, this.gitDir, this.projectRoot, 60_000).catch(() => {});
    }
    return snapshot;
  }

  private async currentTree(): Promise<string | null> {
    try {
      return await this.writeTree();
    } catch {
      return null;
    }
  }

  
  private async restore(
    tree: string,
    force: boolean,
    expected: string | null,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!force && expected) {
      const current = await this.currentTree();
      if (current && current !== expected) {
        return {
          ok: false,
          error: "working tree has unsaved changes since last snapshot — use force:true to overwrite",
        };
      }
    }
    await this.checkoutTree(tree);
    return { ok: true };
  }

  private currentAfterTree(): string | null {
    return this.pointer >= 0 ? this.snapshots[this.pointer]!.afterTree : null;
  }

  async undo(force = false): Promise<{ ok: boolean; snapshot?: CodeSnapshot; error?: string }> {
    if (this.pointer < 0) {
      return { ok: false, error: "nothing to undo" };
    }
    const target = this.snapshots[this.pointer]!;
    const res = await this.restore(target.beforeTree ?? target.afterTree!, force, this.currentAfterTree());
    if (!res.ok) return { ok: false, error: res.error };
    this.pointer -= 1;
    this.saveLog();
    return { ok: true, snapshot: target };
  }

  async redo(force = false): Promise<{ ok: boolean; snapshot?: CodeSnapshot; error?: string }> {
    if (this.pointer >= this.snapshots.length - 1) {
      return { ok: false, error: "nothing to redo" };
    }
    const next = this.pointer + 1;
    const target = this.snapshots[next]!;
    const res = await this.restore(target.afterTree!, force, this.currentAfterTree());
    if (!res.ok) return { ok: false, error: res.error };
    this.pointer = next;
    this.saveLog();
    return { ok: true, snapshot: target };
  }

  async restoreById(id: string, force = false): Promise<{ ok: boolean; snapshot?: CodeSnapshot; error?: string }> {
    const idx = this.snapshots.findIndex((s) => s.id === id);
    if (idx < 0) return { ok: false, error: `snapshot ${id} not found` };
    const target = this.snapshots[idx]!;
    const res = await this.restore(target.afterTree!, force, this.currentAfterTree());
    if (!res.ok) return { ok: false, error: res.error };
    this.pointer = idx;
    this.saveLog();
    return { ok: true, snapshot: target };
  }

  async status(): Promise<CodeStateStatus> {
    const current = await this.currentTree();
    const expected = this.pointer >= 0 ? this.snapshots[this.pointer]!.afterTree : null;
    return {
      snapshots: this.snapshots,
      pointer: this.pointer,
      currentTree: current,
      hasUnsavedChanges: !!expected && current !== null && current !== expected,
    };
  }

  
  reset(): void {
    this.snapshots = [];
    this.pointer = -1;
    this.saveLog();
  }

  
  async diff(idOrIndex?: string | number): Promise<string | null> {
    let snap: CodeSnapshot | undefined;
    if (idOrIndex === undefined) {
      snap = this.pointer >= 0 ? this.snapshots[this.pointer] : undefined;
    } else if (typeof idOrIndex === "number") {
      snap = this.snapshots[idOrIndex];
    } else {
      snap = this.snapshots.find((s) => s.id === idOrIndex);
    }
    if (!snap) return null;
    return this.diffBetween(snap.beforeTree, snap.afterTree!);
  }
}
