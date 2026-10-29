


export const DEFAULT_RATE_LIMIT_PATTERNS: readonly string[] = [
  "429",
  "rate limit",
  "rate_limit",
  "rate-limit",
  "overloaded",
  "too many requests",
  "resource exhausted",
  "quota exceeded",
  "insufficient quota",
  "insufficient_quota",
  "exceeded your current quota",
];


export function matchesPatterns(text: unknown, patterns: readonly string[] = DEFAULT_RATE_LIMIT_PATTERNS): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  const lower = text.toLowerCase();
  for (const p of patterns) {
    if (typeof p === "string" && p.length > 0 && lower.includes(p.toLowerCase())) return true;
  }
  return false;
}


export function toolScopeOnlyHint(subject: string, object: string): string {
  return `⚠️ ${subject} — never search plugin files or the MCP server for ${object}.`;
}
