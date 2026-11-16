
import type { ReflectionFact } from "./chain-ctx.ts";


export function extractFacts(report: {
  taskId: string;
  subtasks: { assignedAgent: string; success: boolean }[];
  status: "success" | "partial" | "failed";
}): ReflectionFact[] {
  const facts: ReflectionFact[] = [];
  const worked = report.subtasks.filter((s) => s.success);
  const failed = report.subtasks.filter((s) => !s.success);

  if (worked.length > 0) {
    facts.push({
      kind: "worked",
      claim: `subtask completed under ${worked.map((s) => s.assignedAgent).join(", ")}`,
    });
  } else {
    facts.push({ kind: "worked", claim: "execution reached completion" });
  }

  if (failed.length > 0) {
    facts.push({
      kind: "failed",
      claim: `subtask failed under ${failed.map((s) => s.assignedAgent).join(", ")}`,
    });
  } else {
    facts.push({ kind: "failed", claim: "no subtask failures recorded" });
  }

  const summary = `task ${report.status} across ${report.subtasks.length} subtask(s)`;
  const learnedTip =
    report.status === "success"
      ? `${summary} — full success, reuse agent mix`
      : report.status === "partial"
        ? `${summary} — partial, retry failed subtasks separately`
        : `${summary} — all failed, reassess plan`;
  facts.push({ kind: "learned", claim: learnedTip });

  return facts;
}


export function factToLearning(fact: ReflectionFact): {
  agent: string;
  content: string;
  tags: string[];
  importance: "low" | "medium" | "high";
  classification: "public" | "private" | "shared";
} {
  const kindTag = { worked: "worked", failed: "failed", learned: "learned" }[fact.kind];
  return {
    agent: "@tawa",
    content: `reflect:${fact.kind} — ${fact.claim}`,
    tags: ["reflection", kindTag],
    importance: fact.kind === "learned" ? "medium" : "low",
    classification: "public",
  };
}
