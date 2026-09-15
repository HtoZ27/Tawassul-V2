import type { ContextNudge, ContextUsage, NudgeConfig } from "../context/priority-types.ts";

const NUDGE_THRESHOLDS: NudgeConfig[] = [
  { threshold: 0.7, severity: "info", action: "compact" },
  { threshold: 0.85, severity: "warning", action: "summarize" },
  { threshold: 0.95, severity: "critical", action: "save" },
];

const NUDGE_MESSAGES: Record<string, string> = {
  compact: "Context approaching limit ({percentage}%). Auto-compaction available to preserve conversation.",
  summarize: "Context at {percentage}%. Consider summarizing or saving progress.",
  save: "Context near full ({percentage}%). Save current task via record() to prevent data loss.",
  handoff: "Context full. Consider handing off to another agent via handoff().",
  pause: "Critical context limit exceeded. Pausing to maintain stability.",
};

export class ContextNudgeManager {
  private nudgeHistory: ContextNudge[] = [];
  private lastNudgeTime = 0;
  private lastNudgeSeverity: "info" | "warning" | "critical" | null = null;
  private firedTiers: Set<"info" | "warning" | "critical"> = new Set();
  private cooldownMs = 60_000;
  private maxHistory = 100;
  private historyHead = 0;

  readonly metrics = { totalEvaluations: 0, totalNudgesFired: 0, totalSuppressed: 0 };

  private static severityRank(s: string): number {
    if (s === "critical") return 3;
    if (s === "warning") return 2;
    if (s === "info") return 1;
    return 0;
  }

  evaluate(usage: ContextUsage): ContextNudge | null {
    this.metrics.totalEvaluations++;
    const now = Date.now();
    const inCooldown = now - this.lastNudgeTime < this.cooldownMs;
    for (const nudgeConfig of [...NUDGE_THRESHOLDS].reverse()) {
      if (usage.percentage >= nudgeConfig.threshold) {
        const severity = nudgeConfig.severity as "info" | "warning" | "critical";
        if (this.firedTiers.has(severity)) continue;
        if (
          inCooldown &&
          this.lastNudgeSeverity !== null &&
          ContextNudgeManager.severityRank(severity) <= ContextNudgeManager.severityRank(this.lastNudgeSeverity)
        ) {
          this.metrics.totalSuppressed++;
          return null;
        }
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