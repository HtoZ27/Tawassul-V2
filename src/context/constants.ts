

import { buildAgentsMdDefault } from "../agent-templates.ts";
import { ALL_AGENTS } from "../core/agent-data.ts";
import type { EvaluationConfig } from "./types.ts";

export const STATE_VERSION = 5;
export const STATE_FILE_DEFAULT = "tawassul-state.json";
export const TAWA_PREFS_FILE = "tawa-prefs.json";

export const SUGGESTED_HANDOFFS_DEFAULT: Record<string, string[]> = {
  "@analyst": ["@architect"],
  "@architect": ["@dev"],
  "@dev": ["@reviewer"],
  "@reviewer": ["@dev", "@tester"],
  "@tester": ["@dev"],
};


export const AGENTS_DEFAULT: readonly string[] = ALL_AGENTS.map((a) => `@${a.name}`);

export const MAX_RECORDS_DEFAULT = 5000;
export const MAX_HANDOFFS_DEFAULT = 2000;
export const MAX_COMPACT_ITEMS_DEFAULT = 20;

export const MAX_DYNAMIC_AGENTS_DEFAULT = 50;

export const MAX_TASK_LENGTH = 1024;

export const DEFAULT_PARALLEL_COPIES = 5;

export const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  ar: "ar-SA",
};

export const SEVERITY_EMOJIS: Record<string, string> = {
  critical: "🔴",
  severe: "🟠",
  moderate: "🟡",
  minor: "🔵",
};

export const EVALUATION_DEFAULTS: EvaluationConfig = {
  enabled: true,
  minCompletionRatio: 0.3,
  minContextLengthAvg: 10,
  minTaskLengthAvg: 5,
  minRecordsPerAgent: 1,
};

export const AGENTS_MD_DEFAULT: Record<string, string> = buildAgentsMdDefault();

export const SCORE_WEIGHTS = {
  completedAsRecipient: 15,
  completedCap: 45,
  checkpointUsed: 10,
  checkpointCap: 20,
  recordCreated: 5,
  recordCap: 15,
  droppedHandoff: -20,
  emptyCheckpoint: -10,
  rapidReHandoff: -10,
  validationError: -5,
  validationErrorCap: -25,
  helpRequestSent: -3,
  helpRequestSentCap: -15,
  helpRequestFulfilled: 5,
  helpRequestFulfilledCap: 20,
};
