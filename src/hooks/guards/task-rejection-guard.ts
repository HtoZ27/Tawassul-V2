import { guardWithRetry } from "./shared.ts";
import { logger } from "../../utils/logger.ts";
import { parseTask } from "../../utils/parse-task.ts";
import { normalizeName } from "../../utils/name-utils.ts";
import type { ParsedTask } from "../../utils/parse-task.ts";

const MAX_TASK_LENGTH = 10000;

const BLOCKED_PHRASES = [
  /\brm\s+-[rf]+\b/i,
  /\bdelete\s+(?:everything|all\s+(?:data|files|records)|database|schema|the\s+entire)\b/i,
  /\bremove\s+(?:all|everything)\b/i,
  /\bdestroy\s+(?:everything|all|database|schema)\b/i,
  /\bwipe\s+(?:all|everything|(?:the\s+)?database)\b/i,
  /\bformat\s+[a-z]:\s*\/fs:/i,
  /\bbypass\s+(?:the\s+)?(?:security|authentication|login|2fa|mfa|password|policy|gate)\b/i,
  /\bdisable\s+(?:security|guard|protection|check)\b/i,
  /\boverride\s+(?:security|restriction|block|guard)\b/i,
  /\bignore\s+(?:all\s+)?(?:safety|security|policy)\b/i,
  /\bskip\s+(?:safety|security|policy|check)\b/i,
  /\bunlimited\s+(?:access|privileges?|permissions?)\b/i,
  /\bforce\s+(?:delete|overwrite|rm|uninstall|disable)\b/i,
];

const ANALYTICAL_FRAMING =
  /\b(?:analy[sz]e?|evaluat|assess|consider|review|discuss|explain|summar|compar|investigat|inspect|explor|identif|determin|check\s+whether|verif|confirm|plan|propos|recommend|suggest|weigh|justif|argu|critic|debate|reflect|outline|describ|assess|what\s+if|should\s+(?:we|i|it)|is\s+it\s+(?:safe|ok|wise)|weighing)\b|(?:هل|قيّم|ناقش|حلّل|راجع|اشرح|وضّح|استكشف|حقّق|خطّط|اقترح)\b/i;

const BLOCKED_ROLES = ["root", "admin", "superuser", "sudo"];

const EXECUTION_INTENT =
  /\b(?:execut|run\b|implement|carry\s+out|go\s+ahead|proceed|do\s+it|apply\b|invoke|perform\b|trigger|actually\s+do)\b|(?:نفّذ|شغّل|طبّق|احذف|فعّل)\b/i;

export { parseTask };
export type { ParsedTask };

export const taskRejectionGuard = guardWithRetry(
  "task-rejection",
  (_ctx, input, output) => {
    if (input.tool !== "task" && input.tool !== "handoff") return null;
    const rawTask = output.args?.task ?? output.args?.prompt ?? "";
    if (typeof rawTask !== "string" || !rawTask.trim()) return null;

    if (rawTask.length > MAX_TASK_LENGTH) {
      logger.audit("TASK_REJECTION_BLOCKED", {
        agent: input.agent,
        tool: input.tool,
        reason: "task_too_long",
        length: rawTask.length,
      });
      return `🚫 Task length ${rawTask.length} characters exceeds the limit ${MAX_TASK_LENGTH}`;
    }

    const parsed = parseTask(rawTask);
    if (!parsed) return null;

    for (const role of BLOCKED_ROLES) {
      if (parsed.agent.toLowerCase() === role.toLowerCase()) {
        logger.audit("TASK_REJECTION_BLOCKED", {
          agent: input.agent,
          tool: input.tool,
          role: parsed.agent,
          task: parsed.task,
        });
        return `🚫 Cannot dispatch a task to "${parsed.agent}" — blocked role`;
      }
    }

    if (normalizeName(input.agent ?? "") === "tawa") return null;

    const framed = ANALYTICAL_FRAMING.test(parsed.task);
    const executing = EXECUTION_INTENT.test(parsed.task);
    if (framed && !executing) return null;

    for (const pattern of BLOCKED_PHRASES) {
      if (pattern.test(parsed.task)) {
        logger.audit("TASK_REJECTION_BLOCKED", {
          agent: input.agent,
          tool: input.tool,
          pattern: pattern.source,
          task: parsed.task,
        });
        return `🚫 Task description contains a blocked pattern: "${pattern.source}"`;
      }
    }

    return null;
  },
  2,
);