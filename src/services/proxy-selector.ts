


import { logger } from "../utils/logger.ts";
import { MODEL_PRIORITY } from "./proxy-models.ts";
import { scoreComplexity } from "./proxy-complexity.ts";
import type { TaskContext } from "./proxy-complexity.ts";
import { getFallbackChain, buildDynamicFallbackChain } from "./proxy-fallback-chains.ts";

export interface ModelHealth {
  model: string;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  lastFailure: number | null;
  successRate: number;
}

export interface SelectorResult {
  model: string;
  complexity: "simple" | "medium" | "complex";
  reason: string;
  confidence: number;
}

export function isModelHealthy(model: string, health: Map<string, ModelHealth>): boolean {
  const h = health.get(model);
  if (!h) return true;
  return h.state !== "OPEN";
}

export function selectModel(
  task: TaskContext,
  health: Map<string, ModelHealth>,
  preferences?: Record<string, string>,
): SelectorResult | null {
  const complexity = scoreComplexity(task);

  if (preferences?.[task.role]) {
    const preferred = preferences[task.role]!;
    if (isModelHealthy(preferred, health)) {
      return { model: preferred, complexity, reason: "user preference", confidence: 0.9 };
    }
  }

  const preferredModel = MODEL_PRIORITY[complexity] ?? "opencode/big-pickle";
  if (isModelHealthy(preferredModel, health)) {
    return { model: preferredModel, complexity, reason: `best available for ${complexity}`, confidence: 0.7 };
  }

  const chain = getFallbackChain(task.role);
  const healthy = chain.filter((m) => m !== preferredModel && isModelHealthy(m, health));

  if (healthy.length > 0) {
    const fallback = healthy[0];
    if (!fallback) {
      logger.warn(`⚠️ No healthy fallback for ${task.role}/${complexity}`);
      return null;
    }
    return { model: fallback, complexity, reason: `fallback for ${complexity}`, confidence: 0.6 };
  }

  logger.warn(`⚠️ All models degraded for ${task.role}/${complexity} — no healthy model available`);
  return null;
}

export function selectModelForTask(task: { description: string; fileCount: number }): string {
  const ctx: TaskContext = {
    description: task.description,
    files: new Array(task.fileCount).fill(""),
    role: "dev",
  };
  const c = scoreComplexity(ctx);
  return MODEL_PRIORITY[c] as string;
}





let cachedAgentModelMap: Record<string, string> | undefined;
let cachedModelChoices: Record<string, string> | undefined;

export function setModelPreferences(
  agentModelMap?: Record<string, string>,
  modelChoices?: Record<string, string>,
): void {
  cachedAgentModelMap = agentModelMap;
  cachedModelChoices = modelChoices;
}

export function getModelPreferences(): {
  agentModelMap?: Record<string, string>;
  modelChoices?: Record<string, string>;
} {
  return { agentModelMap: cachedAgentModelMap, modelChoices: cachedModelChoices };
}


export function resetState(): void {
  cachedAgentModelMap = undefined;
  cachedModelChoices = undefined;
}

export function selectModelForTaskDynamic(
  task: { description: string; fileCount: number },
  availableModels: Array<{ id: string; source: string }>,
  role?: string,
): string {
  const ctx: TaskContext = {
    description: task.description,
    files: new Array(task.fileCount).fill(""),
    role: role || "dev",
  };
  const complexity = scoreComplexity(ctx);
  const dynamicChain = buildDynamicFallbackChain(availableModels, role || "dev");

  if (dynamicChain.length > 0) {
    const preferredPatterns: Record<string, string[]> = {
      complex: ["big-pickle", "deepseek", "mimo", "gemini"],
      medium: ["deepseek", "mimo", "gemini", "nemotron"],
      simple: ["deepseek", "gemini", "mimo", "nemotron"],
    };

    const patterns = preferredPatterns[complexity];
    for (const pattern of patterns ?? []) {
      const match = dynamicChain.find((m) => m.toLowerCase().includes(pattern));
      if (match) return match;
    }

    return dynamicChain[0]!;
  }

  return selectModelForTask(task);
}
