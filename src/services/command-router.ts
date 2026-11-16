

import type { TawaOrchestratorContext } from "../core/service-context.ts";
import { normalizeName } from "../utils/name-utils.ts";



type CommandHandler = (
  cmd: Record<string, unknown>,
  ctx: TawaOrchestratorContext,
) => Promise<{ success: boolean; output: string; error?: string }>;



class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();

  register(action: string, handler: CommandHandler) {
    this.handlers.set(action, handler);
  }

  async execute(action: string, cmd: Record<string, unknown>, ctx: TawaOrchestratorContext) {
    const handler = this.handlers.get(action);
    if (!handler) return { success: false, output: "", error: `Unknown action: ${action}` };
    return await handler(cmd, ctx);
  }
}



export class CommandRouter {
  private registry = new CommandRegistry();

  constructor(ctx: TawaOrchestratorContext) {
    this.registerCommands(ctx);
  }

  
  private registerCommands(ctx: TawaOrchestratorContext): void {
    this.registry.register("MODEL.SELECT", async (cmd, _registryCtx) => {
      const agent = cmd.agent as string | undefined;
      const model = cmd.model as string | undefined;
      if (agent && model) {
        
        const map: Record<string, string> =
          (ctx as unknown as { agentModelMap?: Record<string, string> }).agentModelMap ??
          (ctx as unknown as { modelManager?: { agentModelMap?: Record<string, string> } }).modelManager
            ?.agentModelMap ??
          ((ctx as unknown as Record<string, unknown>).agentModelMap as Record<string, string>);
        if (map) map[normalizeName(agent)] = model;
      }
      const reason = cmd.reason ? ` (${String(cmd.reason)})` : "";
      return { success: true, output: `Model ${cmd.model} selected${reason}` };
    });
  }

  
  async executeCommand(
    cmd: Record<string, unknown>,
    ctx: TawaOrchestratorContext,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    try {
      return await this.registry.execute((cmd.action as string) ?? "", cmd, ctx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, output: "", error: message };
    }
  }

  async executeMultiStep(
    multi: {
      steps?: { action?: string; model?: string; agent?: string; reason?: string }[];
      on_error?: { action?: string }[];
      workflow?: { action?: string; model?: string; agent?: string; reason?: string; on_error?: unknown }[];
    },
    ctx: TawaOrchestratorContext,
  ): Promise<{ success: boolean; results: { success: boolean; output: string; error?: string }[] }> {
    if (!multi) return { success: false, results: [] };
    const results: { success: boolean; output: string; error?: string }[] = [];

    if (Array.isArray(multi.steps)) {
      for (const step of multi.steps) {
        const result = await this.executeCommand(step, ctx);
        results.push(result);
        if (!result.success && Array.isArray(multi.on_error)) {
          for (const errCmd of multi.on_error) {
            const errResult = await this.executeCommand(errCmd, ctx);
            results.push(errResult);
          }
        }
      }
    }

    if (Array.isArray(multi.workflow)) {
      for (const cmd of multi.workflow) {
        if (cmd?.action && !cmd.on_error) {
          const result = await this.executeCommand(cmd, ctx);
          results.push(result);
        }
      }
    }

    return { success: true, results };
  }
}
