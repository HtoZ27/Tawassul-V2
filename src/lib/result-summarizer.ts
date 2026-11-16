export interface AgentResult {
  agent: string;
  role: string;
  status: "success" | "failure" | "partial";
  output: string;
  filesChanged?: string[];
  warnings?: string[];
}

export interface Summary {
  achievements: string[];
  filesChanged: string[];
  warnings: string[];
  nextSteps: string[];
}

function extractKeyPoints(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return lines.slice(0, 5).map((l) => l.trim());
}

export function summarizeResults(results: AgentResult[]): Summary {
  const summary: Summary = {
    achievements: [],
    filesChanged: [],
    warnings: [],
    nextSteps: [],
  };

  for (const result of results) {
    if (result.status === "success") {
      summary.achievements.push(`${result.role} completed successfully`);
    } else if (result.status === "partial") {
      summary.warnings.push(`${result.role} completed partially`);
    } else {
      summary.warnings.push(`${result.role} failed`);
    }

    if (result.filesChanged && result.filesChanged.length > 0) {
      summary.filesChanged.push(...result.filesChanged);
    }

    if (result.warnings && result.warnings.length > 0) {
      summary.warnings.push(...result.warnings);
    }

    const points = extractKeyPoints(result.output);
    if (points.length > 0) {
      summary.achievements.push(...points);
    }
  }

  if (summary.filesChanged.length > 0) {
    const unique = [...new Set(summary.filesChanged)];
    summary.filesChanged = unique;
  }

  return summary;
}

export function formatSummaryForUser(summary: Summary): string {
  const lines: string[] = [];

  if (summary.achievements.length > 0) {
    lines.push("✅ **Completed:**");
    const seen = new Set<string>();
    for (const a of summary.achievements) {
      if (!seen.has(a)) {
        seen.add(a);
        lines.push(`  • ${a}`);
      }
    }
  }

  if (summary.filesChanged.length > 0) {
    lines.push("\n📂 **Files changed:**");
    for (const f of summary.filesChanged) {
      lines.push(`  • \`${f}\``);
    }
  }

  if (summary.warnings.length > 0) {
    lines.push("\n⚠️ **Notes:**");
    const seen = new Set<string>();
    for (const w of summary.warnings) {
      if (!seen.has(w)) {
        seen.add(w);
        lines.push(`  • ${w}`);
      }
    }
  }

  if (summary.nextSteps.length > 0) {
    lines.push("\n📋 **Next steps:**");
    for (const n of summary.nextSteps) {
      lines.push(`  • ${n}`);
    }
  }

  return lines.join("\n");
}