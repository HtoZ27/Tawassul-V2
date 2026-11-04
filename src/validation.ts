import { z } from "zod";



export const FailedModelSchema = z.object({
  model: z.string(),
  failedAt: z.string(),
  error: z.string(),
  retryAfter: z.number().optional(),
});

export const TawaPrefsSchema = z
  .object({
    modelChoices: z.record(z.string(), z.string()).optional(),
    userProviders: z.array(z.string()).optional(),
    learnedPreferences: z.record(z.string(), z.unknown()).optional(),
    failedModels: z.record(z.string(), FailedModelSchema).optional(),
    lastUpdated: z.string().optional(),
  })
  .strict();



export const FileLocationSchema = z
  .object({
    file: z.string().min(1).max(500),
    line: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    snippet: z.string().max(2000).optional(),
    label: z.string().max(200).optional(),
    specializations: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((data) => !data.lineEnd || !data.line || data.lineEnd >= data.line, {
    message: "lineEnd must be >= line when both are provided",
  });

export const AgentModelRefSchema = z.object({
  providerID: z.string(),
  modelID: z.string(),
});

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

export const RecordEntrySchema = z.object({
  id: z.string(),
  type: z.enum(["decision", "fix", "incident", "note"]),
  timestamp: z.string(),
  agent: z.string(),
  title: z.string(),
  detail: z.string(),
  severity: z.enum(["critical", "severe", "moderate", "minor"]).optional(),
  specializations: z.array(z.string()).optional(),
  locations: z.array(FileLocationSchema).optional(),
  provenance: lenient(z.string()),
  decision_kind: lenient(z.string()),
});

export const CheckpointSchema = z
  .object({
    completed: z.array(z.string()),
    remaining: z.array(z.string()),
    filesChanged: z.array(z.string()),
    decisions: z.array(
      z.object({
        title: z.string(),
        detail: z.string(),
      }),
    ),
  })
  .optional();

export const RuleDecisionSchema = z.object({
  action: z.enum(["allow", "block", "reroute", "warn", "queue"]),
  reason: z.string(),
  confidence: z.number(),
  suggestedAgent: z.string().optional(),
  suggestedPriority: z.enum(["P0", "P1", "P2", "P3", "P4"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const HandoffEntrySchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  task: z.string(),
  context: z.string(),
  files: z.array(z.string()),
  timestamp: z.string(),
  status: z.enum(["pending", "accepted", "completed", "cancelled", "paused", "closed"]),
  checkpoint: CheckpointSchema,
  rescue: z.boolean().optional(),
  senderErrorCleared: lenient(z.boolean()),
  result: z.string().optional(),
  parallelId: z.string().optional(),
  sourceLocations: z.array(FileLocationSchema).optional(),
  sourceRecordId: z.string().optional(),
  sourceDiscussionId: lenient(z.string()),
  credentialScope: lenient(z.string()),
  implementer: lenient(AgentModelRefSchema),
  reviewer: lenient(AgentModelRefSchema),
  sessionId: lenient(z.string()),
  turn: lenient(z.number()),
  acceptanceCriteria: lenient(z.array(z.string())),
  acknowledgedBy: lenient(z.string()),
  acknowledgedAt: lenient(z.string()),
  decisionRuleId: z.string().optional(),
  decision: RuleDecisionSchema.optional(),
  reroutedModel: lenient(z.string()),
  contextPackId: z.string().optional(),
  contextPackDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  contextPackActivatedAt: z.string().optional(),
  parentID: z.string().optional(),
});

const CapabilityRecordSchema = z.object({
  agent: z.string().min(1).max(200),
  capabilities: z.array(z.string().min(1).max(200)),
  successRates: z.record(z.string(), z.number().min(0).max(1)),
  attempts: z.record(z.string(), z.number().int().min(0).max(1_000_000)),
  successes: z.record(z.string(), z.number().int().min(0).max(1_000_000)),
  lastUpdated: z.string(),
});

export const AgentRatingSchema = z.object({
  agent: z.string(),
  handoffsInitiated: z.number().int().min(0),
  handoffsCompletedAsRecipient: z.number().int().min(0),
  handoffsAccepted: z.number().int().min(0),
  handoffsDropped: z.number().int().min(0),
  checkpointsUsed: z.number().int().min(0),
  emptyCheckpoints: z.number().int().min(0),
  recordsCreated: z.number().int().min(0),
  validationErrors: z.number().int().min(0),
  totalContextWords: z.number().int().min(0),
  totalContextHandoffs: z.number().int().min(0),
  totalTaskWords: z.number().int().min(0),
  totalTaskHandoffs: z.number().int().min(0),
  rapidReHandoffs: z.number().int().min(0),
  helpRequestsSent: z.number().int().min(0),
  helpRequestsFulfilled: z.number().int().min(0),
  lastAcceptedHandoffId: z.string().nullable().optional(),
  lastActionType: z.enum(["initiated", "accepted", "completed", "recorded", "reverted", "none"]),
  lastActionAt: z.string(),
  toolCallStats: z
    .object({
      total: z.number().int().min(0),
      success: z.number().int().min(0),
      failed: z.number().int().min(0),
      byTool: z.record(
        z.string(),
        z.object({
          total: z.number().int().min(0),
          success: z.number().int().min(0),
          failed: z.number().int().min(0),
        }),
      ),
    })
    .optional(),
  toolCallSuccessRate: z.number().min(0).max(1).optional(),
});



function stripProto<T>(data: T): T {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    const clean = Object.fromEntries(entries.filter(([k]) => k !== "__proto__"));
    return clean as T;
  }
  return data;
}



export const PauseStateSchema = z
  .object({
    active: z.boolean(),
    reason: z.string(),
    pausedAt: z.string(),
    pausedBy: z.string(),
    scope: z.enum(["all", "handoffs", "tasks", "agent"]),
    affectedHandoffs: z.array(z.string()),
  })
  .nullable()
  .optional();



const MemoryEntrySchema = z.object({
  id: z.string(),
  agent: z.string(),
  timestamp: z.string(),
  content: z.union([z.string(), z.record(z.string(), z.unknown())]),
  tags: z.array(z.string()),
  importance: z.enum(["low", "medium", "high"]),
  decayFactor: z.number(),
});

const FileContextEntrySchema = z.object({
  path: z.string(),
  lastModified: z.string(),
  lastAgent: z.string(),
  summary: z.string(),
  relatedFiles: z.array(z.string()),
});

const AgentContextEntrySchema = z.object({
  agent: z.string(),
  lastActive: z.string(),
  currentTask: z.string().optional(),
  expertise: z.array(z.string()),
  recentErrors: z.array(z.string()),
});

const HandoffRecordSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  task: z.string(),
  timestamp: z.string(),
  success: z.boolean(),
  duration: z.number(),
});

export const SharedMemorySchema = z.object({
  decisions: z.array(MemoryEntrySchema).optional(),
  learnings: z.array(MemoryEntrySchema).optional(),
  warnings: z.array(MemoryEntrySchema).optional(),
  handoffHistory: z.array(HandoffRecordSchema).optional(),
  agentContext: z.record(z.string(), AgentContextEntrySchema).optional(),
  fileContext: z.record(z.string(), FileContextEntrySchema).optional(),
});



const DiscussionErrorSchema = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number(),
  type: z.string(),
  severity: z.enum(["critical", "moderate", "low"]),
  message: z.string(),
});

const ProposalSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  errorId: z.string(),
  solution: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  estimatedEffort: z.number(),
  risk: z.enum(["high", "medium", "low"]),
  justification: z.string().optional(),
  timestamp: z.string(),
});

const VoteSchema = z.object({
  agentId: z.string(),
  proposalId: z.string(),
  weight: z.number(),
  reason: z.string().optional(),
  timestamp: z.string(),
});

const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  assignedTo: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  estimatedTime: z.number(),
  dependsOn: z.array(z.string()).optional(),
  status: z.enum(["pending", "in-progress", "completed"]),
});

const SolutionSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  score: z.number(),
  tasks: z.array(TaskSchema),
  selectedAt: z.string(),
});

export const DiscussionSchema = z.object({
  id: z.string(),
  phase: z.enum(["collecting", "proposing", "voting", "dividing", "completed"]),
  errors: z.array(DiscussionErrorSchema),
  participants: z.array(z.string()),
  proposals: z.array(ProposalSchema),
  votes: z.array(VoteSchema),
  result: SolutionSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  consensusActive: z.boolean().optional(),
});



const ToolReceiptSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  output: z.string(),
  timestamp: z.string(),
});

const EvidenceClaimSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  claim: z.string(),
  receiptIds: z.array(z.string()).min(1),
  confidence: z.number().min(0).max(1),
  timestamp: z.string(),
});

const VerificationSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  verifierId: z.string(),
  verdict: z.enum(["supported", "contradicted", "inconclusive"]),
  timestamp: z.string(),
});

const SkepticChallengeSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  challengerId: z.string(),
  type: z.enum(["unverified", "contradicted", "ungrounded"]),
  timestamp: z.string(),
});

const AuditEntrySchema = z.object({
  phase: z.string(),
  agentId: z.string(),
  action: z.string(),
  detail: z.string().optional(),
});

const EvidenceResultSchema = z.object({
  score: z.number(),
  supportRatio: z.number(),
  avgConfidence: z.number(),
  receiptCoverage: z.number(),
  challengesFiled: z.number(),
  claimsCount: z.number(),
  verificationsCount: z.number(),
});

export const EvidencedDiscussionSchema = z.object({
  id: z.string(),
  phase: z.enum(["gathering", "verifying", "challenging", "completed"]),
  receipts: z.array(ToolReceiptSchema),
  claims: z.array(EvidenceClaimSchema),
  verifications: z.array(VerificationSchema),
  challenges: z.array(SkepticChallengeSchema),
  audit: z.array(AuditEntrySchema),
  participants: z.array(z.string()),
  skepticId: z.string(),
  deadline: z.number(),
  result: EvidenceResultSchema.optional(),
});

export const StateSchema = z.preprocess(
  stripProto,
  z
    .object({
      version: z.number().int().optional(),
      records: z.array(RecordEntrySchema).optional(),
      handoffs: z.array(HandoffEntrySchema).optional(),
      recSeq: z.number().int().min(0).optional(),
      hoffSeq: z.number().int().min(0).optional(),
      agentErrors: z.record(z.string(), z.number().min(0).max(10000)).optional(),
      agentRatings: z.record(z.string(), AgentRatingSchema).optional(),
      capabilities: z.array(CapabilityRecordSchema).max(500).optional(),
      dynamicAgents: z.array(z.string().min(1).max(100)).optional(),
      agentModelMap: z.record(z.string(), z.string()).optional(),
      sharedMemory: SharedMemorySchema.optional(),
      discussions: z.array(DiscussionSchema).optional(),
      discussionSeq: z.number().int().min(0).optional(),
      evidencedDiscussions: z.array(EvidencedDiscussionSchema).optional(),
      evidenceSeqReceipt: z.number().int().min(0).optional(),
      evidenceSeqClaim: z.number().int().min(0).optional(),
      evidenceSeqVerification: z.number().int().min(0).optional(),
      evidenceSeqChallenge: z.number().int().min(0).optional(),
      trainingEvaluator: z.record(z.string(), z.unknown()).optional(),
      
      pauseState: PauseStateSchema,
      seenAgents: z.record(z.string(), z.array(z.string())).optional(),
      
      sessionData: z
        .record(
          z.string(),
          z
            .object({
              pauseState: PauseStateSchema,
              seenAgents: z.record(z.string(), z.array(z.string())).optional(),
            })
            .passthrough(),
        )
        .optional(),
      
      
      _meta: z
        .object({
          revision: z.number().int().min(0).optional(),
        })
        .passthrough()
        .optional(),
      
      
      _delta: z.boolean().optional(),
      _timestamp: z.number().optional(),
    })
    .strict(),
);




export const GoalStatusSchema = z.enum([
  "open",
  "in_progress",
  "partial",
  "blocked",
  "completed",
  "verified",
  "dropped",
  "stale",
]);

export const GoalItemStateSchema = z.enum(["pending", "in_progress", "partial", "done", "failed", "dropped"]);

export const GoalListFilterSchema = z.enum([
  "active",
  "open",
  "partial",
  "blocked",
  "completed",
  "verified",
  "dropped",
  "stale",
  "all",
]);

export const DoDCriterionSchema = z.object({
  criterion: z.string().min(1).max(500),
  verification: z.enum(["automated", "manual", "agent_check"]),
  status: z.enum(["pending", "met", "not_met"]),
  
  evidence: z.array(z.string()).default([]),
});

export const GoalItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(500),
  state: GoalItemStateSchema,
  evidence: z.array(z.string()),
  verifiedBy: z.string().nullable(),
  updatedAt: z.string(),
});

export const CompletedItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(500),
  completedAt: z.string(),
  
  evidence: z.array(z.string()).optional().default([]),
});

export const GoalSchema = z.object({
  id: z.string(),
  seq: z.number().int().min(0),
  title: z.string().min(1).max(500),
  detail: z.string().max(5000),
  status: GoalStatusSchema,
  closedAs: GoalStatusSchema.optional(),
  progressPct: z.number().int().min(0).max(100),
  owner: z.string(),
  ownerKind: z.enum(["solo", "delegated"]),
  parentId: z.string().nullable(),
  items: z.array(GoalItemSchema),
  
  completedItems: z.array(CompletedItemSchema).optional().default([]),
  acceptance: z.array(DoDCriterionSchema),
  linkedRecords: z.array(z.string()),
  linkedHandoffs: z.array(z.string()),
  linkedBoards: z.array(z.string()),
  evidence: z.array(z.string()),
  evidenceHashes: z.array(z.string()),
  pinned: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  verifiedBy: z.string().nullable(),
  lastEvidenceAt: z.string().nullable(),
});
