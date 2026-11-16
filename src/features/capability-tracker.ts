import { betaMean, betaCIExact, ucbTerm } from "./beta-stats.ts";
import { normalizeName } from "../utils/name-utils.ts";

export type AgentCapability = {
  agent: string;
  capabilities: string[];
  
  successRates: Record<string, number>;
  
  attempts: Record<string, number>;
  successes: Record<string, number>;
  lastUpdated: string;
};

export class CapabilityTracker {
  private agents: Map<string, AgentCapability> = new Map();
  private static DEFAULT_ALPHA = 0.3;

  seedCapability(agent: string, capability: string): void {
    const agentKey = normalizeName(agent);
    const declared = capability.trim();
    if (!agentKey || declared === "") return;
    let cap = this.agents.get(agentKey);
    if (!cap) {
      cap = {
        agent: agentKey,
        capabilities: [],
        successRates: {},
        attempts: {},
        successes: {},
        lastUpdated: new Date().toISOString(),
      };
      this.agents.set(agentKey, cap);
    }
    if (!cap.capabilities.includes(declared)) {
      cap.capabilities.push(declared);
    }
  }

  updateCapability(
    agent: string,
    capability: string,
    success: boolean,
    alpha: number = CapabilityTracker.DEFAULT_ALPHA,
  ): void {
    const agentKey = normalizeName(agent);
    let cap = this.agents.get(agentKey);
    if (!cap) {
      cap = {
        agent: agentKey,
        capabilities: [],
        successRates: {},
        attempts: {},
        successes: {},
        lastUpdated: new Date().toISOString(),
      };
      this.agents.set(agentKey, cap);
    }

    if (!cap.capabilities.includes(capability)) {
      cap.capabilities.push(capability);
    }

    const key = capability;
    if (!(key in cap.successRates)) {
      cap.successRates[key] = 0.5;
    }

    cap.successRates[key]! = cap.successRates[key]! * (1 - alpha) + (success ? 1 : 0) * alpha;
    cap.attempts[key] = (cap.attempts[key] ?? 0) + 1;
    cap.successes[key] = (cap.successes[key] ?? 0) + (success ? 1 : 0);
    cap.lastUpdated = new Date().toISOString();
  }

  getCapabilities(agent: string): string[] {
    return this.agents.get(normalizeName(agent))?.capabilities || [];
  }

  revertCapabilityUpdate(
    agent: string,
    capability: string,
    success: boolean,
    alpha: number = CapabilityTracker.DEFAULT_ALPHA,
  ): void {
    const cap = this.agents.get(normalizeName(agent));
    if (!cap) return;
    const key = capability;
    if (!(key in cap.successRates) || !(key in cap.attempts)) return;
    if ((cap.attempts[key] ?? 0) <= 0) return;
    const rate = cap.successRates[key]!;
    const previous = success ? (rate - alpha) / (1 - alpha) : rate / (1 - alpha);
    cap.successRates[key] = Math.min(1, Math.max(0, previous));
    cap.attempts[key] = Math.max(0, cap.attempts[key]! - 1);
    cap.successes[key] = Math.max(0, cap.successes[key]! - (success ? 1 : 0));
    cap.lastUpdated = new Date().toISOString();
  }

  getSuccessRate(agent: string, capability: string): number {
    return this.agents.get(normalizeName(agent))?.successRates[capability] || 0.5;
  }

  
  getBestAgentForCapability(capability: string, excludeAgents: string[] = []): string | undefined {
    const normalizedExclude = excludeAgents.map(normalizeName);
    let bestAgent: string | undefined;
    let bestScore = -Infinity;

    
    let totalAttempts = 0;
    for (const cap of this.agents.values()) {
      if (!cap.capabilities.includes(capability)) continue;
      totalAttempts += cap.attempts[capability] ?? 0;
    }

    for (const [agent, cap] of this.agents.entries()) {
      if (normalizedExclude.includes(agent)) continue;
      if (!cap.capabilities.includes(capability)) continue;

      const attempts = cap.attempts[capability] ?? 0;
      const successes = cap.successes[capability] ?? 0;
      const mean = betaMean(successes + 1, attempts - successes + 1);
      const score = mean + ucbTerm(attempts, totalAttempts);

      if (score > bestScore || (score === bestScore && (!bestAgent || agent < bestAgent))) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent;
  }

  
  getAgentScore(agent: string): number {
    const cap = this.agents.get(normalizeName(agent));
    if (!cap) return 0.5;
    const rates = Object.values(cap.successRates);
    if (rates.length === 0) return 0.5;
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  }

  
  getAgentScoreWithCI(agent: string): { mean: number; lower: number; upper: number } {
    const cap = this.agents.get(normalizeName(agent));
    if (!cap) return { mean: 0.5, lower: 0.5, upper: 0.5 };

    let totalAttempts = 0;
    let totalSuccesses = 0;
    for (const key of Object.keys(cap.successRates)) {
      totalAttempts += cap.attempts[key] ?? 0;
      totalSuccesses += cap.successes[key] ?? 0;
    }

    if (totalAttempts === 0) return { mean: 0.5, lower: 0.5, upper: 0.5 };

    const alpha = totalSuccesses + 1;
    const beta = totalAttempts - totalSuccesses + 1;
    const mean = betaMean(alpha, beta);
    const ci = betaCIExact(alpha, beta, 0.95);
    return { mean, lower: ci.lower, upper: ci.upper };
  }

  getAll(): AgentCapability[] {
    return [...this.agents.values()];
  }

  toJSON(): AgentCapability[] {
    return this.getAll().map((entry) => ({
      agent: entry.agent,
      capabilities: [...entry.capabilities],
      successRates: { ...entry.successRates },
      attempts: { ...entry.attempts },
      successes: { ...entry.successes },
      lastUpdated: entry.lastUpdated,
    }));
  }

  restore(records: readonly AgentCapability[] | undefined): void {
    this.agents.clear();
    for (const record of records ?? []) {
      const agent = normalizeName(record.agent);
      if (!agent) continue;
      this.agents.set(agent, {
        agent,
        capabilities: [...new Set(record.capabilities ?? [])],
        successRates: { ...(record.successRates ?? {}) },
        attempts: { ...(record.attempts ?? {}) },
        successes: { ...(record.successes ?? {}) },
        lastUpdated: record.lastUpdated || new Date().toISOString(),
      });
    }
  }

  clear(): void {
    this.agents.clear();
  }
}

export function seedCapabilitiesFromRoster(
  tracker: CapabilityTracker,
  agents: Iterable<string>,
  readCapability: (agent: string) => string | undefined,
): number {
  let seeded = 0;
  const seen = new Set<string>();
  for (const tag of agents) {
    const agent = normalizeName(tag);
    if (!agent || agent === "tawa" || seen.has(agent)) continue;
    seen.add(agent);
    const capability = readCapability(agent);
    if (!capability || capability.trim() === "") continue;
    tracker.seedCapability(agent, capability);
    seeded++;
  }
  return seeded;
}
