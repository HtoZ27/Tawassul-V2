import type { DedupSignature } from "../context/priority-types.ts";
import type { ToolDeduplicator } from "../services/tool-dedup.ts";
import type { ToolRunLog } from "../services/tool-run-log.ts";
import { normalizeToolName } from "../utils/name-utils.ts";

export const THREAD_TOOL_NAME = "thread";
export const IDEMPOTENT_THREAD_ACTIONS: ReadonlySet<string> = new Set(["list", "read", "pack"]);

export function isIdempotentThreadCall(toolName: unknown, args: unknown): boolean {
  if (typeof toolName !== "string" || normalizeToolName(toolName) !== THREAD_TOOL_NAME) return false;
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  const action = (args as Record<string, unknown>).action;
  return typeof action === "string" && IDEMPOTENT_THREAD_ACTIONS.has(action);
}

export interface DuplicateGuardInput {
  tool: string;
  agent: string;
  sessionID: string;
  args: unknown;
  argsJson: string;
  now: number;
  deduplicator?: ToolDeduplicator;
  runLog?: ToolRunLog;
}

export interface DuplicateGuardVerdict {
  blocked: boolean;
  reason?: string;
  merge?: boolean;
}

export function evaluateDuplicateGuard(input: DuplicateGuardInput): DuplicateGuardVerdict {
  if (isIdempotentThreadCall(input.tool, input.args)) return { blocked: false };
  const deduplicator = input.deduplicator;
  if (deduplicator) {
    const signature: DedupSignature = {
      tool: input.tool,
      agent: input.agent,
      sessionId: input.sessionID,
      callDepth: 0,
      argsHash: input.argsJson,
      timestamp: input.now,
    };
    const result = deduplicator.check(signature);
    if (result.isDuplicate && result.strategy === "skip") {
      return { blocked: true, reason: result.reason };
    }
    if (result.isDuplicate && result.strategy === "merge") {
      return { blocked: false, merge: true, reason: result.reason };
    }
  }
  const crossDup = input.runLog?.findCrossSessionDuplicate(input.tool, input.argsJson, input.now);
  if (crossDup) {
    return { blocked: true, reason: `Cross-session duplicate of ${input.tool} (prior run ${crossDup.id})` };
  }
  return { blocked: false };
}
