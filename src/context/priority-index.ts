



import type { ContextPriority, ScoredContextEntry, PriorityIndexStats } from "./priority-types.ts";
import { PRIORITY_ORDER, priorityWeight } from "./priority-types.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";

const MAX_ENTRIES = 2000;

export class PriorityIndex {
  byPriority = new Map<ContextPriority, Set<string>>();
  byAgent = new Map<string, Set<string>>();
  entries = new Map<string, ScoredContextEntry>();
  private _tokenBudget = 4096;

  get tokenBudget(): number {
    return this._tokenBudget;
  }

  set tokenBudget(v: number) {
    this._tokenBudget = v;
  }

  insert(entry: ScoredContextEntry): void {
    if (this.entries.size >= MAX_ENTRIES) {
      const cycles = this.detectCircularDeps();
      if (cycles.length > 0) {
        logger.warn(`${cycles.length} circular dep(s) detected at capacity`);
      }
      const lowest = this.findLowestPriority();
      if (lowest && lowest.score <= entry.score) {
        this.removeLowest();
      } else {
        return;
      }
    }
    this.entries.set(entry.id, entry);
    this.addToSet(this.byPriority, entry.priority, entry.id);
    if (entry.agent) {
      this.addToSet(this.byAgent, normalizeName(entry.agent), entry.id);
    }
  }

  delete(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    const pSet = this.byPriority.get(entry.priority);
    if (pSet) {
      pSet.delete(id);
      if (pSet.size === 0) this.byPriority.delete(entry.priority);
    }
    if (entry.agent) {
      const aSet = this.byAgent.get(normalizeName(entry.agent));
      if (aSet) {
        aSet.delete(id);
        if (aSet.size === 0) this.byAgent.delete(normalizeName(entry.agent));
      }
    }
    return true;
  }

  get(id: string): ScoredContextEntry | undefined {
    return this.entries.get(id);
  }

  getTopK(budget: number): ScoredContextEntry[] {
    const sorted = [...this.entries.values()].sort((a, b) => {
      const pa = priorityWeight(a.priority);
      const pb = priorityWeight(b.priority);
      if (pa !== pb) return pb - pa;
      return b.score - a.score;
    });

    const selected: ScoredContextEntry[] = [];
    const selectedIds = new Set<string>();
    let used = 0;

    
    
    const trySelectWithDeps = (entry: ScoredContextEntry, visiting: Set<string>): boolean => {
      if (selectedIds.has(entry.id)) return true;
      if (visiting.has(entry.id)) return false; 
      visiting.add(entry.id);

      
      for (const depId of entry.dependsOn) {
        if (selectedIds.has(depId)) continue;
        const dep = this.entries.get(depId);
        if (!dep) continue; 
        if (!trySelectWithDeps(dep, visiting)) {
          visiting.delete(entry.id);
          return false;
        }
      }

      
      const canFit = entry.protected || used + entry.tokens <= budget;
      if (!canFit) {
        visiting.delete(entry.id);
        return false;
      }

      selected.push(entry);
      selectedIds.add(entry.id);
      used += entry.tokens;
      visiting.delete(entry.id);
      return true;
    };

    for (const entry of sorted) {
      if (selectedIds.has(entry.id)) continue;
      trySelectWithDeps(entry, new Set<string>());
    }
    return selected;
  }

  getStats(): PriorityIndexStats {
    const byPriority: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let totalTokens = 0;
    let protectedCount = 0;

    for (const [p, s] of this.byPriority) {
      byPriority[p] = s.size;
    }
    for (const [a, s] of this.byAgent) {
      byAgent[a] = s.size;
    }
    for (const [, e] of this.entries) {
      totalTokens += e.tokens;
      if (e.protected) protectedCount++;
    }

    return {
      total: this.entries.size,
      byPriority,
      byAgent,
      totalTokens,
      protectedCount,
    };
  }

  clear(): void {
    this.byPriority.clear();
    this.byAgent.clear();
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  removeLowest(): ScoredContextEntry | undefined {
    const lowest = this.findLowestPriority();
    if (lowest) {
      this.delete(lowest.id);
    }
    return lowest;
  }

  private findLowestPriority(): ScoredContextEntry | undefined {
    let lowest: ScoredContextEntry | undefined;
    for (const p of [...PRIORITY_ORDER].reverse()) {
      const ids = this.byPriority.get(p);
      if (!ids || ids.size === 0) continue;
      for (const id of ids) {
        const entry = this.entries.get(id);
        if (!entry) continue;
        if (!lowest || entry.score < lowest.score) {
          lowest = entry;
        }
      }
      if (lowest) break;
    }
    return lowest;
  }

  private addToSet(map: Map<string, Set<string>>, key: string, id: string): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  }

  
  detectCircularDeps(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (id: string, path: string[]): void => {
      if (inStack.has(id)) {
        const cycleStart = path.indexOf(id);
        if (cycleStart >= 0) {
          cycles.push([...path.slice(cycleStart), id]);
        }
        return;
      }
      if (visited.has(id)) return;
      visited.add(id);
      inStack.add(id);
      path.push(id);

      const entry = this.entries.get(id);
      if (entry) {
        for (const dep of entry.dependsOn) {
          dfs(dep, path);
        }
      }
      path.pop();
      inStack.delete(id);
    };

    for (const id of this.entries.keys()) {
      if (!visited.has(id)) dfs(id, []);
    }
    return cycles;
  }
}
