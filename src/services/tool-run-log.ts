







import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { atomicWriteFile } from "../infra/disk-utils.ts";
import { isIsolationActiveSync } from "./isolation.ts";
import { PrivacyGuard } from "./privacy-guard.ts";
import { logger } from "../utils/logger.ts";

export type ToolRunStatus = "success" | "error";

export interface ToolRunEntry {
  id: string;
  tool: string;
  agent: string;
  sessionId: string;
  argsHash: string;
  status: ToolRunStatus;
  timestamp: number;
  turn: number;
  
  input?: unknown;
  
  error?: string;
}

export interface ToolRunRecordInput {
  tool: string;
  agent: string;
  sessionId: string;
  argsHash: string;
  status: ToolRunStatus;
  turn: number;
  input?: unknown;
  error?: string;
  timestamp?: number;
}


export const NEVER_DEDUP_TOOLS = new Set(["bash", "edit", "write", "task"]);

const MAX_MEMORY_ENTRIES = 2000;
const PRUNE_KEEP = 1500;

export class ToolRunLog {
  private runs: ToolRunEntry[] = [];
  private loaded = false;
  private readonly stateDir: string;
  private readonly redactor: PrivacyGuard;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
    
    
    
    this.redactor = new PrivacyGuard();
  }

  private logPath(): string {
    return resolve(this.stateDir, ".opencode", "tool-run-log.json");
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (isIsolationActiveSync()) return; 
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(this.logPath(), "utf-8");
      const parsed = JSON.parse(raw) as { runs?: unknown };
      if (Array.isArray(parsed.runs)) {
        this.runs = parsed.runs.filter(isToolRunEntry);
      }
    } catch {
      /* no log yet — fresh start */
    }
  }

  async save(): Promise<void> {
    if (isIsolationActiveSync()) return; 
    const p = this.logPath();
    try {
      await mkdir(dirname(p), { recursive: true });
    } catch {
      /* ignore */
    }
    const data = JSON.stringify({ runs: this.runs }, null, 2);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await atomicWriteFile(p, data);
        return;
      } catch (e) {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 5 * (attempt + 1)));
        else logger.warn("tool-run-log save failed after 3 attempts:", e);
      }
    }
  }

  record(input: ToolRunRecordInput): ToolRunEntry {
    
    const redactedInput =
      input.input !== undefined ? this.redactor.redact(JSON.stringify(input.input)).redacted : undefined;
    const redactedError = input.error !== undefined ? this.redactor.redact(String(input.error)).redacted : undefined;
    const entry: ToolRunEntry = {
      id: `tr-${input.tool}-${input.argsHash}-${(input.timestamp ?? Date.now()).toString(36)}`,
      timestamp: input.timestamp ?? Date.now(),
      tool: input.tool,
      agent: input.agent,
      sessionId: input.sessionId,
      argsHash: input.argsHash,
      status: input.status,
      turn: input.turn,
      input: redactedInput,
      error: redactedError,
    };
    this.runs.push(entry);
    if (this.runs.length > MAX_MEMORY_ENTRIES) {
      this.runs = this.runs.slice(-PRUNE_KEEP);
    }
    return entry;
  }

  
  findCrossSessionDuplicate(tool: string, argsHash: string, now: number, windowMs = 30_000): ToolRunEntry | undefined {
    if (NEVER_DEDUP_TOOLS.has(tool)) return undefined;
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const r = this.runs[i]!;
      if (r.tool === tool && r.argsHash === argsHash && r.status === "success" && now - r.timestamp < windowMs) {
        return r;
      }
    }
    return undefined;
  }

  
  purgeOldFailed(maxAgeMs = 120_000): number {
    const now = Date.now();
    let purged = 0;
    for (const r of this.runs) {
      if (r.status === "error" && r.input !== undefined && now - r.timestamp > maxAgeMs) {
        r.input = undefined;
        purged++;
      }
    }
    return purged;
  }

  
  get failedCount(): number {
    return this.runs.filter((r) => r.status === "error").length;
  }

  get entries(): readonly ToolRunEntry[] {
    return this.runs;
  }
}

function isToolRunEntry(v: unknown): v is ToolRunEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.tool === "string" &&
    typeof e.agent === "string" &&
    typeof e.sessionId === "string" &&
    typeof e.argsHash === "string" &&
    (e.status === "success" || e.status === "error") &&
    typeof e.timestamp === "number" &&
    typeof e.turn === "number"
  );
}
