







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
  model?: string;
  
  input?: unknown;
  
  error?: string;
}

export interface ToolRunRecordInput {
  tool: string;
  agent: string;
  sessionId: string;
  argsHash: string;
  status: ToolRunStatus;
  turn?: number;
  model?: string;
  input?: unknown;
  error?: string;
  timestamp?: number;
}


export const NEVER_DEDUP_TOOLS = new Set([
  "read",
  "bash",
  "edit",
  "write",
  "task",
  "delete",
  "kick",
  "addagent",
  "handoff",
]);

const MAX_MEMORY_ENTRIES = 2000;
const PRUNE_KEEP = 1500;

export class ToolRunLog {
  private runs: ToolRunEntry[] = [];
  private loaded = false;
  private readonly stateDir: string;
  private readonly redactor: PrivacyGuard;
  private turnSeq = new Map<string, number>();

  currentTurn(sessionId: string): number {
    return this.turnSeq.get(sessionId) ?? 0;
  }

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
      const trimmed = raw.trim();
      if (!trimmed) return;
      let parsed: unknown[] | null = null;
      try {
        const single = JSON.parse(trimmed) as unknown;
        if (Array.isArray(single)) {
          parsed = single;
        } else if (
          single &&
          typeof single === "object" &&
          Array.isArray((single as { runs?: unknown }).runs)
        ) {
          parsed = (single as { runs: unknown[] }).runs;
        } else if (single && typeof single === "object" && "tool" in (single as object)) {
          parsed = [single];
        }
      } catch {
        parsed = null;
      }
      if (parsed === null) {
        parsed = trimmed
          .split("\n")
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter((value): value is unknown => value !== null);
      }
      if (Array.isArray(parsed)) {
        this.runs = parsed.filter(isToolRunEntry);
      }
    } catch {
    }
  }

  async save(): Promise<void> {
    if (isIsolationActiveSync()) return;
    for (const sessionId of this.turnSeq.keys()) this.purgeAgedFailures(sessionId);
    if (this.runs.length > PRUNE_KEEP) {
      this.runs = this.runs.slice(-PRUNE_KEEP);
    }
    const p = this.logPath();
    try {
      await mkdir(dirname(p), { recursive: true });
    } catch {
    }
    const data = this.runs.map((entry) => JSON.stringify(entry)).join("\n") + (this.runs.length ? "\n" : "");
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
    const turn = input.turn || this.nextTurn(input.sessionId);
    if (input.turn) {
      this.turnSeq.set(input.sessionId, Math.max(this.turnSeq.get(input.sessionId) ?? 0, input.turn));
    }
    const entry: ToolRunEntry = {
      id: `tr-${input.tool}-${input.argsHash}-${(input.timestamp ?? Date.now()).toString(36)}`,
      timestamp: input.timestamp ?? Date.now(),
      tool: input.tool,
      agent: input.agent,
      sessionId: input.sessionId,
      argsHash: input.argsHash,
      status: input.status,
      turn,
      ...(input.model ? { model: input.model } : {}),
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

  private nextTurn(sessionId: string): number {
    const t = (this.turnSeq.get(sessionId) ?? 0) + 1;
    this.turnSeq.set(sessionId, t);
    return t;
  }

  purgeAgedFailures(sessionId: string, keepTurns = 4): number {
    const current = this.turnSeq.get(sessionId) ?? 0;
    let purged = 0;
    for (const r of this.runs) {
      if (
        r.sessionId === sessionId &&
        r.status === "error" &&
        r.input !== undefined &&
        r.turn < current - keepTurns + 1
      ) {
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

export const TOOL_RANKING_SOURCE = "tool-run-log";

export type ToolRankingRow = {
  tool: string;
  calls: number;
  errors: number;
  retries: number;
  lastTurn: number;
};

export function rankToolRuns(
  entries: readonly ToolRunEntry[],
  source: string = TOOL_RANKING_SOURCE,
): ToolRankingRow[] {
  if (source !== TOOL_RANKING_SOURCE) {
    throw new Error(`unsupported tool ranking source: ${source}`);
  }
  const rows = new Map<string, ToolRankingRow>();
  for (const entry of entries) {
    const row = rows.get(entry.tool) ?? {
      tool: entry.tool,
      calls: 0,
      errors: 0,
      retries: 0,
      lastTurn: 0,
    };
    row.calls += 1;
    if (entry.status === "error") row.errors += 1;
    if (entry.turn > row.lastTurn) row.lastTurn = entry.turn;
    rows.set(entry.tool, row);
  }
  entries.forEach((entry, index) => {
    if (entry.status !== "error") return;
    const retried = entries.some(
      (other, otherIndex) =>
        otherIndex > index && other.tool === entry.tool && other.sessionId === entry.sessionId,
    );
    if (!retried) return;
    const row = rows.get(entry.tool);
    if (row) row.retries += 1;
  });
  return [...rows.values()].sort(
    (a, b) => b.calls - a.calls || b.errors - a.errors || a.tool.localeCompare(b.tool),
  );
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
    typeof e.turn === "number" &&
    (e.model === undefined || typeof e.model === "string")
  );
}
