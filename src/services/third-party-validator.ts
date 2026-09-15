import type { HandoffEntry } from "../context/types.ts";
import { normalizeName } from "../utils/name-utils.ts";

export interface ValidationRequest {
  handoffId: string;
  from: string;
  to: string;
  task: string;
}

export interface ValidationResult {
  approved: boolean;
  reason?: string;
}

export interface ThirdPartyValidator {
  validate(request: ValidationRequest): Promise<ValidationResult>;
}

export interface CircuitBreakerStatus {
  getState: (agent: string) => "CLOSED" | "OPEN" | "HALF_OPEN";
}

export class AgentValidator implements ThirdPartyValidator {
  constructor(
    private getAgents: () => string[],
    private circuitBreaker?: CircuitBreakerStatus,
  ) {}

  async validate(request: ValidationRequest): Promise<ValidationResult> {
    if (!request.task || request.task.length < 5) {
      return { approved: true, reason: "Task too short — skipped" };
    }

    if (normalizeName(request.to) === "tawa") {
      return { approved: false, reason: "Handoffs to @tawa are not allowed" };
    }

    if (this.circuitBreaker) {
      const state = this.circuitBreaker.getState(request.to);
      if (state === "OPEN") {
        const candidateAgents = this.getAgents().filter((a) => a !== request.from && a !== request.to);
        if (candidateAgents.length === 0) {
          return { approved: false, reason: `Target agent ${request.to} is OPEN and no alternative available` };
        }
        return {
          approved: false,
          reason: `Target agent ${request.to} is OPEN — consider redirecting to ${candidateAgents[0]}`,
        };
      }
    }

    return { approved: true };
  }
}

export function buildValidationEffects(
  handoff: HandoffEntry,
  validator: ThirdPartyValidator,
): Array<{ name: string; execute: () => Promise<void>; compensate: () => Promise<void> }> {
  return [
    {
      name: `third-party-validate:${handoff.id}`,
      execute: async () => {
        const result = await validator.validate({
          handoffId: handoff.id,
          from: handoff.from,
          to: handoff.to,
          task: handoff.task ?? "",
        });
        if (!result.approved) {
          throw new Error(`Handoff validation rejected: ${result.reason ?? "No reason"}`);
        }
      },
      compensate: async () => {},
    },
  ];
}
