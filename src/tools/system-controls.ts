import { tool } from "../tool.ts";
import { resolve } from "node:path";
import { copyFile, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { t } from "../translations.ts";



export type PauseState = {
  active: boolean;
  reason: string;
  pausedAt: string;
  pausedBy: string;
  scope: "all" | "handoffs" | "tasks" | "agent";
  affectedHandoffs: string[];
  originalStatuses?: Record<string, string>;
};

interface HandoffLike {
  id: string;
  status: string;
  [key: string]: unknown;
}



export function buildPauseTool(
  getPauseState: () => PauseState | null,
  setPauseState: (state: PauseState | null) => void,
  getHandoffs: () => HandoffLike[],
  setHandoffs: (handoffs: HandoffLike[]) => void,
  saveState: () => Promise<void>,
  addWarning: (entry: {
    agent: string;
    content: string;
    tags: string[];
    importance: "low" | "medium" | "high";
  }) => void,
) {
  return tool({
    description: [
      "⏸️ Pause the workflow — stop dispatching new tasks.",
      "",
      "When paused:",
      "- No new handoffs will be created",
      "- Existing handoffs continue until completion",
      "- Use resume() to continue",
      "",
      "EXAMPLES:",
      "  pause()                         — pause with default reason",
      '  pause(reason: "waiting for review")  — pause with specific reason',
    ].join("\n"),
    args: {
      reason: tool.schema.string().optional().describe("Reason for pausing (default: 'manual pause')"),
      scope: tool.schema.enum(["all", "handoffs", "tasks"]).optional().describe("Scope of pause (default: all)"),
    },
    async execute(args, cctx) {
      const current = getPauseState();
      if (current?.active) {
        return {
          output: `⚠️ System already paused since ${current.pausedAt}\nReason: ${current.reason}\nUse resume() first.`,
        };
      }
      const reason = args.reason || "manual pause";
      const scope = args.scope || "all";
      const handoffs = getHandoffs() ?? [];
      const activeHandoffs = handoffs.filter((h) => h.status === "pending" || h.status === "accepted");
      const originalStatuses: Record<string, string> = {};
      for (const h of activeHandoffs) {
        originalStatuses[h.id] = h.status;
      }
      const affectedIds = activeHandoffs.map((h) => h.id);
      const updatedHandoffs = handoffs.map((h) =>
        affectedIds.includes(h.id) ? { ...h, status: "paused" as const } : h,
      );
      setHandoffs(updatedHandoffs);
      const pauseState: PauseState = {
        active: true,
        reason,
        pausedAt: new Date().toISOString(),
        pausedBy: cctx.agent,
        scope,
        affectedHandoffs: affectedIds,
        originalStatuses,
      };
      setPauseState(pauseState);
      addWarning({
        agent: cctx.agent,
        content: `Paused system: ${reason}`,
        tags: ["pause", "workflow"],
        importance: "high",
      });
      saveState();
      return {
        output: [
          `⏸️ **System paused**`,
          ``,
          `- **Reason:** ${reason}`,
          `- **Scope:** ${scope}`,
          `- **Affected:** ${affectedIds.length} handoffs`,
          `- **Paused by:** ${cctx.agent}`,
          ``,
          `Use \`resume()\` to continue.`,
        ].join("\n"),
      };
    },
  });
}



export function buildResumeTool(
  getPauseState: () => PauseState | null,
  setPauseState: (state: PauseState | null) => void,
  getHandoffs: () => HandoffLike[],
  setHandoffs: (handoffs: HandoffLike[]) => void,
  saveState: () => Promise<void>,
  addDecision: (entry: {
    agent: string;
    content: string;
    tags: string[];
    importance: "low" | "medium" | "high";
  }) => void,
) {
  return tool({
    description: [
      "▶️ Resume the workflow after a pause.",
      "",
      "When resumed:",
      "- Paused handoffs are reactivated",
      "- New tasks can be dispatched again",
      "",
      "EXAMPLES:",
      "  resume()  — resume the workflow",
    ].join("\n"),
    args: {},
    async execute(_args, cctx) {
      const current = getPauseState();
      if (!current?.active) {
        return { output: `✅ System is already running. No pause to resume from.` };
      }
      const affectedIds = current.affectedHandoffs;
      const originalStatuses = current.originalStatuses ?? {};
      const handoffs = getHandoffs() ?? [];
      const updatedHandoffs = handoffs.map((h) => {
        if (affectedIds.includes(h.id) && h.status === "paused") {
          const originalStatus = originalStatuses[h.id] ?? "pending";
          return { ...h, status: originalStatus as "pending" | "accepted" };
        }
        return h;
      });
      setHandoffs(updatedHandoffs);
      setPauseState(null);
      addDecision({
        agent: cctx.agent,
        content: `Resumed after pause: ${current.reason}`,
        tags: ["resume", "workflow"],
        importance: "high",
      });
      saveState();
      return {
        output: [
          `▶️ **System resumed**`,
          ``,
          `- **Previously paused:** ${current.reason}`,
          `- **Reactivated:** ${affectedIds.length} handoffs`,
          `- **Resumed by:** ${cctx.agent}`,
        ].join("\n"),
      };
    },
  });
}



const ALLOWED_AGENTS = ["@analyst"];

export function buildPanicTool(clearAllState: () => string, stateDir?: string) {
  return tool({
    description: [
      "🧹 Panic reset — clear all Tawassul state and start fresh.",
      "",
      "Deletes all handoffs, records, agent errors, ratings,",
      "discussions, and dynamic agents. Pause state is also cleared.",
      "",
      "WARNING: This action CANNOT be undone (but a backup is created).",
      "Use only when the system is frozen or unrecoverable.",
      "",
      "EXAMPLES:",
      "  panic()  — reset everything after confirmation",
      "  panic(confirm: true)  — skip confirmation prompt",
    ].join("\n"),
    args: {
      confirm: tool.schema.boolean().optional().describe("Skip confirmation prompt"),
    },
    async execute(args, cctx) {
      if (!ALLOWED_AGENTS.some((a) => normalizeName(a) === normalizeName(cctx.agent))) {
        return { output: t("panicNotAllowed", { allowed: ALLOWED_AGENTS.join(", "), agent: cctx.agent }) };
      }
      if (!args.confirm) {
        return {
          output: [
            t("panicTitle"),
            "",
            t("panicBody"),
            t("panicHandoffs"),
            t("panicRecords"),
            t("panicErrors"),
            t("panicDiscussions"),
            t("panicPause"),
            "",
            t("panicBackupNote"),
            t("panicIrreversible"),
            "",
            t("panicConfirm"),
          ].join("\n"),
        };
      }
      if (stateDir) {
        const stateFile = resolve(stateDir, "tawassul-state.json");
        const backupFile = resolve(stateDir, `tawassul-state.panic-backup-${randomUUID()}.json`);
        try {
          await access(stateFile);
          await copyFile(stateFile, backupFile);
        } catch (e) {
          logger.warn("Panic backup failed:", e);
        }
      }
      const summary = clearAllState();
      const backupNote = stateDir ? "\n\n" + t("panicBackupCreated") : "";
      return {
        title: "🚨 Panic Reset Complete",
        output: summary + backupNote,
      };
    },
  });
}
