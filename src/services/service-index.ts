import type { EventHub } from "./event-hub.ts";
import { join } from "node:path";
import { TaskOrchestrator } from "./task-orchestrator.ts";
import { ResultEngine } from "./result-engine.ts";
import { SelfHealEngine } from "./self-heal-engine.ts";
import { MissionBoard } from "./mission-board.ts";
import { StrategyDispatcher } from "./strategy-dispatcher.ts";
import { CostTransparencyTracker, type AgentCostSummary } from "./cost-transparency/tracker.ts";
import { TrustScoreCalculator } from "./trust-score/calculator.ts";
import type { TrustReport } from "./trust-score/types.ts";

export interface SystemStatus {
  overall: "healthy" | "degraded" | "unhealthy";
  services: Record<string, { status: string; details: string }>;
  trustSummaries: TrustReport[];
  costSummaries: AgentCostSummary[];
  uptime: number;
}

const startTime = Date.now();

export interface ServiceIndexOptions {
  taskOrchestrator?: TaskOrchestrator;
  resultEngine?: ResultEngine;
  selfHealEngine?: SelfHealEngine;
  missionBoard?: MissionBoard;
  strategyDispatcher?: StrategyDispatcher;
  trustScore?: TrustScoreCalculator;
  costTracker?: CostTransparencyTracker;
  storageDir?: string;
}

export class ServiceIndex {
  taskOrchestrator: TaskOrchestrator;
  resultEngine: ResultEngine;
  selfHealEngine: SelfHealEngine;
  missionBoard: MissionBoard;
  strategyDispatcher: StrategyDispatcher;
  trustScore: TrustScoreCalculator;
  costTracker: CostTransparencyTracker;

  constructor(
    public eventHub?: EventHub,
    opts?: ServiceIndexOptions,
  ) {
    this.taskOrchestrator = opts?.taskOrchestrator ?? new TaskOrchestrator(eventHub);
    this.resultEngine = opts?.resultEngine ?? new ResultEngine(eventHub);
    this.selfHealEngine = opts?.selfHealEngine ?? new SelfHealEngine(eventHub);
    this.missionBoard = opts?.missionBoard ?? new MissionBoard(eventHub);
    this.strategyDispatcher = opts?.strategyDispatcher ?? new StrategyDispatcher();
    this.trustScore =
      opts?.trustScore ??
      new TrustScoreCalculator(
        opts?.storageDir ? { storagePath: join(opts.storageDir, "trust-score.json") } : undefined,
      );
    this.costTracker =
      opts?.costTracker ??
      new CostTransparencyTracker(
        opts?.storageDir ? { storagePath: join(opts.storageDir, "cost-transparency.json") } : undefined,
      );
  }

  getStatus(): SystemStatus {
    const agentIds = ["@tawa", "@dev", "@analyst", "@tester", "@reviewer", "@architect", "@designer", "@doc"];
    const unhealthy: string[] = [];
    const services: Record<string, { status: string; details: string }> = {};

    for (const agentId of agentIds) {
      const healthy = this.selfHealEngine.isHealthy(agentId);
      services[agentId] = {
        status: healthy ? "healthy" : "unhealthy",
        details: healthy ? "Working normally" : "Unavailable — needs inspection",
      };
      if (!healthy) unhealthy.push(agentId);
    }

    const trustSummaries = agentIds
      .map((a) => this.trustScore.getReport(a))
      .filter((r): r is TrustReport => r !== null);
    const costSummaries = this.costTracker.getAgentSummaries();

    let overall: "healthy" | "degraded" | "unhealthy";
    if (unhealthy.length === 0) overall = "healthy";
    else if (unhealthy.length <= 2) overall = "degraded";
    else overall = "unhealthy";

    return { overall, services, trustSummaries, costSummaries, uptime: Date.now() - startTime };
  }
}