
export interface RecoveryResult {
  recovered: boolean;
  data: unknown;
  error?: string;
  strategiesApplied?: string[];
}

let recoveryFailures = 0;
let recoverySuccesses = 0;

export function getRecoveryStats() {
  return { recoveryFailures, recoverySuccesses };
}

export function resetRecoveryStats() {
  recoveryFailures = 0;
  recoverySuccesses = 0;
}

export function tryRecoverJSON(input: string): RecoveryResult {
  if (!input || typeof input !== "string") {
    recoveryFailures++;
    return { recovered: false, data: null, error: "Empty input" };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    recoveryFailures++;
    return { recovered: false, data: null, error: "Empty input" };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return { recovered: true, data: parsed };
  } catch {
    // Attempt recovery strategies
  }

  let attempt = trimmed;
  const strategies: string[] = [];

  const firstBrace = attempt.indexOf("{");
  const firstBracket = attempt.indexOf("[");
  const startIdx = firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket) ? firstBrace : firstBracket;
  if (startIdx > 0) {
    attempt = attempt.slice(startIdx);
    strategies.push("trimLeading");
  }

  const lastBrace = attempt.lastIndexOf("}");
  const lastBracket = attempt.lastIndexOf("]");
  const endIdx = lastBrace >= 0 && (lastBracket < 0 || lastBrace > lastBracket) ? lastBrace + 1 : lastBracket + 1;
  if (endIdx > 0 && endIdx < attempt.length) {
    attempt = attempt.slice(0, endIdx);
    strategies.push("trimTrailing");
  }

  if (attempt !== trimmed) strategies.push("trimBoth");

  const noTrailingComma = attempt.replace(/,(\s*[\]}])/g, "$1");
  if (noTrailingComma !== attempt) {
    strategies.push("fixTrailingComma");
    try {
      const parsed = JSON.parse(noTrailingComma);
      recoverySuccesses++;
      return { recovered: true, data: parsed, strategiesApplied: strategies };
    } catch {
      /* next strategy */
    }
  }

  const noSingleQuotes = attempt.replace(/'/g, '"');
  if (noSingleQuotes !== attempt) {
    strategies.push("fixSingleQuotes");
    try {
      const parsed = JSON.parse(noSingleQuotes);
      recoverySuccesses++;
      return { recovered: true, data: parsed, strategiesApplied: strategies };
    } catch {
      /* next strategy */
    }
  }

  try {
    const parsed = JSON.parse(attempt);
    recoverySuccesses++;
    return { recovered: true, data: parsed, strategiesApplied: strategies };
  } catch {
    recoveryFailures++;
    return { recovered: false, data: null, error: "Could not recover JSON" };
  }
}
