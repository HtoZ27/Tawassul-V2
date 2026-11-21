










import type { AgentStatus } from "./agent-health.ts";
import { resolveRole } from "../utils/agent.ts";
import { normalizeName } from "../utils/name-utils.ts";

type CapInfo = { agent: string; capabilities: string[]; successRates: Record<string, number>; lastUpdated: string };



export interface AgentMatchResult {
  agent: string;
  score: number; 
  breakdown: {
    roleMatch: number;
    specializationMatch: number;
    performanceScore: number;
    availabilityScore: number;
    errorPenalty: number;
  };
  reason: string;
  
  confidenceWidth?: number;
}

export interface MatchRequest {
  task: string;
  preferredRole?: string;
  specializations: string[];
  excludeAgents?: string[];
  requireAvailability?: boolean;
}



export class AgentMatcher {
  constructor(
    private getAgentStatuses: () => AgentStatus[],
    private getAgentStats: (agent: string) =>
      | {
          handoffsCompleted: number;
          errors: number;
          avgResponseTime: number;
        }
      | undefined,
    private getAgentCapabilities: (agent: string) => string[],
    private getAgentSpecializations: (agent: string) => string[],
    private getCapabilitySuccessRate?: (agent: string, capability: string) => number,
    private getPredictedSuccess?: (
      agent: string,
      taskDescription: string,
    ) => { successProbability: number; confidenceLevel: string } | null,
    private getAgentScore?: (agent: string) => number,
    private getAllCapabilities?: () => CapInfo[],
    private isAgentUnavailable?: (agent: string) => boolean,
    private getAgentScoreWithCI?: (agent: string) => { mean: number; lower: number; upper: number } | null,
    private getKnownAgents?: () => string[],
  ) {}

  private candidateStatuses(): AgentStatus[] {
    const statuses = this.getAgentStatuses();
    const known = this.getKnownAgents?.() ?? [];
    if (known.length === 0) return statuses;
    const knownNames = new Set(known.map(normalizeName));
    const byName = new Map(
      statuses
        .map((status) => [normalizeName(status.agent), status] as const)
        .filter(([key]) => knownNames.has(key)),
    );
    for (const agent of known) {
      const key = normalizeName(agent);
      if (byName.has(key)) continue;
      byName.set(key, {
        agent: key,
        lastActive: Date.now(),
        pendingCount: 0,
        acceptedCount: 0,
        completedCount: 0,
        failedCount: 0,
        state: "HEALTHY" as AgentStatus["state"],
        stuckSince: null,
        autoPausedSince: null,
      });
    }
    return [...byName.values()];
  }

  private preferDerivedVariants(statuses: AgentStatus[]): AgentStatus[] {
    const derivedRoles = new Set<string>();
    for (const status of statuses) {
      if (!this.isAgentAvailable(status)) continue;
      const role = resolveRole(status.agent);
      if (role !== null && normalizeName(status.agent) !== role) derivedRoles.add(role);
    }
    if (derivedRoles.size === 0) return statuses;
    return statuses.filter((status) => {
      const role = resolveRole(status.agent);
      return role === null || normalizeName(status.agent) !== role || !derivedRoles.has(role);
    });
  }

  
  findBestAgents(request: MatchRequest, topN: number = 3): AgentMatchResult[] {
    const allAgents = this.candidateStatuses();
    
    
    const capMap = this.getAllCapabilities ? new Map(this.getAllCapabilities().map((c) => [c.agent, c])) : null;
    const candidates: AgentMatchResult[] = [];

    const eligible: AgentStatus[] = [];
    for (const status of allAgents) {
      if (request.excludeAgents?.some((ea) => normalizeName(ea) === normalizeName(status.agent))) continue;
      if (request.requireAvailability && !this.isAgentAvailable(status)) continue;
      if (this.isAgentUnavailable?.(status.agent)) continue;
      eligible.push(status);
    }
    for (const status of this.preferDerivedVariants(eligible)) {
      candidates.push(this.scoreAgent(status, request, capMap ?? undefined));
    }

    
    
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        (a.confidenceWidth ?? Infinity) - (b.confidenceWidth ?? Infinity) ||
        a.agent.localeCompare(b.agent),
    );
    return candidates.slice(0, topN);
  }

  
  findBestAgent(request: MatchRequest): AgentMatchResult | null {
    const results = this.findBestAgents(request, 1);
    return results.length > 0 ? results[0]! : null;
  }

  
  private isAgentStuck(status: AgentStatus): boolean {
    return status.state === "STUCK" || status.state === "AUTO_PAUSED";
  }

  
  private isAgentAvailable(status: AgentStatus): boolean {
    return !this.isAgentStuck(status) && status.pendingCount < 3;
  }

  
  private scoreAgent(status: AgentStatus, request: MatchRequest, capMap?: Map<string, CapInfo>): AgentMatchResult {
    const agent = status.agent;
    const stats = this.getAgentStats(agent);
    const capabilities = capMap?.get(agent)?.capabilities ?? this.getAgentCapabilities(agent);
    const agentSpecs = this.getAgentSpecializations(agent);

    
    const roleStr = resolveRole(status.agent) ?? normalizeName(status.agent);
    const requested = request.preferredRole ? normalizeName(request.preferredRole) : "";
    const roleMatch = request.preferredRole
      ? normalizeName(status.agent) === requested || roleStr === requested
        ? 1.0
        : this.rolesRelated(roleStr, requested)
          ? 0.6
          : 0.2
      : 0.5; 

    
    let specializationMatch = 0.5; 
    if (request.specializations.length > 0 && agentSpecs.length > 0) {
      const matchingSpecs = request.specializations.filter((s) => agentSpecs.includes(s) || capabilities.includes(s));
      specializationMatch =
        matchingSpecs.length > 0 ? Math.min(1.0, matchingSpecs.length / request.specializations.length) : 0.2;
    } else if (request.specializations.length > 0) {
      
      const matchingCaps = request.specializations.filter((s) => capabilities.includes(s));
      specializationMatch =
        matchingCaps.length > 0 ? Math.min(1.0, matchingCaps.length / request.specializations.length) : 0.15;
    }

    
    
    
    
    
    
    const signals: { value: number; weight: number }[] = [];
    if (stats && stats.handoffsCompleted + stats.errors > 0) {
      signals.push({
        value: stats.handoffsCompleted / (stats.handoffsCompleted + stats.errors),
        weight: 0.4,
      });
    } else {
      
      signals.push({ value: 0.4, weight: 0.4 });
    }
    if (this.getCapabilitySuccessRate && request.preferredRole) {
      const capRate = this.getCapabilitySuccessRate(status.agent, request.preferredRole);
      if (capRate !== 0.5) {
        
        signals.push({ value: capRate, weight: 0.3 });
      }
    }
    if (this.getPredictedSuccess && request.task) {
      const prediction = this.getPredictedSuccess(status.agent, request.task);
      if (prediction && prediction.confidenceLevel !== "low") {
        signals.push({ value: prediction.successProbability, weight: 0.2 });
      }
    }
    if (this.getAgentScore) {
      const agg = this.getAgentScore(agent);
      if (agg !== 0.5) {
        
        signals.push({ value: agg, weight: 0.1 });
      }
    }
    const signalWeightSum = signals.reduce((s, x) => s + x.weight, 0);
    const performanceScore =
      signalWeightSum > 0
        ? Math.max(0, Math.min(1, signals.reduce((s, x) => s + x.value * x.weight, 0) / signalWeightSum))
        : 0.5;

    
    const loadScore = 1.0 - status.pendingCount * 0.25; 
    const healthPenalty = this.isAgentStuck(status) ? 0.5 : 0;
    const availabilityScore = Math.max(0, Math.min(1.0, loadScore - healthPenalty));

    
    const errorPenalty = Math.min(0.5, status.failedCount * 0.1);

    
    const weights = {
      roleMatch: request.preferredRole ? 0.3 : 0.1,
      specializationMatch: request.specializations.length > 0 ? 0.3 : 0.15,
      performanceScore: 0.2,
      availabilityScore: 0.3,
      errorPenalty: 0.1,
    };

    
    const weightSum =
      weights.roleMatch + weights.specializationMatch + weights.performanceScore + weights.availabilityScore;
    const norm = (w: number) => w / weightSum;

    const score =
      roleMatch * norm(weights.roleMatch) +
      specializationMatch * norm(weights.specializationMatch) +
      performanceScore * norm(weights.performanceScore) +
      availabilityScore * norm(weights.availabilityScore) -
      errorPenalty * norm(weights.errorPenalty);

    
    
    
    const finalScore = score;

    
    const parts: string[] = [];
    if (request.preferredRole) {
      parts.push(`Role: ${roleMatch >= 0.8 ? "OK" : roleMatch >= 0.5 ? "~" : "X"} (${(roleMatch * 100).toFixed(0)}%)`);
    }
    if (request.specializations.length > 0) {
      parts.push(
        `Specialization: ${specializationMatch >= 0.6 ? "OK" : specializationMatch >= 0.3 ? "~" : "X"} (${(specializationMatch * 100).toFixed(0)}%)`,
      );
    }
    parts.push(`Performance: ${(performanceScore * 100).toFixed(0)}%`);
    parts.push(`Available: ${(availabilityScore * 100).toFixed(0)}%`);
    if (errorPenalty > 0) parts.push(`Errors: -${(errorPenalty * 100).toFixed(0)}%`);

    
    
    
    
    let confidenceWidth: number | undefined;
    if (this.getAgentScoreWithCI) {
      const ci = this.getAgentScoreWithCI(agent);
      const width = ci ? ci.upper - ci.lower : 0;
      if (width > 0) confidenceWidth = width;
    }

    return {
      agent,
      score: Math.max(0, Math.min(1.0, finalScore)),
      breakdown: {
        roleMatch,
        specializationMatch,
        performanceScore,
        availabilityScore,
        errorPenalty,
      },
      reason: parts.join(" | "),
      ...(confidenceWidth !== undefined ? { confidenceWidth } : {}),
    };
  }

  
  private static RELATED_SET = new Set<string>([
    "dev|tester",
    "tester|dev",
    "dev|architect",
    "architect|dev",
    "reviewer|analyst",
    "analyst|reviewer",
    "analyst|architect",
    "architect|analyst",
    "dev|doc",
    "doc|dev",
    "tester|reviewer",
    "reviewer|tester",
  ]);

  
  private rolesRelated(a: string, b: string): boolean {
    return (this.constructor as typeof AgentMatcher).RELATED_SET.has(`${a}|${b}`);
  }

  
  suggestParallelTeam(primaryRole: string, _specializations: string[]): string[] {
    const allAgents = this.candidateStatuses();

    
    const roleMap = new Map<string, { agent: string; score: number }>();

    const eligible = allAgents.filter((status) => this.isAgentAvailable(status));
    for (const status of this.preferDerivedVariants(eligible)) {
      const role = resolveRole(status.agent) ?? normalizeName(status.agent);

      const existing = roleMap.get(role);
      const availScore = 1.0 - status.pendingCount * 0.25;
      if (!existing || availScore > existing.score) {
        roleMap.set(role, { agent: status.agent, score: availScore });
      }
    }

    
    const team: string[] = [];
    const preferred = roleMap.get(primaryRole);
    if (preferred) team.push(preferred.agent);

    
    const complementary = this.getComplementaryRoles(primaryRole);
    for (const compRole of complementary) {
      if (team.length >= 4) break;
      const comp = roleMap.get(compRole);
      if (comp && !team.some((t) => normalizeName(t) === normalizeName(comp.agent))) {
        team.push(comp.agent);
      }
    }

    return team;
  }

  private getComplementaryRoles(role: string): string[] {
    const MAP: Record<string, string[]> = {
      dev: ["tester", "reviewer", "doc"],
      tester: ["dev", "reviewer"],
      reviewer: ["dev", "tester"],
      analyst: ["architect", "dev"],
      architect: ["dev", "tester"],
      doc: ["reviewer", "dev"],
    };
    return MAP[role] ?? ["dev", "tester"];
  }
}
