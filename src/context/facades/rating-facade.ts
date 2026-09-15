
import type { TawassulContext } from "../../context-class.ts";
import type { AgentRating, EvaluationConfig } from "../../context/types.ts";
import type { RuleInput } from "../../conflict-resolver/types.ts";

export function ratingIncrementError(ctx: TawassulContext, agent: string): void { ctx.ratingOps.incrementError(agent); }
export function ratingGetOrCreate(ctx: TawassulContext, agent: string): AgentRating { return ctx.ratingOps.getOrCreateRating(agent); }
export function ratingRecordHandoffCompleted(ctx: TawassulContext, agent: string): void { ctx.ratingOps.recordHandoffCompleted(agent); }
export function ratingRecordHandoffInitiated(ctx: TawassulContext, agent: string, c: string, task: string, hcp: boolean, ce: boolean): void { ctx.ratingOps.recordHandoffInitiated(agent, c, task, hcp, ce); }
export function ratingRecordHandoffAccepted(ctx: TawassulContext, agent: string, id: string): void { ctx.ratingOps.recordHandoffAccepted(agent, id); }
export function ratingRecordHandoffDropped(ctx: TawassulContext, agent: string): void { ctx.ratingOps.recordHandoffDropped(agent); }
export function ratingRecordRecordCreated(ctx: TawassulContext, agent: string): void { ctx.ratingOps.recordRecordCreated(agent); }
export function ratingRecordValidationError(ctx: TawassulContext, agent: string): void { ctx.ratingOps.recordValidationError(agent); }
export function ratingRecordHelpRequestSent(ctx: TawassulContext, agent: string): void { ctx.ratingOps.recordHelpRequestSent(agent); }
export function ratingRecordHelpRequestFulfilled(ctx: TawassulContext, agent: string): void { ctx.ratingOps.recordHelpRequestFulfilled(agent); }
export function ratingRecordToolCall(ctx: TawassulContext, agent: string, tool: string, success: boolean): void { ctx.ratingOps.recordToolCall(agent, tool, success); }
export function ratingUpdateLastActive(ctx: TawassulContext, agent: string): void { ctx.ratingOps.updateLastActive(agent); }
export function ratingCalculateHealthScore(ctx: TawassulContext, r: AgentRating): number { return ctx.ratingOps.calculateHealthScore(r); }
export function ratingScoreCategory(ctx: TawassulContext, score: number) { return ctx.ratingOps.scoreCategory(score); }
export function ratingDetectFlags(ctx: TawassulContext, r: AgentRating, cfg: EvaluationConfig) { return ctx.ratingOps.detectFlags(r, cfg); }
export function ratingDetectDroppedHandoffs(ctx: TawassulContext): void { ctx.ratingOps.detectDroppedHandoffs(); }
export function ratingScoreBar(ctx: TawassulContext, score: number, width: number): string { return ctx.ratingOps.scoreBar(score, width); }
export async function ratingBuildRuleInput(ctx: TawassulContext, from: string, to: string, task: string, context: string, files: string[], tc?: "simple" | "medium" | "complex", tp?: "P1" | "P2" | "P3"): Promise<RuleInput> {
  return ctx.ratingOps.buildRuleInput(from, to, task, context, files, tc, tp);
}
