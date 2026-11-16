import type { ContextNudge, ContextUsage, NudgeConfig } from "../context/priority-types.ts";

export const NUDGE_THRESHOLDS: NudgeConfig[] = [
  { threshold: 0.7, severity: "info", action: "defer" },
  { threshold: 0.85, severity: "warning", action: "summarize" },
  { threshold: 0.95, severity: "critical", action: "save" },
];

const NUDGE_MESSAGES: Record<string, string> = {
  defer: "Context at {percentage}%. Large tool results will be deferred; prefer targeted reads and pointers.",
  summarize: "Context at {percentage}%. Summarize the task state and keep only the active checkpoint.",
  save: "Context near full ({percentage}%). Save progress via record(); compaction is not forced.",
  compact: "Context approaching limit ({percentage}%). Auto-compaction available to preserve conversation.",
  handoff: "Context full. Consider handing off to another agent via handoff().",
  pause: "Critical context limit exceeded. Pausing to maintain stability.",
};

export const NUDGE_RESET_BELOW = 0.65;
export const DEFERRED_TOOL_OUTPUT_CHARS = 12_000;
const MAX_NUDGE_SESSIONS = 200;

type Tier = "info" | "warning" | "critical";

type SessionNudgeState = {
  firedTiers: Set<Tier>;
  lastNudgeTime: number;
  lastNudgeSeverity: Tier | null;
  deferral: boolean;
};

export class ContextNudgeManager {
  private nudgeHistory: ContextNudge[] = [];
  private lastNudgeTime = 0;
  private lastNudgeSeverity: Tier | null = null;
  private firedTiers: Set<Tier> = new Set();
  private sessions = new Map<string, SessionNudgeState>();
  private maxSessions = MAX_NUDGE_SESSIONS;
  private maxHistory = 100;
  private historyHead = 0;

  readonly metrics = { totalEvaluations: 0, totalNudgesFired: 0, totalSuppressed: 0 };

  private static severityRank(s: string): number {
    if (s === "critical") return 3;
    if (s === "warning") return 2;
    if (s === "info") return 1;
    return 0;
  }

  private stateFor(sessionID: string): SessionNudgeState {
    let state = this.sessions.get(sessionID);
    if (state) return state;
    state = {
      firedTiers: new Set<Tier>(),
      lastNudgeTime: this.lastNudgeTime,
      lastNudgeSeverity: this.lastNudgeSeverity,
      deferral: false,
    };
    this.sessions.set(sessionID, state);
    if (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value as string | undefined;
      if (oldest !== undefined && oldest !== sessionID) this.sessions.delete(oldest);
    }
    return state;
  }

  evaluate(usage: ContextUsage, sessionID = "default"): ContextNudge | null {
    this.metrics.totalEvaluations++;
    const state = this.stateFor(sessionID);
    if (usage.percentage < NUDGE_RESET_BELOW) {
      state.firedTiers.clear();
      state.lastNudgeTime = 0;
      state.lastNudgeSeverity = null;
      state.deferral = false;
      return null;
    }
    const now = Date.now();
    let highestFired = 0;
    for (const tier of state.firedTiers) highestFired = Math.max(highestFired, ContextNudgeManager.severityRank(tier));
    for (const nudgeConfig of [...NUDGE_THRESHOLDS].reverse()) {
      if (usage.percentage >= nudgeConfig.threshold) {
        const severity = nudgeConfig.severity as Tier;
        if (ContextNudgeManager.severityRank(severity) <= highestFired) {
          this.metrics.totalSuppressed++;
          return null;
        }
        state.lastNudgeTime = now;
        state.lastNudgeSeverity = severity;
        state.firedTiers.add(severity);
        state.deferral = true;
        this.lastNudgeTime = now;
        this.lastNudgeSeverity = severity;
        this.firedTiers.add(severity);
        const msg = NUDGE_MESSAGES[nudgeConfig.action];
        if (!msg) continue;

        const pct = Math.round(usage.percentage * 100);

        const nudge: ContextNudge = {
          id: `nudge-${now}`,
          severity: nudgeConfig.severity,
          message: msg.replace("{percentage}", String(pct)),
          action: nudgeConfig.action,
          threshold: nudgeConfig.threshold,
          timestamp: now,
        };

        if (this.nudgeHistory.length < this.maxHistory) {
          this.nudgeHistory.push(nudge);
        } else {
          this.nudgeHistory[this.historyHead % this.maxHistory] = nudge;
        }
        this.historyHead++;
        this.metrics.totalNudgesFired++;
        return nudge;
      }
    }
    return null;
  }

  isDeferralActive(sessionID = "default"): boolean {
    return this.sessions.get(sessionID)?.deferral === true;
  }

  deferredOutputCap(sessionID = "default"): number | undefined {
    return this.isDeferralActive(sessionID) ? DEFERRED_TOOL_OUTPUT_CHARS : undefined;
  }

  resetSession(sessionID: string): void {
    this.sessions.delete(sessionID);
  }

  suggestAction(usage: ContextUsage, currentTask?: string): string[] {
    const suggestions: string[] = [];

    if (usage.percentage > 0.9) {
      suggestions.push("record() — save current progress");
    }
    if (usage.percentage > 0.85 && usage.breakdown.toolOutputs > usage.breakdown.conversationHistory * 0.5) {
      suggestions.push("Summarize long tool outputs (tool outputs > conversation)");
    }
    if (usage.percentage > 0.8 && currentTask) {
      suggestions.push(`handoff() — hand "${currentTask}" to another agent`);
    }
    if (usage.breakdown.agentMemory > usage.usedTokens * 0.3) {
      suggestions.push("sharedMemory.compact() — compact shared memory");
    }

    return suggestions;
  }

  getHistory(): ContextNudge[] {
    if (this.nudgeHistory.length < this.maxHistory) {
      return [...this.nudgeHistory];
    }
    const ordered: ContextNudge[] = [];
    const start = this.historyHead % this.maxHistory;
    for (let i = 0; i < this.maxHistory; i++) {
      const nudge = this.nudgeHistory[(start + i) % this.maxHistory];
      if (nudge) ordered.push(nudge);
    }
    return ordered;
  }

  clearHistory(): void {
    this.nudgeHistory = [];
    this.lastNudgeTime = 0;
    this.lastNudgeSeverity = null;
    this.firedTiers.clear();
    this.sessions.clear();
    this.historyHead = 0;
  }
}

export function estimateContextUsage(
  conversationTokens: number,
  toolOutputTokens: number,
  memoryTokens: number,
  systemPromptTokens: number,
  maxTokens: number,
): ContextUsage {
  const total = conversationTokens + toolOutputTokens + memoryTokens + systemPromptTokens;
  return {
    usedTokens: total,
    maxTokens,
    percentage: maxTokens > 0 ? Math.min(1, total / maxTokens) : 0,
    breakdown: {
      systemPrompt: systemPromptTokens,
      conversationHistory: conversationTokens,
      toolOutputs: toolOutputTokens,
      agentMemory: memoryTokens,
    },
  };
}
