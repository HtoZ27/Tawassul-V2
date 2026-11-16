export type EvidencePhase = "gathering" | "verifying" | "challenging" | "completed";

export interface ToolReceipt {
  id: string;
  agentId: string;
  toolName: string;
  args: Record<string, unknown>;
  output: string;
  timestamp: string;
}

export interface EvidenceClaim {
  id: string;
  agentId: string;
  claim: string;
  receiptIds: string[];
  confidence: number;
  timestamp: string;
}

export type Verdict = "supported" | "contradicted" | "inconclusive";

export interface Verification {
  id: string;
  claimId: string;
  verifierId: string;
  verdict: Verdict;
  timestamp: string;
}

export type ChallengeType = "unverified" | "contradicted" | "ungrounded";

export interface SkepticChallenge {
  id: string;
  claimId: string;
  challengerId: string;
  type: ChallengeType;
  timestamp: string;
}

export interface EvidenceResult {
  score: number;
  supportRatio: number;
  avgConfidence: number;
}

export interface EvidencedDiscussion {
  discussionId: string;
  phase: EvidencePhase;
  receipts: ToolReceipt[];
  claims: EvidenceClaim[];
  verifications: Verification[];
  challenges: SkepticChallenge[];
  result?: EvidenceResult;
  skepticId: string;
  createdAt: string;
  updatedAt: string;
}

export const MAX_CHALLENGES_PER_DISCUSSION = 3;
