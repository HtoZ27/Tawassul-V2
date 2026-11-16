export * from "./discussion.ts";
export { DiscussionManager } from "./discussion-logic.ts";
export {
  buildDiscussionTool,
  buildProposeTool,
  buildVoteTool,
  buildDivideTool,
  buildEvidenceTool,
} from "./discussion-tools.ts";
export { EvidenceManager } from "./evidence-manager.ts";
export type {
  EvidencePhase,
  ToolReceipt,
  EvidenceClaim,
  Verification,
  SkepticChallenge,
  EvidenceResult,
  EvidencedDiscussion,
} from "./evidence-types.ts";