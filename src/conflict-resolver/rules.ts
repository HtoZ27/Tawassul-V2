import type { RuleInput, RuleDecision, ClassifierInput, ClassifierOutput } from "./types.ts";
import type { CapabilityTracker } from "../features/capability-tracker.ts";
import { classify, type ClassifierParams } from "./classifier.ts";
import { normalizeName } from "../utils/name-utils.ts";
import { t } from "../translations.ts";

export type Rule = {
  id: string;
  name: string;
  description: string;
  priority: number;
  condition: (input: RuleInput) => boolean;
  action: (input: RuleInput) => RuleDecision;
  enabled: boolean;
};




const CAPABILITY_TO_AGENTS: Record<string, string[]> = {
  strategic: ["analyst"],
  design: ["architect", "designer"],
  implementation: ["dev"],
  review: ["reviewer"],
  testing: ["tester"],
  routing: ["tawa"],
  "ux-design": ["designer"],
};


function findAlternativeAgent(input: RuleInput): string {
  const team = Object.keys(input.allAgentCapabilities || {});
  const fallback = team.find((a) => a !== input.to) ?? "dev";
  const to = normalizeName(input.to);
  if (to === "dev") return team.find((a) => normalizeName(a) !== "dev") ?? "reviewer";
  if (to === "reviewer") return team.find((a) => normalizeName(a) !== "reviewer") ?? "dev";
  if (to === "analyst") return team.find((a) => normalizeName(a) !== "analyst") ?? "dev";
  return fallback;
}


function findBestAgentForFiles(input: RuleInput): string {
  
  
  const allCaps = input.allAgentCapabilities || {};

  
  const candidates = Object.entries(allCaps)
    .filter(([agent]) => agent !== input.to)
    .map(([agent, cap]) => ({ agent, cap }));

  if (candidates.length > 0) {
    
    const sameCap = candidates.filter((c) => c.cap === input.dstCap);
    if (sameCap.length > 0) return sameCap[0]!.agent;
    return candidates[0]!.agent;
  }

  return findAlternativeAgent(input);
}


function findBestAgentForCapability(input: RuleInput, tracker?: CapabilityTracker): string {
  const srcCap = input.srcCap;
  const dstCap = input.dstCap;
  const allCaps = input.allAgentCapabilities || {};

  
  if (tracker && srcCap) {
    const tracked = tracker.getBestAgentForCapability(srcCap, [input.to]);
    if (tracked) return tracked;
  }

  
  if (srcCap && allCaps) {
    const candidates = Object.entries(allCaps)
      .filter(([agent, cap]) => cap === srcCap && agent !== input.to)
      .map(([agent]) => agent);

    if (candidates.length > 0) {
      return candidates[0]!;
    }

    const mappedAgents = CAPABILITY_TO_AGENTS[srcCap];
    if (mappedAgents && mappedAgents.length > 0) {
      const filtered = mappedAgents.filter((a) => a !== input.to);
      if (filtered.length > 0) {
        return filtered[0]!;
      }
    }
  }

  
  if (tracker && dstCap) {
    const tracked = tracker.getBestAgentForCapability(dstCap, [input.to]);
    if (tracked) return tracked;
  }

  if (dstCap && allCaps) {
    const candidates = Object.entries(allCaps)
      .filter(([agent, cap]) => cap === dstCap && agent !== input.to)
      .map(([agent]) => agent);

    if (candidates.length > 0) {
      return candidates[0]!;
    }

    const mappedAgents = CAPABILITY_TO_AGENTS[dstCap];
    if (mappedAgents && mappedAgents.length > 0) {
      const filtered = mappedAgents.filter((a) => a !== input.to);
      if (filtered.length > 0) {
        return filtered[0]!;
      }
    }
  }

  
  return findAlternativeAgent(input);
}

function findBestAgentForComplexity(input: RuleInput): string {
  
  
  const allCaps = input.allAgentCapabilities || {};

  
  const devCandidates = Object.entries(allCaps)
    .filter(([agent, cap]) => cap === "implementation" && agent !== input.to)
    .map(([agent]) => agent);

  if (devCandidates.length > 0) {
    return devCandidates[0]!;
  }

  return findAlternativeAgent(input);
}

export const CORE_RULES: Rule[] = [
  {
    id: "PRIORITY-000",
    get name() {
      return t("crNameP000");
    },
    get description() {
      return t("crDescP000");
    },
    priority: 0,
    condition: (input) => input.taskPriority === "P0",
    action: (_input) => ({
      action: "allow",
      reason: t("crReasonP000"),
      confidence: 1.0,
      metadata: { priority: "P0", urgent: true },
    }),
    enabled: true,
  },
  {
    id: "PROTECT-001",
    get name() {
      return t("crNameProt001");
    },
    get description() {
      return t("crDescProt001");
    },
    priority: 1,
    condition: (input) => input.agentBusy && input.activeHandoffs > 0,
    action: (input) => ({
      action: "block",
      reason: t("crReasonProt001", { agent: input.to, task: input.busyTask ?? "", id: input.busyHandoffId ?? "" }),
      confidence: 0.95,
    }),
    enabled: true,
  },
  {
    id: "PROTECT-002",
    get name() {
      return t("crNameProt002");
    },
    get description() {
      return t("crDescProt002");
    },
    priority: 2,
    condition: (input) => input.fileConflict,
    action: (input) => ({
      action: "reroute",
      reason: t("crReasonProt002", { files: input.conflictFiles?.join(", ") ?? "", agent: input.conflictAgent ?? "" }),
      confidence: 0.9,
      suggestedAgent: findBestAgentForFiles(input),
    }),
    enabled: true,
  },
  {
    id: "PROTECT-003",
    get name() {
      return t("crNameProt003");
    },
    get description() {
      return t("crDescProt003");
    },
    priority: 3,
    condition: (input) => input.errorCount >= 3,
    action: (input) => ({
      action: "reroute",
      reason: t("crReasonProt003", { agent: input.to, count: String(input.errorCount) }),
      confidence: 0.85,
      suggestedAgent: findAlternativeAgent(input),
    }),
    enabled: true,
  },
  {
    id: "PRIORITY-001",
    get name() {
      return t("crNameP001");
    },
    get description() {
      return t("crDescP001");
    },
    priority: 4,
    condition: (input) => input.taskPriority === "P1",
    action: (_input) => ({
      action: "allow",
      reason: t("crReasonP001"),
      confidence: 0.9,
      metadata: { priority: "P1", urgent: true },
    }),
    enabled: true,
  },
  {
    id: "PRIORITY-002",
    get name() {
      return t("crNameP002");
    },
    get description() {
      return t("crDescP002");
    },
    priority: 5,
    condition: (input) => input.agentPriority <= 2,
    action: (input) => ({
      action: "allow",
      reason: t("crReasonP002", { agent: input.to, priority: String(input.agentPriority) }),
      confidence: 0.8,
    }),
    enabled: true,
  },
  {
    id: "QUALITY-001",
    get name() {
      return t("crNameQ001");
    },
    get description() {
      return t("crDescQ001");
    },
    priority: 6,
    condition: (input) => typeof input.context === "string" && input.context.split(/\s+/).length < 10,
    action: (input) => ({
      action: "warn",
      reason: t("crReasonQ001", {
        count: String(typeof input.context === "string" ? input.context.split(/\s+/).length : 0),
      }),
      confidence: 0.7,
    }),
    enabled: true,
  },
  {
    id: "ROUTE-001",
    get name() {
      return t("crNameRoute001");
    },
    get description() {
      return t("crDescRoute001");
    },
    priority: 7,
    condition: (input) => !input.capabilityMatch,
    action: (input) => ({
      action: "reroute",
      reason: t("crReasonRoute001", { agent: input.to, cap: input.srcCap || t("crUnknownCap") }),
      confidence: 0.75,
      suggestedAgent: findBestAgentForCapability(input),
    }),
    enabled: true,
  },
  {
    id: "ROUTE-002",
    get name() {
      return t("crNameRoute002");
    },
    get description() {
      return t("crDescRoute002");
    },
    priority: 8,
    condition: (input) => input.taskComplexity === "complex" && input.agentRating < 70,
    action: (input) => ({
      action: "reroute",
      reason: t("crReasonRoute002", { agent: input.to, rating: String(input.agentRating) }),
      confidence: 0.7,
      suggestedAgent: findBestAgentForComplexity(input),
    }),
    enabled: true,
  },
  {
    id: "QUEUE-001",
    get name() {
      return t("crNameQueue001");
    },
    get description() {
      return t("crDescQueue001");
    },
    priority: 9,
    condition: (input) => input.activeHandoffs > 3,
    action: (input) => ({
      action: "queue",
      reason: t("crReasonQueue001", { agent: input.to, count: String(input.activeHandoffs) }),
      confidence: 0.8,
      metadata: { queuePosition: input.activeHandoffs + 1 },
    }),
    enabled: true,
  },
  {
    id: "DEFAULT-001",
    get name() {
      return t("crNameDefault001");
    },
    get description() {
      return t("crDescDefault001");
    },
    priority: 99,
    condition: () => true,
    action: () => ({
      action: "allow",
      reason: t("crReasonDefault001"),
      confidence: 0.6,
    }),
    enabled: true,
  },
];



const SORTED_RULES_CACHE: Rule[] = CORE_RULES.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);

function toClassifierInput(input: RuleInput): ClassifierInput {
  return {
    agentBusy: input.agentBusy,
    fileConflict: input.fileConflict,
    capabilityMatch: input.capabilityMatch,
    agentPriority: input.agentPriority,
    activeHandoffs: input.activeHandoffs,
    errorCount: input.errorCount,
    taskComplexity: input.taskComplexity,
  };
}

export function evaluateRules(
  input: RuleInput,
  capabilityTracker?: CapabilityTracker,
  classifierParams?: Partial<ClassifierParams>,
): RuleDecision {
  
  
  const classifierOutput = classify(toClassifierInput(input), classifierParams);

  for (const rule of SORTED_RULES_CACHE) {
    if (rule.condition(input)) {
      let decision: RuleDecision;
      if (rule.id === "ROUTE-001") {
        
        decision = { ...rule.action(input), suggestedAgent: findBestAgentForCapability(input, capabilityTracker) };
      } else {
        decision = rule.action(input);
      }
      
      
      decision = { ...decision, metadata: { ...decision.metadata, ruleId: rule.id } };
      
      const merge = mergeClassifierRecommendation(decision, classifierOutput);
      if (merge) return merge;
      
      return {
        ...decision,
        metadata: { ...decision.metadata, classifier: classifierOutput },
      };
    }
  }

  
  
  if (classifierOutput.action !== "allow" && classifierOutput.confidence >= 0.8) {
    return {
      action: classifierOutput.action,
      reason: t("crClassifierRecommend", {
        action: classifierOutput.action,
        pct: String(Math.round(classifierOutput.confidence * 100)),
      }),
      confidence: classifierOutput.confidence,
      metadata: { classifier: classifierOutput, ruleId: "DEFAULT-001" },
    };
  }

  return {
    action: "allow",
    reason: t("crReasonDefault001"),
    confidence: 0.5,
    metadata: { classifier: classifierOutput, ruleId: "DEFAULT-001" },
  };
}


function mergeClassifierRecommendation(
  decision: RuleDecision,
  classifierOutput: ClassifierOutput,
): RuleDecision | null {
  if (decision.action === "block" || decision.action === "reroute") return null; 
  if (classifierOutput.action === "allow" || classifierOutput.action === "warn") return null;
  if (classifierOutput.confidence < 0.8) return null;
  
  
  if (decision.confidence >= classifierOutput.confidence) return null;

  return {
    action: classifierOutput.action,
    reason: t("crClassifierConfirm", {
      reason: decision.reason,
      action: classifierOutput.action,
      pct: String(Math.round(classifierOutput.confidence * 100)),
    }),
    confidence: classifierOutput.confidence,
    suggestedAgent: decision.suggestedAgent,
    suggestedPriority: decision.suggestedPriority,
    metadata: { ...decision.metadata, classifier: classifierOutput },
  };
}
