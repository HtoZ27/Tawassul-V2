
import type { TawassulContext } from "../../context-class.ts";
import { sanitizeFilePath } from "../../utils/validation.ts";
import { resolveSafePathSync } from "../../utils/path.ts";
import { resolve } from "node:path";
import { t } from "../../translations.ts";
import { setMaxCallDepth, setMaxTotalTasks } from "../../hooks/validation-pipeline.ts";
import { logger } from "../../utils/logger.ts";
import { globalConfigDir } from "../../utils/path-resolver.ts";

export function configIsConfigDisabled(ctx: TawassulContext): boolean {
  ctx.ensureConfig();
  return !!ctx.configManager.config.disabled;
}

export function configSafeConfigPath(ctx: TawassulContext, name: string | undefined, fallback: string): string {
  if (!name) return configResolveSafePath(ctx, fallback);
  const s = sanitizeFilePath(name);
  if (!s.safe) {
    logger.warn(t("configInvalidPath", { name }));
    return configResolveSafePath(ctx, fallback);
  }
  return configResolveSafePath(ctx, s.decoded);
}

export function configResolveSafePath(ctx: TawassulContext, subPath: string): string {
  
  
  
  const base = ctx.scope === "global" ? globalConfigDir() : resolve(ctx.stateDir, ".opencode");
  const resolved = resolveSafePathSync(subPath, base);
  if (resolved) return resolved;
  logger.warn(`⛔ Path rejected (symlink traversal): ${subPath} — falling back to ${base}`);
  return base;
}

export function configLoadConfig(ctx: TawassulContext): void {
  ctx.configManager.loadConfig();
  ctx._configLoaded = true;
  ctx.agentManager.config = ctx.configManager.config;
  ctx.preferenceManager.setConfig(ctx.configManager.config);
  const c = ctx.configManager.config;
  if (c.maxCallDepth) setMaxCallDepth(c.maxCallDepth);
  if (c.maxTotalTasks) setMaxTotalTasks(c.maxTotalTasks);
}
