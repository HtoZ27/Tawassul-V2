import { EventHub } from "./event-hub.ts";
import { CircuitBreaker } from "./circuit-breaker.ts";
import { HealthTracker } from "./agent-health.ts";
import { TaskPriorityManager } from "../features/task-priority.ts";
import type { TaskPriority } from "../conflict-resolver/types.ts";
import { msg } from "./messages.ts";
import type { Lang } from "./routing-algorithm.ts";

export type AgentAvailability =
  | "available"
  | "busy"
  | "paused"
  | "circuit_open"
  | "unavailable";

export interface QueuedTaskInfo {
  id: string;
  agent: string;
  task: string;
  priority: TaskPriority;
  position: number;
  estimatedWaitMs: number;
  queuedAt: string;
}

export type DispatchTaskCallback = (task: { from: string; to: string; task: string; handoffId: string; priority: TaskPriority }) => void;

interface AvailabilityConfig {
  maxQueuePerAgent: number;
  baseWaitMs: number;
  waitPerQueuedTaskMs: number;
  circuitBreaker: CircuitBreaker;
  healthTracker: HealthTracker;
  taskQueue: TaskPriorityManager;
  
  dispatchCallback?: DispatchTaskCallback;
}

const DEFAULT_CONFIG: AvailabilityConfig = {
  maxQueuePerAgent: 5,
  baseWaitMs: 30000,
  waitPerQueuedTaskMs: 15000,
  circuitBreaker: new CircuitBreaker(),
  healthTracker: new HealthTracker(undefined, undefined, new EventHub()),
  taskQueue: new TaskPriorityManager(),
};

export class AgentAvailabilityManager {
  private config: AvailabilityConfig;
  private hub: EventHub;

  constructor(config?: Partial<AvailabilityConfig>, hub?: EventHub) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.hub = hub ?? new EventHub();
  }

  setDispatchCallback(cb: DispatchTaskCallback): void {
    this.config.dispatchCallback = cb;
    this.hub.on("AGENT_RECOVERED", (payload) => {
      this.dispatchNextForAgent(payload.agent);
    });
    this.hub.on("CIRCUIT_CLOSED", (payload) => {
      this.dispatchNextForAgent(payload.component);
    });
  }

  getAvailability(agent: string, _role?: string): AgentAvailability {
    const cbState = this.config.circuitBreaker.getState(agent);
    if (cbState === "OPEN") return "circuit_open";

    const health = this.config.healthTracker.getStatus(agent);
    if (health) {
      if (health.state === "AUTO_PAUSED" || health.state === "RECOVERING") return "paused";
    }

    const queued = this.config.taskQueue.getQueueForAgent(agent);
    if (queued.length >= this.config.maxQueuePerAgent) return "busy";

    return "available";
  }

  queueTask(
    agent: string,
    task: string,
    priority: TaskPriority = "P3",
  ): QueuedTaskInfo {
    const id = `q-${agent}-${Date.now()}`;
    this.config.taskQueue.enqueue({
      id,
      handoffId: id,
      from: "tawa",
      to: agent,
      task,
      priority,
    });

    const queue = this.config.taskQueue.getQueueForAgent(agent);
    const position = queue.findIndex((t) => t.id === id) + 1;
    const estimatedWaitMs =
      this.config.baseWaitMs + (position - 1) * this.config.waitPerQueuedTaskMs;
    const queuedAt = new Date().toISOString();

    
    this.tryDispatch(agent);

    return { id, agent, task, priority, position, estimatedWaitMs, queuedAt };
  }

  
  tryDispatch(agent: string): void {
    if (!this.config.dispatchCallback) return;
    const status = this.getAvailability(agent);
    if (status === "available") {
      this.dispatchNextForAgent(agent);
    }
  }

  private dispatchNextForAgent(agent: string): void {
    const next = this.config.taskQueue.dequeue(agent);
    if (!next) return;

    const cb = this.config.dispatchCallback;
    if (cb) {
      cb({ from: next.from, to: next.to, task: next.task, handoffId: next.handoffId, priority: next.priority });
    } else {
      this.hub.emit({
        type: "TASK_STARTED",
        agent: next.to,
        taskId: next.id,
      });
    }
  }

  getQueuePosition(agent: string): number {
    return this.config.taskQueue.getQueueForAgent(agent).length;
  }

  getEstimatedWait(agent: string): number {
    const count = this.getQueuePosition(agent);
    return this.config.baseWaitMs + count * this.config.waitPerQueuedTaskMs;
  }

  getQueueInfo(agent: string): { position: number; estimatedWaitMs: number } | null {
    const position = this.getQueuePosition(agent);
    if (position === 0) return null;
    return {
      position,
      estimatedWaitMs: this.getEstimatedWait(agent),
    };
  }

  getUserFacingAvailability(
    agent: string,
    displayName: string,
    lang: Lang,
  ): string {
    const status = this.getAvailability(agent);

    switch (status) {
      case "available":
        return msg("tawaAgentHealthStatus", lang, {
          team: displayName,
          status: msg("statusAvailable", lang),
        });
      case "busy": {
        const queueInfo = this.getQueueInfo(agent);
        if (queueInfo) {
          const waitMsg = msg("tawaQueueEstimatedWait", lang, {
            minutes: Math.ceil(queueInfo.estimatedWaitMs / 60000).toString(),
          });
          return `${msg("tawaAgentHealthStatus", lang, { team: displayName, status: msg("statusBusy", lang) })}\n${waitMsg}`;
        }
        return msg("tawaAgentHealthStatus", lang, {
          team: displayName,
          status: msg("statusBusy", lang),
        });
      }
      case "paused":
        return msg("tawaAgentHealthStatus", lang, {
          team: displayName,
          status: msg("statusPaused", lang),
        });
      case "circuit_open":
        return msg("tawaAgentHealthStatus", lang, {
          team: displayName,
          status: msg("statusCircuitOpen", lang),
        });
      default:
        return msg("tawaAgentHealthStatus", lang, {
          team: displayName,
          status: msg("statusUnavailable", lang),
        });
    }
  }

  getUserFacingAllAgents(
    agents: { name: string; displayName: string }[],
    lang: Lang,
  ): string {
    const lines: string[] = [];
    for (const agent of agents) {
      lines.push(this.getUserFacingAvailability(agent.name, agent.displayName, lang));
    }
    return lines.join("\n");
  }

  get circuitBreaker(): CircuitBreaker {
    return this.config.circuitBreaker;
  }

  get healthTracker(): HealthTracker {
    return this.config.healthTracker;
  }

  get taskQueue(): TaskPriorityManager {
    return this.config.taskQueue;
  }

  get maxQueuePerAgent(): number {
    return this.config.maxQueuePerAgent;
  }

  dispose(): void {
    this.hub.removeAllListeners("AGENT_RECOVERED");
    this.hub.removeAllListeners("CIRCUIT_CLOSED");
  }
}
