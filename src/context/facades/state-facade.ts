
import type { TawassulContext } from "../../context-class.ts";
import type { SaveHealth } from "../../core/service-context.ts";
import { STATE_FILE_DEFAULT } from "../constants.ts";

export async function stateSaveState(ctx: TawassulContext): Promise<void> {
  await ctx.lifecycleManager.saveState();
}

export function stateSaveHealth(ctx: TawassulContext): SaveHealth {
  return ctx.lifecycleManager.getSaveHealth();
}

export async function stateFlushSaves(ctx: TawassulContext): Promise<void> {
  await ctx.lifecycleManager.flushSaves();
}

export function stateMarkDisposing(ctx: TawassulContext): void {
  ctx.lifecycleManager.markDisposing();
}

export async function stateDoSave(ctx: TawassulContext, type?: string): Promise<void> {
  await ctx.lifecycleManager.doSave(type);
}

export async function stateLoadStateAsync(ctx: TawassulContext): Promise<void> {
  await ctx.lifecycleManager.loadStateAsync();
}

export function stateClearAllState(ctx: TawassulContext): string {
  return ctx.lifecycleManager.clearAllState();
}

export async function stateDestroy(ctx: TawassulContext): Promise<void> {
  await ctx.lifecycleManager.destroy();
}

export function statePath(ctx: TawassulContext): string {
  return ctx.stateSafeConfigPath(ctx.configManager.config.stateFile, STATE_FILE_DEFAULT);
}
