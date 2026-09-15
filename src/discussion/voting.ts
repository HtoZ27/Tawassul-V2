import type { Proposal, Vote, Risk, Task } from "./discussion.ts";
import {
  SCORING_WEIGHTS,
  PRIORITY_WEIGHTS,
  RISK_WEIGHTS,
  MAX_TASKS_PER_AGENT,
  AGENT_TASK_ROLES,
} from "./discussion.ts";
import { normalizeName } from "../utils/name-utils.ts";

export function calculateProposalCoverage(allProposals: Proposal[], totalErrors: number): number {
  const coveredErrors = new Set(allProposals.map((p) => p.errorId));
  return totalErrors > 0 ? coveredErrors.size / totalErrors : 0;
}

export function calculateProposalScore(
  proposal: Proposal,
  votes: Vote[],
  totalAgents: number,
  totalErrors: number,
  allProposals: Proposal[],
  coverage = calculateProposalCoverage(allProposals, totalErrors),
): number {
  const proposalVotes = votes.filter((v) => v.proposalId === proposal.id);
  const totalWeight = proposalVotes.reduce((sum, v) => sum + v.weight, 0);
  const consensus = totalAgents > 0 ? Math.min(totalWeight / totalAgents, 1) : 0;
  const riskScore = RISK_WEIGHTS[proposal.risk];
  const priorityScore = PRIORITY_WEIGHTS[proposal.priority];

  return (
    consensus * SCORING_WEIGHTS.voteConsensus +
    riskScore * SCORING_WEIGHTS.riskLow +
    priorityScore * SCORING_WEIGHTS.priorityBoost +
    coverage * SCORING_WEIGHTS.solutionCoverage
  );
}

export function findBestProposal(
  proposals: Proposal[],
  votes: Vote[],
  totalAgents: number,
  totalErrors: number,
): { proposal: Proposal; score: number } | null {
  if (proposals.length === 0) return null;

  const coverage = calculateProposalCoverage(proposals, totalErrors);
  let bestScore = -1;
  let bestProposal: Proposal | null = null;

  for (const proposal of proposals) {
    const score = calculateProposalScore(proposal, votes, totalAgents, totalErrors, proposals, coverage);
    if (score > bestScore) {
      bestScore = score;
      bestProposal = proposal;
    }
  }

  return bestProposal ? { proposal: bestProposal, score: bestScore } : null;
}

export function calculateRiskScore(tasks: unknown[]): number {
  if (tasks.length === 0) return 0;

  const totalRisk = (tasks as Array<{ risk?: Risk }>).reduce((sum, t) => {
    const risk = t.risk;
    return sum + (risk ? (RISK_WEIGHTS[risk] ?? 0.5) : 0.5);
  }, 0);
  return totalRisk / tasks.length;
}

export function findBestAgent(
  task: Omit<Task, "id" | "status">,
  participants: string[],
  workload: Record<string, { count: number; totalTime: number }>,
): string | null {
  
  const roleIndex = new Map<string, string[]>();
  for (const agent of participants) {
    const agentRoles = AGENT_TASK_ROLES[normalizeName(agent)] || [];
    for (const role of agentRoles) {
      const agents = roleIndex.get(role) ?? [];
      agents.push(agent);
      roleIndex.set(role, agents);
    }
  }

  const taskDescription = task.description.toLowerCase();
  const matchingAgents = new Set<string>();
  for (const [role, agents] of roleIndex) {
    if (taskDescription.includes(role) || taskDescription.includes(role.replace("-", " "))) {
      for (const agent of agents) {
        matchingAgents.add(agent);
      }
    }
  }

  
  const avgTime =
    participants.length > 0
      ? participants.reduce((sum, a) => sum + (workload[a]?.totalTime ?? 0), 0) / participants.length
      : 0;

  let bestAgent: string | null = null;
  let bestScore = -1;

  for (const agent of participants) {
    const agentLoad = workload[agent];
    if (!agentLoad) continue;
    if (agentLoad.count >= MAX_TASKS_PER_AGENT) continue;

    const roleScore = matchingAgents.has(agent) ? 1 : 0;
    const loadScore = 1 - agentLoad.count / MAX_TASKS_PER_AGENT;
    const timeScore = agentLoad.totalTime < avgTime ? 1 : 0.5;

    const totalScore = roleScore * 0.5 + loadScore * 0.3 + timeScore * 0.2;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestAgent = agent;
    }
  }

  return bestAgent;
}

export function getLeastLoadedAgent(
  participants: string[],
  workload: Record<string, { count: number; totalTime: number }>,
): string | null {
  let leastLoaded: string | null = null;
  let minCount = Infinity;

  for (const agent of participants) {
    const load = workload[agent];
    if (!load) continue;
    if (load.count < minCount) {
      minCount = load.count;
      leastLoaded = agent;
    }
  }

  return leastLoaded;
}
