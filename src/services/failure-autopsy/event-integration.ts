

import type { EventHub } from "../event-hub.ts";
import type { FailureAutopsyAnalyzer } from "./analyzer.js";
import type { FailureInstance, Lesson } from "./types.js";




export interface FailureEventIntegrationConfig {
  
  recordToolErrors: boolean;

  
  recordAgentErrors: boolean;

  
  recordHandoffErrors: boolean;

  
  autoGenerateLessons: boolean;

  
  detectPatterns: boolean;

  
  patternThreshold: number;
}


export interface FailureEventLog {
  
  id: string;

  
  eventType: string;

  
  failureId: string;

  
  diagnosisId?: string;

  
  lessonId?: string;

  
  timestamp: string;
}



export class FailureEventIntegration {
  private eventHub: EventHub;
  private analyzer: FailureAutopsyAnalyzer;
  private config: FailureEventIntegrationConfig;
  private logs: FailureEventLog[] = [];
  private listeners: Array<{ event: string; callback: (...args: unknown[]) => void }> = [];

  constructor(eventHub: EventHub, analyzer: FailureAutopsyAnalyzer, config?: Partial<FailureEventIntegrationConfig>) {
    this.eventHub = eventHub;
    this.analyzer = analyzer;
    this.config = {
      recordToolErrors: config?.recordToolErrors ?? true,
      recordAgentErrors: config?.recordAgentErrors ?? true,
      recordHandoffErrors: config?.recordHandoffErrors ?? true,
      autoGenerateLessons: config?.autoGenerateLessons ?? true,
      detectPatterns: config?.detectPatterns ?? true,
      patternThreshold: config?.patternThreshold ?? 3,
    };
  }

  
  start(): void {
    
    if (this.config.recordToolErrors) {
      const callback1 = (data: unknown) => {
        const { agent, reason } = data as { agent: string; reason: string };
        this.handleAgentFailed(agent, reason);
      };
      this.eventHub.on("AGENT_FAILED", callback1);
      this.listeners.push({ event: "AGENT_FAILED", callback: callback1 });
    }

    
    if (this.config.recordToolErrors) {
      const callback3 = (data: unknown) => {
        const { component } = data as { component: string };
        this.handleCircuitOpen(component);
      };
      this.eventHub.on("CIRCUIT_OPEN", callback3);
      this.listeners.push({ event: "CIRCUIT_OPEN", callback: callback3 });
    }

    
    if (this.config.recordAgentErrors) {
      const callback4 = (data: unknown) => {
        const { agent, metric, value } = data as { agent: string; metric: string; value: number };
        this.handlePerformanceDegraded(agent, metric, value);
      };
      this.eventHub.on("PERFORMANCE_DEGRADED", callback4);
      this.listeners.push({ event: "PERFORMANCE_DEGRADED", callback: callback4 });
    }
  }

  
  stop(): void {
    for (const { event, callback } of this.listeners) {
      this.eventHub.off(event, callback);
    }
    this.listeners = [];
  }

  
  private handleAgentFailed(agent: string, reason: string): void {
    const failure = this.analyzer.recordFailure(reason, agent, {
      category: "agent_error",
      context: { eventType: "AGENT_FAILED" },
    });

    
    const diagnosis = this.analyzer.diagnose(failure.id);

    
    let lesson: Lesson | null = null;
    if (this.config.autoGenerateLessons && diagnosis) {
      lesson = this.analyzer.generateLesson(failure.id, diagnosis.id);
    }

    
    if (this.config.detectPatterns) {
      this.analyzer.detectPatterns();
    }

    
    this.logs.push({
      id: crypto.randomUUID(),
      eventType: "AGENT_FAILED",
      failureId: failure.id,
      diagnosisId: diagnosis?.id,
      lessonId: lesson?.id,
      timestamp: new Date().toISOString(),
    });
  }

  
  private handleCircuitOpen(component: string): void {
    const failure = this.analyzer.recordFailure(`Circuit breaker opened for component: ${component}`, component, {
      category: "integration_error",
      context: { eventType: "CIRCUIT_OPEN" },
    });

    
    const diagnosis = this.analyzer.diagnose(failure.id);

    
    this.logs.push({
      id: crypto.randomUUID(),
      eventType: "CIRCUIT_OPEN",
      failureId: failure.id,
      diagnosisId: diagnosis?.id,
      timestamp: new Date().toISOString(),
    });
  }

  
  private handlePerformanceDegraded(agent: string, metric: string, value: number): void {
    const failure = this.analyzer.recordFailure(`Performance degraded: ${metric} = ${value}`, agent, {
      category: "agent_error",
      context: { eventType: "PERFORMANCE_DEGRADED", metric, value },
    });

    
    const diagnosis = this.analyzer.diagnose(failure.id);

    
    this.logs.push({
      id: crypto.randomUUID(),
      eventType: "PERFORMANCE_DEGRADED",
      failureId: failure.id,
      diagnosisId: diagnosis?.id,
      timestamp: new Date().toISOString(),
    });
  }

  
  recordCustomFailure(
    message: string,
    source: string,
    options?: {
      category?: string;
      stackTrace?: string;
      task?: string;
      context?: Record<string, unknown>;
    },
  ): FailureInstance {
    const failure = this.analyzer.recordFailure(message, source, options);

    
    const diagnosis = this.analyzer.diagnose(failure.id);

    
    let lesson: Lesson | null = null;
    if (this.config.autoGenerateLessons && diagnosis) {
      lesson = this.analyzer.generateLesson(failure.id, diagnosis.id);
    }

    
    if (this.config.detectPatterns) {
      this.analyzer.detectPatterns();
    }

    
    this.logs.push({
      id: crypto.randomUUID(),
      eventType: "CUSTOM_FAILURE",
      failureId: failure.id,
      diagnosisId: diagnosis?.id,
      lessonId: lesson?.id,
      timestamp: new Date().toISOString(),
    });

    return failure;
  }

  
  getLogs(): FailureEventLog[] {
    return [...this.logs];
  }

  
  getStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    failuresRecorded: number;
    diagnosesCreated: number;
    lessonsGenerated: number;
  } {
    const eventsByType: Record<string, number> = {};
    for (const log of this.logs) {
      eventsByType[log.eventType] = (eventsByType[log.eventType] || 0) + 1;
    }

    return {
      totalEvents: this.logs.length,
      eventsByType,
      failuresRecorded: this.logs.filter((l) => l.failureId).length,
      diagnosesCreated: this.logs.filter((l) => l.diagnosisId).length,
      lessonsGenerated: this.logs.filter((l) => l.lessonId).length,
    };
  }

  
  updateConfig(updates: Partial<FailureEventIntegrationConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
    };
  }

  
  getConfig(): FailureEventIntegrationConfig {
    return { ...this.config };
  }
}




export function createFailureEventIntegration(
  eventHub: EventHub,
  analyzer: FailureAutopsyAnalyzer,
  config?: Partial<FailureEventIntegrationConfig>,
): FailureEventIntegration {
  return new FailureEventIntegration(eventHub, analyzer, config);
}
