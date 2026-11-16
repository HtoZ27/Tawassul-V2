
import type { AgentRating, EvaluationConfig, AgentFlag, HandoffEntry } from "../context/types.ts";
import type { RuleInput } from "../conflict-resolver/types.ts";
import type { RatingManager } from "../context/managers/index.ts";
import type { RuleInputBuilder } from "../services/rule-input-builder.ts";
export interface IRatingOperations {
  incrementError(agent: string): void;
  getOrCreateRating(agent: string): AgentRating;
  recordHandoffCompleted(agent: string): void;
  recordHandoffInitiated(agent: string, ctx: string, task: string, hcp: boolean, ce: boolean): void;
  recordHandoffAccepted(agent: string, id: string): void;
  recordHandoffDropped(agent: string): void;
  revertHandoffCompleted(agent: string): void;
  recordRecordCreated(agent: string): void;
  recordValidationError(agent: string): void;
  recordHelpRequestSent(agent: string): void;
  recordHelpRequestFulfilled(agent: string): void;
  recordToolCall(agent: string, tool: string, success: boolean): void;
  updateLastActive(agent: string): void;
  calculateHealthScore(r: AgentRating): number;
  scoreCategory(score: number): { emoji: string; label: string };
  detectFlags(r: AgentRating, cfg: EvaluationConfig): AgentFlag[];
  detectDroppedHandoffs(): void;
  scoreBar(score: number, width: number): string;
  buildRuleInput(from: string, to: string, task: string, context: string, files: string[], tc?: "simple" | "medium" | "complex", tp?: "P1" | "P2" | "P3"): Promise<RuleInput>;
}

export function createRatingOperations(
  ratingManager: RatingManager,
  errorManager: { incrementError(agent: string): void },
  ruleInputBuilder: RuleInputBuilder,
  handoffsRef: () => HandoffEntry[],
): IRatingOperations {
  return {
    incrementError(agent) { errorManager.incrementError(agent); },
    getOrCreateRating(agent) { return ratingManager.getOrCreateRating(agent); },
    recordHandoffCompleted(agent) { ratingManager.recordHandoffCompleted(agent); },
    recordHandoffInitiated(agent, c, task, hcp, ce) { ratingManager.recordHandoffInitiated(agent, c, task, hcp, ce, handoffsRef()); },
    recordHandoffAccepted(agent, id) { ratingManager.recordHandoffAccepted(agent, id); },
    recordHandoffDropped(agent) { ratingManager.recordHandoffDropped(agent); },
    revertHandoffCompleted(agent) { ratingManager.revertHandoffCompleted(agent); },
    recordRecordCreated(agent) { ratingManager.recordRecordCreated(agent); },
    recordValidationError(agent) { ratingManager.recordValidationError(agent); },
    recordHelpRequestSent(agent) { ratingManager.recordHelpRequestSent(agent); },
    recordHelpRequestFulfilled(agent) { ratingManager.recordHelpRequestFulfilled(agent); },
    recordToolCall(agent, tool, success) { ratingManager.recordToolCall(agent, tool, success); },
    updateLastActive(agent) { ratingManager.updateLastActive(agent); },
    calculateHealthScore(r) { return ratingManager.calculateHealthScore(r); },
    scoreCategory(score) { return ratingManager.scoreCategory(score); },
    detectFlags(r, cfg) { return ratingManager.detectFlags(r, cfg); },
    detectDroppedHandoffs() { ratingManager.detectDroppedHandoffs(handoffsRef()); },
    scoreBar(score, width) { return ratingManager.scoreBar(score, width); },
    async buildRuleInput(from, to, task, context, files, tc, tp) {
      return ruleInputBuilder.build({ from, to, task, context, files, taskComplexity: tc, taskPriority: tp });
    },
  };
}
