

import crypto from "node:crypto";
import { normalizeName } from "../../utils/name-utils.ts";
import type { PredictiveRouter, RoutingRequest, RoutingDecision } from "../../features/predictive-router.ts";
import type { CollectiveMemoryStoreImpl } from "./store.js";
import type { UsagePattern } from "./types.js";




export interface RoutingMemory {
  
  taskType: string;

  
  agent: string;

  
  success: boolean;

  
  responseTimeMs: number;

  
  userPreference?: string;

  
  userId: string;

  
  timestamp: string;
}


export interface MemoryPrediction {
  
  agent: string;

  
  confidence: number;

  
  source: "collective_memory" | "bayesian" | "hybrid";

  
  reason: string;
}



export class CollectiveMemoryRouterIntegration {
  private memory: CollectiveMemoryStoreImpl;
  private router: PredictiveRouter;
  private lastDecayTime = 0;
  private static readonly DECAY_INTERVAL_MS = 300_000; 

  constructor(memory: CollectiveMemoryStoreImpl, router: PredictiveRouter) {
    this.memory = memory;
    this.router = router;
  }

  
  learnFromRouting(
    decision: RoutingDecision,
    request: RoutingRequest,
    success: boolean,
    responseTimeMs: number,
    userId: string = "default",
  ): void {
    const taskType = this.router.classifyTask(request.taskDescription);
    const agent = decision.selectedAgent;

    
    this.memory.addPattern({
      type: "agent_routing",
      description: `Routing task type "${taskType}" to agent "${agent}"`,
      successRate: success ? 1 : 0,
      userIds: [userId],
      tags: ["routing", taskType, agent, success ? "success" : "failure"],
      metadata: {
        taskType,
        agent,
        success,
        responseTimeMs,
        decisionConfidence: decision.decisionConfidence,
      },
    });

    
    this.memory.addMemory({
      patternId: this.getPatternId(taskType, agent),
      content: JSON.stringify({
        taskType,
        agent,
        success,
        responseTimeMs,
        userId,
      }),
      source: "agent_learning",
      provenance: "agent_inferred",
      confidence: success ? 0.8 : 0.3,
      tags: ["routing", taskType, agent],
      classification: "shared",
    });
  }

  
  getMemoryPrediction(
    taskType: string,
    availableAgents: string[],
    _userId: string = "default",
  ): MemoryPrediction | null {
    
    const patterns = this.memory.findSimilarPatterns(`routing ${taskType}`, 20);

    if (patterns.length === 0) {
      return null;
    }

    
    const relevantPatterns = patterns.filter((p) => {
      const meta = p.metadata;
      return (meta?.taskType as string | undefined) === taskType && availableAgents.includes(meta?.agent as string);
    });

    if (relevantPatterns.length === 0) {
      return null;
    }

    
    const agentScores = new Map<string, { score: number; count: number }>();

    for (const pattern of relevantPatterns) {
      const meta = pattern.metadata;
      const agent = meta?.agent as string | undefined;
      const success = meta?.success as boolean | undefined;
      const agentKey = normalizeName(agent ?? "unknown");

      if (!agent || !agentScores.has(agentKey)) {
        agentScores.set(agentKey, { score: 0, count: 0 });
      }

      const entry = agentScores.get(agentKey)!;
      entry.count++;
      entry.score += success ? pattern.weight : 0;
    }

    
    let bestAgent = "";
    let bestScore = 0;

    for (const [agent, { score, count }] of agentScores) {
      const avgScore = count > 0 ? score / count : 0;
      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestAgent = agent;
      }
    }

    if (!bestAgent) {
      return null;
    }

    return {
      agent: bestAgent,
      confidence: bestScore,
      source: "collective_memory",
      reason: `Based on ${relevantPatterns.length} similar routing patterns`,
    };
  }

  
  getHybridPrediction(
    taskType: string,
    availableAgents: string[],
    userId: string = "default",
  ): MemoryPrediction | null {
    
    const memoryPrediction = this.getMemoryPrediction(taskType, availableAgents, userId);

    if (!memoryPrediction) {
      return null;
    }

    
    const boostedConfidence = Math.min(1, memoryPrediction.confidence * 1.2);

    return {
      agent: memoryPrediction.agent,
      confidence: boostedConfidence,
      source: "hybrid",
      reason: `Collective Memory prediction boosted by Bayesian prior`,
    };
  }

  
  getRoutingPatterns(taskType?: string): UsagePattern[] {
    const patterns = this.memory.getPatternsByType("agent_routing");

    if (taskType) {
      return patterns.filter((p) => {
        const meta = p.metadata;
        return (meta?.taskType as string | undefined) === taskType;
      });
    }

    return patterns;
  }

  
  getRoutingStats(): {
    totalRoutings: number;
    successRate: number;
    avgResponseTimeMs: number;
    topAgents: Array<{ agent: string; successRate: number; count: number }>;
  } {
    const patterns = this.memory.getPatternsByType("agent_routing");

    let totalSuccess = 0;
    let totalResponseTime = 0;
    let totalCount = 0;

    const agentStats = new Map<string, { success: number; total: number; responseTime: number }>();

    for (const pattern of patterns) {
      const meta = pattern.metadata;
      if (!meta) continue;

      const agent = meta.agent as string | undefined;
      const success = meta.success as boolean | undefined;
      const responseTime = (meta.responseTimeMs as number) || 0;

      if (!agent || success === undefined) continue;

      if (!agentStats.has(agent)) {
        agentStats.set(agent, { success: 0, total: 0, responseTime: 0 });
      }

      const stats = agentStats.get(agent)!;
      stats.total += pattern.frequency;
      if (success) stats.success += pattern.frequency;
      stats.responseTime += responseTime * pattern.frequency;

      totalSuccess += success ? pattern.frequency : 0;
      totalResponseTime += responseTime * pattern.frequency;
      totalCount += pattern.frequency;
    }

    
    const topAgents = Array.from(agentStats.entries())
      .map(([agent, stats]) => ({
        agent,
        successRate: stats.total > 0 ? stats.success / stats.total : 0,
        count: stats.total,
      }))
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 5);

    return {
      totalRoutings: totalCount,
      successRate: totalCount > 0 ? totalSuccess / totalCount : 0,
      avgResponseTimeMs: totalCount > 0 ? totalResponseTime / totalCount : 0,
      topAgents,
    };
  }

  
  recordRoutingOutcome(agent: string, success: boolean, taskType?: string): void {
    this.memory.addPattern({
      type: "agent_routing",
      description: `Agent ${agent} ${success ? "succeeded" : "failed"}`,
      successRate: success ? 0.9 : 0.1,
      userIds: [],
      tags: ["routing", agent, success ? "success" : "failure", taskType ?? "unknown"].filter(Boolean),
      metadata: {
        agent,
        success,
        taskType: taskType ?? "unknown",
        timestamp: new Date().toISOString(),
      },
    });

    this.memory.addMemory({
      patternId: `routing-${crypto
        .createHash("sha256")
        .update(`${agent}:${taskType ?? "unknown"}:${Date.now()}`)
        .digest("hex")
        .slice(0, 16)}`,
      content: `Routing outcome: ${agent} ${success ? "success" : "failure"} (${taskType ?? "unknown"})`,
      source: "agent_learning",
      provenance: "agent_inferred",
      confidence: success ? 0.8 : 0.3,
      tags: ["routing", agent, success ? "success" : "failure"],
      classification: "shared",
    });
    if (Date.now() - this.lastDecayTime > CollectiveMemoryRouterIntegration.DECAY_INTERVAL_MS) {
      this.memory.applyDecay(0.5);
      this.lastDecayTime = Date.now();
    }
  }

  
  private getPatternId(taskType: string, agent: string): string {
    const existing = this.memory.findSimilarPatterns(`routing ${taskType} to ${agent}`, 1);
    if (existing.length > 0) {
      return existing[0]!.id;
    }
    return `routing-${taskType}-${agent}`;
  }
}




export function createMemoryRouterIntegration(
  memory: CollectiveMemoryStoreImpl,
  router: PredictiveRouter,
): CollectiveMemoryRouterIntegration {
  return new CollectiveMemoryRouterIntegration(memory, router);
}
