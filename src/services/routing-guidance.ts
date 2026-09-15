export function suggestAgentCombination(role: string | null, size: "small" | "medium" | "complex" | null): string {
  if (size === "small") {
    return "Single agent. Use task() for the specified role.";
  }
  if (size === "medium") {
    return (
      "Two agents. Suggested sequence: " +
      (role === "dev"
        ? "dev <- tester"
        : role === "analyst"
          ? "analyst <- architect"
          : role === "architect"
            ? "architect <- dev"
            : role === "tester"
              ? "tester (then escalate based on result)"
              : role === "reviewer"
                ? "reviewer <- dev"
                : role === "doc"
                  ? "doc <- reviewer"
                  : "dev <- tester")
    );
  }
  if (size === "complex") {
    return (
      "3-4 agents. Distribute tasks: " +
      (role === "analyst"
        ? "analyst (analyze) <- architect (plan) <- dev (implement) <- tester (test) <- doc (document)"
        : role === "architect"
          ? "analyst (analyze requirements) <- architect (design) <- dev (build) <- tester (test)"
          : role === "dev"
            ? "analyst (analyze) <- architect (plan) <- dev (implement) <- tester (test)"
            : role === "reviewer"
              ? "analyst (analyze) <- reviewer (review) <- dev (fix) <- tester (test)"
              : role === "tester"
                ? "analyst <- architect <- dev <- tester"
                : role === "doc"
                  ? "analyst <- architect <- dev <- doc"
                  : "analyst <- architect <- dev <- tester <- reviewer <- doc")
    );
  }
  return "Use the logical sequence: analyst -> architect -> dev -> tester -> reviewer -> doc";
}

export function buildGuidance(
  role: string | null,
  size: "small" | "medium" | "complex" | null,
  directAgent: string | null,
  warnings: string[],
): string {
  const lines: string[] = [];

  if (role) {
    const roleLabel: Record<string, string> = {
      dev: "Developer",
      tester: "Tester",
      reviewer: "Reviewer",
      architect: "Architect",
      analyst: "Analyst",
      doc: "Documentation Writer",
    };
    lines.push(`**Required Role:** ${roleLabel[role] || role}`);
  }

  if (size) {
    const sizeLabel: Record<string, string> = {
      small: "Simple — single agent",
      medium: "Medium — two agents",
      complex: "Complex — 3-4 agents",
    };
    lines.push(`**Problem Size:** ${sizeLabel[size]}`);
    lines.push(`**Suggested Distribution:** ${suggestAgentCombination(role, size)}`);
  }

  if (directAgent) {
    lines.push(`**Direct Routing:** @${directAgent}`);
    if (directAgent !== "tawa") {
      lines.push(`> Detected @${directAgent} — direct routing, no need for tawa.`);
    }
  } else {
    lines.push("> Routing on demand — no task will be distributed automatically without an explicit command.");
  }

  if (warnings.length > 0) {
    lines.push("");
    lines.push("**Security Warnings:**");
    lines.push(...warnings);
  }

  return lines.join("\n");
}
