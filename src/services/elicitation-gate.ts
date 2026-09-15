import { logger } from "../utils/logger.ts";
import type { EffortAnalysis } from "./effort-analyzer.ts";
import type { ToolContext } from "../tool.ts";

export const ELICITATION_TIMEOUT_MS = 5_000;
export const ELICITATION_OPTION_LIMIT = 4;

export type ElicitationAsk = NonNullable<ToolContext["ask"]>;

export type ElicitationResult =
  | { selected: false; reason: "not-ambiguous" | "no-ask" | "timeout" | "dismissed" | "deferred" }
  | { selected: true; option: string };

export interface ElicitationEvent {
  type: "ELICITATION_RESOLVED";
  chainId: string;
  taskId: string;
  ambiguityScore: number;
  selectedOption: string;
  requestedBy: string;
}

export interface ElicitationGateDeps {
  ask?: ElicitationAsk;
  channel?: import("./ask-channel.ts").AskChannel;
  sessionID?: string;
  emit?: (event: ElicitationEvent) => void;
  timeoutMs?: number;
  chain?: import("./chain-ctx.ts").ChainCtx | null;
  onTimeout?: () => void;
}

export async function runElicitationGate(
  analysis: EffortAnalysis,
  task: string,
  deps: ElicitationGateDeps = {},
): Promise<ElicitationResult> {
  const { ask, channel, sessionID, emit, timeoutMs = ELICITATION_TIMEOUT_MS, chain, onTimeout } = deps;
  if (!analysis.ambiguity) {
    return { selected: false, reason: "not-ambiguous" };
  }
  if (!ask && !channel) {
    return { selected: false, reason: "no-ask" };
  }

  const options = buildOptions(analysis, task);
  logger.debug(`[elicitation] ambiguous task — asking user with ${options.length} options`);

  if (channel) {
    if (sessionID && channel.hasPending(sessionID)) {
      logger.debug("[elicitation] deferred skipped — question already pending");
      return { selected: false, reason: "no-ask" };
    }
    const deferred = sessionID
      ? channel.deferAskResolvable(
          analysis.action_hint || "The request is unclear — choose an option:",
          { type: "select", options },
          sessionID,
          (answer) => {
            const option = typeof answer === "string" ? answer.trim() : "";
            if (!option) return;
            emit?.({
              type: "ELICITATION_RESOLVED",
              chainId: chain?.chainId ?? task,
              taskId: task,
              ambiguityScore: 1,
              selectedOption: option,
              requestedBy: "user",
            });
          },
          onTimeout,
        )
      : undefined;
    if (deferred === undefined) {
      logger.debug("[elicitation] deferred refused (cap/disposed/missing-session) — dispatching normally");
      return { selected: false, reason: "no-ask" };
    }
    logger.debug("[elicitation] deferred — question rendered, awaiting reply");
    return { selected: false, reason: "deferred" };
  }

  let answer: string | boolean | string[] | void | undefined;
  try {
    answer = await Promise.race([
      (ask as ElicitationAsk)(analysis.action_hint || "The request is unclear — choose an option:", {
        type: "select",
        options,
      }),
      new Promise<"__timeout__">((resolve) => setTimeout(() => resolve("__timeout__"), timeoutMs)),
    ]);
  } catch {
    answer = "__timeout__";
  }

  if (answer === "__timeout__" || answer === undefined) {
    if (answer === "__timeout__") logger.debug("[elicitation] timed out — proceeding with normal dispatch");
    else logger.debug("[elicitation] user dismissed or empty answer — proceeding");
    return { selected: false, reason: answer === "__timeout__" ? "timeout" : "dismissed" };
  }
  if (typeof answer === "string" && answer.trim()) {
    const option = answer.trim();
    emit?.({
      type: "ELICITATION_RESOLVED",
      chainId: chain?.chainId ?? task,
      taskId: task,
      ambiguityScore: 1,
      selectedOption: option,
      requestedBy: "user",
    });
    logger.debug(`[elicitation] resolved: ${option}`);
    return { selected: true, option };
  }
  return { selected: false, reason: "dismissed" };
}

export function buildOptions(analysis: EffortAnalysis, task: string): string[] {
  const hint = analysis.action_hint
    .split(/[,—–-]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
  const words = task
    .split(/\s+/)
    .filter((w) => /[a-zA-Z\u0600-\u06FF]/.test(w) && !/(fix|this|that|it|something|he|she|they|the|a)/i.test(w))
    .slice(0, 3);
  const options = [...hint, ...words].slice(0, ELICITATION_OPTION_LIMIT);
  if (options.length < 2) options.push("Rephrase the request", "Continue as is");
  return [...new Set(options)].slice(0, ELICITATION_OPTION_LIMIT);
}

export const ElicitationGate = {
  run: runElicitationGate,
  buildOptions,
};