import type { FetchResult } from "./model-utils.ts";

export function buildModelsInjectionText(result: FetchResult): string {
  const lines: string[] = [];
  lines.push("Available models:");
  if (result.available.length > 0) {
    lines.push("");
    lines.push("Ready to use:");
    for (const m of result.available) {
      lines.push(`  - ${m.id} (${m.name}) [${m.source}]`);
    }
  }
  if (result.needsSetup.length > 0) {
    lines.push("");
    lines.push("Needs setup:");
    for (const m of result.needsSetup) {
      lines.push(`  - ${m.id} (${m.name}) — ${m.provider}`);
    }
  }
  if (result.failed.length > 0) {
    lines.push("");
    lines.push("Failed:");
    for (const m of result.failed) {
      const err = m.error ? ` — ${m.error}` : "";
      lines.push(`  - ${m.id}${err}`);
    }
  }
  return lines.join("\n");
}
