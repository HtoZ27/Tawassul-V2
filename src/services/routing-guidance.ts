import { t } from "../translations.ts";

const ROLE_KEY: Record<string, string> = {
  dev: "guide.roleDev",
  tester: "guide.roleTester",
  reviewer: "guide.roleReviewer",
  architect: "guide.roleArchitect",
  analyst: "guide.roleAnalyst",
  doc: "guide.roleDoc",
};

const SIZE_KEY: Record<string, string> = {
  small: "guide.sizeSmall",
  medium: "guide.sizeMedium",
  complex: "guide.sizeComplex",
};

const MEDIUM_PLAN: Record<string, string> = {
  dev: "guide.planMediumDev",
  analyst: "guide.planMediumAnalyst",
  architect: "guide.planMediumArchitect",
  tester: "guide.planMediumTester",
  reviewer: "guide.planMediumReviewer",
  doc: "guide.planMediumDoc",
};

const COMPLEX_PLAN: Record<string, string> = {
  analyst: "guide.planComplexAnalyst",
  architect: "guide.planComplexArchitect",
  dev: "guide.planComplexDev",
  reviewer: "guide.planComplexReviewer",
  tester: "guide.planComplexTester",
  doc: "guide.planComplexDoc",
};

export function suggestAgentCombination(role: string | null, size: "small" | "medium" | "complex" | null): string {
  if (size === "small") {
    return t("guide.smallPlan");
  }
  if (size === "medium") {
    const plan = MEDIUM_PLAN[role ?? ""] ?? "guide.planMediumDev";
    return t("guide.medium", { plan: t(plan) });
  }
  if (size === "complex") {
    const plan = COMPLEX_PLAN[role ?? ""] ?? "guide.planComplexDefault";
    return t("guide.complex", { plan: t(plan) });
  }
  return t("guide.planFallback");
}

export function buildGuidance(
  role: string | null,
  size: "small" | "medium" | "complex" | null,
  directAgent: string | null,
  warnings: string[],
): string {
  const lines: string[] = [];

  if (role) {
    const key = ROLE_KEY[role];
    lines.push(t("guide.requiredRole", { role: key ? t(key) : role }));
  }

  if (size) {
    lines.push(t("guide.problemSize", { size: t(SIZE_KEY[size] ?? "guide.sizeSmall") }));
    lines.push(t("guide.suggested", { plan: suggestAgentCombination(role, size) }));
  }

  if (directAgent) {
    lines.push(t("guide.directRouting", { agent: directAgent }));
    if (directAgent === "addagent") {
      lines.push(t("guide.directAddagent"));
    } else if (directAgent !== "tawa") {
      lines.push(t("guide.directNote", { agent: directAgent }));
    }
  } else {
    lines.push(t("guide.onDemand"));
  }

  if (warnings.length > 0) {
    lines.push("");
    lines.push(t("guide.securityWarnings"));
    lines.push(...warnings);
  }

  return lines.join("\n");
}
