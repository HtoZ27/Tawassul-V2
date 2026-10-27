import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { t } from "../translations.ts";
import { normalizeName } from "../utils/name-utils.ts";
import type { GoalStatus, GoalItemState } from "../types/goal-types.ts";
import type { GoalStore } from "../services/goal-store.ts";
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

function fmtGoalLine(g: { id: string; status: string; progressPct: number; title: string }): string {
  return `${STATUS_EMOJI[g.status] ?? "•"} **${g.id}** ${g.status} ${g.progressPct}% · ${g.title}`;
}

export function buildGoalTool(store: GoalStore): ToolDefinition {
  return tool({
    description: [
      "Goal Ledger — the caller-agnostic source of truth for objectives.",
      "Survives long sessions, compaction, and restarts (disk-backed).",
      "",
      "⚠️ THIS IS THE ONLY interface to goals/items/DoD — a missing goal or item is",
      "never a data-file or MCP search job: call goal(list/board) to read, then write",
      "here. Do not grep plugin files for goal storage.",
      "",
      "WRITE — create: goal(create: <title>) [+ detail, items, acceptance, linkedRecords, linkedHandoffs, parentId]",
      "WRITE — update: goal(update: <G-xxx>) [+ title, detail, state, itemId+itemState, itemId+itemTitle, itemEvidence, acceptId+acceptState, itemsAdd, acceptanceAdd, pinned]",
      "WRITE — evidence: goal(evidence: <G-xxx>, evidenceText: <text>)",
      "WRITE — DoD: goal(update: <G-xxx>, acceptId: <criterion>, acceptState: met|not_met[, acceptEvidence: <note>]) — met requires evidence (≥8 chars)",
      "WRITE — close: goal(close: <G-xxx>) [+ verify: true] — completed/verified ONLY if every DoD is met and no items are unfinished (mechanical gate, never prompt-based)",
      "WRITE — delete: goal(delete: <G-xxx>) → dropped (owner or @analyst only)",
      "",
      "READ (never gated, works for the bare main-session model too):",
      '  goal(get: "G-001")            → one goal with items + DoD',
      "  goal(list: true)              → active goals (+ filter: all|open|partial|blocked|completed|verified|dropped|stale)",
      "  goal(board: true)             → tiered digest: attention + compact roster (dozens fit) + counts",
      "",
      "RULES: evidence needs ≥8 chars, no duplicates, ≤100/goal. A goal with no items and no",
      "acceptance criteria can never close (anti-theater). progressPct is always derived from items.",
    ].join("\n"),
    args: {
      create: tool.schema.string().optional().describe("Goal title to create"),
      update: tool.schema.string().optional().describe("Goal ID to update (e.g. G-001)"),
      get: tool.schema.string().optional().describe("Goal ID to read back"),
      list: tool.schema.boolean().optional().describe("List goals (default filter: active)"),
      filter: tool.schema
        .enum(VALID_GOAL_FILTERS as [string, ...string[]])
        .optional()
        .describe("List filter"),
      board: tool.schema.boolean().optional().describe("Tiered digest of all goals"),
      evidence: tool.schema.string().optional().describe("Goal ID to attach evidence to"),
      evidenceText: tool.schema.string().optional().describe("Evidence text (≥8 chars)"),
      close: tool.schema.string().optional().describe("Goal ID to close (completed; verify:true → verified)"),
      verify: tool.schema.boolean().optional().describe("Close as verified instead of completed"),
      delete: tool.schema.string().optional().describe("Goal ID to drop (owner or @analyst)"),
      detail: tool.schema.string().optional().describe("Goal detail/description"),
      state: tool.schema
        .enum(VALID_GOAL_STATES as [string, ...string[]])
        .optional()
        .describe("New goal status"),
      itemId: tool.schema.string().optional().describe("Item ID to transition (with itemState)"),
      itemEvidence: tool.schema
        .array(
          tool.schema.object({
            itemId: tool.schema.string().describe("Item ID the evidence belongs to"),
            text: tool.schema.string().describe("Evidence text (≥8 chars)"),
          }),
        )
        .optional()
        .describe("Item evidence applied before itemState (P2: done and dropped need evidence)"),
      itemState: tool.schema
        .enum(VALID_GOAL_ITEM_STATES as [string, ...string[]])
        .optional()
        .describe("New item state; dropped means the owner decided the item is not needed (records evidence first)"),
      itemTitle: tool.schema.string().optional().describe("New item title (with itemId)"),
      items: tool.schema.array(tool.schema.string()).optional().describe("Item titles (create)"),
      itemsAdd: tool.schema.array(tool.schema.string()).optional().describe("Item titles to append (update)"),
      acceptance: tool.schema.array(tool.schema.string()).optional().describe("DoD criteria (create)"),
      acceptanceAdd: tool.schema.array(tool.schema.string()).optional().describe("DoD criteria to append (update)"),
      acceptId: tool.schema.string().optional().describe("DoD criterion to transition (with acceptState)"),
      acceptState: tool.schema
        .enum(VALID_ACCEPTANCE_STATES as [string, ...string[]])
        .optional()
        .describe("New DoD status"),
      acceptEvidence: tool.schema.string().optional().describe("Evidence for marking a DoD criterion met (≥8 chars)"),
      linkedRecords: tool.schema.array(tool.schema.string()).optional().describe("Linked record IDs (create)"),
      linkedHandoffs: tool.schema.array(tool.schema.string()).optional().describe("Linked handoff IDs (create)"),
      linkedBoards: tool.schema.array(tool.schema.string()).optional().describe("Linked board IDs (create)"),
      parentId: tool.schema.string().optional().describe("Parent goal ID"),
      pinned: tool.schema.boolean().optional().describe("Pin goal (update)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      await store.ensureLoaded();
      const agent = normalizeName(cctx.agent);
      const str = (v: unknown): string => String(v);

      
      if (args.get) {
        const goal = store.get(str(args.get));
        if (!goal) return { output: t("goalNotFound", { id: str(args.get) }) };
        const items = goal.items.map((i) => `  - [${i.state}] ${i.id} · ${i.title}`).join("\n");
        const dod = goal.acceptance.map((d) => `  - [${d.status}] ${d.criterion}`).join("\n");
        return {
          title: `${STATUS_EMOJI[goal.status] ?? "•"} ${goal.id}: ${goal.title}`,
          output: [
            fmtGoalLine(goal),
            goal.detail,
            `owner: ${goal.owner} · updated: ${goal.updatedAt}`,
            goal.items.length > 0 ? `items:\n${items}` : "",
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
        const digest = store.buildDigest();
        return { title: t("goalBoardTitle"), output: digest.text };
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
