
import type { ToolExecuteBeforeContext, ValidationStage } from "../../tool-execute-types.ts";
import type { PipelineState } from "../../PipelineState.ts";

export type StageOutput = { args: Record<string, unknown>; error?: string };
export type Ctx = ToolExecuteBeforeContext;
export type Input = { tool: string; agent?: string; sessionID: string; callID?: string };
export type GuardFn = (ctx: Ctx, input: Input, output: StageOutput) => string | null | Promise<string | null>;



export function ps(ctx: { pipelineState?: PipelineState }) {
  if (!ctx.pipelineState) {
    throw new Error("ps(): pipelineState not set on context — call ensureReady() first");
  }
  return ctx.pipelineState;
}

export type { PipelineState, ValidationStage };
