import { logger } from "../../utils/logger.ts";
import { applyFile, applyImports, applyStamps, applyTree } from "./builder.ts";
import {
  dependents as queryDependents,
  dependentsClosure as queryDependentsClosure,
  filesByLang as queryFilesByLang,
  findSymbol as queryFindSymbol,
  symbolsInFile as querySymbolsInFile,
} from "./query.ts";
import { emptySnapshot, loadSnapshot, saveSnapshot, snapshotPath } from "./store.ts";
import type { DirStamp, FileRecord, FileStamp, ImportEdge, IndexSnapshot, IndexStats, SymbolKind, SymbolRecord } from "./types.ts";

export type ProjectIndexOptions = {
  baseDir: string;
  projectKey: string;
  projectRoot?: string;
  enabled?: boolean;
};

export type ImportBatchEntry = { path: string; edges: ImportEdge[] };

export function projectIndexEnabled(): boolean {
  const raw = process.env.TAWASSUL_PROJECT_INDEX?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export class ProjectIndexService {
  readonly baseDir: string;
  readonly projectKey: string;
  readonly projectRoot: string;
  private readonly enabledFlag: boolean;
  private data: IndexSnapshot | null = null;
  private parseCount = 0;
  private writeCount = 0;

  constructor(options: ProjectIndexOptions) {
    this.baseDir = options.baseDir;
    this.projectKey = options.projectKey;
    this.projectRoot = options.projectRoot ?? options.baseDir;
    this.enabledFlag = options.enabled ?? projectIndexEnabled();
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  get path(): string {
    return snapshotPath(this.baseDir);
  }

  get loaded(): boolean {
    return this.data !== null;
  }

  evictMemory(): number {
    const bytes = this.data?.stats.bytes ?? 0;
    this.data = null;
    return bytes;
  }

  snapshot(): IndexSnapshot {
    return this.load();
  }

  stats(): IndexStats {
    const snapshot = this.load();
    return {
      ...snapshot.stats,
      parses: this.parseCount,
      writes: this.writeCount,
      enabled: this.enabledFlag,
    };
  }

  private load(): IndexSnapshot {
    if (!this.enabledFlag) return emptySnapshot(this.projectKey, this.projectRoot);
    if (!this.data) this.data = loadSnapshot(this.baseDir, this.projectKey, this.projectRoot);
    return this.data;
  }

  private persist(): boolean {
    if (!this.enabledFlag || !this.data) return false;
    const saved = saveSnapshot(this.baseDir, this.data);
    if (saved) this.writeCount += 1;
    return saved;
  }

  async recordTree(files: FileStamp[], dirs: DirStamp[]): Promise<boolean> {
    if (!this.enabledFlag) return false;
    try {
      const changed = applyTree(this.load(), this.baseDir, files, dirs);
      if (changed) this.persist();
      return changed;
    } catch (e) {
      logger.warn("[tawassul] project index tree record failed:", e);
      return false;
    }
  }

  async recordFile(absPath: string): Promise<FileRecord | null> {
    if (!this.enabledFlag) return null;
    try {
      const result = await applyFile(this.load(), this.baseDir, absPath);
      if (!result) return null;
      if (result.parsed) this.parseCount += 1;
      if (result.changed) this.persist();
      return result.record;
    } catch (e) {
      logger.warn("[tawassul] project index file record failed:", e);
      return null;
    }
  }

  recordImports(absPath: string, edges: ImportEdge[]): boolean {
    if (!this.enabledFlag) return false;
    try {
      const changed = applyImports(this.load(), this.baseDir, absPath, edges);
      if (changed) this.persist();
      return changed;
    } catch (e) {
      logger.warn("[tawassul] project index import record failed:", e);
      return false;
    }
  }

  recordImportBatch(entries: ImportBatchEntry[]): boolean {
    if (!this.enabledFlag) return false;
    try {
      let changed = false;
      for (const entry of entries) {
        changed = applyImports(this.load(), this.baseDir, entry.path, entry.edges) || changed;
      }
      if (changed) this.persist();
      return changed;
    } catch (e) {
      logger.warn("[tawassul] project index import batch failed:", e);
      return false;
    }
  }

  recordStamps(paths: string[]): boolean {
    if (!this.enabledFlag) return false;
    try {
      const changed = applyStamps(this.load(), this.baseDir, paths);
      if (changed) this.persist();
      return changed;
    } catch (e) {
      logger.warn("[tawassul] project index stamp record failed:", e);
      return false;
    }
  }

  findSymbol(name: string, kind?: SymbolKind): Array<{ path: string; symbol: SymbolRecord }> {
    return queryFindSymbol(this.load(), name, kind);
  }

  symbolsInFile(path: string): SymbolRecord[] {
    return querySymbolsInFile(this.load(), path);
  }

  dependents(path: string): string[] {
    return queryDependents(this.load(), path);
  }

  dependentsClosure(path: string, maxDepth?: number): string[] {
    return queryDependentsClosure(this.load(), path, maxDepth);
  }

  filesByLang(lang: string): string[] {
    return queryFilesByLang(this.load(), lang);
  }
}
