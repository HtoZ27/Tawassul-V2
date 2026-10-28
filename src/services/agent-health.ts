



import type { HandoffEntry } from "../context/types.ts";
import { EventHub } from "./event-hub.ts";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";



enum HealthState {
  HEALTHY = "HEALTHY",
  STUCK = "STUCK",
  AUTO_PAUSED = "AUTO_PAUSED",
  RECOVERING = "RECOVERING",
}

enum HealthEvent {
  STUCK_DETECTED = "STUCK_DETECTED",
  AUTO_PAUSE_TRIGGERED = "AUTO_PAUSE_TRIGGERED",
  HANDOFF_COMPLETED = "HANDOFF_COMPLETED",
  RESUME = "RESUME",
}



export type AgentStatus = {
  agent: string;
  lastActive: number;
  pendingCount: number;
  acceptedCount: number;
  completedCount: number;
  failedCount: number;
  
  state: HealthState;
  
  stuckSince: number | null;
  
  autoPausedSince: number | null;
};





type TransitionDef = {
  target: HealthState;
  
  onEnter?: (status: AgentStatus, now: number) => void;
};


function getTransitions(eventHub: EventHub): Record<HealthState, Partial<Record<HealthEvent, TransitionDef>>> {
  return {
    [HealthState.HEALTHY]: {
      [HealthEvent.STUCK_DETECTED]: {
        target: HealthState.STUCK,
        onEnter: (status, now) => {
          status.stuckSince ??= now;
          eventHub.emit({ type: "AGENT_STUCK", agent: status.agent, reason: "Stuck detected" });
        },
      },
      [HealthEvent.AUTO_PAUSE_TRIGGERED]: {
        target: HealthState.AUTO_PAUSED,
        onEnter: (status, now) => {
          status.stuckSince ??= now;
          status.autoPausedSince = now;
          eventHub.emit({ type: "AGENT_AUTO_PAUSED", agent: status.agent, reason: "Auto-paused for safety" });
        },
      },
    },

    [HealthState.STUCK]: {
      [HealthEvent.STUCK_DETECTED]: {
        target: HealthState.STUCK,
        onEnter: (status, now) => {
          status.stuckSince ??= now;
        },
      },
      [HealthEvent.AUTO_PAUSE_TRIGGERED]: {
        target: HealthState.AUTO_PAUSED,
        onEnter: (status, now) => {
          status.autoPausedSince = now;
          eventHub.emit({ type: "AGENT_AUTO_PAUSED", agent: status.agent, reason: "Auto-paused for safety" });
        },
      },
      [HealthEvent.HANDOFF_COMPLETED]: {
        target: HealthState.HEALTHY,
        onEnter: (status) => {
          status.stuckSince = null;
          eventHub.emit({ type: "AGENT_RECOVERED", agent: status.agent });
        },
      },
    },

    [HealthState.AUTO_PAUSED]: {
      [HealthEvent.HANDOFF_COMPLETED]: {
        target: HealthState.RECOVERING,
        onEnter: (status) => {
          status.stuckSince = null;
          eventHub.emit({ type: "AGENT_RECOVERED", agent: status.agent });
        },
      },
      [HealthEvent.RESUME]: {
        target: HealthState.HEALTHY,
        onEnter: (status) => {
          status.stuckSince = null;
          status.autoPausedSince = null;
          eventHub.emit({ type: "AGENT_RECOVERED", agent: status.agent });
        },
      },
    },

    [HealthState.RECOVERING]: {
      [HealthEvent.STUCK_DETECTED]: {
        target: HealthState.STUCK,
        onEnter: (status, now) => {
          status.stuckSince ??= now;
        },
      },
      [HealthEvent.AUTO_PAUSE_TRIGGERED]: {
        target: HealthState.AUTO_PAUSED,
        onEnter: (status, now) => {
          status.autoPausedSince ??= now;
          eventHub.emit({ type: "AGENT_AUTO_PAUSED", agent: status.agent, reason: "Re-stuck during recovery" });
        },
      },
      [HealthEvent.HANDOFF_COMPLETED]: {
        target: HealthState.HEALTHY,
        onEnter: (status) => {
          status.autoPausedSince = null;
        },
      },
      [HealthEvent.RESUME]: {
        target: HealthState.HEALTHY,
        onEnter: (status) => {
          status.stuckSince = null;
          status.autoPausedSince = null;
        },
      },
    },
  };
}



import type { TimerManagerLike } from "../types/timer-types.ts";

export class HealthTracker {
  private agents: Map<string, AgentStatus> = new Map();
  private stuckDetectorInterval: ReturnType<typeof setInterval> | null = null;
  private stuckTimeoutMs: number = 30000;
  private autoPauseTimeoutMs: number = 60000;
  private onAutoPauseCallback: ((agent: string, reason: string) => void) | null = null;
  private transitions: Record<HealthState, Partial<Record<HealthEvent, TransitionDef>>>;
  private timers: TimerManagerLike | null;

  constructor(stuckTimeoutMs?: number, autoPauseTimeoutMs?: number, eventHub?: EventHub, timers?: TimerManagerLike) {
    this.stuckTimeoutMs = stuckTimeoutMs ?? 30000;
    this.autoPauseTimeoutMs = autoPauseTimeoutMs ?? 60000;
    this.transitions = getTransitions(eventHub ?? new EventHub());
    this.timers = timers ?? null;
  }

  
  onAutoPause(callback: (agent: string, reason: string) => void): void {
    this.onAutoPauseCallback = callback;
  }

  onHandoffCreated(agent: string, _handoffId: string): void {
    const status = this.getOrCreate(agent);
    status.pendingCount++;
    status.lastActive = Date.now();
  }

  onHandoffAccepted(agent: string): void {
    const status = this.getOrCreate(agent);
    status.pendingCount = Math.max(0, status.pendingCount - 1);
    status.acceptedCount++;
    status.lastActive = Date.now();
  }

  onHandoffCompleted(agent: string): void {
    const status = this.getOrCreate(agent);
    status.acceptedCount = Math.max(0, status.acceptedCount - 1);
    status.completedCount++;
    status.lastActive = Date.now();
    this.transition(status, HealthEvent.HANDOFF_COMPLETED);
  }

  onHandoffFailed(agent: string): void {
    const status = this.getOrCreate(agent);
    status.failedCount++;
    status.lastActive = Date.now();
  }

  onHandoffFailureReverted(agent: string): void {
    const status = this.getOrCreate(agent);
    status.failedCount = Math.max(0, status.failedCount - 1);
    status.lastActive = Date.now();
  }

  onHandoffCompletionReverted(agent: string): void {
    const status = this.getOrCreate(agent);
    status.completedCount = Math.max(0, status.completedCount - 1);
    status.lastActive = Date.now();
  }

  getStatus(agent: string): AgentStatus | undefined {
    return this.agents.get(normalizeName(agent));
  }

  
  detectStuck(handoffs: HandoffEntry[]): string[] {
    const now = Date.now();
    const stuck: string[] = [];

    for (const h of handoffs) {
      if (h.status === "pending" || h.status === "accepted") {
        const elapsed = now - new Date(h.timestamp).getTime();
        if (elapsed > this.stuckTimeoutMs) {
          const status = this.getOrCreate(h.to);
          this.transition(status, HealthEvent.STUCK_DETECTED, now);
          if (!stuck.includes(h.to)) stuck.push(h.to);
        }
      }
    }

    return stuck;
  }

  startStuckDetection(handoffs: () => HandoffEntry[], signal?: AbortSignal): void {
    this.stopStuckDetection();
    const fn = () => {
      if (signal?.aborted) {
        this.stopStuckDetection();
        return;
      }
      const currentHandoffs = handoffs();
      this.detectStuck(currentHandoffs);
      this.autoPauseStuckAgents(currentHandoffs);
    };
    this.stuckDetectorInterval = this.timers
      ? this.timers.setInterval(fn, this.stuckTimeoutMs / 2)
      : (() => {
          const t = setInterval(fn, this.stuckTimeoutMs / 2);
          (t as NodeJS.Timeout).unref();
          return t;
        })();
    signal?.addEventListener("abort", () => this.stopStuckDetection(), { once: true });
  }

  stopStuckDetection(): void {
    if (this.stuckDetectorInterval) {
      if (this.timers) this.timers.clear(this.stuckDetectorInterval);
      else clearInterval(this.stuckDetectorInterval);
      this.stuckDetectorInterval = null;
    }
  }

  cleanup(): void {
    this.stopStuckDetection();
    this.agents.clear();
  }

  getAllStatuses(): AgentStatus[] {
    return [...this.agents.values()];
  }

  removeAgent(agent: string): void {
    this.agents.delete(normalizeName(agent));
  }

  
  autoPauseStuckAgents(handoffs: HandoffEntry[]): string[] {
    const now = Date.now();
    const autoPaused: string[] = [];

    for (const h of handoffs) {
      if (h.status === "pending" || h.status === "accepted") {
        const elapsed = now - new Date(h.timestamp).getTime();
        if (elapsed > this.autoPauseTimeoutMs) {
          const status = this.getOrCreate(h.to);
          
          if (status.state !== HealthState.AUTO_PAUSED && status.state !== HealthState.RECOVERING) {
            this.transition(status, HealthEvent.AUTO_PAUSE_TRIGGERED, now);
            autoPaused.push(h.to);

            
            if (this.onAutoPauseCallback) {
              this.onAutoPauseCallback(h.to, `Agent stuck for ${Math.round(elapsed / 1000)}s — auto-paused for safety`);
            }
          }
        }
      }
    }

    return autoPaused;
  }

  
  resumeAgent(agent: string): void {
    const status = this.agents.get(normalizeName(agent));
    if (status) {
      this.transition(status, HealthEvent.RESUME);
    }
  }

  
  isAutoPaused(agent: string): boolean {
    const status = this.agents.get(normalizeName(agent));
    return status ? status.state === HealthState.AUTO_PAUSED || status.state === HealthState.RECOVERING : false;
  }

  

  
  private transition(status: AgentStatus, event: HealthEvent, now: number = Date.now()): void {
    const currentState = status.state;
    const transDef = this.transitions[currentState]?.[event];

    if (!transDef) {
      logger.debug(`[tawassul] FSM: ignoring invalid transition ${currentState} + ${event}`);
      return;
    }

    status.state = transDef.target;
    transDef.onEnter?.(status, now);
  }

  private getOrCreate(agent: string): AgentStatus {
    const key = normalizeName(agent);
    let status = this.agents.get(key);
    if (!status) {
      status = {
        agent: key,
        lastActive: Date.now(),
        pendingCount: 0,
        acceptedCount: 0,
        completedCount: 0,
        failedCount: 0,
        state: HealthState.HEALTHY,
        stuckSince: null,
        autoPausedSince: null,
      };
      this.agents.set(key, status);
    }
    return status;
  }
}
