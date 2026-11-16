import { MAX_RECORDS_DEFAULT } from "./context/constants.ts";
import { normalizeName } from "./utils/name-utils.ts";

interface RoutingRecord {
  id: string;
  timestamp: number;
  agent: string;
  role: string;
  prompt: string;
  blocked: boolean;
  blockReason?: string;
  sessionId: string;
  outcome?: "success" | "failure" | "pending";
  _output?: string;
}

interface RoleStats {
  totalTasks: number;
  blockedCount: number;
  agentsUsed: Record<string, number>;
  successCount: number;
  failureCount: number;
  avgPromptLength: number;
}

interface EvaluatorStats {
  totalRecordings: number;
  byRole: Record<string, RoleStats>;
  byAgent: Record<string, number>;
  blockRate: number;
  topRoles: [string, RoleStats][];
  topAgents: [string, number][];
  lastHourActivity: number;
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
    agent: string;
    role: string;
    prompt: string;
    blocked: boolean;
    blockReason?: string;
    sessionId: string;
  }): void {
    const id = `R-${String(++this.recordSeq).padStart(6, "0")}`;
    this.records.push({
      id,
      timestamp: Date.now(),
      agent: entry.agent,
      role: entry.role,
      prompt: entry.prompt,
      blocked: entry.blocked,
      blockReason: entry.blockReason,
      sessionId: entry.sessionId,
      outcome: "pending",
    });
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
    this.invalidateStatsCache();
  }

  onRecordCreated(entry: {
    id?: string;
    timestamp: string | number;
    agent: string;
    specializations?: string[];
    title: string;
    detail: string;
  }): void {
    const id = `R-${String(++this.recordSeq).padStart(6, "0")}`;
    this.records.push({
      id: entry.id || id,
      timestamp: new Date(entry.timestamp).getTime(),
      agent: entry.agent,
      role: entry.specializations ? (entry.specializations[0] ?? "dev") : "dev",
      prompt: entry.title + " " + entry.detail,
      blocked: false,
      sessionId: "auto",
      outcome: "pending",
    });
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
    this.invalidateStatsCache();
  }

  markOutcome(id: string, outcome: "success" | "failure"): void {
    const record = this.records.find((r) => r.id === id);
    if (record) {
      record.outcome = outcome;
      this.invalidateStatsCache();
    }
  }

  markOutcomeByAgent(agent: string, outcome: "success" | "failure"): void {
    const normalized = normalizeName(agent);
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r && normalizeName(r.agent) === normalized && r.outcome === "pending") {
        r.outcome = outcome;
        this.invalidateStatsCache();
        return;
      }
    }
  }

  getStats(): EvaluatorStats {
    if (this._statsCache && this._statsCacheVersion === this._statsCurrentVersion) {
      return this._statsCache;
    }

    if (this.records.length === 0) {
      const empty: EvaluatorStats = {
        totalRecordings: 0,
        byRole: {},
        byAgent: {},
        blockRate: 0,
        topRoles: [],
        topAgents: [],
        lastHourActivity: 0,
      };
      this._statsCache = empty;
      this._statsCacheVersion = this._statsCurrentVersion;
      return empty;
    }

    const byRole: Record<string, RoleStats> = {};
    const byAgent: Record<string, number> = {};
    let blockedTotal = 0;
    const oneHourAgo = Date.now() - 3600000;
    let lastHourActivity = 0;

    for (const r of this.records) {
      if (!byRole[r.role]) {
        byRole[r.role] = {
          totalTasks: 0,
          blockedCount: 0,
          agentsUsed: {},
          successCount: 0,
          failureCount: 0,
          avgPromptLength: 0,
        };
      }
      byRole[r.role]!.totalTasks++;
      if (r.blocked) {
        byRole[r.role]!.blockedCount++;
        blockedTotal++;
      }
      if (r.agent) {
        byRole[r.role]!.agentsUsed[r.agent] = (byRole[r.role]!.agentsUsed[r.agent] || 0) + 1;
        byAgent[r.agent] = (byAgent[r.agent] || 0) + 1;
      }
      if (r.outcome === "success") byRole[r.role]!.successCount++;
      if (r.outcome === "failure") byRole[r.role]!.failureCount++;
      byRole[r.role]!.avgPromptLength = Math.round(
        (byRole[r.role]!.avgPromptLength * (byRole[r.role]!.totalTasks - 1) + r.prompt.length) /
          byRole[r.role]!.totalTasks,
      );

      if (r.timestamp > oneHourAgo) lastHourActivity++;
    }

    const topRoles = Object.entries(byRole)
      .sort(([, a], [, b]) => b.totalTasks - a.totalTasks)
      .slice(0, 10);

    const topAgents = Object.entries(byAgent)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    const stats: EvaluatorStats = {
      totalRecordings: this.records.length,
      byRole,
      byAgent,
      blockRate: Math.round((blockedTotal / this.records.length) * 100),
      topRoles,
      topAgents,
      lastHourActivity,
    };

    this._statsCache = stats;
    this._statsCacheVersion = this._statsCurrentVersion;

    return stats;
  }

  getRecords(): RoutingRecord[] {
    return [...this.records];
  }

  recordParallelEvaluation(
    entries: {
      agent: string;
      role: string;
      prompt: string;
      output: string;
      sessionId: string;
    }[],
  ): string[] {
    const ids: string[] = [];
    for (const entry of entries) {
      const id = `R-${String(++this.recordSeq).padStart(6, "0")}`;
      this.records.push({
        id,
        timestamp: Date.now(),
        agent: entry.agent,
        role: entry.role,
        prompt: entry.prompt,
        blocked: false,
        sessionId: entry.sessionId,
        outcome: "pending",
        _output: entry.output.slice(0, 1024),
      });
      ids.push(id);
    }
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
    this.invalidateStatsCache();
    return ids;
  }

  reset(): void {
    this.records = [];
    this.recordSeq = 0;
    this.invalidateStatsCache();
  }

  toJSON(): { records: RoutingRecord[] } {
    return { records: this.records };
  }

  restoreFrom(data: { records: RoutingRecord[] }): void {
    this.records = (data.records || []).slice(-this.maxRecords).map((r) => ({
      ...r,
      timestamp: r.timestamp || Date.now(),
      outcome: r.outcome || "pending",
    }));
    this.invalidateStatsCache();
  }
}
