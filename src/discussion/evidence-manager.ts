import type { DiscussionManager } from "./discussion-logic.ts";
import type {
  EvidencedDiscussion,
  ToolReceipt,
  EvidenceClaim,
  Verification,
  SkepticChallenge,
} from "./evidence-types.ts";
import { MAX_CHALLENGES_PER_DISCUSSION } from "./evidence-types.ts";

export class EvidenceManager {
  private static readonly MAX_STATES = 200;
  private seqReceipt = 0;
  private seqClaim = 0;
  private seqVerification = 0;
  private seqChallenge = 0;
  private states: Map<string, EvidencedDiscussion> = new Map();
  private saveCallback: () => void;
  private discussionManager: DiscussionManager;

  constructor(discussionManager: DiscussionManager, saveCallback: () => void) {
    this.discussionManager = discussionManager;
    this.saveCallback = saveCallback;
  }

  start(discussionId: string): boolean {
    if (this.states.has(discussionId)) return false;
    const discussion = this.discussionManager.getDiscussion(discussionId);
    if (!discussion || discussion.phase !== "proposing") return false;
    
    if (this.states.size >= EvidenceManager.MAX_STATES) {
      const oldestKey = this.states.keys().next().value;
      if (oldestKey) this.states.delete(oldestKey);
    }
    const skepticId = discussion.participants.find(p => p !== discussion.participants[0]) ?? discussion.participants[0] ?? "skeptic";
    this.states.set(discussionId, {
      discussionId,
      phase: "gathering",
      receipts: [],
      claims: [],
      verifications: [],
      challenges: [],
      skepticId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    discussion.consensusActive = true;
    this.saveCallback();
    return true;
  }

  submitReceipt(discussionId: string, input: { agentId: string; toolName: string; args: Record<string, unknown>; output: string }): ToolReceipt | null {
    const state = this.states.get(discussionId);
    if (!state || state.phase !== "gathering") return null;
    this.seqReceipt++;
    const receipt: ToolReceipt = {
      id: `R-${String(this.seqReceipt).padStart(3, "0")}`,
      agentId: input.agentId,
      toolName: input.toolName,
      args: input.args,
      output: input.output,
      timestamp: new Date().toISOString(),
    };
    state.receipts.push(receipt);
    state.updatedAt = new Date().toISOString();
    this.saveCallback();
    return receipt;
  }

  getState(discussionId: string): EvidencedDiscussion | undefined {
    return this.states.get(discussionId);
  }

  getAllState(): EvidencedDiscussion[] {
    return Array.from(this.states.values());
  }

  loadFromState(evidenced: EvidencedDiscussion[]): void {
    this.states.clear();
    for (const ed of evidenced) {
      this.states.set(ed.discussionId, ed);
    }
  }

  submitClaim(discussionId: string, input: { agentId: string; claim: string; receiptIds: string[]; confidence: number }): EvidenceClaim | null {
    const state = this.states.get(discussionId);
    if (!state || state.phase !== "gathering") return null;
    if (!input.receiptIds.length) return null;
    this.seqClaim++;
    const claim: EvidenceClaim = {
      id: `C-${String(this.seqClaim).padStart(3, "0")}`,
      agentId: input.agentId,
      claim: input.claim,
      receiptIds: input.receiptIds,
      confidence: input.confidence,
      timestamp: new Date().toISOString(),
    };
    state.claims.push(claim);
    state.updatedAt = new Date().toISOString();
    this.saveCallback();
    return claim;
  }

  verify(discussionId: string, input: { claimId: string; verifierId: string; verdict: "supported" | "contradicted" | "inconclusive" }): Verification | null {
    const state = this.states.get(discussionId);
    if (!state || state.phase !== "verifying") return null;
    if (state.verifications.some(v => v.claimId === input.claimId)) return null;
    this.seqVerification++;
    const verification: Verification = {
      id: `V-${String(this.seqVerification).padStart(3, "0")}`,
      claimId: input.claimId,
      verifierId: input.verifierId,
      verdict: input.verdict,
      timestamp: new Date().toISOString(),
    };
    state.verifications.push(verification);
    state.updatedAt = new Date().toISOString();
    this.saveCallback();
    return verification;
  }

  challenge(discussionId: string, input: { claimId: string; challengerId: string; type: "unverified" | "contradicted" | "ungrounded" }): SkepticChallenge | null {
    const state = this.states.get(discussionId);
    if (!state || state.phase !== "challenging") return null;
    if (state.skepticId !== input.challengerId) return null;
    if (state.challenges.filter(c => c.claimId === input.claimId).length >= MAX_CHALLENGES_PER_DISCUSSION) return null;
    this.seqChallenge++;
    const challenge: SkepticChallenge = {
      id: `SC-${String(this.seqChallenge).padStart(3, "0")}`,
      claimId: input.claimId,
      challengerId: input.challengerId,
      type: input.type,
      timestamp: new Date().toISOString(),
    };
    state.challenges.push(challenge);
    state.updatedAt = new Date().toISOString();
    this.saveCallback();
    return challenge;
  }

  advancePhase(discussionId: string): boolean {
    const state = this.states.get(discussionId);
    if (!state) return false;
    switch (state.phase) {
      case "gathering":
        if (state.claims.length === 0) return false;
        state.phase = "verifying";
        break;
      case "verifying":
        if (state.verifications.length === 0) return false;
        state.phase = "challenging";
        break;
      case "challenging": {
        const supported = state.verifications.filter(v => v.verdict === "supported").length;
        const total = state.verifications.length;
        const supportRatio = total > 0 ? supported / total : 0;
        const avgConfidence = state.claims.length > 0
          ? state.claims.reduce((s, c) => s + c.confidence, 0) / state.claims.length
          : 0;
        const score = (supportRatio * 0.6) + (avgConfidence * 0.4);
        state.result = { score, supportRatio, avgConfidence };
        state.phase = "completed";
        const discussion = this.discussionManager.getDiscussion(discussionId);
        if (discussion) {
          discussion.consensusActive = false;
          discussion.phase = "voting";
        }
        break;
      }
      case "completed":
        return false;
    }
    state.updatedAt = new Date().toISOString();
    this.saveCallback();
    return true;
  }

  abort(discussionId: string): boolean {
    const state = this.states.get(discussionId);
    if (!state || state.phase === "completed") return false;
    this.states.delete(discussionId);
    const discussion = this.discussionManager.getDiscussion(discussionId);
    if (discussion) {
      discussion.consensusActive = false;
    }
    this.saveCallback();
    return true;
  }

  finalizeIfExpired(discussionId: string): void {
    
    const state = this.states.get(discussionId);
    if (!state) return;
    if (state.phase !== "completed") return;
    const age = Date.now() - new Date(state.updatedAt).getTime();
    if (age > 30 * 60 * 1000) {
      this.states.delete(discussionId);
    }
  }

  reset(): void {
    this.states.clear();
  }

  getSeqCounters() {
    return { seqReceipt: this.seqReceipt, seqClaim: this.seqClaim, seqVerification: this.seqVerification, seqChallenge: this.seqChallenge };
  }

  setSeqCounters(counters: { seqReceipt: number; seqClaim: number; seqVerification: number; seqChallenge: number }): void {
    this.seqReceipt = counters.seqReceipt;
    this.seqClaim = counters.seqClaim;
    this.seqVerification = counters.seqVerification;
    this.seqChallenge = counters.seqChallenge;
  }
}
