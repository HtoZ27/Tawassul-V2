

import crypto from "node:crypto";
import { logger } from "../../utils/logger.ts";
import { BaseInnovationService } from "../base-innovation-service.ts";
import { computeTextRelevance, tokenize } from "../../lib/classifier.ts";

const MAX_LOAD_PATTERNS = 10_000;
const MAX_LOAD_MEMORIES = 50_000;
const MAX_SCAN_ITEMS = 20_000;


const MIN_RELEVANCE_SCORE = 0.1;


const MAX_DERIVED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function safeParseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function isExpired(expiresAt: string | undefined | null): boolean {
  if (!expiresAt) return false;
  const d = safeParseDate(expiresAt);
  return d !== null && d < new Date();
}

import type {
  UsagePattern,
  MemoryEntry,
  CollectiveMemoryStore as ICollectiveMemoryStore,
  MemoryStats,
  MemoryQuery,
  MemoryQueryResult,
  MemoryConfig,
  MemoryEvent,
} from "./types.js";
import {
  UsagePatternSchema,
  MemoryEntrySchema,
  MemoryConfigSchema,
  generatePatternId,
  generateMemoryId,
} from "./types.js";
import type { ExecutionReport } from "../../types/plan.types.ts";



export class CollectiveMemoryStoreImpl
  extends BaseInnovationService<MemoryConfig, MemoryEvent>
  implements ICollectiveMemoryStore
{
  
  
  
  private projectKey: string;

  
  static setProjectKey(_dir: string): void {
    logger.warn(
      "[collective-memory] CollectiveMemoryStoreImpl.setProjectKey is deprecated — pass projectKey via constructor config instead (e.g. new CollectiveMemoryStoreImpl({ projectKey: dir }))",
    );
  }

  
  private scopedId(id: string): string {
    if (!this.projectKey) return id;
    const prefix = `${this.projectKey}:`;
    
    if (id.startsWith(prefix)) return id;
    return `${prefix}${id}`;
  }

  
  private stripOldPrefix(id: string): string {
    if (!this.projectKey) return id;
    const prefix = `${this.projectKey}:`;
    if (id.startsWith(prefix)) return id;
    const colonIdx = id.indexOf(":");
    if (colonIdx !== -1) return id.slice(colonIdx + 1);
    return id;
  }

  private patterns: Map<string, UsagePattern> = new Map();
  private memories: Map<string, MemoryEntry> = new Map();
  private lastPersisted: number = 0;

  
  private tagIndex: Map<string, Set<string>> = new Map();

  private indexMemory(memory: MemoryEntry): void {
    for (const tag of memory.tags) {
      let set = this.tagIndex.get(tag);
      if (!set) {
        set = new Set();
        this.tagIndex.set(tag, set);
      }
      set.add(memory.id);
    }
  }

  private rebuildTagIndex(): void {
    this.tagIndex.clear();
    for (const memory of this.memories.values()) {
      this.indexMemory(memory);
    }
  }

  constructor(config?: Partial<MemoryConfig>) {
    super(config, MemoryConfigSchema);
    this.projectKey = this.config.projectKey ?? "";
    if (!this.projectKey) {
      logger.warn("[collective-memory] projectKey empty — isolation disabled (no prefix)");
    }
  }

  
  addPattern(pattern: Omit<UsagePattern, "id" | "frequency" | "weight" | "lastSeen" | "firstSeen">): UsagePattern {
    const now = new Date().toISOString();

    
    const existing = this.findSimilarPattern(pattern);

    if (existing) {
      
      existing.frequency += 1;
      existing.weight = Math.min(1, existing.weight + 0.05);
      existing.lastSeen = now;

      
      for (const userId of pattern.userIds) {
        if (!existing.userIds.includes(userId)) {
          existing.userIds.push(userId);
        }
      }

      this.emitEvent({
        type: "pattern_updated",
        payload: { patternId: existing.id, frequency: existing.frequency },
        source: "collective-memory",
        timestamp: now,
      });

      return existing;
    }

    
    const newPattern: UsagePattern = {
      ...pattern,
      id: generatePatternId(),
      frequency: 1,
      weight: 0.5,
      lastSeen: now,
      firstSeen: now,
    };

    this.patterns.set(newPattern.id, newPattern);
    this.trimPatterns();

    this.emitEvent({
      type: "pattern_detected",
      payload: { patternId: newPattern.id, type: newPattern.type },
      source: "collective-memory",
      timestamp: now,
    });

    return newPattern;
  }

  
  updatePattern(id: string, updates: Partial<UsagePattern>): UsagePattern | null {
    const pattern = this.patterns.get(id);
    if (!pattern) return null;

    const updated = { ...pattern, ...updates, id: pattern.id };
    this.patterns.set(id, updated);

    this.emitEvent({
      type: "pattern_updated",
      payload: { patternId: id, updates },
      source: "collective-memory",
      timestamp: new Date().toISOString(),
    });

    return updated;
  }

  
  getPatternsByType(type: UsagePattern["type"]): UsagePattern[] {
    return Array.from(this.patterns.values()).filter((p) => p.type === type);
  }

  
  findSimilarPatterns(query: string, limit: number = 10): UsagePattern[] {
    const scored: Array<{ pattern: UsagePattern; score: number }> = [];
    let scanned = 0;

    for (const pattern of this.patterns.values()) {
      if (++scanned > MAX_SCAN_ITEMS) break;
      const textScore = computeTextRelevance(query, pattern.description, pattern.tags);

      
      let metaScore = 0;
      if (pattern.metadata) {
        const metaStr = JSON.stringify(pattern.metadata);
        metaScore = computeTextRelevance(query, metaStr);
      }

      let score = textScore * 0.6 + metaScore * 0.4;

      
      score *= pattern.weight * Math.log(pattern.frequency + 1);

      if (score > 0) {
        scored.push({ pattern, score });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.pattern);
  }

  
  private findSimilarPattern(
    pattern: Omit<UsagePattern, "id" | "frequency" | "weight" | "lastSeen" | "firstSeen">,
  ): UsagePattern | null {
    for (const existing of this.patterns.values()) {
      if (existing.type !== pattern.type) continue;

      
      if (existing.description === pattern.description) {
        return existing;
      }

      
      const overlap = existing.tags.filter((t) => pattern.tags.includes(t));
      if (overlap.length > 0 && overlap.length >= existing.tags.length * 0.5) {
        return existing;
      }
    }
    return null;
  }

  
  addMemory(memory: Omit<MemoryEntry, "id" | "retrievalCount" | "createdAt">): MemoryEntry {
    const now = new Date().toISOString();

    const newMemory: MemoryEntry = {
      ...memory,
      
      provenance: memory.provenance ?? "agent_inferred",
      
      
      expiresAt:
        memory.expiresAt ??
        new Date(Date.now() + Math.min(this.config.retentionMs ?? 0, MAX_DERIVED_TTL_MS)).toISOString(),
      id: generateMemoryId(),
      retrievalCount: 0,
      createdAt: now,
    };

    const scopedNew = { ...newMemory, id: this.scopedId(newMemory.id) };
    this.memories.set(scopedNew.id, scopedNew);
    this.indexMemory(scopedNew);
    this.trimMemories();

    this.emitEvent({
      type: "memory_created",
      payload: { memoryId: newMemory.id, source: newMemory.source },
      source: "collective-memory",
      timestamp: now,
    });

    return newMemory;
  }

  
  retrieveMemories(query: string, limit: number = 10): MemoryEntry[] {
    
    
    const topK: Array<{ memory: MemoryEntry; score: number }> = [];
    let scanned = 0;
    let minTop = 0;
    let truncated = false;

    const consider = (memory: MemoryEntry): boolean => {
      if (isExpired(memory.expiresAt)) return false;
      const textScore = computeTextRelevance(query, memory.content, memory.tags);
      const score = textScore * memory.confidence * (1 + Math.log(memory.retrievalCount + 1));
      if (score <= MIN_RELEVANCE_SCORE) return false;
      if (topK.length === limit && score <= minTop) return false;
      topK.push({ memory, score });
      topK.sort((a, b) => b.score - a.score);
      if (topK.length > limit) topK.pop();
      minTop = topK.length === limit ? topK[topK.length - 1]!.score : 0;
      return false;
    };

    
    
    
    const queryTokens = tokenize(query);
    const taggedSets = queryTokens.map((t) => this.tagIndex.get(t)).filter((s): s is Set<string> => !!s && s.size > 0);
    const fullyTagged = taggedSets.length === queryTokens.length;

    if (fullyTagged) {
      const ids = new Set<string>();
      for (const set of taggedSets) for (const id of set) ids.add(id);
      for (const id of ids) {
        if (++scanned > MAX_SCAN_ITEMS) {
          truncated = true;
          break;
        }
        const memory = this.memories.get(id);
        if (!memory || isExpired(memory.expiresAt)) continue;
        const tagHits = memory.tags.filter((t) => queryTokens.includes(t)).length;
        const score = (tagHits / queryTokens.length) * memory.confidence * (1 + Math.log(memory.retrievalCount + 1));
        if (score <= MIN_RELEVANCE_SCORE) continue;
        if (topK.length === limit && score <= minTop) continue;
        topK.push({ memory, score });
        topK.sort((a, b) => b.score - a.score);
        if (topK.length > limit) topK.pop();
        minTop = topK.length === limit ? topK[topK.length - 1]!.score : 0;
      }
    } else {
      for (const memory of this.memories.values()) {
        if (++scanned > MAX_SCAN_ITEMS) {
          truncated = true;
          break;
        }
        consider(memory);
      }
    }

    
    
    if (truncated) {
      logger.warn(
        `[collective-memory] retrieveMemories hit MAX_SCAN_ITEMS (${MAX_SCAN_ITEMS}) while the store holds ${this.memories.size} memories — results may omit relevant memories`,
      );
    }

    const results = topK.map((s) => s.memory);

    
    for (const memory of results) {
      memory.retrievalCount += 1;
      memory.lastRetrieved = new Date().toISOString();

      this.emitEvent({
        type: "memory_retrieved",
        payload: { memoryId: memory.id, query },
        source: "collective-memory",
        timestamp: new Date().toISOString(),
      });
    }

    return results;
  }

  
  applyDecay(factor?: number): void {
    const decayFactor = factor ?? this.config.decayFactor;
    const now = new Date();
    let expiredCount = 0;

    
    for (const pattern of this.patterns.values()) {
      const lastSeen = safeParseDate(pattern.lastSeen);
      if (!lastSeen) continue;
      const daysSinceLastSeen = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);

      
      const timeDecay = Math.pow(decayFactor, daysSinceLastSeen);
      pattern.weight *= timeDecay;

      
      if (pattern.weight < this.config.minConfidenceThreshold) {
        this.patterns.delete(pattern.id);
      }
    }

    
    for (const memory of this.memories.values()) {
      if (isExpired(memory.expiresAt)) {
        this.memories.delete(memory.id);
        expiredCount++;
      }
    }
    this.rebuildTagIndex();

    if (expiredCount > 0) {
      this.emitEvent({
        type: "memory_expired",
        payload: { count: expiredCount },
        source: "collective-memory",
        timestamp: now.toISOString(),
      });
    }

    this.emitEvent({
      type: "decay_applied",
      payload: { factor: decayFactor, patternsRemaining: this.patterns.size },
      source: "collective-memory",
      timestamp: now.toISOString(),
    });
  }

  
  getStats(): MemoryStats {
    const patterns = Array.from(this.patterns.values());
    const memories = Array.from(this.memories.values());

    const totalWeight = patterns.reduce((sum, p) => sum + p.weight, 0);
    const averageWeight = patterns.length > 0 ? totalWeight / patterns.length : 0;

    const highConfidencePatterns = patterns.filter((p) => p.weight > 0.8).length;
    const expiredMemories = memories.filter((m) => isExpired(m.expiresAt)).length;

    return {
      totalPatterns: patterns.length,
      totalMemories: memories.length,
      averageWeight,
      highConfidencePatterns,
      expiredMemories,
      lastPersisted: this.lastPersisted > 0 ? new Date(this.lastPersisted).toISOString() : undefined,
    };
  }

  
  async persist(): Promise<void> {
    if (this.patterns.size > MAX_LOAD_PATTERNS || this.memories.size > MAX_LOAD_MEMORIES) {
      logger.warn(
        `[memory] trimming before persist: ${this.patterns.size} patterns / ${this.memories.size} memories exceeds limit`,
      );
      this.trimPatterns();
      this.trimMemories();
    }
    this.persistToDisk("collective-memory", () => ({
      patterns: Array.from(this.patterns.values()),
      memories: Array.from(this.memories.values()),
    }));
    this.lastPersisted = Date.now();
    this.emitEvent({
      type: "stats_updated",
      payload: this.getStats(),
      source: "collective-memory",
      timestamp: new Date().toISOString(),
    });
  }

  
  async load(): Promise<void> {
    const data = await this.readFromDisk<{
      version: string;
      persistedAt: string;
      patterns: UsagePattern[];
      memories: MemoryEntry[];
    }>();

    if (!data) return;

    
    if (data.patterns && Array.isArray(data.patterns)) {
      const limited = data.patterns.slice(0, MAX_LOAD_PATTERNS);
      for (const pattern of limited) {
        try {
          const validated = UsagePatternSchema.parse(pattern);
          this.patterns.set(validated.id, validated);
        } catch (e) {
          logger.warn("Invalid pattern, skipping:", e);
        }
      }
    }

    
    if (data.memories && Array.isArray(data.memories)) {
      const limited = data.memories.slice(0, MAX_LOAD_MEMORIES);
      for (const memory of limited) {
        try {
          const validated = MemoryEntrySchema.parse(memory);
          const rawId = this.stripOldPrefix(validated.id);
          const scopedValidated = { ...validated, id: this.scopedId(rawId) };
          this.memories.set(scopedValidated.id, scopedValidated);
        } catch (e) {
          logger.warn("Invalid memory, skipping:", e);
        }
      }
      this.rebuildTagIndex();
    }

    logger.info(`Loaded ${this.patterns.size} patterns, ${this.memories.size} memories`);
  }

  
  query(query: MemoryQuery): MemoryQueryResult {
    const startTime = Date.now();
    let patterns = Array.from(this.patterns.values());
    let memories = Array.from(this.memories.values());

    
    if (query.type) {
      patterns = patterns.filter((p) => p.type === query.type);
    }

    
    if (query.source) {
      memories = memories.filter((m) => m.source === query.source);
    }

    
    
    if (query.tags && query.tags.length > 0) {
      const ids = new Set<string>();
      for (const tag of query.tags) {
        const set = this.tagIndex.get(tag);
        if (set) {
          for (const id of set) ids.add(id);
        }
      }
      if (ids.size > 0) {
        memories = memories.filter((m) => ids.has(m.id));
      } else {
        memories = memories.filter((m) => m.tags.some((t) => query.tags!.includes(t)));
      }
    }

    
    if (query.minConfidence !== undefined) {
      patterns = patterns.filter((p) => p.weight >= query.minConfidence!);
      memories = memories.filter((m) => m.confidence >= query.minConfidence!);
    }

    
    if (query.minFrequency !== undefined) {
      patterns = patterns.filter((p) => p.frequency >= query.minFrequency!);
    }

    
    if (query.since) {
      const since = safeParseDate(query.since);
      if (since) {
        patterns = patterns.filter((p) => {
          const d = safeParseDate(p.firstSeen);
          return d && d >= since;
        });
        memories = memories.filter((m) => {
          const d = safeParseDate(m.createdAt);
          return d && d >= since;
        });
      }
    }

    if (query.until) {
      const until = safeParseDate(query.until);
      if (until) {
        patterns = patterns.filter((p) => {
          const d = safeParseDate(p.lastSeen);
          return d && d <= until;
        });
        memories = memories.filter((m) => {
          const d = safeParseDate(m.createdAt);
          return d && d <= until;
        });
      }
    }

    
    const orderBy = query.orderBy || "relevance";
    if (orderBy === "frequency") {
      patterns.sort((a, b) => b.frequency - a.frequency);
    } else if (orderBy === "recency") {
      patterns.sort((a, b) => {
        const da = safeParseDate(a.lastSeen);
        const db = safeParseDate(b.lastSeen);
        return (db?.getTime() ?? 0) - (da?.getTime() ?? 0);
      });
      memories.sort((a, b) => {
        const da = safeParseDate(a.createdAt);
        const db = safeParseDate(b.createdAt);
        return (db?.getTime() ?? 0) - (da?.getTime() ?? 0);
      });
    } else if (orderBy === "confidence") {
      patterns.sort((a, b) => b.weight - a.weight);
      memories.sort((a, b) => b.confidence - a.confidence);
    }

    
    const limit = query.limit || 50;
    const truncated = patterns.length > limit || memories.length > limit;
    patterns = patterns.slice(0, limit);
    memories = memories.slice(0, limit);

    return {
      patterns,
      memories,
      total: patterns.length + memories.length,
      queryTimeMs: Date.now() - startTime,
      truncated,
    };
  }

  
  private trimPatterns(): void {
    if (this.patterns.size <= this.config.maxPatterns) return;

    
    const sorted = Array.from(this.patterns.values()).sort((a, b) => b.weight - a.weight);

    const toKeep = sorted.slice(0, this.config.maxPatterns);
    this.patterns.clear();
    for (const pattern of toKeep) {
      this.patterns.set(pattern.id, pattern);
    }
  }

  
  private trimMemories(): void {
    if (this.memories.size <= this.config.maxMemories) return;

    
    const sorted = Array.from(this.memories.values()).sort((a, b) => {
      const scoreA = a.confidence * (1 + Math.log(a.retrievalCount + 1));
      const scoreB = b.confidence * (1 + Math.log(b.retrievalCount + 1));
      return scoreB - scoreA;
    });

    const toKeep = sorted.slice(0, this.config.maxMemories);
    this.memories.clear();
    for (const memory of toKeep) {
      const rawId = this.stripOldPrefix(memory.id);
      const scopedMemory = { ...memory, id: this.scopedId(rawId) };
      this.memories.set(scopedMemory.id, scopedMemory);
    }
    this.rebuildTagIndex();
  }

  
  getSize(): { patterns: number; memories: number } {
    return {
      patterns: this.patterns.size,
      memories: this.memories.size,
    };
  }

  
  clear(): void {
    this.patterns.clear();
    this.memories.clear();
    this.tagIndex.clear();
  }

  recordExecution(taskId: string, result: ExecutionReport): void {
    this.addPattern({
      type: "workflow_sequence",
      description: `task execution ${taskId}`,
      successRate: result.status === "success" ? 1 : result.status === "partial" ? 0.5 : 0,
      tags: ["execution", taskId],
      userIds: [],
      metadata: { status: result.status, subtaskCount: result.subtasks.length },
    });
    this.addMemory({
      patternId: crypto.randomUUID(),
      
      
      content: JSON.stringify({
        status: result.status,
        subtaskCount: result.subtasks.length,
        resultCount: result.results.length,
        errorCount: result.results.filter((r) => r.error).length,
      }),
      source: "agent_learning",
      provenance: "tool_observed",
      confidence: 0.5,
      tags: ["execution"],
      classification: "private",
    });
  }

  recordPattern(errorCategory: string, frequency: number): void {
    this.addPattern({
      type: "error_recovery",
      description: `error pattern: ${errorCategory}`,
      successRate: 0,
      tags: ["error", errorCategory],
      userIds: [],
      metadata: { category: errorCategory, frequency },
    });
  }
}



const _storeInstances = new Map<string, CollectiveMemoryStoreImpl>();

export function getCollectiveMemoryStore(config?: Partial<MemoryConfig>): CollectiveMemoryStoreImpl {
  const key = config?.projectKey ?? "default";
  let s = _storeInstances.get(key);
  if (!s) {
    s = new CollectiveMemoryStoreImpl(config);
    _storeInstances.set(key, s);
  }
  return s;
}

export function resetCollectiveMemoryStore(): void {
  for (const s of _storeInstances.values()) s.clear();
  _storeInstances.clear();
}
