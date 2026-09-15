import type { ModelHealth } from "../services/proxy-selector.ts";
import { EventHub } from "../services/event-hub.ts";
import { logger } from "../utils/logger.ts";
import { betaMean, betaCIExact, ucbTerm } from "./beta-stats.ts";
import { normalizeName } from "../utils/name-utils.ts";

export interface BetaDistribution {
  alpha: number;
  beta: number;
}

export interface AgentPerformance {
  agent: string;
  taskType: string;
  distribution: BetaDistribution;
  avgResponseTime: number;
  totalRoutings: number;
  lastRouted: number;
  trend: "improving" | "stable" | "degrading";
  recentOutcomes: boolean[];
}

export interface PredictionResult {
  agent: string;
  successProbability: number;
  marginOfError: number;
  confidenceLower: number;
  confidenceUpper: number;
  confidenceLevel: "high" | "medium" | "low";
  avgResponseTime: number;
  sampleSize: number;
  reason: string;
  trend: "improving" | "stable" | "degrading";
  ucb?: number;
}

export interface RoutingDecision {
  selectedAgent: string;
  allPredictions: PredictionResult[];
  isFallback: boolean;
  excludedAgents: string[];
  timestamp: number;
  decisionConfidence: number;
}

export interface RoutingRequest {
  taskDescription: string;
  availableAgents: string[];
  excludeAgents?: string[];
  explicitTaskType?: string;
  preferences?: Record<string, string>;
  modelHealth?: Map<string, ModelHealth>;
  maxAcceptableResponseTime?: number;
}

export class PredictiveRouter {
  private performanceData: Map<string, Map<string, AgentPerformance>> = new Map();
  private explorationFactor: number = 0.15;
  private trendWindowSize: number = 10;
  private decisionHistory: RoutingDecision[] = [];
  private maxDecisionHistory: number = 500;
  private static readonly MAX_PERFORMANCE_AGENTS = 500;
  private lastReportedProbability: Map<string, number> = new Map();
  private totalRoutings: number = 0;
  private eventHub: EventHub;

  constructor(explorationFactor?: number, eventHub?: EventHub) {
    this.explorationFactor = explorationFactor ?? 0.15;
    this.eventHub = eventHub ?? new EventHub();
  }

  classifyTask(taskDescription: string): string {
    const lower = taskDescription.toLowerCase();

    const patterns: [RegExp, string][] = [
      [/bug|fix|fix|error|fault|defect|correction|issue|problem/, "bugfix"],
      [/test|spec|check|examine|verify|validate|quality|assess|trial/, "testing"],
      [/review|audit|inspect|scrutinize|examine|inspection|check/, "review"],
      [/feature|add|create|implement|develop|capability|new|build|establish|program|construct/, "feature"],
      [/doc|readme|explain|document|guide|manual|reference|description/, "documentation"],
      [/refactor|improve|enhance|restructure|reorganize|update|upgrade/, "refactor"],
      [/analyze|examine|evaluate|assess|review|appraise|compare|study|requirements/, "analysis"],
      [/design|create|layout|ui|ux|interface|interface|wireframe/, "design"],
    ];

    for (const [regex, category] of patterns) {
      if (regex.test(lower)) {
        return category;
      }
    }

    return "general";
  }

  private bayesianUpdate(distribution: BetaDistribution, success: boolean): BetaDistribution {
    return {
      alpha: distribution.alpha + (success ? 1 : 0),
      beta: distribution.beta + (success ? 0 : 1),
    };
  }

  private calculateTrend(recentOutcomes: boolean[]): "improving" | "stable" | "degrading" {
    if (recentOutcomes.length < 4) return "stable";

    const mid = Math.floor(recentOutcomes.length / 2);
    const firstHalf = recentOutcomes.slice(0, mid);
    const secondHalf = recentOutcomes.slice(mid);

    const firstMean = firstHalf.filter(Boolean).length / firstHalf.length;
    const secondMean = secondHalf.filter(Boolean).length / secondHalf.length;

    const diff = secondMean - firstMean;
    if (diff > 0.2) return "improving";
    if (diff < -0.2) return "degrading";
    return "stable";
  }

  recordOutcome(agent: string, taskDescription: string, success: boolean, responseTime?: number): void {
    const taskType = this.classifyTask(taskDescription);
    const key = normalizeName(agent);

    let agentData = this.performanceData.get(key);
    if (!agentData) {
      agentData = new Map();
      if (this.performanceData.size >= PredictiveRouter.MAX_PERFORMANCE_AGENTS) {
        const oldest = this.performanceData.keys().next().value;
        if (oldest !== undefined) this.performanceData.delete(oldest);
      }
      this.performanceData.set(key, agentData);
    }

    let perf = agentData.get(taskType);
    if (!perf) {
      perf = {
        agent,
        taskType,
        distribution: { alpha: 1, beta: 1 },
        avgResponseTime: 0,
        totalRoutings: 0,
        lastRouted: Date.now(),
        trend: "stable",
        recentOutcomes: [],
      };
      agentData.set(taskType, perf);
    }

    perf.distribution = this.bayesianUpdate(perf.distribution, success);
    perf.totalRoutings++;
    this.totalRoutings++;
    perf.lastRouted = Date.now();

    if (responseTime !== undefined) {
      const oldAvg = perf.avgResponseTime;
      const n = perf.totalRoutings;
      perf.avgResponseTime = oldAvg + (responseTime - oldAvg) / n;
    }

    perf.recentOutcomes.push(success);
    if (perf.recentOutcomes.length > this.trendWindowSize) {
      perf.recentOutcomes = perf.recentOutcomes.slice(-this.trendWindowSize);
    }

    perf.trend = this.calculateTrend(perf.recentOutcomes);

    const currentProb = betaMean(perf.distribution.alpha, perf.distribution.beta);
    const lastProb = this.lastReportedProbability.get(key);
    if (lastProb === undefined || currentProb < lastProb * 0.9) {
      this.lastReportedProbability.set(key, currentProb);
      this.eventHub.emit({
        type: "PERFORMANCE_DEGRADED",
        agent,
        metric: "success_probability",
        value: currentProb,
      });
    }
  }

  predict(request: RoutingRequest): RoutingDecision {
    const {
      taskDescription,
      availableAgents,
      excludeAgents = [],
      explicitTaskType,
      modelHealth,
      maxAcceptableResponseTime,
    } = request;

    const taskType = explicitTaskType ?? this.classifyTask(taskDescription);
    const excluded = excludeAgents.map(normalizeName);

    const healthyAgents = availableAgents.filter((agent) => {
      const normalizedAgent = normalizeName(agent);
      if (excluded.includes(normalizedAgent)) return false;

      if (modelHealth) {
        const health = modelHealth.get(normalizedAgent);
        if (health && health.state === "OPEN") {
          excluded.push(normalizedAgent);
          return false;
        }
      }

      return true;
    });

    if (healthyAgents.length === 0) {
      if (availableAgents.length === 0) {
        return {
          selectedAgent: "unknown",
          allPredictions: [],
          isFallback: false,
          excludedAgents: excluded,
          timestamp: Date.now(),
          decisionConfidence: 0,
        };
      }
      const fallbackAgent = availableAgents.find((a) => !excluded.includes(a)) ?? availableAgents[0] ?? "unknown";
      return {
        selectedAgent: fallbackAgent,
        allPredictions: [],
        isFallback: true,
        excludedAgents: excluded,
        timestamp: Date.now(),
        decisionConfidence: 0,
      };
    }

    const predictions: PredictionResult[] = [];
    const preferredAgent = request.preferences?.[taskType];

    for (const agent of healthyAgents) {
      const agentData = this.performanceData.get(normalizeName(agent));
      const perf = agentData?.get(taskType);

      if (!perf || perf.totalRoutings === 0) {
        predictions.push({
          agent,
          successProbability: 0.5 + this.explorationFactor,
          marginOfError: 0.4,
          confidenceLower: 0.1,
          confidenceUpper: 0.9,
          confidenceLevel: "low",
          avgResponseTime: 0,
          sampleSize: 0,
          reason: `New agent/task type — exploration (exploration factor: ${this.explorationFactor})`,
          trend: "stable",
          ucb: Infinity,
        });
        continue;
      }

      const { alpha, beta } = perf.distribution;
      const mean = betaMean(alpha, beta);
      const ci = betaCIExact(alpha, beta, 0.95);
      const ucb = mean + ucbTerm(perf.totalRoutings, this.totalRoutings);

      const totalSamples = alpha + beta - 2;
      let confidenceLevel: "high" | "medium" | "low";
      if (totalSamples >= 20) confidenceLevel = "high";
      else if (totalSamples >= 6) confidenceLevel = "medium";
      else confidenceLevel = "low";

      let responseTimeNote = "";
      if (maxAcceptableResponseTime && perf.avgResponseTime > maxAcceptableResponseTime) {
        responseTimeNote = ` (response time ${perf.avgResponseTime}ms exceeds limit ${maxAcceptableResponseTime}ms)`;
      }

      const trendNote =
        perf.trend === "degrading"
          ? ` — trend: degrading (last ${perf.recentOutcomes.length} tasks)`
          : perf.trend === "improving"
            ? ` — trend: improving`
            : "";

      predictions.push({
        agent,
        successProbability: mean,
        marginOfError: ci.marginOfError,
        confidenceLower: ci.lower,
        confidenceUpper: ci.upper,
        confidenceLevel,
        avgResponseTime: perf.avgResponseTime,
        sampleSize: perf.totalRoutings,
        reason:
          `Beta(${alpha.toFixed(1)}, ${beta.toFixed(1)}) — E[P] = ${(mean * 100).toFixed(1)}%` +
          `, 95% CI [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]` +
          `, n=${perf.totalRoutings}` +
          responseTimeNote +
          trendNote,
        trend: perf.trend,
        ucb,
      });
    }

    predictions.sort((a, b) => (b.ucb ?? -Infinity) - (a.ucb ?? -Infinity));

    if (preferredAgent) {
      const prefIdx = predictions.findIndex((p) => p.agent === preferredAgent);
      if (prefIdx !== -1) {
        const [pref] = predictions.splice(prefIdx, 1) as [PredictionResult];
        predictions.unshift(pref);
      }
    }

    const bestPrediction = predictions[0];
    if (!bestPrediction) {
      return {
        selectedAgent: healthyAgents[0] ?? "unknown",
        allPredictions: [],
        isFallback: false,
        excludedAgents: excluded,
        timestamp: Date.now(),
        decisionConfidence: 0,
      };
    }

    const secondBest = predictions[1];
    let decisionConfidence: number;
    if (secondBest) {
      decisionConfidence = Math.min(1, (bestPrediction.successProbability - secondBest.successProbability) * 3);
    } else {
      decisionConfidence = 0.8;
    }

    const decision: RoutingDecision = {
      selectedAgent: bestPrediction.agent,
      allPredictions: predictions,
      isFallback: false,
      excludedAgents: excluded,
      timestamp: Date.now(),
      decisionConfidence,
    };

    this.decisionHistory.push(decision);
    if (this.decisionHistory.length > this.maxDecisionHistory) {
      this.decisionHistory = this.decisionHistory.slice(-this.maxDecisionHistory);
    }

    return decision;
  }

  getPrediction(agent: string, taskDescription: string): PredictionResult | null {
    const taskType = this.classifyTask(taskDescription);
    const agentData = this.performanceData.get(normalizeName(agent));
    const perf = agentData?.get(taskType);

    if (!perf) return null;

    const { alpha, beta } = perf.distribution;
    const mean = betaMean(alpha, beta);
    const ci = betaCIExact(alpha, beta, 0.95);

    const totalSamples = alpha + beta - 2;
    let confidenceLevel: "high" | "medium" | "low";
    if (totalSamples >= 20) confidenceLevel = "high";
    else if (totalSamples >= 6) confidenceLevel = "medium";
    else confidenceLevel = "low";

    return {
      agent,
      successProbability: mean,
      marginOfError: ci.marginOfError,
      confidenceLower: ci.lower,
      confidenceUpper: ci.upper,
      confidenceLevel,
      avgResponseTime: perf.avgResponseTime,
      sampleSize: perf.totalRoutings,
      reason: `Beta(${alpha.toFixed(1)}, ${beta.toFixed(1)}) — E[P]=${(mean * 100).toFixed(1)}%, n=${perf.totalRoutings}`,
      trend: perf.trend,
    };
  }

  getAllPerformance(): AgentPerformance[] {
    const result: AgentPerformance[] = [];
    for (const agentData of this.performanceData.values()) {
      for (const perf of agentData.values()) {
        result.push(perf);
      }
    }
    return result;
  }

  getDecisionHistory(): RoutingDecision[] {
    return [...this.decisionHistory];
  }

  reset(): void {
    this.performanceData.clear();
    this.decisionHistory = [];
    this.totalRoutings = 0;
  }

  exportData(): string {
    const data = {
      performance: this.getAllPerformance(),
      explorationFactor: this.explorationFactor,
      totalRoutings: this.totalRoutings,
      exportedAt: Date.now(),
    };
    return JSON.stringify(data);
  }

  importData(json: string): void {
    try {
      const data = JSON.parse(json);
      if (data.totalRoutings !== undefined && typeof data.totalRoutings === "number") {
        this.totalRoutings = data.totalRoutings;
      }
      if (data.performance && Array.isArray(data.performance)) {
        for (const perf of data.performance) {
          const perfKey = normalizeName(perf.agent);
          let agentData = this.performanceData.get(perfKey);
          if (!agentData) {
            agentData = new Map();
            this.performanceData.set(perfKey, agentData);
          }
          agentData.set(perf.taskType, {
            agent: perf.agent,
            taskType: perf.taskType,
            distribution: perf.distribution,
            avgResponseTime: perf.avgResponseTime,
            totalRoutings: perf.totalRoutings,
            lastRouted: perf.lastRouted,
            trend: perf.trend,
            recentOutcomes: perf.recentOutcomes,
          });
        }
      }
    } catch (e) {
      logger.error("Failed to import data:", e);
    }
    if (!this.totalRoutings) {
      let sum = 0;
      for (const agentData of this.performanceData.values()) {
        for (const perf of agentData.values()) sum += perf.totalRoutings;
      }
      this.totalRoutings = sum;
    }
  }
}
