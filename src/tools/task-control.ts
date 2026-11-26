import { tool } from "../tool.ts";
import type { BackgroundItem } from "../services/background-tasks.ts";
import {
  BACKGROUND_SNAPSHOT_TTL_MS,
  backgroundControl,
  readBackgroundSnapshot,
} from "../services/background-tasks.ts";

const MAX_FIELD_CHARS = 160;

function clip(value: string): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= MAX_FIELD_CHARS) return single;
  return `${single.slice(0, MAX_FIELD_CHARS - 3)}...`;
}

function itemID(item: BackgroundItem): string {
  if (item.kind === "subagent") return item.childSessionID;
  if (item.kind === "shell") return item.shellID;
  if (item.kind === "codemode") return item.jobID;
  return item.path;
}

function describeItem(item: BackgroundItem): string {
  if (item.kind === "subagent") {
    return `- subagent ${item.childSessionID} | agent=${item.agent} | ${clip(item.description)}`;
  }
  if (item.kind === "shell") {
    return `- shell ${item.shellID} | ${clip(item.command)}`;
  }
  if (item.kind === "codemode") {
    return `- codemode ${clip(item.jobID)}`;
  }
  if (item.kind === "image") {
    return `- image ${clip(item.path)} | model=${item.model}`;
  }
  return `- video ${clip(item.path)}`;
}

function ttlMinutes(): number {
  return Math.round(BACKGROUND_SNAPSHOT_TTL_MS / 60_000);
}

function renderStatus(
  sessionID: string,
  now: number,
): { output: string; metadata: Record<string, unknown> } {
  const snapshot = readBackgroundSnapshot(sessionID, now);
  if (!snapshot.found) {
    return {
      output: [
        `Background status for session ${sessionID}: UNKNOWN.`,
        "No idle snapshot was recorded for this session, so running work cannot be listed and no child can be cancelled or revived from it.",
        "The host may not emit experimental.idle, or the session has not gone idle since Tawassul loaded.",
      ].join("\n"),
      metadata: { action: "status", sessionID, found: false, stale: false, items: 0 },
    };
  }
  const ageSeconds = Math.round(snapshot.ageMs / 1000);
  if (snapshot.stale) {
    return {
      output: [
        `Background status for session ${sessionID}: STALE.`,
        `The snapshot is ${ageSeconds}s old (TTL ${ttlMinutes()}m), so this is history rather than live work.`,
        ...snapshot.items.map(describeItem),
      ].join("\n"),
      metadata: {
        action: "status",
        sessionID,
        found: true,
        stale: true,
        items: snapshot.items.length,
        ageMs: snapshot.ageMs,
      },
    };
  }
  if (snapshot.items.length === 0) {
    return {
      output: `Background status for session ${sessionID}: EMPTY. The latest snapshot (${ageSeconds}s ago) lists no running codemode, shell, subagent, image, or video work.`,
      metadata: {
        action: "status",
        sessionID,
        found: true,
        stale: false,
        items: 0,
        ageMs: snapshot.ageMs,
      },
    };
  }
  return {
    output: [
      `Background status for session ${sessionID}: ${snapshot.items.length} item(s), snapshot ${ageSeconds}s old.`,
      ...snapshot.items.map(describeItem),
    ].join("\n"),
    metadata: {
      action: "status",
      sessionID,
      found: true,
      stale: false,
      items: snapshot.items.length,
      ageMs: snapshot.ageMs,
    },
  };
}

function resolveSubagent(
  sessionID: string,
  childSessionID: string,
  now: number,
): Extract<BackgroundItem, { kind: "subagent" }> {
  const snapshot = readBackgroundSnapshot(sessionID, now);
  if (!snapshot.found) {
    throw new Error(
      `No background snapshot exists for session ${sessionID}; ${childSessionID} is unknown, so the action failed closed.`,
    );
  }
  if (snapshot.stale) {
    throw new Error(
      `The background snapshot for session ${sessionID} is stale (${Math.round(snapshot.ageMs / 1000)}s old, TTL ${ttlMinutes()}m); wait for the host to report the session idle again.`,
    );
  }
  const item = snapshot.items.find((entry) => itemID(entry) === childSessionID);
  if (!item) {
    throw new Error(
      `${childSessionID} is not in the latest background snapshot for session ${sessionID}; the action failed closed instead of inventing a session id.`,
    );
  }
  if (item.kind !== "subagent") {
    throw new Error(
      `${childSessionID} is ${item.kind} work, not a subagent; only subagent children can be cancelled or revived.`,
    );
  }
  return item;
}

export function buildTaskControlTool() {
  return tool({
    description: [
      "Control background work reported in the host idle snapshot.",
      "",
      "ACTIONS",
      "  status: list the running codemode, shell, subagent, image, and video work for a session.",
      "  cancel: interrupt one subagent child listed in the latest snapshot.",
      "  revive: resume one subagent child listed in the latest snapshot with new instructions.",
      "",
      "UNKNOWN, EMPTY, and STALE snapshots are reported as such. Codemode, shell, image, and",
      "video work is listed but never touched. Unknown ids are refused; this tool",
      "never guesses a session id and fails closed when no control channel exists.",
    ].join("\n"),
    args: {
      action: tool.schema
        .enum(["status", "cancel", "revive"])
        .describe("status, cancel, or revive"),
      sessionID: tool.schema
        .string()
        .optional()
        .describe("Session to inspect"),
      childSessionID: tool.schema
        .string()
        .optional()
        .describe("Child session for cancel/revive"),
      text: tool.schema
        .string()
        .optional()
        .describe("Revive instructions"),
    },
    async execute(args, cctx) {
      const sessionID = args.sessionID?.trim() || cctx.sessionID;
      const now = Date.now();
      if (args.action === "status") {
        const rendered = renderStatus(sessionID, now);
        return { title: "🧭 Background status", ...rendered };
      }

      const childSessionID = args.childSessionID?.trim() ?? "";
      if (!childSessionID) {
        throw new Error(`${args.action} requires childSessionID; no control action was attempted.`);
      }
      const item = resolveSubagent(sessionID, childSessionID, now);
      const control = backgroundControl();
      if (!control) {
        throw new Error(
          `Background control is not installed on this host, so ${args.action} failed closed and no child session was touched.`,
        );
      }

      if (args.action === "cancel") {
        try {
          await control.cancelSubagent(childSessionID);
        } catch (e) {
          throw new Error(
            `Cancel failed for child ${childSessionID}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return {
          title: "🛑 Background child cancelled",
          output: `Cancelled subagent ${childSessionID} (agent=${item.agent}). The idle snapshot is historical until the host reports again.`,
          metadata: { action: "cancel", sessionID, childSessionID, kind: item.kind },
        };
      }

      const text = args.text?.trim() ?? "";
      if (!text) {
        throw new Error(`revive requires non-empty text; child ${childSessionID} was not resumed.`);
      }
      try {
        await control.reviveSubagent(childSessionID, text);
      } catch (e) {
        throw new Error(
          `Revive failed for child ${childSessionID}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return {
        title: "🔁 Background child revived",
        output: `Revived subagent ${childSessionID} (agent=${item.agent}) with ${text.length} character(s) of new instructions.`,
        metadata: { action: "revive", sessionID, childSessionID, kind: item.kind, textLength: text.length },
      };
    },
  });
}
