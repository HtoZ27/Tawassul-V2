

import { tool } from "../tool.ts";
import type { StructuredToolResult } from "../services/tool-schema.ts";
import { toToolResult } from "../services/tool-schema.ts";

import type {
  Discussion,
  Proposal,
  Vote,
  Task,
  CreateDiscussionInput,
  VoteResult,
  TaskDivisionResult,
} from "./discussion.ts";
import type { EvidenceManager } from "./evidence-manager.ts";
import { MAX_CHALLENGES_PER_DISCUSSION } from "./evidence-types.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { isRootLikeAgent } from "../hooks/guards/shared/normalize.ts";



function isReadObserver(agent: string | undefined): boolean {
  return isRootLikeAgent(agent) || normalizeName(agent ?? "") === "tawa";
}



export function buildDiscussionTool(
  getDiscussion: (id: string) => Discussion | undefined,
  createDiscussion: (input: CreateDiscussionInput) => Discussion,
  saveCallback?: () => void,
) {
  return tool({
    description: [
      "Open a discussion window for agents to solve problems collaboratively.",
      "Phases: 1 collect errors from files/reports → 2 agents propose solutions → 3 agents vote on the best solution → 4 divide tasks among agents.",
      'Usage: discussion(action: "create", errors: [...], participants: ["@dev", "@architect"]); discussion(action: "status|proposals|close", discussionId: "D-001").',
    ].join("\n"),
    args: {
      action: tool.schema.enum(["create", "status", "proposals", "close"]).describe("Discussion action"),
      discussionId: tool.schema.string().optional().describe("Discussion ID (for status/proposals/close)"),
      errors: tool.schema
        .array(
          tool.schema.object({
            id: tool.schema.string(),
            file: tool.schema.string(),
            line: tool.schema.number(),
            type: tool.schema.string(),
            severity: tool.schema.enum(["critical", "moderate", "low"]),
            message: tool.schema.string(),
          }),
        )
        .optional()
        .describe("Errors to discuss (for create)"),
      participants: tool.schema.array(tool.schema.string()).optional().describe("Agents to invite (for create)"),
    },
    async execute(args, cctx) {
      switch (args.action) {
        case "create": {
          if (!args.errors?.length) {
            return toToolResult({ summary: "⚠️ At least one error is required to start a discussion." });
          }
          if (!args.participants?.length) {
            return toToolResult({ summary: "⚠️ At least one participant is required." });
          }
          
          const hasRootParticipant = args.participants.some((p: string) => isRootLikeAgent(normalizeName(p)));
          if (hasRootParticipant) {
            return toToolResult({
              summary: "⚠️ Root model cannot be a discussion participant. Add only agent names (e.g. @dev, @analyst).",
            });
          }
          const discussion = createDiscussion({
            errors: args.errors,
            participants: args.participants,
          });
          const structured: StructuredToolResult = {
            title: `💬 Discussion ${discussion.id} opened`,
            summary: `Discussion ${discussion.id} — Phase: ${discussion.phase} — ${discussion.participants.length} participants, ${discussion.errors.length} errors`,
            fields: [
              { key: "discussionId", label: "Discussion ID", value: discussion.id, type: "code" },
              { key: "phase", label: "Phase", value: discussion.phase },
              { key: "participants", label: "Participants", value: discussion.participants.join(", ") },
              { key: "errors", label: "Errors", value: String(discussion.errors.length) },
              ...discussion.errors.map((e) => ({
                key: e.id,
                label: `${e.severity === "critical" ? "🔴" : e.severity === "moderate" ? "🟡" : "🟢"} ${e.id}`,
                value: `\`${e.file}:${e.line}\` — ${e.message}`,
                type: "code" as const,
              })),
              {
                key: "nextStep",
                label: "Next Step",
                value: `After agents propose and vote, call discussion(action: "status", discussionId: "${discussion.id}") to check the result.`,
              },
            ],
            actions: discussion.participants.map((p) => ({
              label: `Propose by ${p}`,
              description: `Propose a solution for an error as ${p}`,
              tool: "propose",
              args: { discussionId: discussion.id },
            })),
            metadata: { discussion } as Record<string, unknown>,
          };
          return toToolResult(structured);
        }

        case "status": {
          if (!args.discussionId) {
            return toToolResult({ summary: "⚠️ discussionId is required." });
          }
          const d = getDiscussion(args.discussionId);
          if (!d) {
            return toToolResult({ summary: `❌ Discussion ${args.discussionId} not found.` });
          }
          const isObserver = isReadObserver(cctx.agent);
          if (!d.participants.some((p) => normalizeName(p) === normalizeName(cctx.agent)) && !isObserver) {
            return toToolResult({ summary: `⚠️ You (${cctx.agent}) are not a participant in this discussion.` });
          }
          const coveredErrors = new Set(d.proposals.map((p) => p.errorId));
          const uncovered = d.errors.filter((e) => !coveredErrors.has(e.id));
          const nextActions: { label: string; description: string; tool: string; args: Record<string, unknown> }[] = [];
          
          if (!isObserver) {
            if (d.phase === "proposing")
              nextActions.push({
                label: "Propose solution",
                description: "Suggest a solution for an error",
                tool: "propose",
                args: { discussionId: d.id },
              });
            if (d.phase === "voting")
              nextActions.push({
                label: "Vote",
                description: "Vote on proposals",
                tool: "vote",
                args: { discussionId: d.id },
              });
            if (d.phase === "dividing")
              nextActions.push({
                label: "Divide tasks",
                description: "Split tasks among agents",
                tool: "divide",
                args: { discussionId: d.id },
              });
          }

          const fields: import("../services/tool-schema.ts").StructuredField[] = [
            { key: "phase", label: "Phase", value: d.phase },
            { key: "participants", label: "Participants", value: d.participants.join(", ") },
            { key: "errors", label: "Errors", value: String(d.errors.length) },
            { key: "proposals", label: "Proposals", value: String(d.proposals.length) },
            { key: "votes", label: "Votes", value: String(d.votes.length) },
          ];
          if (d.result) {
            fields.push({ key: "score", label: "Score", value: d.result.score.toFixed(2) });
            fields.push({ key: "tasks", label: "Tasks assigned", value: String(d.result.tasks.length) });
          }
          
          if (d.adr && (d.phase === "dividing" || d.phase === "completed")) {
            fields.push({ key: "decision", label: "Decision", value: d.adr.decision, type: "code" });
            fields.push({ key: "quorum", label: "Quorum reached", value: d.adr.quorumReached ? "Yes" : "No" });
            fields.push({ key: "adrId", label: "ADR ID", value: d.adr.id, type: "code" });
            if (d.adr.alternativesCount > 0) {
              fields.push({
                key: "alternatives",
                label: "Alternatives considered",
                value: d.adr.alternativesCount + " other proposals",
              });
            }
          }
          if (uncovered.length > 0) {
            fields.push({
              key: "uncovered",
              label: `Uncovered errors (${uncovered.length}/${d.errors.length})`,
              value: uncovered.map((e) => `${e.id} ${e.file}:${e.line} — ${e.message}`).join("\n"),
              type: "code",
            });
          }

          return toToolResult({
            title: `💬 ${d.id} — ${d.phase}`,
            summary: `Discussion ${d.id} — ${d.phase} phase`,
            fields,
            actions: nextActions.length > 0 ? nextActions : undefined,
            metadata: { discussion: d },
          });
        }

        case "proposals": {
          if (!args.discussionId) {
            return toToolResult({ summary: "⚠️ discussionId is required." });
          }
          const disc = getDiscussion(args.discussionId);
          if (!disc) {
            return toToolResult({ summary: `❌ Discussion ${args.discussionId} not found.` });
          }
          if (
            !disc.participants.some((p) => normalizeName(p) === normalizeName(cctx.agent)) &&
            !isReadObserver(cctx.agent)
          ) {
            return toToolResult({ summary: `⚠️ You (${cctx.agent}) are not a participant in this discussion.` });
          }
          if (disc.proposals.length === 0) {
            return toToolResult({ summary: "📭 No proposals yet." });
          }
          const isProposalObserver = isReadObserver(cctx.agent);
          return toToolResult({
            title: `📋 ${disc.proposals.length} proposals for ${disc.id}`,
            summary: `${disc.proposals.length} proposals submitted`,
            fields: disc.proposals.map((p) => ({
              key: p.id,
              label: `${p.id} — ${p.agentId}`,
              value: [
                `Error: ${p.errorId}`,
                `Solution: ${p.solution}`,
                `Priority: ${p.priority} | Effort: ${p.estimatedEffort}min | Risk: ${p.risk}`,
                p.justification ? `Justification: ${p.justification}` : "",
                `Votes: ${disc.votes.filter((v) => v.proposalId === p.id).reduce((sum, v) => sum + v.weight, 0)}`,
              ]
                .filter(Boolean)
                .join("\n"),
              type: "code",
            })),
            actions: isProposalObserver
              ? undefined
              : [
                  {
                    label: "Vote on proposal",
                    description: "Vote on the best proposal",
                    tool: "vote",
                    args: { discussionId: disc.id },
                  },
                ],
            metadata: { proposals: disc.proposals },
          });
        }

        case "close": {
          if (!args.discussionId) {
            return toToolResult({ summary: "⚠️ discussionId is required." });
          }
          const discussion = getDiscussion(args.discussionId);
          if (!discussion) {
            return toToolResult({ summary: `❌ Discussion ${args.discussionId} not found.` });
          }
          if (!discussion.participants.some((p) => normalizeName(p) === normalizeName(cctx.agent))) {
            return toToolResult({ summary: `⚠️ You (${cctx.agent}) are not a participant in this discussion.` });
          }
          if (discussion.consensusActive) {
            return toToolResult({ summary: "⚠️ Evidence phase in progress. Complete or abort evidence first." });
          }
          discussion.phase = "completed";
          discussion.updatedAt = new Date().toISOString();

          if (saveCallback) {
            saveCallback();
          }

          return toToolResult({
            title: `🔒 ${discussion.id} closed`,
            summary: `Discussion ${discussion.id} has been closed.`,
          });
        }

        default:
          return toToolResult({ summary: "⚠️ Unknown action. Use: create, status, proposals, close." });
      }
    },
  });
}



export function buildProposeTool(
  getDiscussion: (id: string) => Discussion | undefined,
  addProposal: (discussionId: string, proposal: Omit<Proposal, "id" | "timestamp">) => Proposal | null,
) {
  return tool({
    description: [
      "Propose a solution for an error in a discussion.",
      "",
      "═══ USAGE ═══",
      '  propose(discussionId: "D-001", errorId: "E-001",',
      '    solution: "Add null check before property access",',
      '    priority: "high", estimatedEffort: 5, risk: "low",',
      '    justification: "Simple fix, no side effects")',
    ].join("\n"),
    args: {
      discussionId: tool.schema.string().describe("Discussion ID"),
      errorId: tool.schema.string().describe("Error ID"),
      solution: tool.schema.string().describe("Proposed solution"),
      priority: tool.schema.enum(["high", "medium", "low"]).describe("Solution priority"),
      estimatedEffort: tool.schema.number().min(1).describe("Effort in minutes"),
      risk: tool.schema.enum(["high", "medium", "low"]).describe("Risk level"),
      justification: tool.schema.string().optional().describe("Why this solution?"),
    },
    async execute(args, cctx) {
      const d = getDiscussion(args.discussionId);
      if (!d) {
        return toToolResult({ summary: `❌ Discussion ${args.discussionId} not found.` });
      }
      if (!d.participants.some((p) => normalizeName(p) === normalizeName(cctx.agent))) {
        return toToolResult({ summary: `⚠️ You (${cctx.agent}) are not a participant in this discussion.` });
      }

      const proposal = addProposal(args.discussionId, {
        agentId: cctx.agent,
        errorId: args.errorId,
        solution: args.solution,
        priority: args.priority,
        estimatedEffort: args.estimatedEffort,
        risk: args.risk,
        justification: args.justification,
      });

      if (!proposal) {
        return toToolResult({ summary: "❌ Failed to add proposal." });
      }

      const coveredErrors = new Set(d.proposals.map((p) => p.errorId));
      const uncovered = d.errors.filter((e) => !coveredErrors.has(e.id));
      const structured = {
        title: `💡 Proposal ${proposal.id} by ${cctx.agent}`,
        summary: `Proposal ${proposal.id} — ${proposal.solution} [${proposal.priority}]`,
        fields: [
          { key: "agent", label: "Agent", value: cctx.agent },
          { key: "error", label: "Error", value: proposal.errorId },
          { key: "solution", label: "Solution", value: proposal.solution, type: "code" },
          { key: "priority", label: "Priority", value: proposal.priority },
          { key: "risk", label: "Risk", value: proposal.risk },
          ...(proposal.justification
            ? [{ key: "justification", label: "Justification", value: proposal.justification }]
            : []),
          {
            key: "coverage",
            label: "Uncovered",
            value: uncovered.length > 0 ? `${uncovered.length} errors` : "All covered!",
          },
        ],
        actions:
          uncovered.length > 0
            ? uncovered.map((e) => ({
                label: `Propose for ${e.id}`,
                description: `Propose solution for ${e.id}`,
                tool: "propose",
                args: { discussionId: args.discussionId, errorId: e.id },
              }))
            : d.phase === "proposing"
              ? [
                  {
                    label: "Start evidence",
                    description: "All errors covered — start evidence phase",
                    tool: "evidence",
                    args: { action: "start", discussionId: args.discussionId },
                  },
                ]
              : [],
        metadata: { proposal },
      };
      return toToolResult(structured as StructuredToolResult);
    },
  });
}



export function buildVoteTool(
  getDiscussion: (id: string) => Discussion | undefined,
  castVote: (discussionId: string, vote: Omit<Vote, "timestamp">) => VoteResult,
) {
  return tool({
    description: [
      "Vote on a proposed solution in a discussion.",
      "",
      "═══ USAGE ═══",
      '  vote(discussionId: "D-001", proposalId: "P-001",',
      '    weight: 1.0, reason: "Simple and effective solution")',
      "",
      "Weight: 0.0 to 1.0 (how strongly you support this proposal)",
    ].join("\n"),
    args: {
      discussionId: tool.schema.string().describe("Discussion ID"),
      proposalId: tool.schema.string().describe("Proposal ID to vote for"),
      weight: tool.schema.number().min(0).max(1).describe("Vote weight (0.0 to 1.0)"),
      reason: tool.schema.string().optional().describe("Reason for your vote"),
    },
    async execute(args, cctx) {
      const d = getDiscussion(args.discussionId);
      if (!d) {
        return toToolResult({ summary: `❌ Discussion ${args.discussionId} not found.` });
      }

      const result = castVote(args.discussionId, {
        agentId: cctx.agent,
        proposalId: args.proposalId,
        weight: args.weight,
        reason: args.reason,
      });

      if (!result.success) {
        return toToolResult({ summary: `❌ ${result.error}` });
      }

      const totalVotes = d.votes.length ?? 0;

      const voteStructured = {
        title: `🗳️ Vote cast by ${cctx.agent}`,
        summary: `${cctx.agent} voted for ${args.proposalId} (weight: ${args.weight})`,
        fields: [
          { key: "agent", label: "Agent", value: cctx.agent },
          { key: "proposal", label: "Proposal", value: args.proposalId },
          { key: "weight", label: "Weight", value: String(args.weight) },
          ...(args.reason ? [{ key: "reason", label: "Reason", value: args.reason }] : []),
          { key: "total", label: "Total votes", value: String(totalVotes) },
          ...(result.winningProposal
            ? [
                {
                  key: "leader",
                  label: "Current leader",
                  value: `${result.winningProposal.id} (score: ${result.score?.toFixed(2)})`,
                },
              ]
            : []),
          
          ...(result.structured
            ? [
                { key: "phase", label: "Phase", value: result.structured.phase },
                { key: "quorumMet", label: "Quorum met", value: String(result.structured.quorumMet) },
                {
                  key: "votesCast",
                  label: "Votes cast",
                  value: `${result.structured.votesCast}/${result.structured.totalParticipants}`,
                },
              ]
            : []),
        ],
        actions:
          result.winningProposal && d.phase === "dividing"
            ? [
                {
                  label: "Divide tasks",
                  description: "Split tasks among agents",
                  tool: "divide",
                  args: { discussionId: args.discussionId },
                },
              ]
            : [],
        metadata: {
          vote: { agentId: cctx.agent, proposalId: args.proposalId, weight: args.weight },
          
          ...(result.structured ? { consensus: result.structured } : {}),
        },
      };
      return toToolResult(voteStructured as StructuredToolResult);
    },
  });
}



export function buildDivideTool(
  getDiscussion: (id: string) => Discussion | undefined,
  divideTasks: (discussionId: string, tasks: Omit<Task, "id" | "status">[]) => TaskDivisionResult,
) {
  return tool({
    description: [
      "Divide agreed-upon tasks among agents after a discussion reaches consensus.",
      "",
      "═══ USAGE ═══",
      '  divide(discussionId: "D-001", tasks: [',
      '    { description: "Fix null pointer in main.ts", assignedTo: "@dev", priority: "high", estimatedTime: 5 },',
      '    { description: "Add tests for utils.ts", assignedTo: "@tester", priority: "medium", estimatedTime: 10 }',
      "  ])",
      "",
      "Tasks will be automatically assigned and tracked.",
    ].join("\n"),
    args: {
      discussionId: tool.schema.string().describe("Discussion ID"),
      tasks: tool.schema
        .array(
          tool.schema.object({
            description: tool.schema.string().describe("Task description"),
            assignedTo: tool.schema.string().describe("Agent to assign to"),
            priority: tool.schema.enum(["high", "medium", "low"]).describe("Task priority"),
            estimatedTime: tool.schema.number().min(1).describe("Minutes"),
            dependsOn: tool.schema.array(tool.schema.string()).optional().describe("Dependency task IDs"),
          }),
        )
        .describe("Tasks to divide"),
    },
    async execute(args, cctx) {
      const d = getDiscussion(args.discussionId);
      if (!d) {
        return toToolResult({ summary: `❌ Discussion ${args.discussionId} not found.` });
      }
      if (!d.participants.some((p) => normalizeName(p) === normalizeName(cctx.agent))) {
        return toToolResult({ summary: `⚠️ You (${cctx.agent}) are not a participant in this discussion.` });
      }

      const result = divideTasks(args.discussionId, args.tasks);

      if (!result.success) {
        return toToolResult({ summary: `❌ ${result.error}` });
      }

      const structured: StructuredToolResult = {
        title: `📋 Tasks divided for ${args.discussionId}`,
        summary: [
          `**Tasks:** ${result.tasks?.length ?? 0}`,
          ...(result.handoffIds ? [`**Handoffs:** ${result.handoffIds.length}`] : []),
        ].join(" | "),
        fields: [
          ...(result.tasks ?? []).map((t) => ({
            key: t.id,
            label: `${t.id} [${t.priority}] → ${t.assignedTo}`,
            value: `${t.description} (${t.estimatedTime} min)`,
          })),
          ...Object.entries(result.assignments ?? {}).map(([agent, tasks]) => ({
            key: `assign-${agent}`,
            label: `Agent: ${agent}`,
            value: `${tasks.length} task(s)`,
          })),
        ],
        actions: (result.handoffIds ?? []).map((h) => ({
          label: `Complete ${h}`,
          description: `Complete handoff ${h} with result`,
          tool: "handoff",
          args: { completeHandoff: h },
        })),
        metadata: { tasks: result.tasks, assignments: result.assignments, handoffIds: result.handoffIds } as Record<
          string,
          unknown
        >,
      };

      return toToolResult(structured);
    },
  });
}



export function buildEvidenceTool(
  getDiscussion: (id: string) => Discussion | undefined,
  evidenceManager: EvidenceManager,
) {
  return tool({
    description: [
      "Submit and manage evidence for a discussion.",
      "Phases: gathering (submit receipts + claims) → verifying (verify claims) → challenging (skeptic challenges) → completed.",
      "ACTIONS: start (begins the phase, transitions from proposing); receipt (submit tool output); claim (needs receiptIds); verify (supported/contradicted/inconclusive); challenge (skeptic challenges a claim); advance (next phase); status (view state); abort (cancel, returns to proposing).",
    ].join("\n"),
    args: {
      action: tool.schema
        .enum(["start", "receipt", "claim", "verify", "challenge", "advance", "status", "abort"])
        .describe("Evidence action"),
      discussionId: tool.schema.string().describe("Discussion ID"),
      toolName: tool.schema.string().optional().describe("Tool name"),
      output: tool.schema.string().optional().describe("Tool output"),
      claim: tool.schema.string().optional().describe("Claim text"),
      receiptIds: tool.schema.array(tool.schema.string()).optional().describe("Receipt IDs"),
      confidence: tool.schema.number().min(0).max(1).optional().describe("Confidence 0-1"),
      claimId: tool.schema.string().optional().describe("Claim ID"),
      verdict: tool.schema
        .enum(["supported", "contradicted", "inconclusive"])
        .optional()
        .describe("Verdict"),
      challengeType: tool.schema
        .enum(["unverified", "contradicted", "ungrounded"])
        .optional()
        .describe("Challenge type"),
    },
    async execute(args, cctx) {
      const d = getDiscussion(args.discussionId);
      if (!d) return toToolResult({ summary: `❌ Discussion ${args.discussionId} not found.` });
      if (!d.participants.some((p) => normalizeName(p) === normalizeName(cctx.agent))) {
        return toToolResult({ summary: `⚠️ You (${cctx.agent}) are not a participant in this discussion.` });
      }

      switch (args.action) {
        case "start": {
          const uniqueProposers = new Set(d.proposals.map((p) => p.agentId));
          if (uniqueProposers.size < d.participants.length) {
            return toToolResult({ summary: "❌ All participants must propose before starting evidence." });
          }
          const ok = evidenceManager.start(args.discussionId);
          if (!ok)
            return toToolResult({
              summary: "❌ Cannot start evidence. Discussion must be in 'proposing' phase and not already started.",
            });
          return toToolResult({
            title: `🔬 Evidence started — ${args.discussionId}`,
            summary: `Evidence phase started for ${args.discussionId}. Submit receipts and claims to begin.`,
            actions: [
              {
                label: "Submit receipt",
                description: "Submit tool output as evidence receipt",
                tool: "evidence",
                args: { action: "receipt", discussionId: args.discussionId },
              },
            ],
          });
        }
        case "receipt": {
          const r = evidenceManager.submitReceipt(args.discussionId, {
            agentId: cctx.agent,
            toolName: args.toolName ?? "unknown",
            args: {},
            output: args.output ?? "",
          });
          if (!r) return toToolResult({ summary: "❌ Cannot submit receipt. Phase must be 'gathering'." });
          const ed = evidenceManager.getState(args.discussionId);
          return toToolResult({
            summary: `✅ Receipt ${r.id} submitted. Total: ${ed?.receipts.length ?? 0}`,
            fields: [
              { key: "receiptId", label: "Receipt ID", value: r.id },
              { key: "total", label: "Total receipts", value: String(ed?.receipts.length ?? 0) },
            ],
          });
        }
        case "claim": {
          if (!args.claim) return toToolResult({ summary: "❌ Claim text required." });
          if (!args.receiptIds?.length) return toToolResult({ summary: "❌ At least one receiptId required." });
          const c = evidenceManager.submitClaim(args.discussionId, {
            agentId: cctx.agent,
            claim: args.claim,
            receiptIds: args.receiptIds,
            confidence: args.confidence ?? 0.5,
          });
          if (!c) return toToolResult({ summary: "❌ Cannot submit claim. Must cite at least 1 receipt." });
          return toToolResult({
            summary: `✅ Claim ${c.id} submitted.`,
            fields: [{ key: "claimId", label: "Claim ID", value: c.id }],
          });
        }
        case "verify": {
          if (!args.claimId) return toToolResult({ summary: "❌ claimId required." });
          if (!args.verdict)
            return toToolResult({ summary: "❌ verdict required (supported/contradicted/inconclusive)." });
          const v = evidenceManager.verify(args.discussionId, {
            claimId: args.claimId,
            verifierId: cctx.agent,
            verdict: args.verdict,
          });
          if (!v) return toToolResult({ summary: "❌ Cannot verify. Already verified or wrong phase." });
          return toToolResult({
            summary: `✅ Verification submitted: ${args.verdict}`,
            fields: [{ key: "verdict", label: "Verdict", value: args.verdict }],
          });
        }
        case "challenge": {
          if (!args.claimId) return toToolResult({ summary: "❌ claimId required." });
          if (!args.challengeType) return toToolResult({ summary: "❌ challengeType required." });
          const ch = evidenceManager.challenge(args.discussionId, {
            claimId: args.claimId,
            challengerId: cctx.agent,
            type: args.challengeType,
          });
          if (!ch) return toToolResult({ summary: "❌ Only the skeptic can challenge, or max challenges reached." });
          return toToolResult({
            summary: `✅ Challenge ${ch.id} filed.`,
            fields: [{ key: "challengeId", label: "Challenge ID", value: ch.id }],
          });
        }
        case "advance": {
          const ok = evidenceManager.advancePhase(args.discussionId);
          if (!ok)
            return toToolResult({
              summary: "❌ Cannot advance. Check phase requirements (claims or verifications needed).",
            });
          const state = evidenceManager.getState(args.discussionId);
          const phase = state?.phase ?? "unknown";
          if (phase === "completed" && state?.result) {
            return toToolResult({
              title: `✅ Evidence complete — ${args.discussionId}`,
              summary: `Evidence complete. Score: ${state.result.score.toFixed(2)}. Discussion transitions to voting.`,
              fields: [
                { key: "score", label: "Score", value: state.result.score.toFixed(2) },
                {
                  key: "supportRatio",
                  label: "Support ratio",
                  value: `${(state.result.supportRatio * 100).toFixed(0)}%`,
                },
                {
                  key: "avgConfidence",
                  label: "Avg confidence",
                  value: `${(state.result.avgConfidence * 100).toFixed(0)}%`,
                },
              ],
              actions: [
                {
                  label: "Vote",
                  description: "Vote on proposals",
                  tool: "vote",
                  args: { discussionId: args.discussionId },
                },
              ],
            });
          }
          return toToolResult({ summary: `✅ Advanced to '${phase}' phase.` });
        }
        case "status": {
          const state = evidenceManager.getState(args.discussionId);
          if (!state)
            return toToolResult({
              summary: "❌ No evidence phase active. Use `evidence(action: 'start')` to begin.",
            });
          evidenceManager.finalizeIfExpired(args.discussionId);
          const fields = [
            { key: "phase", label: "Phase", value: state.phase },
            { key: "skeptic", label: "Skeptic", value: state.skepticId },
            { key: "receipts", label: "Receipts", value: String(state.receipts.length) },
            { key: "claims", label: "Claims", value: String(state.claims.length) },
            { key: "verifications", label: "Verifications", value: String(state.verifications.length) },
            {
              key: "challenges",
              label: "Challenges",
              value: `${state.challenges.length}/${state.phase === "challenging" ? String(MAX_CHALLENGES_PER_DISCUSSION) : "-"}`,
            },
          ];
          if (state.result) {
            fields.push({ key: "score", label: "Score", value: state.result.score.toFixed(2) });
            fields.push({
              key: "supportRatio",
              label: "Support ratio",
              value: `${(state.result.supportRatio * 100).toFixed(0)}%`,
            });
            fields.push({
              key: "avgConfidence",
              label: "Avg confidence",
              value: `${(state.result.avgConfidence * 100).toFixed(0)}%`,
            });
          }
          const nextActions: { label: string; description: string; tool: string; args: Record<string, unknown> }[] = [];
          if (state.phase === "gathering") {
            nextActions.push({
              label: "Submit receipt",
              description: "Submit tool output as evidence",
              tool: "evidence",
              args: { action: "receipt", discussionId: args.discussionId },
            });
            nextActions.push({
              label: "Submit claim",
              description: "Make an evidence-backed claim",
              tool: "evidence",
              args: { action: "claim", discussionId: args.discussionId },
            });
          }
          if (state.phase === "verifying") {
            nextActions.push({
              label: "Verify claim",
              description: "Verify a claim",
              tool: "evidence",
              args: { action: "verify", discussionId: args.discussionId },
            });
          }
          if (state.phase === "challenging") {
            nextActions.push({
              label: "Challenge claim",
              description: "Challenge a claim",
              tool: "evidence",
              args: { action: "challenge", discussionId: args.discussionId },
            });
          }
          nextActions.push({
            label: "Advance phase",
            description: "Move to next evidence phase",
            tool: "evidence",
            args: { action: "advance", discussionId: args.discussionId },
          });
          return toToolResult({
            title: `🔬 Evidence — ${args.discussionId}`,
            summary: `Evidence phase: ${state.phase}`,
            fields,
            actions: nextActions,
          });
        }
        case "abort": {
          const ok = evidenceManager.abort(args.discussionId);
          if (!ok) return toToolResult({ summary: "❌ Cannot abort. Evidence already completed or not active." });
          return toToolResult({
            summary: `✅ Evidence aborted. Discussion ${args.discussionId} returned to 'proposing'.`,
          });
        }
        default:
          return toToolResult({ summary: "❌ Unknown action." });
      }
    },
  });
}
