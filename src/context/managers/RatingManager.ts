

import type { AgentRating, AgentFlag, EvaluationConfig } from "../types.ts";
import { SCORE_WEIGHTS } from "../constants.ts";
import { normalizeName } from "../../utils/name-utils.ts";

export class RatingManager {
  agentRatings: Record<string, AgentRating> = {};
  private static MAX_RATINGS = 200;
  
  private _lruOrder: string[] = [];
  
  private _lruPos: Map<string, number> = new Map();

  getOrCreateRating(agent: string): AgentRating {
    const key = normalizeName(agent);
    if (!this.agentRatings[key]) {
      const keys = Object.keys(this.agentRatings);
      if (keys.length >= RatingManager.MAX_RATINGS) {
        
        const oldest = this._lruOrder.shift() ?? keys[0]!;
        this._lruPos.delete(oldest);
        delete this.agentRatings[oldest];
      }
      this.agentRatings[key] = {
        agent: key,
        handoffsInitiated: 0,
        handoffsCompletedAsRecipient: 0,
        handoffsAccepted: 0,
        handoffsDropped: 0,
        checkpointsUsed: 0,
        emptyCheckpoints: 0,
        recordsCreated: 0,
        validationErrors: 0,
        totalContextWords: 0,
        totalContextHandoffs: 0,
        totalTaskWords: 0,
        totalTaskHandoffs: 0,
        rapidReHandoffs: 0,
        helpRequestsSent: 0,
        helpRequestsFulfilled: 0,
        lastAcceptedHandoffId: null,
        lastActionType: "none",
        lastActionAt: new Date(0).toISOString(),
      };
      
      this._lruPos.set(key, this._lruOrder.length);
      this._lruOrder.push(key);
    }
    
    const i = this._lruPos.get(key)!;
    const last = this._lruOrder.length - 1;
    if (i !== last && last >= 0) {
      const tailKey = this._lruOrder[last]!;
      this._lruOrder[i] = tailKey;
      this._lruPos.set(tailKey, i);
      this._lruOrder[last] = key;
      this._lruPos.set(key, last);
    }
    return this.agentRatings[key]!;
  }

  recordHandoffInitiated(
    agent: string,
    context: string,
    task: string,
    hasCheckpoint: boolean,
    checkpointEmpty: boolean,
    handoffs: { id: string; status: string }[],
  ): void {
    const r = this.getOrCreateRating(agent);
    r.handoffsInitiated++;
    if (hasCheckpoint) {
      r.checkpointsUsed++;
      if (checkpointEmpty) r.emptyCheckpoints++;
    }
    r.totalContextWords += context.split(/\s+/).filter(Boolean).length;
    r.totalContextHandoffs++;
    r.totalTaskWords += task.split(/\s+/).filter(Boolean).length;
    r.totalTaskHandoffs++;

    
    if (r.lastActionType === "accepted" && r.lastAcceptedHandoffId) {
      const handoffMap = new Map(handoffs.map((h) => [h.id, h]));
      const h = handoffMap.get(r.lastAcceptedHandoffId);
      if (h && h.status !== "completed") r.rapidReHandoffs++;
    }

    r.lastActionType = "initiated";
    r.lastActionAt = new Date().toISOString();
  }

  recordHandoffAccepted(agent: string, handoffId: string): void {
    const r = this.getOrCreateRating(agent);
    r.handoffsAccepted++;
    r.lastAcceptedHandoffId = handoffId;
    r.lastActionType = "accepted";
    r.lastActionAt = new Date().toISOString();
  }

  recordHandoffCompleted(agent: string): void {
    const r = this.getOrCreateRating(agent);
    r.handoffsCompletedAsRecipient++;
    r.lastAcceptedHandoffId = null;
    r.lastActionType = "completed";
    r.lastActionAt = new Date().toISOString();
  }

  recordHandoffDropped(agent: string): void {
    const r = this.getOrCreateRating(agent);
    r.handoffsDropped++;
  }

  revertHandoffCompleted(agent: string): void {
    const r = this.getOrCreateRating(agent);
    r.handoffsCompletedAsRecipient = Math.max(0, r.handoffsCompletedAsRecipient - 1);
    r.lastActionType = "reverted";
    r.lastActionAt = new Date().toISOString();
  }

  recordRecordCreated(agent: string): void {
    const r = this.getOrCreateRating(agent);
    r.recordsCreated++;
    r.lastActionType = "recorded";
    r.lastActionAt = new Date().toISOString();
  }

  recordValidationError(agent: string): void {
    const r = this.getOrCreateRating(agent);
    r.validationErrors++;
  }

  recordHelpRequestSent(agent: string): void {
    const r = this.getOrCreateRating(agent);
    r.helpRequestsSent++;
  }

  recordHelpRequestFulfilled(agent: string): void {
    const r = this.getOrCreateRating(agent);
    r.helpRequestsFulfilled++;
  }

  recordToolCall(agent: string, tool: string, success: boolean): void {
    const r = this.getOrCreateRating(agent);
    if (!r.toolCallStats) {
      r.toolCallStats = { total: 0, success: 0, failed: 0, byTool: {} };
    }
    r.toolCallStats.total++;
    if (success) r.toolCallStats.success++;
    else r.toolCallStats.failed++;
    if (!r.toolCallStats.byTool[tool]) {
      r.toolCallStats.byTool[tool] = { total: 0, success: 0, failed: 0 };
    }
    r.toolCallStats.byTool[tool].total++;
    if (success) r.toolCallStats.byTool[tool].success++;
    else r.toolCallStats.byTool[tool].failed++;
    r.toolCallSuccessRate = r.toolCallStats.total > 0 ? r.toolCallStats.success / r.toolCallStats.total : 1;
  }

  updateLastActive(agent: string): void {
    const r = this.getOrCreateRating(agent);
    r.lastActionAt = new Date().toISOString();
  }

  calculateHealthScore(r: AgentRating): number {
    
    
    
    const n = (x: number): number => (Number.isFinite(x) ? x : 0);
    let score = 50;
    score += Math.min(
      n(r.handoffsCompletedAsRecipient) * SCORE_WEIGHTS.completedAsRecipient,
      SCORE_WEIGHTS.completedCap,
    );
    score += Math.min(n(r.checkpointsUsed) * SCORE_WEIGHTS.checkpointUsed, SCORE_WEIGHTS.checkpointCap);
    score += Math.min(n(r.recordsCreated) * SCORE_WEIGHTS.recordCreated, SCORE_WEIGHTS.recordCap);
    score += Math.min(
      n(r.helpRequestsFulfilled) * SCORE_WEIGHTS.helpRequestFulfilled,
      SCORE_WEIGHTS.helpRequestFulfilledCap,
    );
    score += n(r.handoffsDropped) * SCORE_WEIGHTS.droppedHandoff;
    score += n(r.emptyCheckpoints) * SCORE_WEIGHTS.emptyCheckpoint;
    score += n(r.rapidReHandoffs) * SCORE_WEIGHTS.rapidReHandoff;
    score -= Math.min(n(r.helpRequestsSent) * SCORE_WEIGHTS.helpRequestSent, SCORE_WEIGHTS.helpRequestSentCap);
    score -= Math.min(n(r.validationErrors) * SCORE_WEIGHTS.validationError, SCORE_WEIGHTS.validationErrorCap);
    return Math.max(0, Math.min(100, score));
  }

  scoreCategory(score: number): { emoji: string; label: string } {
    if (score >= 80) return { emoji: "🟢", label: "Excellent" };
    if (score >= 60) return { emoji: "🟡", label: "Fair" };
    if (score >= 30) return { emoji: "🟠", label: "Poor" };
    return { emoji: "🔴", label: "Critical" };
  }

  detectFlags(r: AgentRating, evalCfg: EvaluationConfig): AgentFlag[] {
    const flags: AgentFlag[] = [];
    if (r.handoffsDropped > 0) {
      flags.push({ symbol: "🔴", message: `${r.handoffsDropped} dropped handoff(s)`, metric: "handoffsDropped" });
    }
    if (r.emptyCheckpoints > 0) {
      flags.push({ symbol: "🟠", message: `${r.emptyCheckpoints} empty checkpoint(s)`, metric: "emptyCheckpoints" });
    }
    if (r.rapidReHandoffs > 0) {
      flags.push({ symbol: "🟠", message: `${r.rapidReHandoffs} rapid re-handoff(s)`, metric: "rapidReHandoffs" });
    }
    if (r.validationErrors >= (evalCfg.minRecordsPerAgent ?? 1)) {
      flags.push({ symbol: "🟡", message: `${r.validationErrors} validation error(s)`, metric: "validationErrors" });
    }
    if (r.totalContextHandoffs > 0) {
      const avgCtx = r.totalContextWords / r.totalContextHandoffs;
      if (avgCtx < (evalCfg.minContextLengthAvg ?? 10)) {
        flags.push({
          symbol: "🟡",
          message: `Low avg context (${avgCtx.toFixed(0)} words, threshold ${evalCfg.minContextLengthAvg ?? 10})`,
          metric: "avgContext",
        });
      }
    }
    if (r.totalTaskHandoffs > 0) {
      const avgTask = r.totalTaskWords / r.totalTaskHandoffs;
      if (avgTask < (evalCfg.minTaskLengthAvg ?? 5)) {
        flags.push({
          symbol: "🟡",
          message: `Low avg task (${avgTask.toFixed(0)} words, threshold ${evalCfg.minTaskLengthAvg ?? 5})`,
          metric: "avgTask",
        });
      }
    }
    if (r.handoffsAccepted > 0) {
      const ratio = r.handoffsCompletedAsRecipient / r.handoffsAccepted;
      if (ratio < (evalCfg.minCompletionRatio ?? 0.3)) {
        flags.push({
          symbol: "🔴",
          message: `Low completion ratio (${(ratio * 100).toFixed(0)}%, threshold ${((evalCfg.minCompletionRatio ?? 0.3) * 100).toFixed(0)}%)`,
          metric: "completionRatio",
        });
      }
    }
    if (r.handoffsInitiated + r.handoffsAccepted >= 3 && r.recordsCreated < (evalCfg.minRecordsPerAgent ?? 1)) {
      flags.push({
        symbol: "🟠",
        message: `No records created after ${r.handoffsInitiated + r.handoffsAccepted} handoffs`,
        metric: "noRecords",
      });
    }
    if (r.helpRequestsSent >= 3) {
      flags.push({
        symbol: "🟠",
        message: `${r.helpRequestsSent} help requests sent — needs training`,
        metric: "helpRequestsSent",
      });
    }
    if (r.helpRequestsFulfilled >= 3) {
      flags.push({
        symbol: "🟡",
        message: `${r.helpRequestsFulfilled} help requests fulfilled`,
        metric: "helpRequestsFulfilled",
      });
    }
    return flags;
  }

  private _countedDroppedHandoffs: Set<string> = new Set();

  droppedHandoffCount(): number {
    return this._countedDroppedHandoffs.size;
  }

  detectDroppedHandoffs(handoffs: { to: string; status: string }[]): number {
    let counted = 0;
    for (const h of handoffs) {
      const key = normalizeName(h.to);
      if (h.status === "accepted" && !this._countedDroppedHandoffs.has(key)) {
        this._countedDroppedHandoffs.add(key);
        this.recordHandoffDropped(key);
        counted += 1;
      }
    }
    return counted;
  }

  scoreBar(score: number, width: number): string {
    const filled = Math.round((score / 100) * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  }
}
