import { normalizeName } from "../utils/name-utils.ts";

const MAX_RECORDS_DEFAULT = 200;

interface RoutingRecord {
  id: string;
  timestamp: number;
  role: string;
  agent: string;
  outcome: "success" | "failure" | "pending";
  blocked: boolean;
}

interface EvaluatorStats {
  totalRecords: number;
  byRole: Record<string, { count: number; successCount: number; failureCount: number }>;
  blockedCount: number;
  lastHourActivity: number;
  agentCounts: Record<string, number>;
}

export class TrainingEvaluator {
  private records: RoutingRecord[] = [];
  private recordSeq = 0;
  private maxRecords = MAX_RECORDS_DEFAULT;
  private _statsCache: EvaluatorStats | null = null;
  private _statsCacheVersion = 0;
  private _statsCurrentVersion = 0;

  private invalidateStatsCache(): void {
    this._statsCurrentVersion++;
  }

  record(entry: {
    role: string;
    agent?: string;
  }): string {
    this._statsCache = null;
    const id = `r-${Date.now()}-${++this.recordSeq}`;
    this.records.push({
      id,
      timestamp: Date.now(),
      role: entry.role,
      agent: entry.agent ?? "",
      outcome: "pending",
      blocked: false,
    });
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    return id;
  }

  onRecordCreated(entry: {
    id: string;
    role: string;
    agent?: string;
  }): void {
    this._statsCache = null;
    this.records.push({
      id: entry.id,
      timestamp: Date.now(),
      role: entry.role,
      agent: entry.agent ?? "",
      outcome: "pending",
      blocked: false,
    });
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }

  markOutcome(id: string, outcome: "success" | "failure"): void {
    const record = this.records.find((r) => r.id === id);
    if (record) {
      record.outcome = outcome;
    }
    this.invalidateStatsCache();
  }

  markOutcomeByAgent(agent: string, outcome: "success" | "failure"): void {
    const normalized = normalizeName(agent);
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r && normalizeName(r.agent) === normalized && r.outcome === "pending") {
        r.outcome = outcome;
        break;
      }
    }
    this.invalidateStatsCache();
  }

  getStats(): EvaluatorStats {
    if (this._statsCache && this._statsCacheVersion === this._statsCurrentVersion) {
      return this._statsCache;
    }
    if (this.records.length === 0) {
      return {
        totalRecords: 0,
        byRole: {},
        blockedCount: 0,
        lastHourActivity: 0,
        agentCounts: {},
      };
    }
    const byRole: Record<string, { count: number; successCount: number; failureCount: number }> = {};
    const agentCounts: Record<string, number> = {};
    let blockedCount = 0;
    let lastHourActivity = 0;
    const oneHourAgo = Date.now() - 3600000;
    for (const r of this.records) {
      if (!byRole[r.role]) {
        byRole[r.role] = { count: 0, successCount: 0, failureCount: 0 };
      }
      byRole[r.role]!.count++;
      if (r.blocked) {
        blockedCount++;
      }
      if (r.agent) {
        agentCounts[r.agent] = (agentCounts[r.agent] ?? 0) + 1;
      }
      if (r.outcome === "success") byRole[r.role]!.successCount++;
      if (r.outcome === "failure") byRole[r.role]!.failureCount++;
      if (r.timestamp > oneHourAgo) lastHourActivity++;
    }
    const stats: EvaluatorStats = {
      totalRecords: this.records.length,
      byRole,
      blockedCount,
      lastHourActivity,
      agentCounts,
    };
    this._statsCache = stats;
    this._statsCacheVersion = this._statsCurrentVersion;
    return stats;
  }

  getRecords(): RoutingRecord[] {
    return [...this.records];
  }

  recordParallelEvaluation(
    entries: Array<{
      role: string;
      agent: string;
      outcome: "success" | "failure";
      blocked?: boolean;
    }>,
  ): void {
    this._statsCache = null;
    for (const entry of entries) {
      this.records.push({
        id: `r-${Date.now()}-${++this.recordSeq}`,
        timestamp: Date.now(),
        role: entry.role,
        agent: entry.agent,
        outcome: entry.outcome,
        blocked: entry.blocked ?? false,
      });
    }
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }

  reset(): void {
    this.records = [];
    this.recordSeq = 0;
    this._statsCache = null;
    this._statsCacheVersion = 0;
    this._statsCurrentVersion = 0;
  }

  toJSON(): { records: RoutingRecord[] } {
    return { records: this.records };
  }

  restoreFrom(data: { records: RoutingRecord[] }): void {
    this.records = data.records ?? [];
    this.invalidateStatsCache();
  }
}