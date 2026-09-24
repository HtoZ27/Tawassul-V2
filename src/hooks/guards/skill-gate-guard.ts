
import { guard, getCurrentAgent } from "./shared.ts";

let skillGateEnabled = true;

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
  return `⏭️ SKIP: agent "${input.agent}" has no registered capabilities in capabilityTracker. Instead of running ${input.tool} directly, route the task via task(desc: '${input.agent}') or update the capability record first.`;
});
