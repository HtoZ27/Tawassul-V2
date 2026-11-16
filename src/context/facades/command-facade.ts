
import type { TawassulContext } from "../../context-class.ts";

export function commandExecute(ctx: TawassulContext, cmd: Record<string, unknown>) { return ctx.commandRouter.executeCommand(cmd, ctx); }
export function commandExecuteMultiStep(ctx: TawassulContext, multi: { steps?: { action?: string; model?: string; agent?: string; reason?: string }[]; on_error?: { action?: string }[]; workflow?: { action?: string; model?: string; agent?: string; reason?: string; on_error?: unknown }[] }) { return ctx.commandRouter.executeMultiStep(multi, ctx); }
