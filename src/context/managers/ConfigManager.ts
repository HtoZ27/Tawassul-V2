

import { existsSync, readFileSync } from "node:fs";
import { resolveSafePathSync } from "../../utils/path.ts";
import { resolve } from "node:path";
import { t } from "../../translations.ts";
import type { TawassulConfig, EvaluationConfig, AgentModelConfig } from "../types.ts";
import { configSchema } from "../config-schema.ts";
import { logger } from "../../utils/logger.ts";
import {
  globalConfigDir,
  TAWASSUL_ROSTER_FILE,
  TAWASSUL_ROSTER_FILE_LEGACY,
  type InstallScope,
} from "../../utils/path-resolver.ts";
import { readJsoncObject } from "../../utils/opencode-config.ts";

export class ConfigManager {
  config: TawassulConfig = {};
  private stateDir: string;
  private safeConfigPath: (name: string | undefined, fallback: string) => string;
  
  private scope: InstallScope;

  constructor(
    stateDir: string,
    safeConfigPath: (name: string | undefined, fallback: string) => string,
    scope?: InstallScope,
  ) {
    this.stateDir = stateDir;
    this.safeConfigPath = safeConfigPath;
    this.scope = scope ?? "project";
  }

  configPath(): string {
    return this.safeConfigPath(this.config.configFile, "tawassul.json");
  }

  deepMergeConfig(base: TawassulConfig, override: TawassulConfig): TawassulConfig {
    const result = { ...base, ...override } as TawassulConfig;
    if (override.agentEvaluation || base.agentEvaluation) {
      result.agentEvaluation = {
        ...(base.agentEvaluation || {}),
        ...(override.agentEvaluation || {}),
      } as EvaluationConfig;
    }
    if (override.innovations || base.innovations) {
      
      
      result.innovations = {
        ...(base.innovations || {}),
        ...(override.innovations || {}),
      };
    }
    if (override.agentModels || base.agentModels) {
      const mergedModels: Record<string, AgentModelConfig> = { ...(base.agentModels || {}) };
      if (override.agentModels) {
        for (const [k, v] of Object.entries(override.agentModels)) {
          if (mergedModels[k]) {
            mergedModels[k] = { ...mergedModels[k], ...v };
            if (v.models && mergedModels[k].models) {
              mergedModels[k].models = [...mergedModels[k].models, ...v.models];
            }
          } else {
            mergedModels[k] = v;
          }
        }
      }
      result.agentModels = mergedModels;
    }
    return result;
  }

  loadConfig(): TawassulConfig {
    this.config = {} as TawassulConfig;
    if (!this.stateDir) return this.config;

    try {
      
      const g = globalConfigDir();
      const globalPath = existsSync(resolve(g, TAWASSUL_ROSTER_FILE))
        ? resolve(g, TAWASSUL_ROSTER_FILE)
        : resolve(g, TAWASSUL_ROSTER_FILE_LEGACY);

      
      const safeGlobalPath = resolveSafePathSync(globalPath, g);
      if (safeGlobalPath && existsSync(safeGlobalPath)) {
        
        const globalParsed = readJsoncObject(readFileSync(safeGlobalPath, "utf-8"));
        
        
        
        
        const baseForParse = { ...(globalParsed as Record<string, unknown>) };
        if (this.scope === "project") {
          delete baseForParse.agents;
          delete baseForParse.deleted;
        }
        const globalResult = configSchema.safeParse(baseForParse);
        if (globalResult.success) {
          this.config = globalResult.data as TawassulConfig;
        }
      }
    } catch (e) {
      logger.warn(t("configGlobalLoadFailed"), e);
    }

    const fp = this.configPath();

    
    const safeFp = resolveSafePathSync(fp, this.stateDir);
    if (!safeFp) {
      if (this.scope !== "global") logger.warn(`⛔ Config path rejected (symlink traversal):`, fp);
      return this.config;
    }

    try {
      if (!existsSync(safeFp)) return this.config;
      
      const parsed = readJsoncObject(readFileSync(safeFp, "utf-8"));
      const result = configSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `${(issue.path as (string | number)[]).join(".")}: ${issue.message}`)
          .join("; ");
        logger.warn(t("configValidationFailed", { issues }));
        return this.config;
      }
      this.config = this.deepMergeConfig(this.config, result.data as TawassulConfig);
    } catch (e) {
      logger.warn(t("loadConfigFailed"), e);
    }

    return this.config;
  }
}
