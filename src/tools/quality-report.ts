import { smartTruncate } from "../utils/smart-truncate.ts";
import { existsSync } from "node:fs";
import type { TawassulContext } from "../context.ts";
import type { ToolDefinition, ToolContext } from "../tool.ts";
import { tool } from "../tool.ts";
import { t } from "../translations.ts";
import { secureExec } from "../utils/secure-exec.ts";
const EACH_TIMEOUT = 60000;
const MAX_LINES = 100;

interface CheckResult {
  name: string;
  passed: boolean;
  output: string;
  duration: number;
  exitCode: number | null;
}

async function runCheck(name: string, cmd: string, args: string[], dir: string): Promise<CheckResult> {
  const start = Date.now();
  try {
    const child = await secureExec(cmd, args, {
      timeout: EACH_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024,
      cwd: dir,
    });
    const duration = Date.now() - start;
    return {
      name,
      passed: true,
      output: smartTruncate(child.stdout, MAX_LINES) || t("qualityReportNoOutput"),
      duration,
      exitCode: 0,
    };
  } catch (e: unknown) {
    const duration = Date.now() - start;
    const err = e as { stderr?: string; stdout?: string; code?: string; status?: number; message?: string };
    const stderr = err.stderr || "";
    const stdout = err.stdout || "";
    const output = smartTruncate(stdout + "\n" + stderr, MAX_LINES) || err.message || t("qualityReportCmdFailed");
    return {
      name,
      passed: false,
      output,
      duration,
      exitCode: err.code === "ENOENT" ? -1 : (err.status ?? 1),
    };
  }
}

function detectPackageManager(dir: string): string {
  if (existsSync(dir + "/pnpm-lock.yaml")) return "pnpm";
  if (existsSync(dir + "/yarn.lock")) return "yarn";
  return "npm";
}

function lintCommand(pm: string): [string, string[]] {
  if (pm === "pnpm") return ["pnpm", ["lint"]];
  if (pm === "yarn") return ["yarn", ["lint"]];
  return ["npm", ["run", "lint"]];
}

function typecheckCommand(pm: string): [string, string[]] {
  if (pm === "pnpm") return ["pnpm", ["typecheck"]];
  if (pm === "yarn") return ["yarn", ["typecheck"]];
  return ["npm", ["run", "typecheck"]];
}

function testCommand(pm: string): [string, string[]] {
  if (pm === "pnpm") return ["pnpm", ["test", "--", "--reporter=verbose"]];
  if (pm === "yarn") return ["yarn", ["test", "--verbose"]];
  return ["npm", ["test"]];
}

export function buildQualityReportTool(_ctx: TawassulContext): ToolDefinition {
  return tool({
    description: [
      "Run quality checks (lint + typecheck + tests) combined in one command.",
      "Shows each check's result with pass/fail status and duration.",
      "Reduces the need for 3-4 separate bash calls.",
      "",
      "Examples:",
      "  quality_report()",
      '  quality_report(checks: ["lint", "typecheck"])  # run specific checks only',
    ].join("\n"),
    args: {
      checks: tool.schema
        .array(tool.schema.enum(["lint", "typecheck", "test"]))
        .optional()
        .describe("List of checks to run (default: all)"),
    },
    async execute(args: Record<string, unknown>, cctx: ToolContext) {
      const { checks } = args as { checks?: string[] };
      const pm = detectPackageManager(cctx.directory);

      const available: [string, string, string[]][] = [
        ["lint", ...lintCommand(pm)],
        ["typecheck", ...typecheckCommand(pm)],
        ["test", ...testCommand(pm)],
      ];

      const toRun = checks ? available.filter(([name]) => checks.includes(name)) : available;

      if (toRun.length === 0) {
        return { output: t("qualityReportNoChecks") };
      }

      const results = await Promise.all(toRun.map(([name, cmd, args]) => runCheck(name, cmd, args, cctx.directory)));

      const lines: string[] = [
        t("qualityReportTitle", { directory: cctx.directory }),
        t("qualityReportTimestamp", { time: new Date().toISOString().slice(0, 19).replace("T", " ") }),
        t("qualityReportPackageManager", { pm }),
        "",
      ];

      let allPassed = true;
      for (const r of results) {
        const icon = r.passed ? "✅" : r.exitCode === -1 ? "⚠️" : "❌";
        const status = r.passed
          ? t("qualityReportStatusPass")
          : r.exitCode === -1
            ? t("qualityReportStatusNotInstalled")
            : t("qualityReportStatusFail");
        const duration = r.duration > 1000 ? `${(r.duration / 1000).toFixed(1)}s` : `${r.duration}ms`;

        lines.push(`${icon} ${r.name} — ${status} (${duration})`);
        lines.push("");
        lines.push(r.output.trim());
        lines.push("");

        if (!r.passed) allPassed = false;
      }

      const failedCount = results.filter((r) => !r.passed).length;
      const summary = allPassed
        ? t("qualityReportAllPassed", { count: String(results.length) })
        : t("qualityReportSomeFailed", { failed: String(failedCount), total: String(results.length) });

      lines.push("—".repeat(40));
      lines.push(summary);

      return { output: lines.join("\n") };
    },
  });
}