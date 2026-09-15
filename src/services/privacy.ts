const SENSITIVE_PATTERNS: { regex: RegExp; replacement: string }[] = [
  { regex: /(--password[= ])\S+/gi, replacement: "$1***" },
  { regex: /(--token[= ])\S+/gi, replacement: "$1***" },
  { regex: /(--key[= ])\S+/gi, replacement: "$1***" },
  { regex: /(--secret[= ])\S+/gi, replacement: "$1***" },
  { regex: /(--api.?key[= ])\S+/gi, replacement: "$1***" },
  { regex: /(bearer\s+)\S+/gi, replacement: "$1***" },
  { regex: /(authorization:\s*)\S+/gi, replacement: "$1***" },
  { regex: /(?:ghp|gho|ghu|ghs|ghr|ghb)_[A-Za-z0-9_]{36,}/g, replacement: "gh*_***" },
  { regex: /github_pat_[A-Za-z0-9_]{36,}/g, replacement: "github_pat_***" },
  { regex: /(?:sk-|pk-)[A-Za-z0-9_-]{20,}/g, replacement: "sk-***" },
  { regex: /(?:AC|AKIA|ASIA)[A-Z0-9]{16,}/g, replacement: "AKIA***" },
];

export function sanitizeOutput(text: string): string {
  let result = text;
  for (const { regex, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

export function filterEnvKeys(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  const sensitiveKeys = ["TOKEN", "SECRET", "KEY", "PASSWORD", "API_KEY", "AUTH"];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    const isSensitive = sensitiveKeys.some((s) => k.toUpperCase().includes(s));
    result[k] = isSensitive ? "***" : v;
  }
  return result;
}
