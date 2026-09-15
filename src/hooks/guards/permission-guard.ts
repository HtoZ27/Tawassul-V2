import { guardWithRetry, isRootLikeAgent } from "./shared.ts";
import { logger } from "../../utils/logger.ts";
import { t } from "../../translations.ts";
import { TAWASSUL_TOOL_NAMES } from "../../tool-names.ts";
import { normalizeName } from "../../utils/name-utils.ts";
import { resolveRole } from "../../utils/agent.ts";
import { resolveModelAlias, MODEL_CATALOG } from "../../core/model-registry.ts";
import { detectDeletedProtectedAgents, stripJsoncComments } from "../../utils/opencode-config.ts";
import { TASK_PERMISSIONS } from "../../security-policy.ts";
import { AGENTS_DEFAULT } from "../../context/constants.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function extractDeletedNames(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(stripJsoncComments(raw)) as { deleted?: unknown };
    if (!parsed || !Array.isArray(parsed.deleted)) return null;
    return new Set(
      (parsed.deleted as unknown[]).filter((d) => typeof d === "string").map((s) => normalizeName(String(s))),
    );
  } catch {
    return null;
  }
}

export type Tier = "user" | "agent" | "admin";

const TIER_RANK: Record<Tier, number> = { user: 0, agent: 1, admin: 2 };

const TOOL_TIERS: Record<string, Tier> = {
  bash: "admin",
  edit: "admin",
  write: "admin",
  delete: "admin",
  addagent: "admin",
  kick: "admin",
  web: "user",
  fetch: "user",
  search: "user",
  read: "user",
  glob: "user",
  grep: "user",
  task: "agent",
  handoff: "agent",
  discuss: "agent",
  vote: "agent",
  propose: "agent",
};

for (const name of TAWASSUL_TOOL_NAMES) {
  if (!(name in TOOL_TIERS)) TOOL_TIERS[name] = "agent";
}

function isMainSession(agent: string | undefined): boolean {
  return agent === undefined || agent === "" || normalizeName(agent) === "undefined";
}

function isRawModelId(a: string): boolean {
  if (resolveModelAlias(a) !== null) return true;
  if (MODEL_CATALOG.some((m) => m.id === a)) return true;
  return false;
}

function getTier(agent: string): Tier {
  const a = normalizeName(agent);
  if (isMainSession(agent)) return "admin";
  if (a === "addagent") return "admin";
  if (isRootLikeAgent(a)) return "agent";
  if (a === "tawa") return "admin";
  if (a.startsWith("agent:")) return "agent";
  if (resolveRole(a) !== null) return "agent";
  if (isRawModelId(a)) return "admin";
  return "agent";
}

export const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /sudo/,
  /chmod\s+777/,
  /chown/,
  />\s*\/dev/,
  /dd\s+if=/,
  /mkfs/,
  /fdisk/,
  /:\(\)\s*\{/,
  /eval\s+\$\(/,
];

export const permissionGuard = guardWithRetry("3-tier-permissions", (_ctx, input, output) => {
  const agentTier = getTier(input.agent ?? "");
  const toolTier = TOOL_TIERS[input.tool] ?? "admin";
  if (TIER_RANK[agentTier] < TIER_RANK[toolTier]) {
    logger.audit("PERMISSION_BLOCKED", { agent: input.agent, tool: input.tool, agentTier, toolTier });
    const callerRole = resolveRole(input.agent ?? "") ?? input.agent ?? "";
    const helpers = TASK_PERMISSIONS[callerRole];
    const hint = helpers?.length
      ? t("rbacHelpersHint", {
          helpers: helpers.map((h) => `@${h}`).join(", "),
        })
      : "";
    return t("rbacDeniedBase", {
      agent: String(input.agent ?? ""),
      tool: String(input.tool ?? ""),
      tier: toolTier,
      hint,
    });
  }

  const args = output.args ?? {};
  if (input.tool === "addagent" && agentTier !== "admin") {
    logger.audit("PERMISSION_BLOCKED", { agent: input.agent, tool: "addagent", reason: "non-admin" });
    return "🚫 Only the main user can add new agents";
  }

  if (input.tool === "kick" && agentTier !== "admin") {
    logger.audit("PERMISSION_BLOCKED", { agent: input.agent, tool: "kick", reason: "non-admin" });
    return "🚫 Only the main user can remove agents";
  }

  if (input.tool === "bash" && typeof args.command === "string") {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(args.command)) {
        logger.audit("PERMISSION_BLOCKED", { agent: input.agent, tool: "bash", pattern: pattern.source });
        return `🚫 Dangerous bash command blocked: ${pattern.source}`;
      }
    }
  }

  if (["edit", "write", "delete"].includes(input.tool)) {
    const filePath = (args.filePath ?? args.path ?? args.file_path ?? "") as string;
    const isRosterFile =
      typeof filePath === "string" &&
      (filePath.endsWith("opencode.json") ||
        filePath.endsWith("opencode.jsonc") ||
        filePath.endsWith("tawassul.json") ||
        filePath.endsWith("tawassul.jsonc") ||
        filePath.endsWith("tawassul-state.json") ||
        filePath.endsWith("deleted-agents.json"));
    if (isRosterFile) {
      let currentDisk: string | undefined;
      try {
        currentDisk = readFileSync(filePath, "utf8");
      } catch {
        try {
          currentDisk = readFileSync(resolve(process.cwd(), filePath), "utf8");
        } catch {
          currentDisk = undefined;
        }
      }
      let newContent: string;
      if (input.tool === "edit") {
        const oldString = args.oldString as string | undefined;
        const newString = args.newString as string | undefined;
        if (typeof oldString === "string" && typeof newString === "string") {
          newContent =
            currentDisk !== undefined
              ? currentDisk.includes(oldString)
                ? currentDisk.replace(oldString, newString)
                : currentDisk
              : newString;
        } else {
          newContent = (args.content ?? args.newString ?? args.text ?? "") as string;
        }
      } else {
        newContent = (args.content ?? args.newString ?? args.text ?? "") as string;
      }
      if (typeof newContent === "string" && newContent.trim().length > 0) {
        const protectedNames = AGENTS_DEFAULT.map((n) => normalizeName(n));
        const deleted = detectDeletedProtectedAgents(newContent, filePath, protectedNames);
        if (deleted.length > 0) {
          logger.audit("PERMISSION_BLOCKED", {
            agent: input.agent,
            tool: input.tool,
            reason: "protected-agent-delete",
            deleted,
          });
          return `🚫 Deleting protected agents via ${input.tool} is blocked — use kick: ${deleted.join(", ")}`;
        }
        const oldDeletedSet = extractDeletedNames(currentDisk);
        const newDeletedSet = extractDeletedNames(newContent);
        if (oldDeletedSet && newDeletedSet) {
          const removedDeletions = [...oldDeletedSet].filter((n) => !newDeletedSet.has(n));
          if (removedDeletions.length > 0) {
            logger.audit("PERMISSION_BLOCKED", {
              agent: input.agent,
              tool: input.tool,
              reason: "deleted-list-shrink",
              removedDeletions,
            });
            return `🚫 Removing names from the deleted list via ${input.tool} is blocked — re-add the agent via addagent: ${removedDeletions.join(", ")}`;
          }
        }
      }
    }
  }

  return null;
});
