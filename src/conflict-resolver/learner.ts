import type { SharedMemory, MemoryEntry, RuleDecision } from "./types.ts";
import { secureId } from "../utils/crypto.ts";
import { DEFAULT_CLASSIFIER_PARAMS, type ClassifierParams } from "./classifier.ts";
import { CORE_RULES } from "./rules.ts";

const DECAY_RATE = 0.95;
const MIN_IMPORTANCE = 0.1;
const MAX_LEARNINGS = 500;
const MAX_WARNINGS = 200;



const KNOWN_RULE_IDS = new Set<string>(CORE_RULES.map((r) => r.id));

function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export class ConflictLearner {
  private memory: SharedMemory;
  private _learningIndex = new Map<string, number>(); 
  
  private _ruleCounters = new Map<string, { acc: number; rej: number }>();

  constructor(memory: SharedMemory) {
    this.memory = memory;
    for (let i = 0; i < memory.learnings.length; i++) {
      const c = memory.learnings[i]!.content;
      this._learningIndex.set(typeof c === "string" ? c : JSON.stringify(c), i);
    }
    
    for (const l of memory.learnings) {
      const data = typeof l.content === "string" ? safeJsonParse(l.content) : (l.content as Record<string, unknown>);
      const rid = typeof data?.ruleId === "string" ? data.ruleId : null;
      if (!rid || !KNOWN_RULE_IDS.has(rid)) continue;
      const occ = typeof l.occurrences === "number" ? l.occurrences : 1;
      const cur = this._ruleCounters.get(rid) ?? { acc: 0, rej: 0 };
      if (data?.accepted === true) cur.acc += occ;
      else cur.rej += occ;
      this._ruleCounters.set(rid, cur);
    }
  }

  recordOutcome(ruleId: string, decision: RuleDecision, accepted: boolean, agent?: string): void {
    const entryData = {
      ruleId,
      action: decision.action,
      confidence: decision.confidence,
      accepted,
    };
    const contentKey = JSON.stringify(entryData);
    const tags = ["learning", decision.action, ruleId];
    const now = new Date().toISOString();

    const existingIdx = this._learningIndex.get(contentKey);

    if (existingIdx !== undefined && existingIdx < this.memory.learnings.length) {
      const existing = this.memory.learnings[existingIdx]!;
      existing.timestamp = now;
      existing.agent = agent || "system";
      existing.importance = accepted ? "high" : "medium";
      existing.decayFactor = 1;
      
      
      
      existing.occurrences = (existing.occurrences ?? 1) + 1;
    } else {
      const entry: MemoryEntry = {
        id: `learn-${Date.now()}-${secureId()}`,
        agent: agent || "system",
        timestamp: now,
        content: entryData,
        tags,
        importance: accepted ? "high" : "medium",
        decayFactor: 1,
        occurrences: 1,
      };
      if (this.memory.learnings.length >= MAX_LEARNINGS) {
        const oldest = this.memory.learnings.shift();
        if (oldest) {
          this._learningIndex.delete(
            typeof oldest.content === "string" ? oldest.content : JSON.stringify(oldest.content),
          );
          
          const od =
            typeof oldest.content === "string"
              ? safeJsonParse(oldest.content)
              : (oldest.content as Record<string, unknown>);
          const orid = typeof od?.ruleId === "string" ? od.ruleId : null;
          if (orid && KNOWN_RULE_IDS.has(orid)) {
            const occ = typeof oldest.occurrences === "number" ? oldest.occurrences : 1;
            const cur = this._ruleCounters.get(orid);
            if (cur) {
              if (od?.accepted === true) cur.acc = Math.max(0, cur.acc - occ);
              else cur.rej = Math.max(0, cur.rej - occ);
            }
          }
          
          this._learningIndex.clear();
          for (let i = 0; i < this.memory.learnings.length; i++) {
            const c = this.memory.learnings[i]!.content;
            this._learningIndex.set(typeof c === "string" ? c : JSON.stringify(c), i);
          }
        }
      }
      this._learningIndex.set(contentKey, this.memory.learnings.length);
      this.memory.learnings.push(entry);
    }
    
    if (KNOWN_RULE_IDS.has(ruleId)) {
      const cur = this._ruleCounters.get(ruleId) ?? { acc: 0, rej: 0 };
      if (accepted) cur.acc++;
      else cur.rej++;
      this._ruleCounters.set(ruleId, cur);
    }

    if (decision.action === "warn" && !accepted) {
      const warning: MemoryEntry = {
        id: `warn-${Date.now()}-${secureId()}`,
        agent: agent || "system",
        timestamp: new Date().toISOString(),
        content: `Agent ${agent} rejected warning from rule ${ruleId} — may need rule adjustment`,
        tags: ["warning", "rejected", ruleId],
        importance: "medium",
        decayFactor: 1,
      };
      this.memory.warnings.push(warning);
      if (this.memory.warnings.length > MAX_WARNINGS) {
        this.memory.warnings.splice(0, this.memory.warnings.length - MAX_WARNINGS);
      }
    }

    this.invalidateCache();
  }

  applyDecay(): void {
    const applyTo = (entries: MemoryEntry[]) => {
      for (const entry of entries) {
        entry.decayFactor *= DECAY_RATE;
      }
      return entries.filter((e) => e.decayFactor >= MIN_IMPORTANCE);
    };

    this.memory.learnings = applyTo(this.memory.learnings);
    this.memory.warnings = applyTo(this.memory.warnings);
    this.memory.decisions = applyTo(this.memory.decisions);

    
    this._learningIndex.clear();
    for (let i = 0; i < this.memory.learnings.length; i++) {
      const c = this.memory.learnings[i]!.content;
      this._learningIndex.set(typeof c === "string" ? c : JSON.stringify(c), i);
    }
  }

  getRuleEffectiveness(ruleId: string): { total: number; accepted: number; rejected: number; successRate: number } {
    
    const cur = this._ruleCounters.get(ruleId);
    if (cur) {
      const total = cur.acc + cur.rej;
      return { total, accepted: cur.acc, rejected: cur.rej, successRate: total > 0 ? cur.acc / total : 0 };
    }
    
    const relevant = this.memory.learnings.filter((l) => l.tags.includes(ruleId));
    let total = 0;
    let accepted = 0;
    for (const l of relevant) {
      const occurrences = typeof l.occurrences === "number" ? l.occurrences : 1;
      const data = typeof l.content === "string" ? safeJsonParse(l.content) : l.content;
      total += occurrences;
      if (data?.accepted === true) accepted += occurrences;
    }
    return {
      total,
      accepted,
      rejected: total - accepted,
      successRate: total > 0 ? accepted / total : 0,
    };
  }

  suggestRuleAdjustment(ruleId: string): { disable: boolean; adjustPriority?: number } | null {
    const stats = this.getRuleEffectiveness(ruleId);

    if (stats.total >= 5 && stats.successRate < 0.3) {
      return { disable: true };
    }

    if (stats.total >= 5 && stats.successRate < 0.5) {
      return { disable: false, adjustPriority: 99 };
    }

    return null;
  }

  
  getClassifierParams(): Partial<ClassifierParams> {
    const out: Partial<ClassifierParams> = {};

    const map: Record<string, { feature: keyof ClassifierParams; min: number; max: number }> = {
      "PROTECT-001": { feature: "agentBusy", min: 0.3, max: 0.7 },
      "PROTECT-002": { feature: "fileConflict", min: 0.3, max: 0.7 },
      "PROTECT-003": { feature: "errorCount", min: 2, max: 4 },
      
      
      
      "QUEUE-001": { feature: "activeHandoffs", min: 1, max: 4 },
    };

    for (const [ruleId, spec] of Object.entries(map)) {
      const stats = this.getRuleEffectiveness(ruleId);
      if (stats.total < 5) continue; 
      const base = DEFAULT_CLASSIFIER_PARAMS[spec.feature];
      
      const t = (stats.accepted - stats.rejected) / stats.total; 
      const clamped = Math.max(-1, Math.min(1, t));
      
      
      const delta = clamped * (clamped >= 0 ? base - spec.min : spec.max - base);
      const adjusted = Math.max(spec.min, Math.min(spec.max, base - delta));
      out[spec.feature] = adjusted;
    }

    return out;
  }

  private cachedAdjustments: { ruleId: string; disable: boolean; adjustPriority?: number }[] | null = null;
  private lastCheckTime = 0;
  private readonly CACHE_TTL = 5000; 

  checkAllRules(): { ruleId: string; disable: boolean; adjustPriority?: number }[] {
    const now = Date.now();
    if (this.cachedAdjustments && now - this.lastCheckTime < this.CACHE_TTL) {
      return this.cachedAdjustments;
    }

    const ruleIds = new Set<string>();
    for (const entry of this.memory.learnings) {
      for (const tag of entry.tags) {
        
        
        
        if (KNOWN_RULE_IDS.has(tag)) ruleIds.add(tag);
      }
    }

    const adjustments: { ruleId: string; disable: boolean; adjustPriority?: number }[] = [];
    for (const ruleId of ruleIds) {
      const adjustment = this.suggestRuleAdjustment(ruleId);
      if (adjustment) {
        adjustments.push({ ruleId, ...adjustment });
      }
    }

    this.cachedAdjustments = adjustments;
    this.lastCheckTime = now;
    return adjustments;
  }

  invalidateCache(): void {
    this.cachedAdjustments = null;
    this.lastCheckTime = 0;
  }

  getState(): SharedMemory {
    return this.memory;
  }

  restoreState(memory: SharedMemory): void {
    this.memory = memory;
  }

  clearMemory(): void {
    this.memory.decisions.length = 0;
    this.memory.learnings.length = 0;
    this.memory.warnings.length = 0;
    for (const key of Object.keys(this.memory.fileContext)) {
      delete this.memory.fileContext[key];
    }
    for (const key of Object.keys(this.memory.agentContext)) {
      delete this.memory.agentContext[key];
    }
    this.memory.handoffHistory.length = 0;
  }
}
