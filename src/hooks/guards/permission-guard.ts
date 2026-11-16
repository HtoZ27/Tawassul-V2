import { guardWithRetry, isRootLikeAgent } from "./shared.ts";
import type { Input, StageOutput } from "./shared.ts";
import { logger } from "../../utils/logger.ts";
import { t } from "../../translations.ts";
import { TAWASSUL_TOOL_NAMES } from "../../tool-names.ts";
import { normalizeName } from "../../utils/name-utils.ts";
import { resolveRole } from "../../utils/agent.ts";
import { resolveModelAlias, MODEL_CATALOG } from "../../core/model-registry.ts";
import { detectDeletedProtectedAgents, stripJsoncComments } from "../../utils/opencode-config.ts";
import { TASK_PERMISSIONS } from "../../security-policy.ts";
import { AGENTS_DEFAULT } from "../../context/constants.ts";
import { readFile } from "node:fs/promises";
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

function extractPinnedNames(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(stripJsoncComments(raw)) as { pinned?: unknown };
    if (!parsed || !Array.isArray(parsed.pinned)) return null;
    return new Set(
      (parsed.pinned as unknown[]).filter((d) => typeof d === "string").map((s) => normalizeName(String(s))),
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

export async function checkRosterBoundaryDelete(input: Input, output: StageOutput, redirectNote?: string): Promise<string | null> {
  const args = output.args ?? {};
  if (["edit", "write", "delete"].includes(input.tool)) {
    const filePath = (args.filePath ?? args.path ?? args.file_path ?? "") as string;
    const normalized = typeof filePath === "string" ? filePath.replace(/\\/g, "/") : "";
    const isAgentVariantMd = /\.opencode\/agents\/[^/]+\.md$/.test(normalized);
    const isRosterFile =
      typeof filePath === "string" &&
      (filePath.endsWith("opencode.json") ||
        filePath.endsWith("opencode.jsonc") ||
        filePath.endsWith("tawassul.json") ||
        filePath.endsWith("tawassul.jsonc") ||
        filePath.endsWith("tawassul-state.json") ||
        filePath.endsWith("tawassul-pins.json") ||
        isAgentVariantMd);
    if (isRosterFile) {
      if (isAgentVariantMd) {
        logger.audit("PERMISSION_BLOCKED", {
          agent: input.agent,
          tool: input.tool,
          reason: "agent-variant-direct-edit",
          filePath,
        });
        return (
          `🚫 Direct editing of agent files is forbidden — the official path for add/remove is @addagent` +
          (redirectNote ?? "")
        );
      }
      let currentDisk: string | undefined;
      try {
        currentDisk = await readFile(filePath, "utf8");
      } catch {
        try {
          currentDisk = await readFile(resolve(process.cwd(), filePath), "utf8");
        } catch {
          currentDisk = undefined;
        }
      }
      let newContent: string;
      let intentUnverifiable = false;
      if (input.tool === "edit") {
        const oldString = args.oldString as string | undefined;
        const newString = args.newString as string | undefined;
        if (typeof oldString === "string" && typeof newString === "string") {
          if (currentDisk === undefined) {
            newContent = newString;
          } else if (!currentDisk.includes(oldString)) {
            intentUnverifiable = true;
            newContent = "";
          } else {
            newContent = currentDisk.replace(oldString, newString);
          }
        } else {
          newContent = (args.content ?? args.newString ?? args.text ?? "") as string;
        }
      } else {
        newContent = (args.content ?? args.newString ?? args.text ?? "") as string;
      }
      if (intentUnverifiable || newContent.trim().length === 0) {
        logger.audit("PERMISSION_BLOCKED", {
          agent: input.agent,
          tool: input.tool,
          reason: "unverifiable-roster-write",
          filePath,
        });
        return (
          `🚫 Writing an empty or unverifiable roster file via ${input.tool} is forbidden — manage agents via addagent/kick` +
          (redirectNote ?? "")
        );
      }
      {
        const parseAgentKeys = (raw: string | undefined): Set<string> | null => {
          if (!raw) return null;
          try {
            const parsed = JSON.parse(stripJsoncComments(raw)) as { agent?: unknown };
            if (!parsed || typeof parsed.agent !== "object" || parsed.agent === null || Array.isArray(parsed.agent)) {
              return null;
            }
            return new Set(Object.keys(parsed.agent as Record<string, unknown>).map((k) => normalizeName(k)));
          } catch {
            return null;
          }
        };
        const diskKeys = parseAgentKeys(currentDisk);
        const newKeys = parseAgentKeys(newContent);
        if (diskKeys && newKeys) {
          const removedAny = [...diskKeys].filter((k) => !newKeys.has(k));
          if (removedAny.length > 0) {
            logger.audit("PERMISSION_BLOCKED", {
              agent: input.agent,
              tool: input.tool,
              reason: "direct-agent-delete",
              removedAny,
            });
            return `🚫 Removing agents via ${input.tool} outside kick is forbidden — use kick: ${removedAny.join(", ")}${redirectNote ?? ""}`;
          }
          const addedAny = [...newKeys].filter((k) => !diskKeys.has(k));
          if (addedAny.length > 0) {
            logger.audit("PERMISSION_BLOCKED", {
              agent: input.agent,
              tool: input.tool,
              reason: "direct-agent-add",
              addedAny,
            });
            return `🚫 Adding agents via ${input.tool} outside addagent is forbidden — use addagent: ${addedAny.join(", ")}${redirectNote ?? ""}`;
          }
        }
        const protectedNames = [...AGENTS_DEFAULT.map((n) => normalizeName(n)), normalizeName("addagent")];
        const deleted = detectDeletedProtectedAgents(newContent, filePath, protectedNames);
        if (deleted.length > 0) {
          logger.audit("PERMISSION_BLOCKED", {
            agent: input.agent,
            tool: input.tool,
            reason: "protected-agent-delete",
            deleted,
          });
          return `🚫 Deleting protected agents via ${input.tool} is forbidden — use kick: ${deleted.join(", ")}`;
        }
        const isGlobalRoster =
          typeof filePath === "string" &&
          (filePath.endsWith("tawassul.json") || filePath.endsWith("tawassul.jsonc"));
        const oldDeletedSet = isGlobalRoster ? extractDeletedNames(currentDisk) : null;
        const newDeletedSet = isGlobalRoster ? extractDeletedNames(newContent) : null;
        if (oldDeletedSet && newDeletedSet) {
          const removedDeletions = [...oldDeletedSet].filter((n) => !newDeletedSet.has(n));
          if (removedDeletions.length > 0) {
            logger.audit("PERMISSION_BLOCKED", {
              agent: input.agent,
              tool: input.tool,
              reason: "deleted-list-shrink",
              removedDeletions,
            });
            return `🚫 Removing names from the deleted list via ${input.tool} is forbidden — re-add the agent via addagent: ${removedDeletions.join(", ")}`;
          }
        }
        if (typeof filePath === "string" && filePath.endsWith("tawassul-pins.json")) {
          const oldPins = extractPinnedNames(currentDisk);
          const newPins = extractPinnedNames(newContent);
          if (oldPins && newPins) {
            const removedPins = [...oldPins].filter((n) => !newPins.has(n));
            if (removedPins.length > 0) {
              logger.audit("PERMISSION_BLOCKED", {
                agent: input.agent,
                tool: input.tool,
                reason: "pins-shrink",
                removedPins,
              });
              return `🚫 Removing pins via ${input.tool} is forbidden — manage overrides via addagent: ${removedPins.join(", ")}`;
            }
          }
        }
      }
    }
  }
  return null;
}

export const rosterBoundaryDeleteGuard = guardWithRetry("roster-boundary-delete", (_ctx, input, output) =>
  checkRosterBoundaryDelete(input, output),
);

export const permissionGuard = guardWithRetry("3-tier-permissions", async (_ctx, input, output) => {
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

  if (input.tool === "addagent" && agentTier !== "admin") {
    logger.audit("PERMISSION_BLOCKED", { agent: input.agent, tool: "addagent", reason: "non-admin" });
    return "🚫 Only the main user can add new agents";
  }

  if (input.tool === "kick" && agentTier !== "admin") {
    logger.audit("PERMISSION_BLOCKED", { agent: input.agent, tool: "kick", reason: "non-admin" });
    return "🚫 Only the main user can remove agents";
  }

  if (["edit", "write", "delete"].includes(input.tool)) {
    const rosterMsg = await checkRosterBoundaryDelete(input, output);
    if (rosterMsg) return rosterMsg;
  }

  return null;
});
