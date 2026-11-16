import type {
  Discussion,
  Proposal,
  Vote,
  Task,
  Solution,
  CreateDiscussionInput,
  VoteResult,
  TaskDivisionResult,
  Priority,
} from "./discussion.ts";

import { MAX_SOLUTION_LENGTH, MAX_PARTICIPANTS_PER_DISCUSSION, InputValidationError } from "./discussion.ts";

import { normalizeName } from "../utils/name-utils.ts";
import {
  calculateProposalScore,
  findBestProposal,
  findBestAgent,
  getLeastLoadedAgent,
  calculateRiskScore as calcRiskScore,
} from "./voting.ts";
import { EventHub } from "../services/event-hub.ts";
import { councillorVote } from "../services/councillor.ts";
import type { CouncillorOutput } from "../services/councillor.ts";
import type { ADRRecord } from "../services/chain-ctx.ts";
import type { EvidenceManager } from "./evidence-manager.ts";
import type { EvidencedDiscussion } from "./evidence-types.ts";
import type { TimerManagerLike } from "../types/timer-types.ts";

export const QUORUM_RATIO = 0.5;

export const VOTE_TIMEOUT_MS = 10 * 60 * 1000;

export class DiscussionManager {
  private discussions: Map<string, Discussion> = new Map();
  private sequence: number = 0;
  private saveCallback?: (discussions: Discussion[]) => void;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private static MAX_DISCUSSIONS = 50;
  private eventHub: EventHub;
  private timers: TimerManagerLike | null;

  private createHandoffCallback?: (params: {
    from: string;
    to: string;
    task: string;
    context: string;
    files: string[];
    sourceDiscussionId?: string;
  }) => string;

  private decisionSink?: (adr: ADRRecord) => void;
  private emitWithChain?: (type: string, payload: Record<string, unknown>) => void;
  private consensusBrokerEnabled = false;

  private voteDeadlines: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(
    saveCallback?: (discussions: Discussion[]) => void,
    private evidenceManager?: EvidenceManager,
    eventHub?: EventHub,
    timers?: TimerManagerLike,
    decisionSink?: (adr: ADRRecord) => void,
    emitWithChain?: (type: string, payload: Record<string, unknown>) => void,
  ) {
    this.saveCallback = saveCallback;
    this.eventHub = eventHub ?? new EventHub();
    this.timers = timers ?? null;
    this.decisionSink = decisionSink;
    this.emitWithChain = emitWithChain;
  }

  setDecisionSink(sink: (adr: ADRRecord) => void): void {
    this.decisionSink = sink;
  }

  setConsensusBrokerEnabled(enabled: boolean): void {
    this.consensusBrokerEnabled = enabled;
  }

  private emitConsensusEvent(
    type: string,
    discussion: Discussion,
    result: {
      quorumReached: boolean;
      winningProposal: { proposal: Proposal; score: number } | null;
      decision: ADRRecord | null;
    },
  ): void {
    const payload = {
      chainId: discussion.id,
      discussionId: discussion.id,
      quorumReached: result.quorumReached,
      winner: result.winningProposal?.proposal.solution ?? "",
      adrId: result.decision?.id ?? "",
    };
    if (this.emitWithChain) this.emitWithChain(type, payload);
    else this.eventHub.emit({ type, ...payload } as never);
  }

  setCreateHandoffCallback(cb: NonNullable<typeof this.createHandoffCallback>): void {
    this.createHandoffCallback = cb;
  }

  loadFromState(discussions: Discussion[], sequence: number): void {
    if (this.saveTimer) {
      if (this.timers) this.timers.clear(this.saveTimer);
      else clearTimeout(this.saveTimer as ReturnType<typeof setTimeout>);
      this.saveTimer = undefined;
    }
    for (const timerId of this.voteDeadlines.values()) {
      if (this.timers) this.timers.clear(timerId);
      else clearTimeout(timerId as ReturnType<typeof setTimeout>);
    }
    this.voteDeadlines.clear();
    this.discussions.clear();
    for (const d of discussions) {
      this.discussions.set(d.id, d);
    }
    this.sequence = sequence;
    const timerFn = this.timers
      ? (fn: () => void, ms: number) => this.timers!.setTimeout(fn, ms)
      : (fn: () => void, ms: number) => setTimeout(fn, ms);
    for (const d of this.discussions.values()) {
      if (d.phase === "voting" && d.participants.length > 1 && !this.voteDeadlines.has(d.id)) {
        const timerId = timerFn(() => this.expireVote(d.id), VOTE_TIMEOUT_MS);
        this.voteDeadlines.set(d.id, timerId);
      }
    }
  }

  getDiscussionsForSave(): Discussion[] {
    return Array.from(this.discussions.values());
  }

  getSequence(): number {
    return this.sequence;
  }

  save(): void {
    this.triggerSave();
  }

  private triggerSave(): void {
    if (this.saveTimer) {
      if (this.timers) this.timers.clear(this.saveTimer);
      else clearTimeout(this.saveTimer as ReturnType<typeof setTimeout>);
    }
    const fire = () => {
      this.saveTimer = undefined;
      if (this.saveCallback) {
        this.saveCallback(this.getDiscussionsForSave());
      }
    };
    if (this.timers) {
      this.saveTimer = this.timers.setTimeout(fire, 500);
    } else {
      const t = setTimeout(fire, 500);
      if (t?.unref) t.unref();
      this.saveTimer = t;
    }
  }

  public flushSave(): void {
    if (this.saveTimer) {
      if (this.timers) this.timers.clear(this.saveTimer);
      else clearTimeout(this.saveTimer as ReturnType<typeof setTimeout>);
      this.saveTimer = undefined;
    }
    if (this.saveCallback) {
      this.saveCallback(this.getDiscussionsForSave());
    }
  }

  reset(): void {
    if (this.saveTimer) {
      if (this.timers) this.timers.clear(this.saveTimer);
      else clearTimeout(this.saveTimer as ReturnType<typeof setTimeout>);
      this.saveTimer = undefined;
    }
    for (const timerId of this.voteDeadlines.values()) {
      if (this.timers) this.timers.clear(timerId);
      else clearTimeout(timerId as ReturnType<typeof setTimeout>);
    }
    this.voteDeadlines.clear();
    this.discussions.clear();
    this.sequence = 0;
    this.evidenceManager?.reset();
  }

  public dispose(): void {
    this.reset();
  }

  collectErrors(input: CreateDiscussionInput): Discussion {
    if (input.participants.length > MAX_PARTICIPANTS_PER_DISCUSSION) {
      throw new InputValidationError(
        `Too many participants: ${input.participants.length} (max ${MAX_PARTICIPANTS_PER_DISCUSSION})`,
      );
    }
    if (this.discussions.size >= DiscussionManager.MAX_DISCUSSIONS) {
      const oldest = [...this.discussions.values()]
        .filter((d) => d.phase === "completed")
        .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())[0];
      if (oldest) {
        this.discussions.delete(oldest.id);
      } else {
        throw new InputValidationError(
          `Maximum discussions reached (${DiscussionManager.MAX_DISCUSSIONS}). Complete or remove old discussions.`,
        );
      }
    }
    this.sequence++;
    const id = `D-${String(this.sequence).padStart(3, "0")}`;
    const now = new Date().toISOString();

    const discussion: Discussion = {
      id,
      phase: "proposing",
      errors: input.errors,
      participants: input.participants,
      proposals: [],
      votes: [],
      createdAt: now,
      updatedAt: now,
    };

    this.discussions.set(id, discussion);
    this.eventHub.emit({ type: "DISCUSSION_STARTED", discussionId: id });
    this.triggerSave();
    return discussion;
  }

  proposeSolution(discussionId: string, proposal: Omit<Proposal, "id" | "timestamp">): Proposal | null {
    const discussion = this.discussions.get(discussionId);
    if (!discussion || discussion.phase !== "proposing") {
      return null;
    }
    if (discussion.consensusActive) return null;

    if (!discussion.errors.some((e) => e.id === proposal.errorId)) {
      return null;
    }

    if (proposal.solution.length > MAX_SOLUTION_LENGTH) {
      return null;
    }

    const proposalId = `P-${String(discussion.proposals.length + 1).padStart(3, "0")}`;
    const newProposal: Proposal = {
      id: proposalId,
      ...proposal,
      timestamp: new Date().toISOString(),
    };

    discussion.proposals.push(newProposal);
    discussion.updatedAt = new Date().toISOString();

    const uniqueProposers = new Set(discussion.proposals.map((p) => p.agentId));
    const coveredErrors = new Set(discussion.proposals.map((p) => p.errorId));
    const allErrorsCovered = discussion.errors.every((e) => coveredErrors.has(e.id));
    if (uniqueProposers.size >= discussion.participants.length && allErrorsCovered && !discussion.consensusActive) {
      discussion.phase = "voting";
    }

    this.triggerSave();
    return newProposal;
  }

  vote(discussionId: string, voteData: Omit<Vote, "timestamp">): VoteResult {
    const discussion = this.discussions.get(discussionId);
    if (!discussion) {
      return { success: false, error: `Discussion ${discussionId} not found.` };
    }
    if (discussion.phase !== "voting") {
      return {
        success: false,
        error: `Discussion is in "${discussion.phase}" phase. Voting only allowed during "voting" phase.`,
      };
    }
    if (discussion.consensusActive) {
      return { success: false, error: "Evidence phase in progress. Complete evidence first." };
    }
    if (!discussion.participants.some((p) => normalizeName(p) === normalizeName(voteData.agentId))) {
      return { success: false, error: `Agent ${voteData.agentId} is not a participant.` };
    }
    if (!discussion.proposals.find((p) => p.id === voteData.proposalId)) {
      return { success: false, error: `Proposal ${voteData.proposalId} not found.` };
    }

    discussion.votes = discussion.votes.filter((v) => v.agentId !== voteData.agentId);

    const newVote: Vote = {
      ...voteData,
      timestamp: new Date().toISOString(),
    };
    discussion.votes.push(newVote);
    this.eventHub.emit({ type: "DISCUSSION_VOTE_CAST", discussionId, vote: voteData.proposalId });
    discussion.updatedAt = new Date().toISOString();

    if (!this.voteDeadlines.has(discussionId) && discussion.participants.length > 1) {
      const timerFn = this.timers
        ? (fn: () => void, ms: number) => this.timers!.setTimeout(fn, ms)
        : (fn: () => void, ms: number) => setTimeout(fn, ms);
      const timerId = timerFn(() => this.expireVote(discussionId), VOTE_TIMEOUT_MS);
      this.voteDeadlines.set(discussionId, timerId);
    }

    const uniqueVoters = new Set(discussion.votes.map((v) => v.agentId));
    const requiredQuorum = Math.ceil(
      discussion.participants.length > 0 ? discussion.participants.length * QUORUM_RATIO : 0,
    );
    if (uniqueVoters.size >= discussion.participants.length) {
      this.clearVoteDeadline(discussionId);
      const quorumResult = this.resolveQuorum(discussion, requiredQuorum);
      const canDecide = this.consensusBrokerEnabled ? quorumResult.quorumReached : !!quorumResult.decision;
      if (canDecide && quorumResult.decision && quorumResult.winningProposal) {
        if (this.consensusBrokerEnabled) {
          this.emitConsensusEvent("CONSENSUS_REACHED", discussion, quorumResult);
        }
        this.decisionSink?.(quorumResult.decision);
        const winner = quorumResult.winningProposal;
        const solution: Solution = {
          id: `S-${discussion.id}`,
          proposalId: winner.proposal.id,
          score: winner.score,
          tasks: [],
          selectedAt: new Date().toISOString(),
        };
        discussion.result = solution;
        discussion.adr = {
          id: quorumResult.decision.id,
          decision: quorumResult.decision.decision,
          quorumReached: quorumResult.quorumReached,
          alternativesCount: quorumResult.decision.alternatives.length,
        };
        discussion.phase = "dividing";
        discussion.updatedAt = new Date().toISOString();
        this.triggerSave();
        return {
          success: true,
          winningProposal: winner.proposal,
          score: winner.score,
          structured: {
            discussionId,
            phase: discussion.phase,
            votesCast: uniqueVoters.size,
            totalParticipants: discussion.participants.length,
            quorumMet: quorumResult.quorumReached,
            leader: {
              id: winner.proposal.id,
              agent: winner.proposal.agentId,
              solution: winner.proposal.solution,
              score: winner.score,
            },
          },
        };
      }
      if (!this.voteDeadlines.has(discussionId)) {
        const timerFn = this.timers
          ? (fn: () => void, ms: number) => this.timers!.setTimeout(fn, ms)
          : (fn: () => void, ms: number) => setTimeout(fn, ms);
        const timerId = timerFn(() => this.expireVote(discussionId), VOTE_TIMEOUT_MS);
        this.voteDeadlines.set(discussionId, timerId);
      }
    }

    this.triggerSave();
    const currentLeader = findBestProposal(
      discussion.proposals,
      discussion.votes,
      discussion.participants.length,
      discussion.errors.length,
    );
    return {
      success: true,
      winningProposal: currentLeader?.proposal,
      score: currentLeader?.score,
      structured: {
        discussionId,
        phase: discussion.phase,
        votesCast: uniqueVoters.size,
        totalParticipants: discussion.participants.length,
        quorumMet: uniqueVoters.size >= requiredQuorum,
        leader: currentLeader
          ? {
              id: currentLeader.proposal.id,
              agent: currentLeader.proposal.agentId,
              solution: currentLeader.proposal.solution,
              score: currentLeader.score,
            }
          : undefined,
      },
    };
  }

  private expireVote(discussionId: string): void {
    this.voteDeadlines.delete(discussionId);
    const discussion = this.discussions.get(discussionId);
    if (!discussion || discussion.phase !== "voting") return;

    const uniqueVoters = new Set(discussion.votes.map((v) => v.agentId));
    const requiredQuorum = Math.ceil(
      discussion.participants.length > 0 ? discussion.participants.length * QUORUM_RATIO : 0,
    );

    const winner = findBestProposal(
      discussion.proposals,
      discussion.votes,
      discussion.participants.length,
      discussion.errors.length,
    );
    if (!winner) return;

    const quorumReached = uniqueVoters.size >= requiredQuorum;
    const decision: ADRRecord = {
      id: `ADR-${discussion.id}-deadline`,
      title: `Vote deadline for ${discussion.id}`,
      context: `Participants: ${discussion.participants.join(", ")}. Votes: ${uniqueVoters.size}/${discussion.participants.length}`,
      decision: quorumReached
        ? `Adopted "${winner.proposal.solution}" (${uniqueVoters.size}/${discussion.participants.length} voted)`
        : `Adopted best proposal "${winner.proposal.solution}" — quorum ${uniqueVoters.size}/${requiredQuorum}, some participants did not vote`,
      alternatives: discussion.proposals.filter((p) => p.id !== winner.proposal.id).map((p) => p.solution),
      votedAt: new Date().toISOString(),
      quorumReached,
    };

    this.emitConsensusEvent("CONSENSUS_REACHED", discussion, {
      quorumReached,
      winningProposal: winner,
      decision,
    });
    this.decisionSink?.(decision);

    const solution: Solution = {
      id: `S-${discussion.id}`,
      proposalId: winner.proposal.id,
      score: winner.score,
      tasks: [],
      selectedAt: new Date().toISOString(),
    };
    discussion.result = solution;
    discussion.adr = {
      id: decision.id,
      decision: decision.decision,
      quorumReached,
      alternativesCount: decision.alternatives.length,
    };
    discussion.phase = "dividing";
    discussion.updatedAt = new Date().toISOString();
    this.triggerSave();
  }

  private clearVoteDeadline(discussionId: string): void {
    const timerId = this.voteDeadlines.get(discussionId);
    if (timerId !== undefined) {
      if (this.timers) this.timers.clear(timerId);
      else clearTimeout(timerId as ReturnType<typeof setTimeout>);
      this.voteDeadlines.delete(discussionId);
    }
  }

  public calculateRiskScore(tasks: unknown[]): number {
    return calcRiskScore(tasks);
  }

  public calculateProposalScore(
    proposal: Proposal,
    votes: Vote[],
    totalAgents: number,
    totalErrors: number,
    allProposals: Proposal[],
  ): number {
    return calculateProposalScore(proposal, votes, totalAgents, totalErrors, allProposals);
  }

  divideTasks(discussionId: string, tasks: Omit<Task, "id" | "status">[]): TaskDivisionResult {
    const discussion = this.discussions.get(discussionId);
    if (!discussion) {
      return { success: false, error: `Discussion ${discussionId} not found.` };
    }

    const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
    const sortedTasks = [...tasks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    const agentWorkload: Record<string, { count: number; totalTime: number }> = {};
    for (const agent of discussion.participants) {
      agentWorkload[agent] = { count: 0, totalTime: 0 };
    }

    const assignedTasks: Task[] = [];

    for (const taskInput of sortedTasks) {
      const taskId = `T-${String(assignedTasks.length + 1).padStart(3, "0")}`;

      const bestAgent = findBestAgent(taskInput, discussion.participants, agentWorkload);

      if (!bestAgent) {
        const leastLoaded = getLeastLoadedAgent(discussion.participants, agentWorkload);
        if (leastLoaded) {
          const task: Task = {
            id: taskId,
            ...taskInput,
            assignedTo: leastLoaded,
            status: "pending",
          };
          assignedTasks.push(task);
          agentWorkload[leastLoaded]!.count++;
          agentWorkload[leastLoaded]!.totalTime += taskInput.estimatedTime;
        }
      } else {
        const task: Task = {
          id: taskId,
          ...taskInput,
          assignedTo: bestAgent,
          status: "pending",
        };
        assignedTasks.push(task);
        agentWorkload[bestAgent]!.count++;
        agentWorkload[bestAgent]!.totalTime += taskInput.estimatedTime;
      }
    }

    const assignments: Record<string, Task[]> = {};
    for (const task of assignedTasks) {
      if (!assignments[task.assignedTo]) {
        assignments[task.assignedTo] = [];
      }
      assignments[task.assignedTo]!.push(task);
    }

    if (discussion.result) {
      discussion.result.tasks = assignedTasks;
    }
    this.clearVoteDeadline(discussionId);
    discussion.phase = "completed";
    this.eventHub.emit({ type: "DISCUSSION_RESOLVED", discussionId, resolution: discussion.result!.id });
    discussion.updatedAt = new Date().toISOString();

    const handoffIds: string[] = [];
    if (this.createHandoffCallback) {
      for (const agent of Object.keys(assignments)) {
        const normalizedAgent = normalizeName(agent);
        if (normalizedAgent === "tawa") {
          return {
            success: false,
            error: "🚫 Blocked: cannot assign a task to @tawa via divide. Use @tawa as dispatcher only.",
          };
        }
        const agentTasks = assignments[agent]!;
        const taskDescriptions = agentTasks.map((t) => `- ${t.id}: ${t.description} [${t.priority}]`).join("\n");
        const handoffContext = `Tasks from discussion ${discussionId}:\n${taskDescriptions}`;
        const hId = this.createHandoffCallback({
          from: "discussion",
          to: agent,
          task:
            agentTasks.length === 1
              ? agentTasks[0]!.description
              : `${agentTasks.length} tasks from discussion ${discussionId}`,
          context: handoffContext,
          files: [...new Set(discussion.errors.map((e) => e.file))],
          sourceDiscussionId: discussionId,
        });
        handoffIds.push(hId);
      }
    }

    this.triggerSave();
    return {
      success: true,
      tasks: assignedTasks,
      assignments,
      handoffIds: handoffIds.length > 0 ? handoffIds : undefined,
    };
  }

  resolveQuorum(
    discussion: Discussion,
    requiredQuorum: number,
  ): {
    decision: ADRRecord | null;
    winningProposal: { proposal: Proposal; score: number } | null;
    quorumReached: boolean;
  } {
    const outputs: CouncillorOutput[] = discussion.votes.map((v) => {
      const proposal = discussion.proposals.find((p) => p.id === v.proposalId);
      return {
        agent: v.agentId,
        content: proposal?.solution ?? v.proposalId,
        weight: v.weight,
        confidence: proposal?.justification ? 0.8 : undefined,
      };
    });

    let quorumReached: boolean;
    let weightedVotes: Map<string, number> = new Map();
    try {
      const result = councillorVote(outputs, requiredQuorum);
      weightedVotes = result.weightedVotes;
      quorumReached = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      quorumReached = !/Quorum not met/.test(msg);
    }

    let winnerContent: string | null = null;
    let score = 0;
    for (const [content, w] of weightedVotes) {
      if (w > score) {
        winnerContent = content;
        score = w;
      }
    }

    const winningProposal = winnerContent
      ? (() => {
          const p = discussion.proposals.find((pp) => pp.solution === winnerContent) ?? null;
          return p ? { proposal: p, score } : null;
        })()
      : null;

    const adr: ADRRecord | null = quorumReached
      ? {
          id: `ADR-${discussion.id}`,
          title: `Decision for ${discussion.errors[0]?.message ?? discussion.id}`,
          context: discussion.errors.map((e) => e.message).join("; "),
          decision: winnerContent ?? "",
          alternatives: discussion.proposals.map((p) => p.solution),
          votedAt: new Date().toISOString(),
          quorumReached: true,
          provenance: "agent_inferred",
        }
      : null;

    if (this.emitWithChain) {
      this.emitWithChain("QUORUM_RESOLVED", {
        chainId: discussion.id,
        discussionId: discussion.id,
        winner: winnerContent ?? "",
        quorumReached,
        adrId: adr?.id ?? "",
      });
    } else {
      this.eventHub.emit({
        type: "QUORUM_RESOLVED",
        chainId: discussion.id,
        discussionId: discussion.id,
        winner: winnerContent ?? "",
        quorumReached,
        adrId: adr?.id ?? "",
      });
    }

    return { decision: adr, winningProposal, quorumReached };
  }

  getDiscussion(id: string): Discussion | undefined {
    return this.discussions.get(id);
  }

  getAllDiscussions(): Discussion[] {
    return Array.from(this.discussions.values());
  }

  getSummary(discussionId: string): string {
    const d = this.discussions.get(discussionId);
    if (!d) return `Discussion ${discussionId} not found.`;

    const lines = [
      `## 💬 Discussion Summary — ${d.id}`,
      ``,
      `**Phase:** ${d.phase}`,
      `**Created:** ${d.createdAt}`,
      `**Participants:** ${d.participants.join(", ")}`,
      ``,
      `### Errors (${d.errors.length})`,
      ...d.errors.map(
        (e) =>
          `- ${e.severity === "critical" ? "🔴" : e.severity === "moderate" ? "🟡" : "🟢"} **${e.id}** \`${e.file}:${e.line}\` — ${e.message}`,
      ),
      ``,
      `### Proposals (${d.proposals.length})`,
      ...d.proposals.map((p) => {
        const votes = d.votes.filter((v) => v.proposalId === p.id);
        const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
        return `- **${p.id}** by ${p.agentId}: ${p.solution} (votes: ${votes.length}, weight: ${totalWeight.toFixed(2)})`;
      }),
      ``,
      `### Votes (${d.votes.length})`,
      ...d.votes.map(
        (v) => `- ${v.agentId} → ${v.proposalId} (weight: ${v.weight})${v.reason ? ` — ${v.reason}` : ""}`,
      ),
    ];

    if (d.result) {
      lines.push(
        ``,
        `### 🏆 Result`,
        `- **Winning Proposal:** ${d.result.proposalId}`,
        `- **Score:** ${d.result.score.toFixed(4)}`,
        `- **Tasks:** ${d.result.tasks.length}`,
        ...d.result.tasks.map((t) => `  - ${t.id}: ${t.description} → ${t.assignedTo} [${t.priority}]`),
      );
    }

    return lines.join("\n");
  }

  public getEvidenceManager(): EvidenceManager | undefined {
    return this.evidenceManager;
  }

  public setEvidenceManager(em: EvidenceManager): void {
    this.evidenceManager = em;
  }

  public getFullState(): { discussions: Discussion[]; evidencedDiscussions: EvidencedDiscussion[] } {
    return {
      discussions: this.getDiscussionsForSave(),
      evidencedDiscussions: this.evidenceManager?.getAllState() ?? [],
    };
  }
}
