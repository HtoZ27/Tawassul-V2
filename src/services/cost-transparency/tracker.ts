

import { logger } from "../../utils/logger.ts";
import { BaseInnovationService, createSingleton } from "../base-innovation-service.ts";
import { normalizeName } from "../../utils/name-utils.ts";

export interface AgentCostSummary {
  agent: string;
  totalCost: number;
  totalTokens: number;
  taskCount: number;
  averageCostPerTask: number;
  budgetRemaining: number;
}

import type {
  PricingModel,
  OperationCost,
  CostSummary,
  CostPerOutcome,
  Budget,
  CostTransparencyConfig,
  CostEvent,
  CostQuery,
} from "./types.js";
import {
  CostTransparencyConfigSchema,
  generateOperationId,
  calculateCost,
  formatCost,
  formatTokens,
  DEFAULT_PRICING_MODELS,
} from "./types.js";



export class CostTransparencyTracker extends BaseInnovationService<CostTransparencyConfig, CostEvent> {
  private operations: Map<string, OperationCost> = new Map();
  private pricingModels: Map<string, PricingModel> = new Map();
  private budget: Budget | null = null;
  
  private orderIds: string[] = [];
  
  private agg = { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, successCount: 0 };

  constructor(config?: Partial<CostTransparencyConfig>) {
    super(config, CostTransparencyConfigSchema);

    
    for (const model of DEFAULT_PRICING_MODELS) {
      this.pricingModels.set(model.id, model);
    }
  }

  
  recordOperation(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    options?: {
      cacheReadTokens?: number;
      task?: string;
      agentId?: string;
      success?: boolean;
      durationMs?: number;
      estimated?: boolean;
    },
  ): OperationCost {
    const model = this.pricingModels.get(modelId);
    if (!model) {
      throw new Error(`Pricing model not found: ${modelId}`);
    }

    const totalCost = calculateCost(inputTokens, outputTokens, model, options?.cacheReadTokens);

    const operation: OperationCost = {
      id: generateOperationId(),
      modelId,
      inputTokens,
      outputTokens,
      cacheReadTokens: options?.cacheReadTokens,
      totalCost,
      task: options?.task,
      agentId: options?.agentId ? normalizeName(options.agentId) : undefined,
      success: options?.success ?? true,
      durationMs: options?.durationMs ?? 0,
      timestamp: new Date().toISOString(),
      estimated: options?.estimated === true ? true : undefined,
    };

    this.operations.set(operation.id, operation);
    this.orderIds.push(operation.id);
    this.agg.totalCost += operation.totalCost;
    this.agg.totalInputTokens += operation.inputTokens;
    this.agg.totalOutputTokens += operation.outputTokens;
    if (operation.success) this.agg.successCount++;
    this.trimOperations();
    this.persistToDisk("cost-transparency", () => ({
      operations: Array.from(this.operations.values()),
      budget: this.budget,
    }));

    
    if (this.budget) {
      this.budget.currentDailySpend += totalCost;
      this.budget.currentMonthlySpend += totalCost;

      
      this.checkBudgetAlerts();
    }

    this.emitEvent({
      type: "operation_recorded",
      payload: { operationId: operation.id, cost: totalCost, modelId },
      source: "cost-transparency",
      timestamp: new Date().toISOString(),
    });

    return operation;
  }

  
  private checkBudgetAlerts(): void {
    if (!this.budget || !this.config.alertOnBudgetApproach) return;

    const dailyRatio = this.budget.dailyLimit > 0 ? this.budget.currentDailySpend / this.budget.dailyLimit : 0;

    const monthlyRatio = this.budget.monthlyLimit > 0 ? this.budget.currentMonthlySpend / this.budget.monthlyLimit : 0;

    if (dailyRatio >= this.config.alertThreshold || monthlyRatio >= this.config.alertThreshold) {
      this.emitEvent({
        type: "budget_alert",
        payload: {
          dailySpend: this.budget.currentDailySpend,
          dailyLimit: this.budget.dailyLimit,
          monthlySpend: this.budget.currentMonthlySpend,
          monthlyLimit: this.budget.monthlyLimit,
          dailyRatio,
          monthlyRatio,
        },
        source: "cost-transparency",
        timestamp: new Date().toISOString(),
      });
    }

    if (dailyRatio >= 1 || monthlyRatio >= 1) {
      this.budget.exceeded = true;

      this.emitEvent({
        type: "budget_exceeded",
        payload: {
          dailySpend: this.budget.currentDailySpend,
          dailyLimit: this.budget.dailyLimit,
          monthlySpend: this.budget.currentMonthlySpend,
          monthlyLimit: this.budget.monthlyLimit,
        },
        source: "cost-transparency",
        timestamp: new Date().toISOString(),
      });
    }
  }

  
  setBudget(
    budget: Omit<
      Budget,
      "currentDailySpend" | "currentMonthlySpend" | "lastDailyReset" | "lastMonthlyReset" | "exceeded"
    >,
  ): void {
    const now = new Date().toISOString();

    this.budget = {
      ...budget,
      currentDailySpend: 0,
      currentMonthlySpend: 0,
      lastDailyReset: now,
      lastMonthlyReset: now,
      exceeded: false,
    };
  }

  
  resetDailyBudget(): void {
    if (this.budget) {
      this.budget.currentDailySpend = 0;
      this.budget.lastDailyReset = new Date().toISOString();
      this.budget.exceeded = false;
    }
  }

  
  resetMonthlyBudget(): void {
    if (this.budget) {
      this.budget.currentMonthlySpend = 0;
      this.budget.lastMonthlyReset = new Date().toISOString();
      this.budget.exceeded = false;
    }
  }

  
  getAgentSummaries(): AgentCostSummary[] {
    const byAgent = new Map<string, OperationCost[]>();
    for (const op of this.operations.values()) {
      const agent = normalizeName(op.agentId || "unknown");
      if (!byAgent.has(agent)) byAgent.set(agent, []);
      byAgent.get(agent)!.push(op);
    }

    const summaries: AgentCostSummary[] = [];
    for (const [agent, ops] of byAgent) {
      const totalCost = ops.reduce((sum, op) => sum + op.totalCost, 0);
      const totalTokens = ops.reduce((sum, op) => sum + op.inputTokens + op.outputTokens, 0);
      const budgetRemaining = this.budget
        ? Math.max(0, this.budget.dailyLimit - this.budget.currentDailySpend)
        : Infinity;
      summaries.push({
        agent,
        totalCost,
        totalTokens,
        taskCount: ops.length,
        averageCostPerTask: ops.length > 0 ? totalCost / ops.length : 0,
        budgetRemaining,
      });
    }
    return summaries.sort((a, b) => b.totalCost - a.totalCost);
  }

  
  getSummary(period?: { from: string; to: string }): CostSummary {
    let operations = Array.from(this.operations.values());

    
    if (period) {
      const from = new Date(period.from);
      const to = new Date(period.to);
      operations = operations.filter((op) => {
        const date = new Date(op.timestamp);
        return date >= from && date <= to;
      });
    }

    const totalCost = operations.reduce((sum, op) => sum + op.totalCost, 0);
    const totalInputTokens = operations.reduce((sum, op) => sum + op.inputTokens, 0);
    const totalOutputTokens = operations.reduce((sum, op) => sum + op.outputTokens, 0);
    const successCount = operations.filter((op) => op.success).length;

    
    const byModel: Record<string, number> = {};
    for (const op of operations) {
      const model = this.pricingModels.get(op.modelId);
      const name = model?.name || op.modelId;
      byModel[name] = (byModel[name] || 0) + op.totalCost;
    }

    
    const byTask: Record<string, number> = {};
    for (const op of operations) {
      const task = op.task || "unknown";
      byTask[task] = (byTask[task] || 0) + op.totalCost;
    }

    
    const byAgent: Record<string, number> = {};
    for (const op of operations) {
      const agent = normalizeName(op.agentId || "unknown");
      byAgent[agent] = (byAgent[agent] || 0) + op.totalCost;
    }

    return {
      totalCost,
      avgCostPerOperation: operations.length > 0 ? totalCost / operations.length : 0,
      totalInputTokens,
      totalOutputTokens,
      operationCount: operations.length,
      successRate: operations.length > 0 ? successCount / operations.length : 0,
      byModel,
      byTask,
      byAgent,
      period: period || {
        from: operations.length > 0 ? operations[0]!.timestamp : new Date().toISOString(),
        to: operations.length > 0 ? operations[operations.length - 1]!.timestamp : new Date().toISOString(),
      },
    };
  }

  
  getCostPerOutcome(): CostPerOutcome[] {
    const taskGroups = new Map<string, OperationCost[]>();

    for (const op of this.operations.values()) {
      const task = op.task || "unknown";
      if (!taskGroups.has(task)) {
        taskGroups.set(task, []);
      }
      taskGroups.get(task)!.push(op);
    }

    const outcomes: CostPerOutcome[] = [];
    const totalCost = Array.from(this.operations.values()).reduce((sum, op) => sum + op.totalCost, 0);
    const totalCount = this.operations.size;
    const avgCostPerOp = totalCount > 0 ? totalCost / totalCount : 0;

    for (const [task, ops] of taskGroups) {
      const taskCost = ops.reduce((sum, op) => sum + op.totalCost, 0);
      const successCount = ops.filter((op) => op.success).length;
      const avgCost = ops.length > 0 ? taskCost / ops.length : 0;

      outcomes.push({
        outcomeType: task,
        avgCostPerOutcome: avgCost,
        outcomeCount: ops.length,
        totalCost: taskCost,
        successRate: ops.length > 0 ? successCount / ops.length : 0,
        isEfficient: avgCost < avgCostPerOp,
        vsAverage: avgCostPerOp > 0 ? ((avgCost - avgCostPerOp) / avgCostPerOp) * 100 : 0,
      });
    }

    return outcomes.sort((a, b) => a.avgCostPerOutcome - b.avgCostPerOutcome);
  }

  
  getBudget(): Budget | null {
    return this.budget;
  }

  
  addPricingModel(model: PricingModel): void {
    this.pricingModels.set(model.id, model);

    this.emitEvent({
      type: "model_added",
      payload: { modelId: model.id, name: model.name },
      source: "cost-transparency",
      timestamp: new Date().toISOString(),
    });
  }

  
  updatePricingModel(id: string, updates: Partial<PricingModel>): void {
    const model = this.pricingModels.get(id);
    if (!model) return;

    const updated = { ...model, ...updates, id: model.id };
    this.pricingModels.set(id, updated);

    this.emitEvent({
      type: "model_updated",
      payload: { modelId: id, updates },
      source: "cost-transparency",
      timestamp: new Date().toISOString(),
    });
  }

  
  getPricingModels(): PricingModel[] {
    return Array.from(this.pricingModels.values());
  }

  
  queryOperations(query: CostQuery): OperationCost[] {
    let operations = Array.from(this.operations.values());

    if (query.modelId) {
      operations = operations.filter((op) => op.modelId === query.modelId);
    }

    if (query.task) {
      operations = operations.filter((op) => op.task === query.task);
    }

    if (query.agentId) {
      const queryAgent = normalizeName(query.agentId);
      operations = operations.filter((op) => op.agentId === queryAgent);
    }

    if (query.success !== undefined) {
      operations = operations.filter((op) => op.success === query.success);
    }

    if (query.since) {
      const since = new Date(query.since);
      operations = operations.filter((op) => new Date(op.timestamp) >= since);
    }

    if (query.until) {
      const until = new Date(query.until);
      operations = operations.filter((op) => new Date(op.timestamp) <= until);
    }

    if (query.minCost !== undefined) {
      operations = operations.filter((op) => op.totalCost >= query.minCost!);
    }

    if (query.maxCost !== undefined) {
      operations = operations.filter((op) => op.totalCost <= query.maxCost!);
    }

    
    const orderBy = query.orderBy || "recent";
    if (orderBy === "cost") {
      operations.sort((a, b) => b.totalCost - a.totalCost);
    } else if (orderBy === "recent") {
      operations.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } else if (orderBy === "duration") {
      operations.sort((a, b) => b.durationMs - a.durationMs);
    }

    
    const limit = query.limit || 50;
    return operations.slice(0, limit);
  }

  
  private trimOperations(): void {
    while (this.operations.size > this.config.maxOperations) {
      const oldestId = this.orderIds.shift();
      if (oldestId === undefined) break;
      const evicted = this.operations.get(oldestId);
      if (!evicted) continue;
      this.operations.delete(oldestId);
      this.agg.totalCost -= evicted.totalCost;
      this.agg.totalInputTokens -= evicted.inputTokens;
      this.agg.totalOutputTokens -= evicted.outputTokens;
      if (evicted.success) this.agg.successCount--;
    }
  }

  
  async persist(): Promise<void> {
    this.persistToDisk("cost-transparency", () => ({
      operations: Array.from(this.operations.values()),
      pricingModels: Array.from(this.pricingModels.values()),
      budget: this.budget,
    }));
  }

  
  async load(): Promise<void> {
    const data = await this.readFromDisk<{
      version: string;
      persistedAt: string;
      operations: OperationCost[];
      budget: Budget;
      pricingModels?: PricingModel[];
    }>();

    if (!data) return;

    if (data.operations && Array.isArray(data.operations)) {
      for (const op of data.operations) {
        this.operations.set(op.id, op);
      }
    }

    
    this.rebuildIndex();

    if (data.pricingModels && Array.isArray(data.pricingModels)) {
      for (const model of data.pricingModels) {
        this.pricingModels.set(model.id, model);
      }
    }

    if (data.budget) {
      this.budget = data.budget;
    }

    logger.info(`Loaded ${this.operations.size} operations`);
    if (data.pricingModels) {
      logger.info(`Loaded ${data.pricingModels.length} pricing models`);
    }
  }

  
  getStats(): {
    totalOperations: number;
    totalCost: number;
    avgCostPerOperation: number;
    budgetStatus: "ok" | "warning" | "exceeded" | "no_budget";
  } {
    
    const totalOperations = this.operations.size;
    const totalCost = this.agg.totalCost;

    let budgetStatus: "ok" | "warning" | "exceeded" | "no_budget" = "no_budget";
    if (this.budget) {
      if (this.budget.exceeded) {
        budgetStatus = "exceeded";
      } else {
        const dailyRatio = this.budget.dailyLimit > 0 ? this.budget.currentDailySpend / this.budget.dailyLimit : 0;
        budgetStatus = dailyRatio >= this.config.alertThreshold ? "warning" : "ok";
      }
    }

    return {
      totalOperations,
      totalCost,
      avgCostPerOperation: totalOperations > 0 ? totalCost / totalOperations : 0,
      budgetStatus,
    };
  }

  
  clear(): void {
    this.operations.clear();
    this.orderIds = [];
    this.agg = { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, successCount: 0 };
    this.budget = null;
  }

  
  private rebuildIndex(): void {
    this.orderIds = Array.from(this.operations.values())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((op) => op.id);
    this.agg = { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, successCount: 0 };
    for (const op of this.operations.values()) {
      this.agg.totalCost += op.totalCost;
      this.agg.totalInputTokens += op.inputTokens;
      this.agg.totalOutputTokens += op.outputTokens;
      if (op.success) this.agg.successCount++;
    }
  }

  
  isEnabled(): boolean {
    return this.config.enabled;
  }

  
  formatCost(cost: number): string {
    return formatCost(cost);
  }

  
  formatTokens(tokens: number): string {
    return formatTokens(tokens);
  }
}



export const { get: getCostTransparencyTracker, reset: resetCostTransparencyTracker } =
  createSingleton<CostTransparencyTracker>(
    (config) => new CostTransparencyTracker(config as Partial<CostTransparencyConfig> | undefined),
  );
