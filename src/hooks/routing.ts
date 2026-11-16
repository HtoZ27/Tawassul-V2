import { logger } from "../utils/logger.ts";

export const REPORT_PATH_SENTINEL = "[[tawassul:report-path:v1]]";
export const REPORT_PATH_CLAUSE =
  "\n\nReport back to the coordinator that sent you this work. If you are blocked, state what you tried, what blocked you, and what you need next. If you pass this work on, repeat this instruction.\n\n" +
  REPORT_PATH_SENTINEL;
export const MIN_RING_PROMPT = 32;
export const RING_CAP = 64;
export const RING_TTL_MS = 10 * 60 * 1000;

export const TAWA_MENTION_REGEX = /(?:^|\s|[\W])@tawa\b|(?<![\p{L}])tawa(?![\p{L}])/iu;

export const EXPLICIT_DISPATCH_REGEX =
  /\bdispatch\b|\bdistribute\b|\bdelegate\b|\bhand[ -]?off\b|send[\s\S]{0,25}to agents|assign[\s\S]{0,25}to agents|route[\s\S]{0,25}to agents/iu;

export type RoutingMode = "tawa" | "direct" | "explicit" | "normal";
export type RoutingSource = "classified" | "dispatch" | "override";

export type RoutingRecord = {
  mode: RoutingMode;
  directAgent: string | null;
  preferredAgent: string | null;
  source: RoutingSource;
  latched: boolean;
};

export type PromptRingEntry = {
  dispatcherSessionID: string;
  prompt: string;
  mode: RoutingMode;
  at: number;
};

export type RoutingDecisionState = {
  existing?: RoutingRecord;
  directAgent?: string | null;
  ring: readonly PromptRingEntry[];
  now?: number;
};

export function normalizePrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function hasReportPathSentinel(text: string): boolean {
  return text.trimEnd().endsWith(REPORT_PATH_SENTINEL);
}

export function classifyContent(content: string): RoutingMode {
  if (TAWA_MENTION_REGEX.test(content)) return "tawa";
  if (EXPLICIT_DISPATCH_REGEX.test(content)) return "explicit";
  return "normal";
}

export function defaultRoutingRecord(): RoutingRecord {
  return {
    mode: "normal",
    directAgent: null,
    preferredAgent: null,
    source: "classified",
    latched: false,
  };
}

function classifyWithDirect(content: string, directAgent: string | null): RoutingMode {
  if (TAWA_MENTION_REGEX.test(content)) return "tawa";
  if (directAgent) return "direct";
  if (EXPLICIT_DISPATCH_REGEX.test(content)) return "explicit";
  return "normal";
}

export function matchPromptRing(
  content: string,
  ring: readonly PromptRingEntry[],
  now = Date.now(),
): PromptRingEntry | null {
  const normalized = normalizePrompt(content);
  for (let i = ring.length - 1; i >= 0; i -= 1) {
    const entry = ring[i];
    if (!entry) continue;
    if (now - entry.at > RING_TTL_MS) continue;
    if (normalized.includes(normalizePrompt(entry.prompt))) return entry;
  }
  return null;
}

export function resolveRouting(
  sessionID: string,
  content: string,
  state: RoutingDecisionState,
): RoutingRecord {
  const now = state.now ?? Date.now();
  const sentinel = hasReportPathSentinel(content);
  const existing = state.existing;
  if (!existing) {
    const hit = matchPromptRing(content, state.ring, now);
    if (hit && (hit.mode !== "tawa" || sentinel)) {
      logger.info(
        `[routing] dispatch ring hit session=${sessionID} dispatcher=${hit.dispatcherSessionID} mode=${hit.mode} sentinel=${sentinel}`,
      );
      return {
        mode: hit.mode === "tawa" ? "tawa" : "normal",
        directAgent: null,
        preferredAgent: null,
        source: "dispatch",
        latched: true,
      };
    }
    if (hit) {
      logger.warn(
        `[routing] tawa ring hit without the sentinel session=${sessionID} dispatcher=${hit.dispatcherSessionID}; classifying the message`,
      );
    }
    if (sentinel) {
      logger.info(`[routing] sentinel-only dispatch record session=${sessionID}`);
      return { mode: "tawa", directAgent: null, preferredAgent: null, source: "dispatch", latched: false };
    }
    const mode = classifyWithDirect(content, state.directAgent ?? null);
    return {
      mode,
      directAgent: mode === "direct" ? (state.directAgent ?? null) : null,
      preferredAgent: null,
      source: "classified",
      latched: false,
    };
  }
  if (existing.source === "dispatch" && existing.latched) {
    return { ...existing, preferredAgent: null };
  }
  const mode = classifyWithDirect(content, state.directAgent ?? null);
  return {
    mode,
    directAgent: mode === "direct" ? (state.directAgent ?? null) : null,
    preferredAgent: null,
    source: "classified",
    latched: false,
  };
}
