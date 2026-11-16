

import { logger } from "../../utils/logger.ts";
import { BaseInnovationService, createSingleton } from "../base-innovation-service.ts";
import type { TrustComponents, TrustReport, TrustScoreHistory, TrustConfig, TrustCalculationConfig } from "./types.js";
import {
  TrustScoreHistorySchema,
  TrustConfigSchema,
  calculateOverallScore,
  getTrustLevel,
  generateRecommendations,
  generateWarnings,
  calculateTrend,
  sampleThompsonWeights,
} from "./types.js";
import type { TrustOutcomePriors } from "./types.js";
import { normalizeName } from "../../utils/name-utils.ts";

export type TrustWeightComponent = "successRate" | "responseTime" | "outputQuality" | "errorRate" | "memoryEfficiency";



export class TrustScoreCalculator extends BaseInnovationService<TrustConfig, never> {
  private history: Map<string, TrustScoreHistory[]> = new Map();
  private thompsonPriors = new Map<string, Record<TrustWeightComponent, TrustOutcomePriors>>();

  constructor(config?: Partial<TrustConfig>) {
    super(config, TrustConfigSchema);
  }

  
  recordTaskOutcome(
    agentId: string,
    outcome: {
      success: boolean;
      successRate?: number;
      avgResponseTimeMs?: number;
      avgOutputQuality?: number;
      memoryEfficiency?: number;
    },
  ): void {
    const key = normalizeName(agentId);
    const base = this.thompsonPriors.get(key) ?? {
      successRate: { successes: 0, failures: 0 },
      responseTime: { successes: 0, failures: 0 },
      outputQuality: { successes: 0, failures: 0 },
      errorRate: { successes: 0, failures: 0 },
      memoryEfficiency: { successes: 0, failures: 0 },
    };

    const good = (v: number | undefined, threshold: number): boolean =>
      v === undefined ? outcome.success : v >= threshold;

    if (good(outcome.successRate, 0.7)) base.successRate.successes++;
    else base.successRate.failures++;
    if (good(outcome.avgResponseTimeMs, 15000) && outcome.avgResponseTimeMs !== undefined)
      base.responseTime.successes++;
    else if (outcome.avgResponseTimeMs !== undefined) base.responseTime.failures++;
    else if (outcome.success) base.responseTime.successes++;
    else base.responseTime.failures++;
    if (good(outcome.avgOutputQuality, 0.7)) base.outputQuality.successes++;
    else base.outputQuality.failures++;
    if (outcome.success) base.errorRate.failures++;
    else base.errorRate.successes++;
    if (outcome.memoryEfficiency !== undefined) {
      if (good(outcome.memoryEfficiency, 0.5)) base.memoryEfficiency.successes++;
      else base.memoryEfficiency.failures++;
    } else if (outcome.success) base.memoryEfficiency.successes++;
    else base.memoryEfficiency.failures++;

    this.thompsonPriors.set(key, base);
  }

  
  private sampledWeights(agentId: string): TrustCalculationConfig["weights"] {
    const priors = this.thompsonPriors.get(normalizeName(agentId));
    if (!priors) return this.config.calculation.weights;
    return sampleThompsonWeights(priors, this.config.calculation);
  }

  
  evaluate(agentId: string, agentName: string, components: TrustComponents): TrustReport {
    const agentHistory = this.history.get(normalizeName(agentId)) || [];
    return this.buildReport(agentId, agentName, components, agentHistory, true);
  }

  private buildReport(
    agentId: string,
    agentName: string,
    components: TrustComponents,
    agentHistory: TrustScoreHistory[],
    record: boolean,
  ): TrustReport {
    const now = new Date().toISOString();

    
    
    const overallScore = calculateOverallScore(components, {
      ...this.config.calculation,
      weights: this.sampledWeights(agentId),
    });

    
    const level = getTrustLevel(overallScore);

    
    const key = normalizeName(agentId);

    if (record) {
      const historyEntry: TrustScoreHistory = {
        agentId,
        timestamp: now,
        score: overallScore,
        components,
        taskCount: components.completedTasks,
      };

      agentHistory.push(historyEntry);

      if (agentHistory.length > this.config.calculation.historyLimit) {
        agentHistory.splice(0, agentHistory.length - this.config.calculation.historyLimit);
      }

      this.history.set(key, agentHistory);
    }

    
    const trend = calculateTrend(agentHistory);

    
    const explanations = this.generateExplanations(components, overallScore, level);

    
    const recommendations = generateRecommendations(components, level);

    
    const warnings = generateWarnings(components, level);

    
    const report: TrustReport = {
      agentId,
      agentName,
      overallScore,
      components,
      level,
      beta: this.config.beta,
      explanations,
      lastUpdated: now,
      firstEvaluated: agentHistory[0]?.timestamp || now,
      evaluationCount: agentHistory.length,
      trend,
      recommendations,
      warnings,
    };

    return report;
  }

  
  private generateExplanations(
    components: TrustComponents,
    overallScore: number,
    level: TrustReport["level"],
  ): Record<string, string> {
    const explanations: Record<string, string> = {};

    
    if (components.successRate >= 0.9) {
      explanations.successRate = `Excellent success rate (${(components.successRate * 100).toFixed(1)}%) — agent completes most tasks successfully`;
    } else if (components.successRate >= 0.7) {
      explanations.successRate = `Good success rate (${(components.successRate * 100).toFixed(1)}%) — agent completes most tasks but has some failures`;
    } else if (components.successRate >= 0.5) {
      explanations.successRate = `Moderate success rate (${(components.successRate * 100).toFixed(1)}%) — agent fails frequently, review error patterns`;
    } else {
      explanations.successRate = `Poor success rate (${(components.successRate * 100).toFixed(1)}%) — agent is unreliable, consider using different agent`;
    }

    
    if (components.avgResponseTimeMs < 5000) {
      explanations.responseTime = `Fast response time (${(components.avgResponseTimeMs / 1000).toFixed(1)}s) — agent responds quickly`;
    } else if (components.avgResponseTimeMs < 15000) {
      explanations.responseTime = `Moderate response time (${(components.avgResponseTimeMs / 1000).toFixed(1)}s) — acceptable for most tasks`;
    } else {
      explanations.responseTime = `Slow response time (${(components.avgResponseTimeMs / 1000).toFixed(1)}s) — agent may be overthinking or using too many tools`;
    }

    
    if (components.avgOutputQuality >= 0.9) {
      explanations.outputQuality = `Excellent output quality (${(components.avgOutputQuality * 100).toFixed(1)}%) — agent produces high-quality work`;
    } else if (components.avgOutputQuality >= 0.7) {
      explanations.outputQuality = `Good output quality (${(components.avgOutputQuality * 100).toFixed(1)}%) — agent produces acceptable work`;
    } else {
      explanations.outputQuality = `Low output quality (${(components.avgOutputQuality * 100).toFixed(1)}%) — agent work needs significant review`;
    }

    
    const errorRate = components.completedTasks > 0 ? components.errorCount / components.completedTasks : 0;

    if (errorRate < 0.1) {
      explanations.errorRate = `Low error rate (${(errorRate * 100).toFixed(1)}%) — agent rarely makes mistakes`;
    } else if (errorRate < 0.3) {
      explanations.errorRate = `Moderate error rate (${(errorRate * 100).toFixed(1)}%) — agent makes some mistakes, review error patterns`;
    } else {
      explanations.errorRate = `High error rate (${(errorRate * 100).toFixed(1)}%) — agent makes frequent errors, exercise caution`;
    }

    
    const memoryEfficiency =
      components.memoryHits + components.memoryMisses > 0
        ? components.memoryHits / (components.memoryHits + components.memoryMisses)
        : 0;

    if (memoryEfficiency > 0.7) {
      explanations.memoryEfficiency = `Good memory efficiency (${(memoryEfficiency * 100).toFixed(1)}%) — agent effectively uses Collective Memory`;
    } else if (memoryEfficiency > 0.3) {
      explanations.memoryEfficiency = `Moderate memory efficiency (${(memoryEfficiency * 100).toFixed(1)}%) — agent sometimes benefits from Collective Memory`;
    } else {
      explanations.memoryEfficiency = `Low memory efficiency (${(memoryEfficiency * 100).toFixed(1)}%) — agent rarely benefits from Collective Memory`;
    }

    
    explanations.overallScore = `Overall trust score: ${(overallScore * 100).toFixed(1)}% (${level})`;

    
    const minTasks = this.config.calculation.minTasksForEvaluation;
    if (components.completedTasks < minTasks) {
      explanations.confidence = `Insufficient data (${components.completedTasks}/${minTasks} tasks) — trust score may be unreliable`;
    } else {
      explanations.confidence = `Sufficient data (${components.completedTasks} tasks) — trust score is reliable`;
    }

    return explanations;
  }

  
  getReport(agentId: string): TrustReport | null {
    const agentHistory = this.history.get(normalizeName(agentId));
    if (!agentHistory || agentHistory.length === 0) {
      return null;
    }

    const latest = agentHistory[agentHistory.length - 1]!;
    return this.buildReport(
      agentId,
      agentId,
      latest.components,
      agentHistory,
      false,
    );
  }

  
  getHistory(agentId: string): TrustScoreHistory[] {
    return this.history.get(normalizeName(agentId)) || [];
  }

  
  getAllReports(): TrustReport[] {
    const reports: TrustReport[] = [];

    for (const agentId of this.history.keys()) {
      const report = this.getReport(agentId);
      if (report) {
        reports.push(report);
      }
    }

    return reports;
  }

  
  findByLevel(level: TrustReport["level"]): TrustReport[] {
    return this.getAllReports().filter((r) => r.level === level);
  }

  
  findByMinScore(minScore: number): TrustReport[] {
    return this.getAllReports().filter((r) => r.overallScore >= minScore);
  }

  
  async persist(): Promise<void> {
    this.persistToDisk("trust-score", () => ({
      history: Object.fromEntries(this.history),
      priors: Object.fromEntries(this.thompsonPriors),
    }));
  }

  
  async load(): Promise<void> {
    const data = await this.readFromDisk<{
      version: string;
      persistedAt: string;
      history: Record<string, TrustScoreHistory[]>;
      priors?: Record<string, Record<string, TrustOutcomePriors>>;
    }>();

    if (!data) return;

    if (data.history && typeof data.history === "object") {
      for (const [agentId, entries] of Object.entries(data.history)) {
        if (Array.isArray(entries)) {
          const validated = entries
            .map((e: unknown) => {
              try {
                return TrustScoreHistorySchema.parse(e);
              } catch {
                return null;
              }
            })
            .filter((e): e is TrustScoreHistory => e !== null);

          this.history.set(normalizeName(agentId), validated);
        }
      }
    }

    if (data.priors && typeof data.priors === "object") {
      for (const [agentId, rec] of Object.entries(data.priors)) {
        if (!rec || typeof rec !== "object") continue;
        const clean: Record<string, TrustOutcomePriors> = {};
        let ok = true;
        for (const [k, v] of Object.entries(rec)) {
          const s = (v as TrustOutcomePriors)?.successes;
          const f = (v as TrustOutcomePriors)?.failures;
          if (typeof s !== "number" || typeof f !== "number" || s < 0 || f < 0) {
            ok = false;
            break;
          }
          clean[k] = { successes: s, failures: f };
        }
        if (ok) {
          this.thompsonPriors.set(normalizeName(agentId), clean as Record<TrustWeightComponent, TrustOutcomePriors>);
        }
      }
    }

    logger.info(`Loaded history for ${this.history.size} agents`);
  }

  
  clear(): void {
    this.history.clear();
  }

  
  getStats(): {
    totalAgents: number;
    averageScore: number;
    levelDistribution: Record<TrustReport["level"], number>;
  } {
    const reports = this.getAllReports();

    if (reports.length === 0) {
      return {
        totalAgents: 0,
        averageScore: 0,
        levelDistribution: {
          untrusted: 0,
          low: 0,
          medium: 0,
          high: 0,
          excellent: 0,
        },
      };
    }

    const totalScore = reports.reduce((sum, r) => sum + r.overallScore, 0);
    const averageScore = totalScore / reports.length;

    const levelDistribution: Record<TrustReport["level"], number> = {
      untrusted: 0,
      low: 0,
      medium: 0,
      high: 0,
      excellent: 0,
    };

    for (const report of reports) {
      levelDistribution[report.level]++;
    }

    return {
      totalAgents: reports.length,
      averageScore,
      levelDistribution,
    };
  }

  
  isEnabled(): boolean {
    return this.config.enabled;
  }

  
  isBeta(): boolean {
    return this.config.beta;
  }
}



export const { get: getTrustScoreCalculator, reset: resetTrustScoreCalculator } = createSingleton<TrustScoreCalculator>(
  (config) => new TrustScoreCalculator(config as Partial<TrustConfig> | undefined),
);
