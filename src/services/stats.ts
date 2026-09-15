import type { TeamStats, SmartAlert } from "../conflict-resolver/types.ts";
import { normalizeName } from "../utils/name-utils.ts";

type AgentStats = {
  agent: string;
  handoffsInitiated: number;
  handoffsCompleted: number;
  records: number;
  errors: number;
  avgResponseTime: number;
  lastActive: string;
};

const MAX_COMPLETIONS = 1000;
const MAX_AGENTS = 200;

export class StatsCollector {
  private agentStats: Map<string, AgentStats> = new Map();
  private agentOrder: string[] = [];
  private dailyCompletions: { timestamp: string; duration: number; success: boolean }[] = [];

  recordHandoff(agent: string, completed: boolean, duration: number): void {
    const stats = this.getOrCreate(agent);
    stats.handoffsInitiated++;
    if (completed) stats.handoffsCompleted++;
    stats.lastActive = new Date().toISOString();

    this.dailyCompletions.push({
      timestamp: new Date().toISOString(),
      duration,
      success: completed,
    });
    if (this.dailyCompletions.length > MAX_COMPLETIONS) {
      this.dailyCompletions.splice(0, this.dailyCompletions.length - MAX_COMPLETIONS);
    }
  }

  recordRecord(agent: string): void {
    const stats = this.getOrCreate(agent);
    stats.records++;
    stats.lastActive = new Date().toISOString();
  }

  recordError(agent: string): void {
    const stats = this.getOrCreate(agent);
    stats.errors++;
  }

  getTeamStats(agents: string[]): TeamStats {
    const activeAgents = agents.filter((a) => {
      const s = this.agentStats.get(normalizeName(a));
      return s && Date.now() - new Date(s.lastActive).getTime() < 60 * 60 * 1000;
    }).length;

    const today = this.dailyCompletions.filter((c) => {
      const d = new Date(c.timestamp);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    });

    const completedToday = today.filter((c) => c.success).length;
    const avgCompletionTime = today.length > 0 ? today.reduce((sum, c) => sum + c.duration, 0) / today.length : 0;

    const successRate = today.length > 0 ? today.filter((c) => c.success).length / today.length : 1;

    let topAgent = "";
    let topCompleted = 0;
    let bottleneckAgent = "";
    let maxErrors = 0;

    for (const [agent, stats] of this.agentStats.entries()) {
      if (stats.handoffsCompleted > topCompleted) {
        topCompleted = stats.handoffsCompleted;
        topAgent = agent;
      }
      if (stats.errors > maxErrors) {
        maxErrors = stats.errors;
        bottleneckAgent = agent;
      }
    }

    return {
      activeAgents,
      activeHandoffs: this.countActiveHandoffs(agents),
      completedToday,
      avgCompletionTime,
      successRate,
      topAgent,
      bottleneckAgent,
      recentErrors: [...this.agentStats.values()].reduce((sum, s) => sum + s.errors, 0),
    };
  }

  generateAlerts(stats: TeamStats): SmartAlert[] {
    const alerts: SmartAlert[] = [];

    if (stats.successRate < 0.7) {
      alerts.push({
        level: "critical",
        message: `Low success rate: ${(stats.successRate * 100).toFixed(0)}%`,
        action: "Inspect agents and identify issues",
      });
    }

    if (stats.recentErrors > 5) {
      alerts.push({
        level: "warning",
        message: `${stats.recentErrors} recent errors on the team`,
        action: "Review logs and determine the cause of errors",
      });
    }

    if (stats.bottleneckAgent) {
      alerts.push({
        level: "warning",
        message: `Agent ${stats.bottleneckAgent} is causing a bottleneck`,
        agent: stats.bottleneckAgent,
        action: "Review this agent's workload",
      });
    }

    return alerts;
  }

  getAgentStats(agent: string): AgentStats | undefined {
    return this.agentStats.get(normalizeName(agent));
  }

  private getOrCreate(agent: string): AgentStats {
    const key = normalizeName(agent);
    let stats = this.agentStats.get(key);
    if (!stats) {
      if (this.agentStats.size >= MAX_AGENTS) {
        const oldest = this.agentOrder.shift();
        if (oldest) this.agentStats.delete(oldest);
      }
      stats = {
        agent: key,
        handoffsInitiated: 0,
        handoffsCompleted: 0,
        records: 0,
        errors: 0,
        avgResponseTime: 0,
        lastActive: new Date().toISOString(),
      };
      this.agentStats.set(key, stats);
      if (!this.agentOrder.includes(key)) this.agentOrder.push(key);
    }
    return stats;
  }

  private countActiveHandoffs(agents: string[]): number {
    let count = 0;
    for (const agent of agents) {
      const stats = this.agentStats.get(normalizeName(agent));
      if (stats) count += stats.handoffsInitiated - stats.handoffsCompleted;
    }
    return Math.max(0, count);
  }
}