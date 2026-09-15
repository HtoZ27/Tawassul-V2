import type { ContextPriority, PriorityResult } from "../context/priority-types.ts";
import { priorityWeight } from "../context/priority-types.ts";
import { resolveRole } from "../utils/agent.ts";
import { estimateTokensByFactor, PRIORITY_TOKEN_FACTOR } from "./token-estimation.ts";

const TOOL_PRIORITY_MAP: Record<string, ContextPriority> = {
  handoff: "critical",
  record: "high",
  pipeline: "critical",
  "quality-report": "high",
  task: "normal",
  bash: "high",
  edit: "high",
  write: "high",
  read: "normal",
  grep: "normal",
  glob: "low",
  webfetch: "low",
  websearch: "low",
  ls: "low",
};

const AGENT_ROLE_PRIORITY: Record<string, ContextPriority> = {
  tawa: "critical",
  architect: "high",
  analyst: "high",
  reviewer: "high",
  tester: "normal",
  dev: "normal",
  doc: "low",
  designer: "normal",
  addagent: "low",
};

const CRITICAL_KEYWORDS = [
  /security|vulnerability|exploit/i,
  /urgent|immediate|critical/i,
  /crash|data.?loss/i,
  /regression/i,
];

const HIGH_KEYWORDS = [
  /breaking.?change/i,
  /deploy|release/i,
  /migrate/i,
  /refactor/i,
];

const LOW_KEYWORDS = [
  /typo|rename/i,
  /comment/i,
  /format|prettier|eslint/i,
  /readme/i,
];

export function classifyMessagePriority(text: string, tool?: string, agent?: string): PriorityResult {
  const factors: string[] = [];
  const lower = text.toLowerCase();

  let contentPriority: ContextPriority;
  if (CRITICAL_KEYWORDS.some((k) => k.test(lower))) {
    contentPriority = "critical";
    factors.push("content:critical_pattern");
  } else if (HIGH_KEYWORDS.some((k) => k.test(lower))) {
    contentPriority = "high";
    factors.push("content:high_pattern");
  } else if (LOW_KEYWORDS.some((k) => k.test(lower))) {
    contentPriority = "low";
    factors.push("content:low_pattern");
  } else {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const charCount = text.length;
    if (wordCount > 100 || charCount > 150) {
      contentPriority = "high";
      factors.push("content:long_message");
    } else if (wordCount < 5 && charCount < 50) {
      contentPriority = "low";
      factors.push("content:short_message");
    } else {
      contentPriority = "normal";
      factors.push("content:medium_message");
    }
  }

  const toolPriority = tool ? TOOL_PRIORITY_MAP[tool] : undefined;
  if (toolPriority) factors.push(`tool:${tool}=${priorityWeight(toolPriority) / 100}`);

  const agentRole = agent ? (resolveRole(agent) ?? agent) : undefined;
  const agentPriority = agentRole ? AGENT_ROLE_PRIORITY[agentRole] : undefined;
  if (agentPriority) factors.push(`agent:${agentRole}=${priorityWeight(agentPriority) / 100}`);

  const candidates: ContextPriority[] = [contentPriority];
  if (toolPriority) candidates.push(toolPriority);
  if (agentPriority) candidates.push(agentPriority);

  let maxPriority: ContextPriority = "normal";
  let maxRank = 0;
  for (const c of candidates) {
    const r = priorityWeight(c) / 100;
    if (r > maxRank) {
      maxRank = r;
      maxPriority = c;
    }
  }

  const score = maxRank;
  const source = tool ? (agent ? "hybrid" : "tool") : "message";

  return { priority: maxPriority, score, factors, source };
}

export function estimateTokens(text: string): number {
  return estimateTokensByFactor(text.length, PRIORITY_TOKEN_FACTOR);
}