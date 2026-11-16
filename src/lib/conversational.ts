import { msg } from "../services/messages.ts";
import type { Lang } from "../services/routing-algorithm.ts";

export type TechnicalError =
  | "circuit_breaker_open"
  | "rate_limited"
  | "call_depth_exceeded"
  | "deleted_agent"
  | "agent_busy"
  | "all_agents_busy"
  | "task_failed"
  | "ambiguous_request"
  | "unknown";

interface TranslateErrorInput {
  error: TechnicalError;
  lang: Lang;
  agent?: string;
  team?: string;
  reason?: string;
}

export function translateError(input: TranslateErrorInput): string {
  const { error, lang, agent, team, reason } = input;
  switch (error) {
    case "circuit_breaker_open":
    case "agent_busy":
      return msg("tawaAgentBusy", lang);
    case "deleted_agent":
      return msg("tawaAgentUnavailable", lang, { team: team || agent || "the team" });
    case "rate_limited":
      return msg("tawaAllAgentsBusy", lang);
    case "call_depth_exceeded":
      return msg("tawaAgentUnavailable", lang, { team: "the system" });
    case "all_agents_busy":
      return msg("tawaAllAgentsBusy", lang);
    case "task_failed":
      return msg("tawaTaskFailed", lang, { reason: reason || "an unexpected error occurred." });
    case "ambiguous_request":
      return msg("tawaIntentUnclear", lang);
    default:
      return msg("tawaTaskFailed", lang, { reason: reason || "an unexpected error occurred." });
  }
}