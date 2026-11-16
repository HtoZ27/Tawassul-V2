import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { t } from "../translations.ts";
import { normalizeName } from "../utils/name-utils.ts";
import type { GoalStatus, GoalItemState } from "../types/goal-types.ts";
import type { GoalStore } from "../services/goal-store.ts";
import { formatHostGoal, hostGoalSuffix, readHostGoal } from "../services/host-goal.ts";
import { GoalStatusSchema, GoalItemStateSchema, GoalListFilterSchema } from "../validation.ts";



export const VALID_GOAL_STATES = GoalStatusSchema.options as readonly string[];
export const VALID_GOAL_ITEM_STATES = GoalItemStateSchema.options as readonly string[];
export const VALID_GOAL_FILTERS = GoalListFilterSchema.options as readonly string[];
export const VALID_ACCEPTANCE_STATES = ["met", "not_met"] as readonly string[];

const STATUS_EMOJI: Record<string, string> = {
  open: "🆕",
  in_progress: "🔨",
  partial: "◐",
  blocked: "🚧",
  completed: "✅",
  verified: "✔",
  dropped: "🗑",
  stale: "⏳",
};

function fmtGoalLine(g: { id: string; status: string; closedAs?: string; progressPct: number; title: string }): string {
  const status = g.closedAs ?? g.status;
  return `${STATUS_EMOJI[status] ?? "•"} **${g.id}** ${status} ${g.progressPct}% · ${g.title}`;
}

export function buildGoalTool(store: GoalStore): ToolDefinition {
  return tool({
    description: [
      "Goal Ledger — the caller-agnostic source of truth for objectives; disk-backed, survives compaction and restarts.",
      "⚠️ THIS IS THE ONLY interface to goals/items/DoD — never search data files, plugin files or the MCP server: read with goal(list/board).",
      "",
      "create: goal(create: <title>) [+ detail, items, acceptance, linkedRecords, linkedHandoffs, parentId]",
      "update: <G-xxx> [+ title, detail, state, itemId+itemState/itemTitle/itemEvidence, acceptId+acceptState, acceptRetireId+acceptRetireReason, itemsAdd, acceptanceAdd, pinned]",
      "evidence: goal(evidence: <G-xxx>, evidenceText: <text>)",
      "DoD: goal(update: <G-xxx>, acceptId: <criterion>, acceptState: met|not_met[, acceptEvidence: <note>]) — met requires evidence (≥8 chars)",
      "close: goal(close: <G-xxx>) [+ verify: true] — completed/verified ONLY if every DoD is met and no items are unfinished (mechanical gate, never prompt-based)",
      "delete: goal(delete: <G-xxx>) → dropped (owner or @analyst only)",
      "",
      "READ (never gated):",
      '  goal(get: "G-001") → one goal + items + DoD',
      "  goal(list: true) → active goals (+ filter: all|open|partial|blocked|completed|verified|dropped|stale)",
      "  goal(board: true) → tiered digest: attention + roster + counts",
      "",
      'HOST (read-only): goal(host: true) / goal(get: "host") reads the host /goal; goal(board: true) appends it. Never sets, pauses, resumes or clears it — use /goal pause|resume|clear.',
      "",
      "RULES: evidence ≥8 chars, no duplicates, ≤100/goal. A goal with no items and no acceptance criteria can never close. progressPct is derived from items.",
    ].join("\n"),
    args: {
      create: tool.schema.string().optional().describe("Goal title"),
      update: tool.schema.string().optional().describe("Goal ID to update"),
      get: tool.schema.string().optional().describe("Goal ID to read"),
      list: tool.schema.boolean().optional().describe("List goals (default: active)"),
      filter: tool.schema
        .enum(VALID_GOAL_FILTERS as [string, ...string[]])
        .optional()
        .describe("List filter"),
      board: tool.schema.boolean().optional().describe("Tiered goal digest"),
      host: tool.schema.boolean().optional().describe("Read the host /goal state (read-only)"),
      evidence: tool.schema.string().optional().describe("Goal ID for evidence"),
      evidenceText: tool.schema.string().optional().describe("Evidence (≥8 chars)"),
      close: tool.schema.string().optional().describe("Goal ID to close"),
      verify: tool.schema.boolean().optional().describe("Close as verified"),
      delete: tool.schema.string().optional().describe("Goal ID to drop"),
      detail: tool.schema.string().optional().describe("Goal detail"),
      state: tool.schema
        .enum(VALID_GOAL_STATES as [string, ...string[]])
        .optional()
        .describe("New goal status"),
      itemId: tool.schema.string().optional().describe("Item ID to transition"),
      itemEvidence: tool.schema
        .array(
          tool.schema.object({
            itemId: tool.schema.string().describe("Item ID"),
            text: tool.schema.string().describe("Evidence (≥8 chars)"),
          }),
        )
        .optional()
        .describe("Item evidence before itemState"),
      itemState: tool.schema
        .enum(VALID_GOAL_ITEM_STATES as [string, ...string[]])
        .optional()
        .describe("New item state (dropped needs evidence)"),
      itemTitle: tool.schema.string().optional().describe("New item title"),
      items: tool.schema.array(tool.schema.string()).optional().describe("Item titles (create)"),
      itemsAdd: tool.schema.array(tool.schema.string()).optional().describe("Item titles to append"),
      acceptance: tool.schema.array(tool.schema.string()).optional().describe("DoD criteria (create)"),
      acceptanceAdd: tool.schema.array(tool.schema.string()).optional().describe("DoD criteria to append"),
      acceptId: tool.schema.string().optional().describe("DoD criterion to transition"),
      acceptState: tool.schema
        .enum(VALID_ACCEPTANCE_STATES as [string, ...string[]])
        .optional()
        .describe("New DoD status"),
      acceptEvidence: tool.schema.string().optional().describe("Evidence for met DoD (≥8 chars)"),
      acceptRetireId: tool.schema.string().optional().describe("DoD criterion to retire"),
      acceptRetireReason: tool.schema
        .string()
        .optional()
        .describe("Retirement reason (≥8 chars)"),
      linkedRecords: tool.schema.array(tool.schema.string()).optional().describe("Linked record IDs"),
      linkedHandoffs: tool.schema.array(tool.schema.string()).optional().describe("Linked handoff IDs"),
      linkedBoards: tool.schema.array(tool.schema.string()).optional().describe("Linked board IDs"),
      parentId: tool.schema.string().optional().describe("Parent goal ID"),
      pinned: tool.schema.boolean().optional().describe("Pin goal"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      await store.ensureLoaded();
      const agent = normalizeName(cctx.agent);
      const str = (v: unknown): string => String(v);

      const hostRead =
        args.host === true ||
        (typeof args.get === "string" && args.get.trim().toLowerCase() === "host");
      if (hostRead) {
        const hostGoal = await readHostGoal(cctx.sessionID);
        if (!hostGoal) {
          return { title: "Host /goal", output: "No host /goal is active for this session." };
        }
        const lines = [
          formatHostGoal(hostGoal),
          `updated: ${new Date(hostGoal.updatedAt).toISOString()}`,
          hostGoal.reason ? `reason: ${hostGoal.reason}` : "",
          hostGoal.stalls !== undefined ? `stalls: ${hostGoal.stalls}` : "",
        ].filter(Boolean);
        return {
          title: `Host /goal · ${hostGoal.status}`,
          output: lines.join("\n"),
          metadata: { hostGoal },
        };
      }

      const hostAlias = [args.update, args.close, args.delete, args.evidence].find(
        (value) => typeof value === "string" && value.trim().toLowerCase() === "host",
      );
      if (hostAlias !== undefined) {
        return {
          output:
            '`host` is the host /goal, not a ledger goal. Use /goal pause, /goal resume, or /goal clear in the host; this tool mirrors it for reading only.',
        };
      }

      
      if (args.get) {
        const goal = store.getAny(str(args.get));
        if (!goal) return { output: t("goalNotFound", { id: str(args.get) }) };
        const items = goal.items.map((i) => `  - [${i.state}] ${i.id} · ${i.title}`).join("\n");
        const completed = goal.completedItems.map((i) => `  - [done] ${i.id} · ${i.title}`).join("\n");
        const dod = goal.acceptance.map((d) => `  - [${d.status}] ${d.criterion}`).join("\n");
        const status = goal.closedAs ?? goal.status;
        return {
          title: `${STATUS_EMOJI[status] ?? "•"} ${goal.id}: ${goal.title}`,
          output: [
            fmtGoalLine(goal),
            goal.detail,
            `owner: ${goal.owner} · updated: ${goal.updatedAt}`,
            goal.items.length > 0 ? `items:\n${items}` : "",
            goal.completedItems.length > 0 ? `completed:\n${completed}` : "",
            goal.acceptance.length > 0 ? `acceptance:\n${dod}` : "",
            goal.evidence.length > 0 ? `evidence: ${goal.evidence.length}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { goal },
        };
      }
      if (args.list) {
        const filter = (args.filter as string | undefined) ?? "active";
        if (!VALID_GOAL_FILTERS.includes(filter)) {
          return { output: t("goalInvalidFilter", { filter, allowed: VALID_GOAL_FILTERS.join(", ") }) };
        }
        const goals = store.list(filter as Parameters<GoalStore["list"]>[0]);
        if (goals.length === 0) return { output: t("goalEmpty") };
        return {
          title: t("goalListTitle", { count: String(goals.length) }),
          output: goals.map(fmtGoalLine).join("\n"),
        };
      }
      if (args.board) {
        const digest = store.buildDigest({ terminalCounts: true });
        const hostGoal = await readHostGoal(cctx.sessionID);
        return {
          title: t("goalBoardTitle"),
          output: `${digest.text}${store.staleSection()}${hostGoalSuffix(hostGoal)}`,
        };
      }

      
      if (args.delete) {
        const id = str(args.delete);
        const goal = store.get(id);
        if (!goal) return { output: t("goalNotFound", { id }) };
        if (normalizeName(goal.owner) !== agent && agent !== "analyst") {
          return { output: t("goalNoPermission", { id, owner: goal.owner }) };
        }
        const res = await store.deleteGoal(id);
        if (!res.ok) {
          if (res.reason === "locked") return { output: t("goalLocked") };
          return { output: t("goalTransitionBlocked", { missing: (res.missing ?? []).join(", ") }) };
        }
        return { title: `🗑 ${id} dropped`, output: t("goalDropped", { id, title: goal.title }) };
      }
      if (args.close) {
        const id = str(args.close);
        const res = await store.close(id, args.verify === true, agent);
        if (!res.ok) {
          if (res.reason === "locked") return { output: t("goalLocked") };
          if (res.reason === "not-found") return { output: t("goalNotFound", { id }) };
          return { output: t("goalInvariantBlocked", { missing: (res.missing ?? []).join("; ") }) };
        }
        const closed = res.goal;
        return args.verify === true
          ? { title: `✔ ${id} verified`, output: t("goalVerified", { id, title: closed.title }) }
          : { title: `✅ ${id} completed`, output: t("goalClosed", { id, title: closed.title }) };
      }
      if (args.evidence) {
        const id = str(args.evidence);
        if (!args.evidenceText) return { output: t("goalEvidenceRequired") };
        const res = await store.appendEvidence(id, str(args.evidenceText));
        if (!res.ok) {
          if (res.reason === "locked") return { output: t("goalLocked") };
          if (res.reason === "not-found") return { output: t("goalNotFound", { id }) };
          return { output: t("goalEvidenceRejected", { reason: res.reason }) };
        }
        return { output: t("goalEvidenceOk", { id, count: String(res.goal.evidence.length) }) };
      }
      if (args.update) {
        const id = str(args.update);
        
        
        
        if (args.state === "completed" || args.state === "verified") {
          return { output: t("goalUseClose", { id }) };
        }
        if (
          args.itemId &&
          args.itemState === undefined &&
          args.itemTitle === undefined &&
          args.itemEvidence === undefined
        ) {
          return { output: t("goalItemStateRequired") };
        }
        if ((args.acceptRetireId === undefined) !== (args.acceptRetireReason === undefined)) {
          return { output: t("goalAcceptanceRetirePair") };
        }
        const res = await store.update(id, {
          ...(args.title !== undefined ? { title: str(args.title) } : {}),
          ...(args.detail !== undefined ? { detail: str(args.detail) } : {}),
          ...(args.state !== undefined ? { status: args.state as GoalStatus } : {}),
          ...(args.parentId !== undefined ? { parentId: str(args.parentId) } : {}),
          ...(args.pinned !== undefined ? { pinned: args.pinned === true } : {}),
          ...(args.itemId && args.itemState
            ? { itemStates: [{ itemId: str(args.itemId), state: args.itemState as GoalItemState }] }
            : {}),
          ...(args.itemId && args.itemTitle !== undefined
            ? { itemTitles: [{ itemId: str(args.itemId), title: str(args.itemTitle) }] }
            : {}),
          ...(args.itemEvidence !== undefined
            ? { itemEvidence: args.itemEvidence as Array<{ itemId: string; text: string }> }
            : {}),
          ...(args.itemsAdd !== undefined ? { itemsAdd: args.itemsAdd as string[] } : {}),
          ...(args.acceptanceAdd !== undefined ? { acceptanceAdd: args.acceptanceAdd as string[] } : {}),
          
          
          
          ...(args.acceptId !== undefined && args.acceptState !== undefined
            ? {
                acceptanceStates: [{ criterion: str(args.acceptId), status: args.acceptState as "met" | "not_met" }],
              }
            : {}),
          ...(args.acceptId !== undefined && args.acceptEvidence !== undefined
            ? {
                acceptanceEvidence: [{ criterion: str(args.acceptId), text: str(args.acceptEvidence) }],
              }
            : {}),
          ...(args.acceptRetireId !== undefined && args.acceptRetireReason !== undefined
            ? {
                acceptanceRetire: [
                  { criterion: str(args.acceptRetireId), reason: str(args.acceptRetireReason) },
                ],
              }
            : {}),
        });
        if (!res.ok) {
          if (res.reason === "locked") return { output: t("goalLocked") };
          if (res.reason === "not-found") return { output: t("goalNotFound", { id }) };
          if (res.reason === "transition" || res.reason === "invariant") {
            return { output: t("goalTransitionBlocked", { missing: (res.missing ?? []).join("; ") }) };
          }
          if (res.reason === "unknown-item") {
            return { output: t("goalUnknownItem", { item: (res.missing ?? []).join(", ") }) };
          }
          if (res.reason === "item-evidence" || res.reason === "item-evidence-short") {
            return { output: t("goalItemEvidenceBlocked", { item: (res.missing ?? []).join(", ") }) };
          }
          if (res.reason === "acceptance-unknown") {
            return { output: t("goalAcceptanceUnknown", { criterion: (res.missing ?? []).join(", ") }) };
          }
          if (res.reason === "acceptance-evidence" || res.reason === "acceptance-evidence-short") {
            return { output: t("goalAcceptanceEvidenceBlocked", { criterion: (res.missing ?? []).join(", ") }) };
          }
          if (res.reason === "acceptance-reason-short") {
            return { output: t("goalAcceptanceRetireBlocked", { criterion: (res.missing ?? []).join(", ") }) };
          }
          return { output: t("goalRequiredFields") };
        }
        return { title: fmtGoalLine(res.goal), output: t("goalUpdated", { id, title: res.goal.title }) };
      }
      if (args.create) {
        const res = await store.create({
          title: str(args.create),
          detail: args.detail !== undefined ? str(args.detail) : "",
          owner: agent,
          ownerKind: "solo",
          parentId: args.parentId !== undefined ? str(args.parentId) : null,
          items: args.items as string[] | undefined,
          acceptance: args.acceptance as string[] | undefined,
          
          linkedRecords: args.linkedRecords as string[] | undefined,
          linkedHandoffs: args.linkedHandoffs as string[] | undefined,
          linkedBoards: args.linkedBoards as string[] | undefined,
        });
        if (!res.ok) {
          if (res.reason === "locked") return { output: t("goalLocked") };
          if (res.reason === "max") return { output: t("goalMaxReached") };
          return { output: t("goalRequiredFields") };
        }
        return { title: fmtGoalLine(res.goal), output: t("goalCreated", { id: res.goal.id, title: res.goal.title }) };
      }
      return { output: t("goalRequiredFields") };
    },
  });
}
