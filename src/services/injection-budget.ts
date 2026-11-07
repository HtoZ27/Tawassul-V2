export const INJECTION_BUDGETS = {
  digest: 8_192,
  session_index: 16_384,
  decisions: 4_096,
  r1: 512,
} as const;

export type InjectionSource = keyof typeof INJECTION_BUDGETS;

export type FittedInjection = {
  source: InjectionSource;
  text: string;
  bytes: number;
  budget: number;
  truncated: boolean;
};

const POINTERS: Record<InjectionSource, string> = {
  digest: "goal(list: true) returns the full digest",
  session_index: "record(list: true) and the handoff list return the full index",
  decisions: "record(list: true) returns every record",
  r1: "the clause is fixed text",
};

function sliceToBytes(text: string, limit: number): string {
  let used = 0;
  let out = "";
  for (const char of text) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (used + bytes > limit) break;
    out += char;
    used += bytes;
  }
  return out;
}

export function fitInjection(text: string, source: InjectionSource, pointer?: string): FittedInjection {
  const budget = INJECTION_BUDGETS[source];
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= budget) return { source, text, bytes, budget, truncated: false };
  const hint = pointer ?? POINTERS[source];
  const marker = `\n… [${source} truncated from ${bytes} B to fit the ${budget} B budget; ${hint}]`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (markerBytes >= budget) {
    const only = sliceToBytes(marker, budget);
    return { source, text: only, bytes: Buffer.byteLength(only, "utf8"), budget, truncated: true };
  }
  const kept: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const lineBytes = Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0);
    if (used + lineBytes + markerBytes > budget) break;
    kept.push(line);
    used += lineBytes;
  }
  let head = kept.join("\n");
  if (head.length === 0) head = sliceToBytes(text, budget - markerBytes);
  const fitted = `${head}${marker}`;
  return { source, text: fitted, bytes: Buffer.byteLength(fitted, "utf8"), budget, truncated: true };
}
