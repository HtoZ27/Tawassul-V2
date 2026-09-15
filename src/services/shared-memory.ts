import type { SharedMemory, MemoryEntry } from "../conflict-resolver/types.ts";
import { randomUUID } from "node:crypto";
import { normalizeName } from "../utils/name-utils.ts";

const MAX_DECISIONS = 100;
const MAX_LEARNINGS = 100;
const MAX_WARNINGS = 50;
const MAX_FILE_CONTEXT = 1000;
const MAX_AGENT_CONTEXT = 1000;
const MAX_CONTENT_LENGTH = 5000;
const COMPACTION_INTERVAL_MS = 60 * 60 * 1000;
const BASE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const KNOWLEDGE_DECAY: Record<string, number> = {
  rule: 0.9,
  reference: 0.95,
  fact: 0.8,
  ephemeral: 0.7,
  reflection: 0.75,
  worked: 0.8,
};

function decayFactorForTags(tags: string[] | undefined, fallback = 1): number {
  if (!tags) return fallback;
  for (const t of tags) {
    const factor = KNOWLEDGE_DECAY[t.toLowerCase()];
    if (factor !== undefined) return factor;
  }
  return fallback;
}

function ttlForDecayFactor(factor: number): string {
  return new Date(Date.now() + Math.round(BASE_TTL_MS * factor)).toISOString();
}

function safeParseTime(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function createEmptyMemory(): SharedMemory {
  return {
    version: 1,
    lastCompacted: new Date().toISOString(),
    decisions: [],
    learnings: [],
    warnings: [],
    fileContext: {},
    agentContext: {},
    handoffHistory: [],
  };
}

export class SharedMemoryManager {
  private memory: SharedMemory;

  constructor(existing?: SharedMemory) {
    this.memory = existing || createEmptyMemory();
  }

  get(): SharedMemory {
    return this.memory;
  }

  getForAgent(agent: string): SharedMemory {
    const normalized = normalizeName(agent);
    const visible = (entry: MemoryEntry) => {
      const cls = entry.classification ?? "public";
      if (cls === "public") return true;
      if (cls === "private") return normalizeName(entry.source) === normalized;
      return (
        normalizeName(entry.source) === normalized ||
        entry.sharedWith?.some((s) => normalizeName(s) === normalized) === true
      );
    };
    return {
      ...this.memory,
      decisions: this.memory.decisions.filter(visible),
      learnings: this.memory.learnings.filter(visible),
      warnings: this.memory.warnings.filter(visible),
    };
  }

  addDecision(entry: Omit<MemoryEntry, "id" | "timestamp" | "decayFactor">): void {
    if (!entry?.content) return;
    const raw = entry.content;
    const content =
      typeof raw === "string" && raw.length > MAX_CONTENT_LENGTH
        ? raw.substring(0, MAX_CONTENT_LENGTH) + "... (truncated)"
        : raw;
    this.memory.decisions.push({
      ...entry,
      content,
      id: `dec-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      decayFactor: decayFactorForTags(entry.tags, 1),
      expiresAt: entry.expiresAt ?? ttlForDecayFactor(decayFactorForTags(entry.tags, 1)),
    });
    if (this.memory.decisions.length > MAX_DECISIONS) {
      this.memory.decisions = this.memory.decisions.slice(-MAX_DECISIONS);
    }
  }

  addLearning(entry: Omit<MemoryEntry, "id" | "timestamp" | "decayFactor">): void {
    if (!entry?.content) return;
    const raw = entry.content;
    const content =
      typeof raw === "string" && raw.length > MAX_CONTENT_LENGTH
        ? raw.substring(0, MAX_CONTENT_LENGTH) + "... (truncated)"
        : raw;
    this.memory.learnings.push({
      ...entry,
      content,
      id: `learn-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      decayFactor: decayFactorForTags(entry.tags, 1),
      expiresAt: entry.expiresAt ?? ttlForDecayFactor(decayFactorForTags(entry.tags, 1)),
    });
    if (this.memory.learnings.length > MAX_LEARNINGS) {
      this.memory.learnings = this.memory.learnings.slice(-MAX_LEARNINGS);
    }
  }

  addWarning(entry: Omit<MemoryEntry, "id" | "timestamp" | "decayFactor">): void {
    if (!entry?.content) return;
    const raw = entry.content;
    const content =
      typeof raw === "string" && raw.length > MAX_CONTENT_LENGTH
        ? raw.substring(0, MAX_CONTENT_LENGTH) + "... (truncated)"
        : raw;
    this.memory.warnings.push({
      ...entry,
      content,
      id: `warn-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      decayFactor: decayFactorForTags(entry.tags, 1),
    });
    if (this.memory.warnings.length > MAX_WARNINGS) {
      this.memory.warnings = this.memory.warnings.slice(-MAX_WARNINGS);
    }
  }

  updateFileContext(
    path: string,
    data: { lastModified: string; lastAgent: string; summary: string; relatedFiles: string[] },
  ): void {
    this.memory.fileContext[path] = {
      path,
      ...data,
    };
    const keys = Object.keys(this.memory.fileContext);
    if (keys.length > MAX_FILE_CONTEXT) {
      const toRemove = keys.slice(0, keys.length - MAX_FILE_CONTEXT);
      for (const key of toRemove) {
        delete this.memory.fileContext[key];
      }
    }
  }

  updateAgentContext(
    agent: string,
    data: { lastActive: string; currentTask?: string; expertise: string[]; recentErrors: string[] },
  ): void {
    const key = normalizeName(agent);
    this.memory.agentContext[key] = {
      agent: key,
      ...data,
    };
    const keys = Object.keys(this.memory.agentContext);
    if (keys.length > MAX_AGENT_CONTEXT) {
      const toRemove = keys.slice(0, keys.length - MAX_AGENT_CONTEXT);
      for (const key of toRemove) {
        delete this.memory.agentContext[key];
      }
    }
  }

  addHandoffRecord(record: {
    id: string;
    from: string;
    to: string;
    task: string;
    timestamp: string;
    success: boolean;
    duration: number;
  }): void {
    this.memory.handoffHistory.push(record);
    if (this.memory.handoffHistory.length > 100) {
      this.memory.handoffHistory.splice(0, this.memory.handoffHistory.length - 100);
    }
  }

  compact(): void {
    const now = Date.now();
    if (now - new Date(this.memory.lastCompacted).getTime() < COMPACTION_INTERVAL_MS) return;

    const decay = (entries: MemoryEntry[]) => {
      const notExpired = entries.filter((e) => !e.expiresAt || safeParseTime(e.expiresAt) > now);
      if (!notExpired.some((e) => e.decayFactor < 0.95)) return notExpired;
      return notExpired.map((e) => ({ ...e, decayFactor: e.decayFactor * 0.95 })).filter((e) => e.decayFactor >= 0.1);
    };

    this.memory.decisions = decay(this.memory.decisions);
    this.memory.learnings = decay(this.memory.learnings);
    this.memory.warnings = decay(this.memory.warnings);
    this.memory.lastCompacted = new Date().toISOString();
  }
}