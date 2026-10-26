
import { guard, getCurrentAgent } from "./shared.ts";
import { logger } from "../../utils/logger.ts";

let skillGateEnabled = true;

const EMPTY_RECORD_WARNED: Set<string> = new Set();
const MAX_EMPTY_RECORD_WARNS = 48;

export const setSkillGateEnabled = (enabled: boolean): void => {
  skillGateEnabled = enabled;
};

export const isSkillGateEnabled = (): boolean => skillGateEnabled;

const SKIP_TOOLS = new Set(["edit", "write", "bash"]);

export const skillGateGuard = guard("skill-gate", (ctx, input) => {
  if (!skillGateEnabled) return null;
  if (!SKIP_TOOLS.has(input.tool)) return null;
  const agent = getCurrentAgent(input);
  if (!agent || agent === "tawa") return null;
  const capabilities = ctx.capabilityTracker?.getCapabilities(agent) ?? [];
  if (capabilities.length > 0) return null;
  if (!EMPTY_RECORD_WARNED.has(agent) && EMPTY_RECORD_WARNED.size < MAX_EMPTY_RECORD_WARNS) {
    EMPTY_RECORD_WARNED.add(agent);
    logger.warn("[tawassul] skill gate: managed agent has no capability record — allowing (bootstrap seed fault)", {
      agent,
      tool: input.tool,
    });
  }
  return null;
});
