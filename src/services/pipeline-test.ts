import type { HandoffEntry } from "../context/types.ts";
import type {
  TestOutput,
  TestClassification,
  TestFailure,
  TestVerdict,
  ExecutionResultInput,
  PipelineDefinition,
} from "./pipeline.ts";
import { PASS_THRESHOLD, MINOR_THRESHOLD, MINOR_MAX_FAILURES, MAJOR_FAILURE_THRESHOLD } from "./pipeline.ts";

let handoffCounter = 0;

const INTEGRATION_PATTERNS = [
  /integration/i,
  /e2e/i,
  /end.to.end/i,
  /connect/i,
  /timeout/i,
  /network/i,
  /database/i,
  /db\./i,
  /mongo/i,
  /postgres/i,
  /sql/i,
  /api/i,
  /http/i,
  /fetch/i,
  /request/i,
  /service/i,
  /microservice/i,
  /container/i,
];
const PERFORMANCE_PATTERNS = [
  /performance/i,
  /perf/i,
  /slow/i,
  /\u0628\u0637\u064A\u0621/i,
  /latency/i,
  /throughput/i,
  /load/i,
  /stress/i,
  /timeout/i,
  /duration/i,
  /ms\s*>\s*\d+/i,
];
const SYNTAX_PATTERNS = [
  /syntax/i,
  /parse/i,
  /unexpected token/i,
  /unterminated/i,
  /missing/i,
  /expected/i,
  /TypeError/i,
  /ReferenceError/i,
  /undefined is not/i,
  /cannot find/i,
  /module/i,
  /import/i,
  /export/i,
];
const LOGIC_PATTERNS = [
  /logic/i,
  /expected/i,
  /assert/i,
  /toEqual/i,
  /toBe/i,
  /toMatch/i,
  /toContain/i,
  /should\s+(be|have|return|not)/i,
  /incorrect/i,
  /wrong/i,
  /mismatch/i,
];
const MAJOR_KEYWORDS = [
  /crash/i,
  /fatal/i,
  /panic/i,
  /abort/i,
  /security/i,
  /vulnerability/i,
  /exploit/i,
  /data loss/i,
  /corrupt/i,
  /broken/i,
  /regression/i,
  /blocker/i,
  /critical/i,
];

function categorizeFailure(message: string, testName: string): TestFailure["category"] {
  const m = message.toLowerCase();
  const n = testName.toLowerCase();
  if (INTEGRATION_PATTERNS.some((p) => p.test(m) || p.test(n))) return "integration";
  if (PERFORMANCE_PATTERNS.some((p) => p.test(m))) return "performance";
  if (SYNTAX_PATTERNS.some((p) => p.test(m))) return "syntax";
  if (LOGIC_PATTERNS.some((p) => p.test(m))) return "logic";
  return "unknown";
}

function determineSeverity(category: TestFailure["category"], message: string): TestFailure["severity"] {
  if (category === "integration" || category === "performance") return "major";
  if (MAJOR_KEYWORDS.some((p) => p.test(message))) return "major";
  return "minor";
}

function classifyFailures(rawFailures: Array<{ name: string; file: string; message: string }>): TestFailure[] {
  return rawFailures.map((f) => ({
    testName: f.name,
    file: f.file,
    errorMessage: f.message,
    category: categorizeFailure(f.message, f.name),
    severity: determineSeverity(categorizeFailure(f.message, f.name), f.message),
  }));
}

function determineVerdict(passRate: number, failures: TestFailure[]): TestVerdict {
  const majorFailures = failures.filter((f) => f.severity === "major");
  const integrationFailures = failures.filter((f) => f.category === "integration");
  const syntaxFailures = failures.filter((f) => f.category === "syntax");
  const allSyntax = failures.length === syntaxFailures.length;

  if (passRate >= PASS_THRESHOLD) return "pass";
  if (integrationFailures.length > 0) return "major";
  if (failures.length >= MAJOR_FAILURE_THRESHOLD) return "major";
  if (majorFailures.length > 0) return "major";
  if (passRate < MINOR_THRESHOLD) return "major";
  if (passRate >= MINOR_THRESHOLD && passRate < PASS_THRESHOLD) {
    if (allSyntax && failures.length < MINOR_MAX_FAILURES) return "minor";
    return "major";
  }
  if (allSyntax && failures.length < MINOR_MAX_FAILURES) return "minor";
  return "major";
}

function estimateDuration(fileCount: number, testTypes: string[]): number {
  let ms = fileCount * 10000;
  if (testTypes.includes("integration")) ms += 30000;
  if (testTypes.includes("performance")) ms += 60000;
  if (testTypes.includes("security")) ms += 45000;
  return Math.max(ms, 10000);
}

export function classifyTestResult(testOutput: TestOutput): TestClassification {
  const total = testOutput.total || 1;
  const passed = testOutput.passed;
  const failed = testOutput.failed;
  const passRate = total > 0 ? passed / total : 1;
  const failures = classifyFailures(testOutput.failures ?? []);
  return {
    verdict: determineVerdict(passRate, failures),
    passedTests: passed,
    failedTests: failed,
    totalTests: total,
    failures,
    passRate,
  };
}

export function routeTestFailure(
  classification: TestClassification,
  pipeline: PipelineDefinition,
): HandoffEntry | null {
  if (classification.verdict === "pass") return null;

  handoffCounter++;
  const id = `handoff-test-${Date.now()}-${handoffCounter}`;
  const failedFiles = [...new Set(classification.failures.map((f) => f.file))];
  const targetAgent = classification.verdict === "major" ? "@architect" : "@dev";

  const task =
    classification.verdict === "major"
      ? `🆘 MAJOR: ${classification.failedTests}/${classification.totalTests} tests failed — requires redesign`
      : `🔧 MINOR: ${classification.failedTests}/${classification.totalTests} tests failed — requires a fix`;

  const failureSummary = classification.failures
    .map((f) => `- **${f.testName}** (${f.file}): ${f.errorMessage} [${f.category}/${f.severity}]`)
    .join("\n");

  const context = [
    `## 📋 Test Results Summary`,
    ``,
    `- **Verdict**: ${classification.verdict === "major" ? "🔴 Major" : "🟡 Minor"}`,
    `- **Pass Rate**: ${(classification.passRate * 100).toFixed(1)}%`,
    `- **Passed**: ${classification.passedTests}/${classification.totalTests}`,
    `- **Failed**: ${classification.failedTests}/${classification.totalTests}`,
    ``,
    `## ❌ Failures`,
    failureSummary,
    ``,
    `## 📐 Pipeline`,
    `- **Phases**: ${pipeline.phases.join(" → ")}`,
    `- **Effort**: ${pipeline.effort}`,
    ``,
    classification.verdict === "major"
      ? `**Required action**: Redesign the solution — the problem is in the design, not the implementation`
      : `**Required action**: Fix the bugs in the implementation files, then re-run the tests`,
  ].join("\n");

  return {
    id,
    from: "@tester",
    to: targetAgent,
    task,
    context,
    files: failedFiles,
    timestamp: new Date().toISOString(),
    status: "pending",
  };
}

export function createTestPlan(executionResult: ExecutionResultInput): import("./pipeline.ts").TestPlan {
  const testTypes: string[] = ["unit"];
  const requiredAgents: string[] = ["@tester"];

  if (executionResult.filesChanged.some((f) => /api|service|route|controller|middleware/i.test(f)))
    testTypes.push("integration");
  if (executionResult.specializations?.some((s) => /performance|perf/i.test(s))) testTypes.push("performance");
  if (executionResult.specializations?.some((s) => /security/i.test(s))) testTypes.push("security");

  const testFiles = executionResult.filesChanged.map((f) =>
    f.replace(/^(src\/)?/, "tests/").replace(/\.[^.]+$/, ".test.ts"),
  );
  return {
    testTypes,
    files: testFiles,
    estimatedDuration: estimateDuration(testFiles.length, testTypes),
    requiredAgents: [...new Set(requiredAgents)],
  };
}

export function getRepairSuggestions(classification: TestClassification): string[] {
  if (classification.verdict === "pass") return ["✅ All tests passed — no repair needed"];

  const suggestions: string[] = [];
  const categories = new Map<TestFailure["category"], TestFailure[]>();
  for (const failure of classification.failures) {
    const arr = categories.get(failure.category) ?? [];
    arr.push(failure);
    categories.set(failure.category, arr);
  }

  for (const [category, failures] of categories) {
    switch (category) {
      case "syntax":
        suggestions.push(`🔧 Syntax errors in ${failures.length} tests — check imports and exports`);
        break;
      case "logic":
        suggestions.push(`🧠 Logic errors in ${failures.length} tests — review the expectations`);
        break;
      case "integration":
        suggestions.push(`🔗 Integration errors in ${failures.length} tests — check the API connections`);
        break;
      case "performance":
        suggestions.push(`⚡ Performance issues in ${failures.length} tests — analyze response latency`);
        break;
      case "unknown":
        suggestions.push(`❓ Unclassified failures in ${failures.length} tests — review the error messages manually`);
        break;
    }
  }

  if (classification.verdict === "major")
    suggestions.push("🚨 The problem is major — the solution may need a redesign, not just a fix");
  return suggestions;
}

export function summarizeTestResult(classification: TestClassification): string {
  const verdictEmoji: Record<TestVerdict, string> = { pass: "✅", minor: "🟡", major: "🔴" };
  const lines = [
    `${verdictEmoji[classification.verdict]} **Test result: ${classification.verdict.toUpperCase()}**`,
    ``,
    `- **Pass Rate**: ${(classification.passRate * 100).toFixed(1)}%`,
    `- **Total**: ${classification.totalTests}`,
    `- **Passed**: ${classification.passedTests}`,
    `- **Failed**: ${classification.failedTests}`,
  ];
  if (classification.failures.length > 0) {
    lines.push(``, `**Failures (${classification.failures.length}):**`);
    for (const failure of classification.failures.slice(0, 10)) {
      lines.push(`- ${failure.testName} (${failure.file}): [${failure.category}/${failure.severity}]`);
    }
    if (classification.failures.length > 10) lines.push(`- ... and ${classification.failures.length - 10} more failures`);
  }
  return lines.join("\n");
}