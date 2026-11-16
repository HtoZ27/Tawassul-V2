import { smartTruncate } from "../utils/smart-truncate.ts";
import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { t } from "../translations.ts";
import { hasScript, resolveProjectRunner, type Runner } from "../utils/package-manager.ts";
import { PKG_SAFE_SCRIPTS, probeHostBun, runPackageScript } from "../utils/secure-exec.ts";

const EACH_TIMEOUT = 60000;
const MAX_LINES = 100;
const CHECK_ORDER = ["lint", "typecheck", "test"] as const;

interface CheckResult {
  name: string;
  passed: boolean;
  defined: boolean;
  output: string;
  duration: number;
  exitCode: number | null;
}

async function runCheck(name: string, runner: Runner, dir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const child = await runPackageScript(runner, name, {
      timeout: EACH_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024,
      cwd: dir,
      projectRoot: dir,
    });
    const duration = Date.now() - start;
    return {
      name,
      passed: true,
      defined: true,
      output: smartTruncate(child.stdout, MAX_LINES) || t("qualityReportNoOutput"),
      duration,
      exitCode: 0,
    };
  } catch (e: unknown) {
    const duration = Date.now() - start;
    const err = e as { stderr?: string; stdout?: string; code?: string; status?: number; message?: string };
    const stderr = err.stderr || "";
    const stdout = err.stdout || "";
    const combined = (stdout + "\n" + stderr).trim();
    const output = smartTruncate(combined, MAX_LINES) || err.message || t("qualityReportCmdFailed");
    return {
      name,
      passed: false,
      defined: true,
      output,
      duration,
      exitCode: err.code === "ENOENT" ? -1 : (err.status ?? 1),
    };
  }
}

function missingScript(name: string): CheckResult {
  return {
    name,
    passed: true,
    defined: false,
    output: t("qualityReportNotDefinedOutput", { script: name }),
    duration: 0,
    exitCode: 0,
  };
}

export function buildQualityReportTool(_ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Run quality checks (lint + typecheck + tests) combined into one command.",
      "Shows each check's result with pass/fail status and duration.",
      "Reduces the need for 3-4 separate bash calls.",
      "",
      "Examples:",
      "  qualityreport()",
      '  qualityreport(checks: ["lint", "typecheck"])  # run specific checks only',
    ].join("\n"),
    args: {
      checks: tool.schema
        .array(tool.schema.enum(["lint", "typecheck", "test"]))
        .optional()
        .describe("List of checks to run (default: all)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const { checks } = args as { checks?: string[] };
      const resolution = await resolveProjectRunner(cctx.directory, {
        probeHostBun: async () => (await probeHostBun()) !== null,
        projectRoot: cctx.directory,
      });

      if (resolution.kind === "override-invalid") {
        return { output: t("qualityReportRunnerInvalid", { value: resolution.value.slice(0, 40) }) };
      }
      if (resolution.kind === "override-unavailable") {
        return { output: t("qualityReportRunnerUnavailable", { manager: resolution.manager }) };
      }
      if (resolution.kind === "pnp-unavailable") {
        return { output: t("qualityReportPnpUnavailable") };
      }
      if (resolution.kind === "none") {
        return { output: t("qualityReportNoPackageManager") };
      }

      const runner = resolution.runner;
      const manager = runner.kind === "path" ? runner.manager : "bun";
      const available = CHECK_ORDER.filter((name) => PKG_SAFE_SCRIPTS.has(name));
      const toRun = checks ? available.filter((name) => checks.includes(name)) : available;

      if (toRun.length === 0) {
        return { output: t("qualityReportNoChecks") };
      }

      const results: CheckResult[] = [];
      for (const name of toRun) {
        results.push(
          hasScript(cctx.directory, name)
            ? await runCheck(name, runner, cctx.directory)
            : missingScript(name),
        );
      }

      const lines: string[] = [
        t("qualityReportTitle", { directory: cctx.directory }),
        t("qualityReportTimestamp", { time: new Date().toISOString().slice(0, 19).replace("T", " ") }),
        t("qualityReportPackageManager", { pm: manager }),
        "",
      ];

      for (const r of results) {
        const icon = !r.defined ? "⚠️" : r.passed ? "✅" : r.exitCode === -1 ? "⚠️" : "❌";
        const status = !r.defined
          ? t("qualityReportStatusNotDefined")
          : r.passed
            ? t("qualityReportStatusPass")
            : r.exitCode === -1
              ? t("qualityReportStatusNotInstalled")
              : t("qualityReportStatusFail");
        const duration = r.duration > 1000 ? `${(r.duration / 1000).toFixed(1)}s` : `${r.duration}ms`;

        lines.push(`${icon} ${r.name} — ${status} (${duration})`);
        lines.push("");
        lines.push(r.output.trim());
        lines.push("");
      }

      const executed = results.filter((r) => r.defined);
      const failedCount = executed.filter((r) => !r.passed).length;
      const summary =
        executed.length === 0
          ? t("qualityReportNoDefinedChecks")
          : failedCount === 0
            ? t("qualityReportAllPassed", { count: String(executed.length) })
            : t("qualityReportSomeFailed", { count: String(failedCount) });

      lines.push("—".repeat(40));
      lines.push(summary);

      return { output: lines.join("\n") };
    },
  });
}
