
import type { TawassulContext } from "../../context-class.ts";
import type { EvaluationConfig, Strictness } from "../../context/types.ts";

export function agentReadMd(ctx: TawassulContext, tag: string) { return ctx.agentManager.readAgentMd(tag); }
export function agentGetAgents(ctx: TawassulContext): string[] { return ctx.agentManager.getAgents(); }
export function agentGetMaxRecords(ctx: TawassulContext): number { return ctx.agentManager.getMaxRecords(); }
export function agentGetMaxHandoffs(ctx: TawassulContext): number { return ctx.agentManager.getMaxHandoffs(); }
export function agentGetMaxCompactItems(ctx: TawassulContext): number { return ctx.agentManager.getMaxCompactItems(); }
export function agentGetEvalConfig(ctx: TawassulContext): EvaluationConfig { return ctx.agentManager.getEvalConfig(); }
export function agentGetSuggestedHandoffs(ctx: TawassulContext): Record<string, string[]> { return ctx.agentManager.getSuggestedHandoffs(); }
export function agentStrictness(ctx: TawassulContext): Strictness { return ctx.preferenceManager.strictness(); }
